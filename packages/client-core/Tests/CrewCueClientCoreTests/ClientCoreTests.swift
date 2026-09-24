import Foundation
import Testing
@testable import CrewCueClientCore

@Test func helloStampIsStable() {
    #expect(CrewCueClientCore.helloStamp() == "CrewCue")
}

@Test func durationFormattingMatchesMobileCases() {
    #expect(ScheduleFormat.formatDurationSeconds(0) == "00:00")
    #expect(ScheduleFormat.formatDurationSeconds(65) == "01:05")
    #expect(ScheduleFormat.formatDurationSeconds(600) == "10:00")
    #expect(ScheduleFormat.formatDurationSeconds(3599) == "59:59")
    #expect(ScheduleFormat.formatDurationSeconds(3600) == "1:00:00")
    #expect(ScheduleFormat.formatDurationSeconds(4200) == "1:10:00")
    #expect(ScheduleFormat.formatDurationSeconds(14700) == "4:05:00")
    #expect(ScheduleFormat.formatDurationSeconds(-1) == "—")
    #expect(ScheduleFormat.formatDurationSeconds(.nan) == "—")
}

@Test func scheduleClockRejectsInvalidISO() {
    #expect(ScheduleFormat.formatScheduleClock("not-a-date") == "—")
    #expect(ScheduleFormat.formatScheduleClock("2026-08-15T14:10:00.000Z") != "—")
    #expect(ScheduleFormat.formatUtcHhMm("2026-08-15T14:10:00.000Z") == "14:10 UTC")
}

@Test func scheduleSheetSuccessIncludesAidDuration() throws {
    let screen = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet"))
    #expect(screen.accessibilityIdentifier == "crewcue.schedule-sheet")
    #expect(screen.body.contains("1:10:00"))
    #expect(screen.body.contains("Aid 1"))
    #expect(screen.body.contains("Finish  5:50:00  18:50 UTC"))
}

@Test func scheduleSheetStates() throws {
    let empty = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet?state=empty"))
    #expect(empty.body == "No stops on this sheet.")
    let error = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet?state=error"))
    #expect(error.body == "Couldn't load the schedule.")
    let offline = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/schedule-sheet?state=offline"))
    #expect(offline.body == "Offline. Schedule not updated.")
}

@Test func estimateRecomputeDetectsHistoryChange() {
    let first = EstimateRecompute.decide(
        EstimateRecomputeInput(
            canEdit: true,
            busy: false,
            estimateId: "est",
            coldStart: true,
            usableHistoryCount: 1,
            historyFingerprint: "a",
            record: .empty
        )
    )
    #expect(first.reason == .coldStartWithHistory)
    #expect(first.recompute)
    let next = EstimateRecompute.decide(
        EstimateRecomputeInput(
            canEdit: true,
            busy: false,
            estimateId: "est",
            coldStart: false,
            usableHistoryCount: 1,
            historyFingerprint: "b",
            record: first.nextRecord
        )
    )
    #expect(next.reason == .historyChanged)
}

@Test func outboxMergeAndRetry() {
    let first = OutboxOperation(id: "1", type: "ping", status: "pending", conflictKey: "ping")
    let replacement = OutboxOperation(id: "2", type: "ping", status: "pending", conflictKey: "other")
    let merged = OutboxPolicy.merge([first], replacement, conflictKey: "ping")
    #expect(merged.count == 1)
    #expect(merged[0].id == "2")
    #expect(OutboxPolicy.isSafeRetry(first))
    #expect(!OutboxPolicy.isSafeRetry(OutboxOperation(id: "3", type: "task", status: "pending", conflictKey: "t")))
    let rejected = OutboxPolicy.resolve(ClientHTTPError(status: 422, message: "no", decision: "rejected"))
    #expect(rejected.status == "rejected")
    #expect(rejected.feedback == "Rejected by server policy.")
}

@Test func checkInValidation() {
    if case .invalid(let message) = CheckIn.validate(arrivalAt: "", departureAt: "") {
        #expect(message == "Arrival and departure are required.")
    } else {
        Issue.record("expected empty check-in to fail")
    }
    if case .invalid(let message) = CheckIn.validate(arrivalAt: "2026-08-15T14:16:00.000Z", departureAt: "2026-08-15T14:10:00.000Z") {
        #expect(message == "Departure must be after arrival.")
    } else {
        Issue.record("expected reversed check-in to fail")
    }
    if case .ok = CheckIn.validate(arrivalAt: "2026-08-15T14:10:00.000Z", departureAt: "2026-08-15T14:16:00.000Z") {
    } else {
        Issue.record("expected a valid check-in")
    }
}

@Test func mentionsFindAda() {
    let tokens = Mentions.parse("See @Ada at aid 1", members: [MentionMember(userId: "u1", displayName: "Ada")])
    #expect(tokens.contains { if case .mention(let name, let userId) = $0 { return name == "Ada" && userId == "u1" }; return false })
}

@Test func healthFixtureRoundTrip() throws {
    let url = try #require(Bundle.module.url(forResource: "health-status", withExtension: "json"))
    let data = try Data(contentsOf: url)
    let health = try APIClient.decodeHealth(data)
    #expect(health.service == "api")
    #expect(health.status == "ok")
    #expect(health.timestamp == "2026-09-23T00:00:00.000Z")
}

@Test func idempotencyKeyIsStable() {
    let key = IdempotencyKey.hashPayload(#"{"roomId":"room-fixture-50k"}"#)
    #expect(key == IdempotencyKey.hashPayload(#"{"roomId":"room-fixture-50k"}"#))
    #expect(key.count == 16)
    #expect(key != IdempotencyKey.hashPayload(#"{"roomId":"other"}"#))
}

@Test func deeplinkAliasForPaceEstimate() throws {
    let screen = try #require(CrewCueClientCore.featureScreen(forCrewCueURL: "crewcue://dev/pace-estimate?state=empty"))
    #expect(screen.featureId == "pace-estimate")
    #expect(screen.body == "No estimate yet.")
}

struct MockTransport: HTTPTransport {
    func send(url: URL, method: HTTPMethod) async throws -> HTTPResponse {
        let body = try Data(contentsOf: Bundle.module.url(forResource: "health-status", withExtension: "json")!)
        return HTTPResponse(status: 200, body: body)
    }
}

@Test func fetchHealthUsesTransport() async throws {
    let health = try await APIClient.fetchHealth(baseURL: URL(string: "https://example.invalid")!, transport: MockTransport())
    #expect(health.service == "api")
}
