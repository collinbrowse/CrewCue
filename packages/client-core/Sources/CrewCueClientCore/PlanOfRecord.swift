import Foundation

/// Why the client is asking the server for a new plan-of-record estimate. The server checks it too.
public enum PlanTrigger: String, Sendable, CaseIterable {
    /// The athlete's own history changed (or arrived on a cold start). Athlete only.
    case auto
    /// Crew seeds the first estimate when the room has no plan of record yet.
    case coldStart = "cold_start"
    /// Someone tapped Recalculate.
    case recalculate
}

public enum PlanAuthorityError: Error, Equatable, Sendable {
    case notAllowed

    public var message: String {
        "Only the athlete's history updates the plan automatically."
    }
}

extension PlanAuthority {
    /// Only the athlete's history may automatically create or recompute the plan of record.
    /// Crew may seed a cold start (no plan yet) or tap Recalculate.
    public static func allows(role: String, trigger: PlanTrigger, hasPlanOfRecord: Bool) -> Bool {
        switch trigger {
        case .auto:
            mayAutoRecompute(role: role)
        case .coldStart:
            maySeedColdStart(role: role) && (mayAutoRecompute(role: role) || !hasPlanOfRecord)
        case .recalculate:
            mayExplicitRecalculate(role: role)
        }
    }
}

public enum PlanOfRecord {
    /// Computes an estimate for the room and attaches it as the plan of record. Refused locally,
    /// before any request, when the role may not use this trigger.
    ///
    /// An unpaid race takes a plan only for its current course length. When the course changed
    /// between the compute and the attach, the attach answers 400 `course_mismatch`; the estimate
    /// is then computed and attached once more, with nothing shown to the person.
    public static func recompute(
        graph: ClientGraph,
        roomId: String,
        role: String,
        trigger: PlanTrigger,
        hasPlanOfRecord: Bool
    ) async throws -> PacingEstimate {
        guard PlanAuthority.allows(role: role, trigger: trigger, hasPlanOfRecord: hasPlanOfRecord) else {
            throw PlanAuthorityError.notAllowed
        }
        return try await computeAndAttach(graph: graph, roomId: roomId, trigger: trigger)
    }

    /// The history step's two estimates: one from no history at all (`historyRefIds: []`, a cold
    /// start) and one from all of the athlete's history, which is attached as the plan. Athlete
    /// only, like every `auto` estimate.
    public static func recomputeComparingHistory(
        graph: ClientGraph,
        roomId: String,
        role: String
    ) async throws -> HistoryComparison {
        guard PlanAuthority.allows(role: role, trigger: .auto, hasPlanOfRecord: true) else {
            throw PlanAuthorityError.notAllowed
        }
        let withoutHistory = try await compute(graph: graph, roomId: roomId, trigger: .auto, historyRefIds: [])
        let attached = try await computeAndAttach(graph: graph, roomId: roomId, trigger: .auto)
        return HistoryComparison(withoutHistory: withoutHistory, attached: attached)
    }

    /// The history step's Skip: a rough estimate from no history at all (`historyRefIds: []`, a
    /// cold start), attached as the plan, even when the athlete has imported past runs. Athlete
    /// only, like every `auto` estimate.
    public static func recomputeWithoutHistory(
        graph: ClientGraph,
        roomId: String,
        role: String
    ) async throws -> PacingEstimate {
        guard PlanAuthority.allows(role: role, trigger: .auto, hasPlanOfRecord: true) else {
            throw PlanAuthorityError.notAllowed
        }
        return try await computeAndAttach(graph: graph, roomId: roomId, trigger: .auto, historyRefIds: [])
    }

    /// `POST /pacing-estimates` for the room, not attached. `historyRefIds` nil uses all of the
    /// athlete's history; an empty list uses none.
    public static func compute(
        graph: ClientGraph,
        roomId: String,
        trigger: PlanTrigger,
        historyRefIds: [String]? = nil
    ) async throws -> PacingEstimate {
        var body: [String: Any] = ["roomId": roomId, "trigger": trigger.rawValue]
        if let historyRefIds { body["historyRefIds"] = historyRefIds }
        return try await send(graph, "/pacing-estimates", method: .post, body: body)
    }

    /// `PUT /race-rooms/:roomId/pacing-estimate`: makes a computed estimate the plan of record.
    public static func attach(
        graph: ClientGraph,
        roomId: String,
        estimateId: String,
        trigger: PlanTrigger
    ) async throws -> PacingEstimate {
        let attached: AttachEnvelope = try await send(
            graph,
            "/race-rooms/\(roomId)/pacing-estimate",
            method: .put,
            body: ["pacingEstimateId": estimateId, "trigger": trigger.rawValue]
        )
        return attached.estimate
    }

    /// 400 `course_mismatch`: the estimate was computed for another course length than the race has now.
    public static func isCourseMismatch(_ error: any Error) -> Bool {
        guard let http = error as? ClientHTTPError, http.status == 400 else { return false }
        return http.reason == "course_mismatch" || http.decision == "course_mismatch"
    }

    private static func computeAndAttach(
        graph: ClientGraph,
        roomId: String,
        trigger: PlanTrigger,
        historyRefIds: [String]? = nil
    ) async throws -> PacingEstimate {
        let computed = try await compute(graph: graph, roomId: roomId, trigger: trigger, historyRefIds: historyRefIds)
        do {
            return try await attach(graph: graph, roomId: roomId, estimateId: computed.id, trigger: trigger)
        } catch where isCourseMismatch(error) {
            let again = try await compute(graph: graph, roomId: roomId, trigger: trigger, historyRefIds: historyRefIds)
            return try await attach(graph: graph, roomId: roomId, estimateId: again.id, trigger: trigger)
        }
    }

    private struct AttachEnvelope: Decodable {
        var estimate: PacingEstimate
    }

    private static func send<T: Decodable>(
        _ graph: ClientGraph,
        _ path: String,
        method: HTTPMethod,
        body: [String: Any]
    ) async throws -> T {
        guard let baseURL = graph.baseURL, let url = APIClient.endpoint(baseURL, path) else {
            throw ClientHTTPError(status: 0, message: "API base URL is not configured.")
        }
        let token = await graph.tokenProvider?.accessToken()
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        let request = APIClient.authorized(url: url, method: method, token: token, body: data)
        return try await APIClient.send(request, transport: graph.transport)
    }
}

/// The history step's comparison: the finish without any history, and with it (the plan).
public struct HistoryComparison: Equatable, Sendable {
    public var withoutHistory: PacingEstimate
    public var attached: PacingEstimate

    public init(withoutHistory: PacingEstimate, attached: PacingEstimate) {
        self.withoutHistory = withoutHistory
        self.attached = attached
    }

    /// "Finish 9:42 AM instead of 10:15 AM", or nil when the two finishes print the same.
    public func line(timeZone: TimeZone = DeviceTimeZone.current, locale: Locale = .current) -> String? {
        OnboardingCopy.historyComparison(
            withHistoryFinishAt: attached.expectedFinishAt,
            withoutHistoryFinishAt: withoutHistory.expectedFinishAt,
            timeZone: timeZone,
            locale: locale
        )
    }
}
