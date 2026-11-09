import Foundation

/// Store products (consumables). A purchase attaches to one race room (#649).
/// Ids match App Store Connect, Google Play, and RevenueCat.
public enum BillingProduct: String, CaseIterable, Sendable, Codable {
    case racePass = "race_pass"
    case crewUpgrade = "crew_upgrade"
    case racePassFullCrew = "race_pass_full_crew"

    public var title: String {
        switch self {
        case .racePass: return "Race Pass"
        case .crewUpgrade: return "Full Crew upgrade"
        case .racePassFullCrew: return "Race Pass + Full Crew"
        }
    }

    public var detail: String {
        switch self {
        case .racePass: return "You plus 1 crew member for this race."
        case .crewUpgrade: return "Unlimited crew for this race."
        case .racePassFullCrew: return "You plus unlimited crew for this race."
        }
    }

    /// Shown when the store has no localized price (debug fake purchaser, store offline).
    public var fallbackPrice: String {
        switch self {
        case .racePass: return "$14.99"
        case .crewUpgrade: return "$9.99"
        case .racePassFullCrew: return "$19.99"
        }
    }

    /// The RevenueCat subscriber attribute the server reads to attach the purchase to a room.
    public static let roomAttribute = "crewcue_room_id"
}

/// A room's billing as every member sees it. Built from `GET /race-rooms/:roomId/billing`.
public struct RoomBillingState: Equatable, Sendable {
    public var roomId: String
    public var isPaid: Bool
    public var isUnlimited: Bool
    public var crewCount: Int
    /// Crew allowed besides the runner; nil when unlimited.
    public var crewLimit: Int?
    public var offers: [BillingProduct]

    public init(roomId: String, isPaid: Bool, isUnlimited: Bool, crewCount: Int, crewLimit: Int?, offers: [BillingProduct]) {
        self.roomId = roomId
        self.isPaid = isPaid
        self.isUnlimited = isUnlimited
        self.crewCount = crewCount
        self.crewLimit = crewLimit
        self.offers = offers
    }

    public init(_ wire: RaceRoomBilling) {
        let unlimited = (wire.entitlement.crewTier ?? "unlimited") == "unlimited"
        self.init(
            roomId: wire.roomId,
            isPaid: wire.entitlement.status == "paid",
            isUnlimited: unlimited,
            crewCount: Int(wire.crewCount),
            crewLimit: wire.crewLimit.map { Int($0) },
            offers: wire.offers.compactMap(BillingProduct.init(rawValue:))
        )
    }

    /// Whether one more crew member can join now.
    public var hasCrewSeat: Bool {
        guard let crewLimit else { return true }
        return crewCount < crewLimit
    }

    /// Whether this state includes what `product` sells.
    public func satisfies(_ product: BillingProduct) -> Bool {
        switch product {
        case .racePass: return isPaid
        case .crewUpgrade, .racePassFullCrew: return isPaid && isUnlimited
        }
    }

    /// One line for the room screen.
    public var summary: String {
        if !isPaid { return "No Race Pass yet. Buy one to open this race." }
        if isUnlimited { return "Full Crew: unlimited crew." }
        let limit = crewLimit ?? 1
        return "Race Pass: you plus \(limit) crew member (\(crewCount) of \(limit) joined)."
    }
}

/// What the store reported for one purchase attempt. Apps map their SDK result into this.
public enum StorePurchaseResult: Equatable, Sendable {
    case purchased
    case cancelled
    /// The store refused or failed; `offline` when the device had no connection.
    case failed(message: String, offline: Bool)
}

/// Purchase flow screen state.
public enum PurchasePhase: Equatable, Sendable {
    case idle
    case purchasing(BillingProduct)
    /// The store took the payment; waiting for the server (webhook) to unlock the room.
    case confirming(BillingProduct)
    case unlocked(RoomBillingState)
    /// Paid, but the server has not confirmed yet. Members see it once the webhook lands.
    case pending(BillingProduct)
    case cancelled
    case failed(UserFacingError)

    public var message: String {
        switch self {
        case .idle: return ""
        case .purchasing(let product): return "Opening the store for \(product.title)."
        case .confirming: return "Payment received. Unlocking your race."
        case .unlocked(let state): return state.isUnlimited ? "Unlocked: unlimited crew." : "Unlocked: you plus 1 crew member."
        case .pending: return "Payment received. Unlocking can take a minute; pull to refresh."
        case .cancelled: return "Purchase cancelled."
        case .failed(let error): return error.message
        }
    }
}

