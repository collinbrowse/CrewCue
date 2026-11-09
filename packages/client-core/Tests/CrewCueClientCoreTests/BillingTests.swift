import Foundation
import Testing
@testable import CrewCueClientCore

private struct BillingTestLogger: Logger {
    func log(_ message: String) {}
}

/// Answers GET /billing unpaid for the first `lateReads` reads, then paid: a webhook that lands late.
private final class DelayedWebhookTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var reads = 0
    let lateReads: Int
    let paidBody: String

    init(lateReads: Int, paidBody: String) {
        self.lateReads = lateReads
        self.paidBody = paidBody
    }

    var readCount: Int { lock.withLock { reads } }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        guard request.method == .get, request.url.path == "/race-rooms/room-1/billing" else {
            return HTTPResponse(status: 404, body: Data(#"{"error":"Not found"}"#.utf8))
        }
        let n = lock.withLock { () -> Int in
            reads += 1
            return reads
        }
        let body = n <= lateReads ? unpaidBody : paidBody
        return HTTPResponse(status: 200, body: Data(body.utf8))
    }
}

private let unpaidBody = #"{"roomId":"room-1","entitlement":{"status":"unpaid","lastUpdatedAt":"2026-11-09T00:00:00Z","source":"manual","crewTier":"one"},"crewCount":0,"crewLimit":1,"offers":["race_pass","race_pass_full_crew"]}"#
private let passBody = #"{"roomId":"room-1","entitlement":{"status":"paid","lastUpdatedAt":"2026-11-09T00:00:00Z","source":"provider_webhook","crewTier":"one"},"crewCount":1,"crewLimit":1,"offers":["crew_upgrade"]}"#
private let fullCrewBody = #"{"roomId":"room-1","entitlement":{"status":"paid","lastUpdatedAt":"2026-11-09T00:00:00Z","source":"provider_webhook","crewTier":"unlimited"},"crewCount":3,"offers":[]}"#

private struct OfflineBillingTransport: HTTPTransport {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        throw URLError(.notConnectedToInternet)
    }
}

private func billingGraph(_ transport: some HTTPTransport) -> ClientGraph {
    ClientGraph(
        transport: transport,
        clock: SystemClock(),
        logger: BillingTestLogger(),
        baseURL: URL(string: "https://api.test"),
        tokenProvider: StaticTokenProvider(token: "token")
    )
}

private let instantPoll = EntitlementPollPolicy(attempts: 5, intervalSeconds: 2, sleep: { _ in })

@Test func billingStateMapsWireAndOffers() throws {
    let wire = try JSONDecoder().decode(RaceRoomBilling.self, from: Data(passBody.utf8))
    let state = RoomBillingState(wire)
    #expect(state.isPaid)
    #expect(!state.isUnlimited)
    #expect(state.crewLimit == 1)
    #expect(!state.hasCrewSeat)
    #expect(state.offers == [.crewUpgrade])
    #expect(state.satisfies(.racePass))
    #expect(!state.satisfies(.crewUpgrade))
    #expect(state.summary == "Race Pass: you plus 1 crew member (1 of 1 joined).")

    let full = RoomBillingState(try JSONDecoder().decode(RaceRoomBilling.self, from: Data(fullCrewBody.utf8)))
    #expect(full.isUnlimited)
    #expect(full.hasCrewSeat)
    #expect(full.satisfies(.racePassFullCrew))
    #expect(full.offers.isEmpty)
}

@Test func roomsStoredBeforeBillingReadAsUnlimited() throws {
    let legacy = #"{"roomId":"room-1","entitlement":{"status":"paid","lastUpdatedAt":"x","source":"manual"},"crewCount":4,"offers":[]}"#
    let state = RoomBillingState(try JSONDecoder().decode(RaceRoomBilling.self, from: Data(legacy.utf8)))
    #expect(state.isUnlimited)
}

@Test func lateWebhookIsPolledUntilTheRoomUnlocks() async {
    let transport = DelayedWebhookTransport(lateReads: 3, paidBody: passBody)
    let phase = await BillingFlow.complete(
        graph: billingGraph(transport),
        roomId: "room-1",
        product: .racePass,
        store: .purchased,
        poll: instantPoll
    )
    guard case .unlocked(let state) = phase else {
        Issue.record("expected unlocked, got \(phase)")
        return
    }
    #expect(state.isPaid)
    #expect(transport.readCount == 4)
}

@Test func webhookLaterThanThePollEndsPendingNotFailed() async {
    let transport = DelayedWebhookTransport(lateReads: 100, paidBody: passBody)
    let phase = await BillingFlow.complete(
        graph: billingGraph(transport),
        roomId: "room-1",
        product: .racePass,
        store: .purchased,
        poll: instantPoll
    )
    #expect(phase == .pending(.racePass))
    #expect(transport.readCount == 5)
    #expect(phase.message.contains("Payment received"))
}

