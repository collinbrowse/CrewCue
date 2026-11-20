import Foundation

/// The replay's shared state: which step is on screen and whether the replay ended. The player
/// moves it; the transport and the clock read it.
final class DemoRaceWorld: @unchecked Sendable {
    let script: DemoRaceScript
    private let lock = NSLock()
    private var index = 0
    private var ended = false
    private var waiters: [UUID: CheckedContinuation<Void, Never>] = [:]
    private var timers: [UUID: Task<Void, Never>] = [:]

    init(script: DemoRaceScript) {
        self.script = script
    }

    var step: DemoRaceStep {
        lock.lock()
        defer { lock.unlock() }
        return script.steps[index]
    }

    var isEnded: Bool {
        lock.lock()
        defer { lock.unlock() }
        return ended
    }

    /// Moves forward only. True when the step changed; waiting long-polls then look again.
    @discardableResult
    func advance(to next: Int) -> Bool {
        lock.lock()
        let target = min(max(next, 0), script.steps.count - 1)
        guard !ended, target > index else {
            lock.unlock()
            return false
        }
        index = target
        lock.unlock()
        wakeAll()
        return true
    }

    func end() {
        lock.lock()
        ended = true
        lock.unlock()
        wakeAll()
    }

    /// Returns when the step changes, the replay ends, `seconds` pass, or the task is cancelled.
    func waitForChange(seconds: Double) async {
        let id = UUID()
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                lock.lock()
                if ended || Task.isCancelled {
                    lock.unlock()
                    continuation.resume()
                    return
                }
                waiters[id] = continuation
                timers[id] = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
                    self?.wake(id)
                }
                lock.unlock()
            }
        } onCancel: {
            self.wake(id)
        }
    }

    private func wake(_ id: UUID) {
        lock.lock()
        let waiter = waiters.removeValue(forKey: id)
        let timer = timers.removeValue(forKey: id)
        lock.unlock()
        timer?.cancel()
        waiter?.resume()
    }

    private func wakeAll() {
        lock.lock()
        let all = Array(waiters.values)
        let pending = Array(timers.values)
        waiters.removeAll()
        timers.removeAll()
        lock.unlock()
        pending.forEach { $0.cancel() }
        all.forEach { $0.resume() }
    }
}

/// The replay's clock: the simulated race time of the step on screen.
public struct DemoRaceClock: Clock {
    let world: DemoRaceWorld

    public func now() -> Date {
        world.step.now
    }
}

/// Answers the race-day routes from the script, in the wire shapes `RaceDayAPI` decodes and in the
/// unpaid teaser shape: `locked.checkpointIds` on projection and schedule, no aid or other
/// mid-course ETA anywhere. Only its own host, only GETs, never real I/O.
public final class DemoRaceTransport: HTTPTransport, @unchecked Sendable {
    public let baseURL: URL
    let world: DemoRaceWorld