/// How long to wait for the webhook after the store reports a purchase.
public struct EntitlementPollPolicy: Sendable {
    public var attempts: Int
    public var intervalSeconds: Double
    public var sleep: @Sendable (Double) async -> Void

    public init(attempts: Int = 20, intervalSeconds: Double = 2, sleep: @escaping @Sendable (Double) async -> Void = EntitlementPollPolicy.taskSleep) {
        self.attempts = attempts
        self.intervalSeconds = intervalSeconds
        self.sleep = sleep
    }

    public static let taskSleep: @Sendable (Double) async -> Void = { seconds in
        try? await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
    }
}

public enum BillingErrors {
    /// A join, invite, or invite accept refused because the room's crew tier is full.
    public static func isCrewLimit(_ error: Error) -> Bool {
        guard let http = error as? ClientHTTPError else { return false }
        return http.status == 409 && (http.reason == "crew_limit_reached" || http.decision == "crew_limit_reached")
    }

    public static let crewLimitForCrew = UserFacingError(
        code: "crew_limit",
        message: "This race is full. Ask the runner to add Full Crew so more crew can join.",
        retryable: false
    )

    public static let crewLimitForRunner = UserFacingError(
        code: "crew_limit",
        message: "Your Race Pass covers 1 crew member. Add Full Crew for unlimited crew.",
        retryable: false
    )

    public static let offline = UserFacingError(
        code: "offline",
        message: "Offline. Purchases need the network.",
        retryable: true
    )

    public static func userFacing(_ error: Error) -> UserFacingError {
        if TransportFailure.isOffline(error) { return offline }
        if let http = error as? ClientHTTPError {
            if http.status == 0 { return offline }
            return UserFacingError(http)
        }
        return UserFacingError(code: "unknown", message: "Couldn't complete the purchase.", retryable: true)
    }
}

extension RaceDayAPI {
    /// Members only; not entitlement-gated, so an unpaid room can show its paywall.
    public static func billing(graph: ClientGraph, roomId: String) async throws -> RoomBillingState {
        let wire: RaceRoomBilling = try await get(graph, "/race-rooms/\(roomId)/billing")
        return RoomBillingState(wire)
    }

    /// Debug builds only: the server refuses this in production. Same grant path as the store webhook.
    public static func devPurchase(graph: ClientGraph, roomId: String, product: BillingProduct) async throws -> RoomBillingState {
        let data = try await sendData(
            graph,
            "/race-rooms/\(roomId)/billing/dev-purchase",
            method: .post,
            body: #"{"productId":"\#(product.rawValue)"}"#
        )
        return RoomBillingState(try JSONDecoder().decode(RaceRoomBilling.self, from: data))
    }
}

/// After the store reports a purchase, poll the room until the server (webhook) unlocks it.
public enum BillingFlow {
    /// Maps one store result plus the server poll into the final phase.
    public static func complete(
        graph: ClientGraph,
        roomId: String,
        product: BillingProduct,
        store: StorePurchaseResult,
        poll: EntitlementPollPolicy = EntitlementPollPolicy()
    ) async -> PurchasePhase {
        switch store {
        case .cancelled:
            return .cancelled
        case .failed(let message, let offline):
            return .failed(offline ? BillingErrors.offline : UserFacingError(code: "store", message: message, retryable: true))
        case .purchased:
            return await awaitUnlock(graph: graph, roomId: roomId, product: product, poll: poll)
        }
    }

    /// Polls `GET /billing` until it includes `product`. A purchase that the webhook has not
    /// confirmed yet ends as `.pending`, never as a failure: the store already charged.
    public static func awaitUnlock(
        graph: ClientGraph,
        roomId: String,
        product: BillingProduct,
        poll: EntitlementPollPolicy = EntitlementPollPolicy()
    ) async -> PurchasePhase {
        let attempts = max(1, poll.attempts)
        for attempt in 0..<attempts {
            if attempt > 0 {
                await poll.sleep(poll.intervalSeconds)
            }
            if let state = try? await RaceDayAPI.billing(graph: graph, roomId: roomId), state.satisfies(product) {
                graph.logger.log("billing unlocked \(roomId) \(product.rawValue) after \(attempt + 1) reads")
                return .unlocked(state)
            }
        }
        graph.logger.log("billing pending \(roomId) \(product.rawValue)")
        return .pending(product)
    }
}