@Test func upgradeWaitsForUnlimitedNotJustPaid() async {
    // Paid-but-one for two reads, then the upgrade lands.
    let transport = DelayedWebhookTransport(lateReads: 0, paidBody: passBody)
    let stillOne = await BillingFlow.awaitUnlock(
        graph: billingGraph(transport),
        roomId: "room-1",
        product: .crewUpgrade,
        poll: EntitlementPollPolicy(attempts: 2, intervalSeconds: 0, sleep: { _ in })
    )
    #expect(stillOne == .pending(.crewUpgrade))

    let upgraded = DelayedWebhookTransport(lateReads: 1, paidBody: fullCrewBody)
    let phase = await BillingFlow.awaitUnlock(
        graph: billingGraph(upgraded),
        roomId: "room-1",
        product: .crewUpgrade,
        poll: instantPoll
    )
    guard case .unlocked(let state) = phase else {
        Issue.record("expected unlocked, got \(phase)")
        return
    }
    #expect(state.isUnlimited)
}

@Test func cancelledAndOfflinePurchasesMapToTheirStates() async {
    let graph = billingGraph(OfflineBillingTransport())
    let cancelled = await BillingFlow.complete(graph: graph, roomId: "room-1", product: .racePass, store: .cancelled, poll: instantPoll)
    #expect(cancelled == .cancelled)

    let offline = await BillingFlow.complete(
        graph: graph,
        roomId: "room-1",
        product: .racePass,
        store: .failed(message: "The Internet connection appears to be offline.", offline: true),
        poll: instantPoll
    )
    #expect(offline == .failed(BillingErrors.offline))
    #expect(offline.message == "Offline. Purchases need the network.")

    let declined = await BillingFlow.complete(
        graph: graph,
        roomId: "room-1",
        product: .racePass,
        store: .failed(message: "Payment declined.", offline: false),
        poll: instantPoll
    )
    #expect(declined.message == "Payment declined.")
    #expect(BillingErrors.userFacing(URLError(.notConnectedToInternet)) == BillingErrors.offline)
}

@Test func crewLimitConflictIsRecognized() {
    let body = Data(#"{"error":"Crew limit reached","code":"crew_limit_reached","roomId":"room-1","crewLimit":1,"crewCount":1,"upgradeProductId":"crew_upgrade"}"#.utf8)
    let error = APIClient.failure(status: 409, data: body)
    #expect(BillingErrors.isCrewLimit(error))
    #expect(!BillingErrors.isCrewLimit(APIClient.failure(status: 409, data: Data(#"{"error":"Invite is not pending"}"#.utf8))))
    #expect(!BillingErrors.isCrewLimit(URLError(.notConnectedToInternet)))
}

@Test func productIdsMatchTheStores() {
    #expect(BillingProduct.allCases.map(\.rawValue) == ["race_pass", "crew_upgrade", "race_pass_full_crew"])
    #expect(BillingProduct.roomAttribute == "crewcue_room_id")
}

/// Records dev purchases and answers billing from what was bought.
private final class FakeStoreServer: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var bought: [String] = []

    var purchases: [String] { lock.withLock { bought } }

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if request.method == .post, request.url.path == "/race-rooms/room-1/billing/dev-purchase" {
            let body = String(decoding: request.body ?? Data(), as: UTF8.self)
            lock.withLock { bought.append(body) }
            return HTTPResponse(status: 200, body: Data(passBody.utf8))
        }
        let paid = lock.withLock { !bought.isEmpty }
        return HTTPResponse(status: 200, body: Data((paid ? passBody : unpaidBody).utf8))
    }
}

@Test func fakePurchaserUnlocksThroughTheDevRoute() async {
    let server = FakeStoreServer()
    let graph = billingGraph(server)
    let store = await FakeStorePurchaser.purchase(graph: graph, roomId: "room-1", product: .racePass)
    #expect(store == .purchased)
    #expect(server.purchases == [#"{"productId":"race_pass"}"#])
    let phase = await BillingFlow.complete(graph: graph, roomId: "room-1", product: .racePass, store: store, poll: instantPoll)
    guard case .unlocked = phase else {
        Issue.record("expected unlocked, got \(phase)")
        return
    }
}

@Test func fakePurchaserOfflineFailsBeforeCharging() async {
    let store = await FakeStorePurchaser.purchase(graph: billingGraph(OfflineBillingTransport()), roomId: "room-1", product: .racePass)
    #expect(store == .failed(message: "Offline. Purchases need the network.", offline: true))
}

@Test func bridgeShapesCarryPhaseAndCrewLimit() throws {
    let state = RoomBillingState(roomId: "room-1", isPaid: true, isUnlimited: false, crewCount: 1, crewLimit: 1, offers: [.crewUpgrade])
    let unlocked = BillingBridge.json(PurchasePhase.unlocked(state))
    #expect(unlocked["phase"] as? String == "unlocked")
    let billing = try #require(unlocked["billing"] as? [String: Any])
    #expect(billing["hasCrewSeat"] as? Bool == false)
    #expect(billing["offers"] as? [String] == ["crew_upgrade"])
    #expect(BillingBridge.json(PurchasePhase.pending(.racePass))["phase"] as? String == "pending")

    let limit = APIClient.failure(status: 409, data: Data(#"{"error":"Crew limit reached","code":"crew_limit_reached"}"#.utf8))
    let raw = RuntimeCall.failureJSON(limit)
    let object = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    #expect(object["crewLimit"] as? Bool == true)
    #expect(object["offline"] as? Bool == false)
}