    init(baseURL: URL, world: DemoRaceWorld) {
        self.baseURL = baseURL
        self.world = world
    }

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        let url = request.url
        guard url.scheme?.lowercased() == baseURL.scheme?.lowercased(),
              url.host?.lowercased() == baseURL.host?.lowercased(),
              url.port == baseURL.port else {
            throw DemoRaceError.foreignHost(url.absoluteString)
        }
        guard request.method == .get else {
            throw DemoRaceError.readOnly("\(request.method.rawValue) \(url.path)")
        }
        guard !world.isEnded else { throw DemoRaceError.ended }
        let parts = url.path.split(separator: "/").map(String.init)
        let query = Self.query(url)
        let course = world.script.course
        if parts == ["health"] {
            return try json(HealthStatus(service: "api", status: "ok", timestamp: RaceDayReadouts.iso8601(world.step.now)))
        }
        if parts.count >= 2, parts[0] == "race-rooms" {
            guard parts[1] == course.roomId else { return notFound("Race room not found") }
            switch Array(parts.dropFirst(2)) {
            case []: return HTTPResponse(status: 200, body: course.roomBody)
            case ["schedule"]: return try json(schedule())
            case ["projection"]: return try projection()
            case ["pings", "latest"]: return try json(latestPing())
            case ["pings", "track"]: return try json(track(after: query["after"], limit: Int(query["limit"] ?? "")))
            default: return notFound("Not part of the race-day replay")
            }
        }
        if parts.count == 4, parts[0] == "chat", parts[1] == "rooms", parts[3] == "messages" {
            guard parts[2] == course.roomId else { return notFound("Race room not found") }
            return try await chat(query)
        }
        return notFound("Not part of the race-day replay")
    }

    private func schedule() -> CrewScheduleSheet {
        let course = world.script.course
        let finish = course.raceStart.addingTimeInterval(course.plannedFinishSeconds)
        return CrewScheduleSheet(
            roomId: course.roomId,
            raceStartAt: RaceDayReadouts.iso8601(course.raceStart),
            stops: [
                ScheduleStop(
                    id: "stop-\(course.startCheckpointId)", checkpointId: course.startCheckpointId,
                    clockArrivalAt: RaceDayReadouts.iso8601(course.raceStart), elapsedSeconds: 0, plannedStoppageSeconds: 0
                ),
                ScheduleStop(
                    id: "stop-\(course.finishCheckpointId)", checkpointId: course.finishCheckpointId,
                    clockArrivalAt: RaceDayReadouts.iso8601(finish), elapsedSeconds: course.plannedFinishSeconds, plannedStoppageSeconds: 0
                )
            ],
            pacingEstimateId: course.pacingEstimateId,
            locked: TeaserLockedCheckpoints(checkpointIds: course.lockedCheckpointIds)
        )
    }

    private func projection() throws -> HTTPResponse {
        let step = world.step
        let course = world.script.course
        let latest = world.script.pings(through: step.index).last
        let core = RaceRoomProjectionCore(
            roomId: course.roomId,
            asOfPingId: latest?.pingId ?? LiveProjection.bootstrapPingId,
            asOfRecordedAt: RaceDayReadouts.iso8601(latest?.recordedAt ?? course.raceStart),
            progressMeters: latest?.progressMeters ?? 0,
            courseLengthMeters: course.courseLengthMeters,
            plannedPaceSecondsPerKm: course.plannedPaceSecondsPerKm,
            etaFinishPlanIso: RaceDayReadouts.iso8601(step.finishEtaAt),
            checkpointSplits: [],
            stoppageSummary: CheckpointStoppageSummary(
                totalPlannedStopSeconds: course.plannedStopSeconds,
                totalActualStopSeconds: 0,
                remainingPlannedStopSeconds: course.plannedStopSeconds
            ),
            remainingCheckpointEtas: [],
            locked: TeaserLockedCheckpoints(checkpointIds: course.lockedCheckpointIds)
        )
        let since = latest.map { max(0, step.now.timeIntervalSince($0.recordedAt)) } ?? DemoRaceScript.stalenessThresholdSeconds
        let timeliness = ProjectionTimeliness(
            projectionConfidence: latest != nil && since <= DemoRaceScript.stalenessThresholdSeconds ? "fresh" : "degraded",
            stalenessThresholdSeconds: DemoRaceScript.stalenessThresholdSeconds,
            secondsSinceLastAcceptedPing: since,
            evaluatedAt: RaceDayReadouts.iso8601(step.now)
        )
        // The route sends the core and its timeliness as one object.
        var object = try Self.object(core)
        for (key, value) in try Self.object(timeliness) {
            object[key] = value
        }
        return HTTPResponse(status: 200, body: try JSONSerialization.data(withJSONObject: object))
    }

    private func latestPing() -> RaceRoomLatestPingResponse {
        let step = world.step
        let latest = world.script.pings(through: step.index).last
        return RaceRoomLatestPingResponse(
            roomId: world.script.course.roomId,
            ping: latest.map {
                AthleteLatestPing(
                    pingId: $0.pingId, latitude: $0.latitude, longitude: $0.longitude,
                    recordedAt: RaceDayReadouts.iso8601($0.recordedAt), receivedAt: RaceDayReadouts.iso8601($0.receivedAt),
                    progressMeters: $0.progressMeters
                )
            },
            stalenessThresholdSeconds: DemoRaceScript.stalenessThresholdSeconds,
            evaluatedAt: RaceDayReadouts.iso8601(step.now)
        )
    }

    /// The runner's path after `after` (exclusive), oldest first; `nextCursor` on a full page. The
    /// path runs along the course line (`DemoRaceScript.track(through:)`), not ping to ping.
    private func track(after: String?, limit: Int?) -> RaceRoomPingTrackResponse {
        let cap = min(max(limit ?? 1000, 1), 1000)
        let cursor = after.flatMap(ScheduleFormat.parseISO8601)
        let served = world.script.track(through: world.step.index)
        var start = served.startIndex
        if let cursor {
            start = served.firstIndex { $0.recordedAt > cursor } ?? served.endIndex
            // A point whose millisecond wire time is the cursor's own was sent already.
            while start < served.endIndex,
                  let wire = ScheduleFormat.parseISO8601(RaceDayReadouts.iso8601(served[start].recordedAt)), wire <= cursor {
                start += 1
            }
        }
        let points = served[start...]
            .prefix(cap)
            .map { AthleteTrackPoint(recordedAt: RaceDayReadouts.iso8601($0.recordedAt), latitude: $0.latitude, longitude: $0.longitude) }
        return RaceRoomPingTrackResponse(
            roomId: world.script.course.roomId,
            points: Array(points),
            nextCursor: points.count == cap ? points.last?.recordedAt : nil
        )
    }

    /// `GET /chat/rooms/:roomId/messages`: the newest page, `before` for older, or `after` with
    /// `wait` to long-poll until the crew message arrives, the wait passes, or the replay ends.
    private func chat(_ query: [String: String]) async throws -> HTTPResponse {
        let limit = min(max(Int(query["limit"] ?? "") ?? 50, 1), 100)
        if let after = query["after"].flatMap({ Int($0) }) {
            let wait = Double(query["wait"].flatMap { Int($0) } ?? 0)
            let deadline = ProcessInfo.processInfo.systemUptime + wait
            var newer = messages().filter { $0.seq > after }
            while newer.isEmpty, wait > 0, !Task.isCancelled {
                let remaining = deadline - ProcessInfo.processInfo.systemUptime
                guard remaining > 0 else { break }
                await world.waitForChange(seconds: remaining)
                if world.isEnded { throw DemoRaceError.ended }
                newer = messages().filter { $0.seq > after }
            }
            let page = Array(newer.prefix(limit))
            return try json(chatPage(page, latest: page.last.map { String($0.seq) } ?? String(after), older: nil))
        }
        let all = messages()
        let before = query["before"].flatMap { Int($0) }
        let pool = before.map { cursor in all.filter { $0.seq < cursor } } ?? all
        let page = Array(pool.suffix(limit))
        let older = before == nil && (page.first.map { first in all.contains { $0.seq < first.seq } } ?? false)
            ? page.first.map { String($0.seq) } : nil
        let latest = before == nil ? page.last : all.last
        return try json(chatPage(page, latest: latest.map { String($0.seq) } ?? "", older: older))
    }

    private func messages() -> [DemoRaceChatMessage] {
        world.script.chat(through: world.step.index).sorted { $0.seq < $1.seq }
    }

    private func chatPage(_ page: [DemoRaceChatMessage], latest: String, older: String?) -> ChatMessagePage {
        let course = world.script.course
        let crew = ChatRoomMember(userId: DemoRaceScript.crewUserId, displayName: DemoRaceScript.crewDisplayName)
        return ChatMessagePage(
            messages: page.map {
                ChatMessage(
                    id: String($0.seq), roomId: course.roomId, senderUserId: $0.senderUserId,
                    clientMessageId: "demo-chat-\($0.seq)", text: $0.text, createdAt: RaceDayReadouts.iso8601($0.createdAt)
                )
            },
            members: course.members + [crew],
            selfUserId: course.viewerUserId,
            olderCursor: older,
            latestCursor: latest
        )
    }

    private func json<T: Encodable>(_ value: T) throws -> HTTPResponse {
        HTTPResponse(status: 200, body: try JSONEncoder().encode(value))
    }

    private func notFound(_ message: String) -> HTTPResponse {
        HTTPResponse(status: 404, body: Data(#"{"error":"\#(message)"}"#.utf8))
    }

    private static func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        (try JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any]) ?? [:]
    }

    private static func query(_ url: URL) -> [String: String] {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        return items.reduce(into: [:]) { result, item in
            if let value = item.value { result[item.name] = value }
        }
    }
}