/// Debug builds: stands in for the store so fixtures and deeplinks work without one.
/// It posts to the API's dev purchase route, which production refuses.
public enum FakeStorePurchaser {
    /// `webhookDelaySeconds` > 0 returns "purchased" at once and lets the server unlock later,
    /// the way a late RevenueCat webhook behaves.
    public static func purchase(
        graph: ClientGraph,
        roomId: String,
        product: BillingProduct,
        webhookDelaySeconds: Double = 0
    ) async -> StorePurchaseResult {
        do {
            // A real store sheet needs the network too; fail the same way when offline.
            _ = try await RaceDayAPI.billing(graph: graph, roomId: roomId)
        } catch {
            let facing = BillingErrors.userFacing(error)
            return .failed(message: facing.message, offline: facing == BillingErrors.offline)
        }
        if webhookDelaySeconds > 0 {
            Task.detached {
                await EntitlementPollPolicy.taskSleep(webhookDelaySeconds)
                _ = try? await RaceDayAPI.devPurchase(graph: graph, roomId: roomId, product: product)
            }
            return .purchased
        }
        do {
            _ = try await RaceDayAPI.devPurchase(graph: graph, roomId: roomId, product: product)
            return .purchased
        } catch {
            let facing = BillingErrors.userFacing(error)
            return .failed(message: facing.message, offline: facing == BillingErrors.offline)
        }
    }
}

/// JSON shapes for Android (RuntimeBridge ops `billing`, `completePurchase`, `fakePurchase`).
enum BillingBridge {
    static func json(_ state: RoomBillingState) -> [String: Any] {
        var row: [String: Any] = [
            "roomId": state.roomId,
            "isPaid": state.isPaid,
            "isUnlimited": state.isUnlimited,
            "crewCount": state.crewCount,
            "hasCrewSeat": state.hasCrewSeat,
            "offers": state.offers.map(\.rawValue),
            "summary": state.summary
        ]
        if let limit = state.crewLimit {
            row["crewLimit"] = limit
        }
        return row
    }

    static func json(_ phase: PurchasePhase) -> [String: Any] {
        var row: [String: Any] = ["message": phase.message]
        switch phase {
        case .idle: row["phase"] = "idle"
        case .purchasing: row["phase"] = "purchasing"
        case .confirming: row["phase"] = "confirming"
        case .unlocked(let state):
            row["phase"] = "unlocked"
            row["billing"] = json(state)
        case .pending: row["phase"] = "pending"
        case .cancelled: row["phase"] = "cancelled"
        case .failed(let error):
            row["phase"] = "failed"
            row["code"] = error.code
        }
        return row
    }

    private static func product(_ object: [String: Any]) throws -> BillingProduct {
        guard let raw = object["product"] as? String, let product = BillingProduct(rawValue: raw) else {
            throw ClientHTTPError(status: 400, message: "Unknown product.")
        }
        return product
    }

    private static func poll(_ object: [String: Any]) -> EntitlementPollPolicy {
        var policy = EntitlementPollPolicy()
        if let attempts = object["pollAttempts"] as? Int { policy.attempts = attempts }
        if let interval = object["pollIntervalSeconds"] as? Double { policy.intervalSeconds = interval }
        return policy
    }

    /// The app ran the store purchase (RevenueCat); map its result and wait for the server.
    static func completePurchase(graph: ClientGraph, _ object: [String: Any]) async throws -> Any {
        let product = try product(object)
        let roomId = object["roomId"] as? String ?? ""
        let store: StorePurchaseResult
        switch object["store"] as? String {
        case "purchased": store = .purchased
        case "cancelled": store = .cancelled
        default:
            store = .failed(message: object["message"] as? String ?? "Couldn't complete the purchase.", offline: object["offline"] as? Bool ?? false)
        }
        let phase = await BillingFlow.complete(graph: graph, roomId: roomId, product: product, store: store, poll: poll(object))
        return json(phase)
    }

    static func fakePurchase(graph: ClientGraph, _ object: [String: Any]) async throws -> Any {
        let product = try product(object)
        let roomId = object["roomId"] as? String ?? ""
        let delay = object["webhookDelaySeconds"] as? Double ?? 0
        let store = await FakeStorePurchaser.purchase(graph: graph, roomId: roomId, product: product, webhookDelaySeconds: delay)
        let phase = await BillingFlow.complete(graph: graph, roomId: roomId, product: product, store: store, poll: poll(object))
        return json(phase)
    }
}
