import Foundation
import Observation
import CrewCueClientCore

/// Copy from clients/behavior/billing-redeem.md.
enum BillingRedeemCopy {
    static let empty = "Have a code? Redeem it with the App Store or Google Play."
    static let success = "Code redeemed. Unlocking your race."
    static let error = "Couldn't open code redemption."
    static let offline = "Offline. Redeeming a code needs the network."
}

/// Paywall for one unpaid race (clients/behavior/billing-purchase.md, billing-redeem.md).
/// The store takes the payment; only the server's billing read unlocks the race.
@MainActor
@Observable
final class BillingPurchaseModel {
    private(set) var billing: RoomBillingState?
    private(set) var status = ""
    private(set) var redeemStatus = BillingRedeemCopy.empty
    private(set) var prices: [BillingProduct: String] = [:]
    private(set) var working = false
    private(set) var loading = false
    private(set) var roomId: String?

    private let client: AppClient
    private let purchaser: StorePurchaser
    private var generation = 0

    init(client: AppClient, purchaser: StorePurchaser) {
        self.client = client
        self.purchaser = purchaser
    }

    var unlocked: Bool { billing?.isPaid == true }

    func price(_ product: BillingProduct) -> String {
        prices[product] ?? product.fallbackPrice
    }

    func activate(roomId: String?) async {
        generation += 1
        let ticket = generation
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            self.roomId = nil
            billing = nil
            status = "No race yet."
            return
        }
        if self.roomId != trimmed {
            billing = nil
            redeemStatus = BillingRedeemCopy.empty
        }
        self.roomId = trimmed
        guard !working else { return }
        loading = true
        defer { if ticket == generation { loading = false } }
        do {
            let state = try await RaceDayAPI.billing(graph: client.graph, roomId: trimmed)
            guard ticket == generation else { return }
            billing = state
            status = state.isPaid ? PurchasePhase.unlocked(state).message : state.summary
        } catch {
            guard ticket == generation else { return }
            let offline = BillingErrors.userFacing(error) == BillingErrors.offline
            status = offline ? BillingErrors.offline.message : StorePurchasers.purchaseFailedMessage
            // Redeeming also needs the network; say so where the Redeem button is.
            if offline {
                redeemStatus = BillingRedeemCopy.offline
            }
        }
        let loaded = await purchaser.prices(for: [.racePass, .racePassFullCrew])
        if ticket == generation { prices = loaded }
    }

    func buy(_ product: BillingProduct) async {
        guard let roomId, !working else { return }
        working = true
        defer { working = false }
        status = PurchasePhase.purchasing(product).message
        let store = await purchaser.purchase(product: product, roomId: roomId)
        if store == .purchased {
            status = PurchasePhase.confirming(product).message
        }
        let phase = await BillingFlow.complete(graph: client.graph, roomId: roomId, product: product, store: store)
        apply(phase)
    }

    func redeem() async {
        guard let roomId, !working else { return }
        working = true
        defer { working = false }
        let store = await purchaser.presentRedeemSheet(roomId: roomId)
        switch store {
        case .purchased:
            redeemStatus = BillingRedeemCopy.success
            status = PurchasePhase.confirming(.racePass).message
            apply(await BillingFlow.awaitUnlock(graph: client.graph, roomId: roomId, product: .racePass))
        case .cancelled:
            redeemStatus = BillingRedeemCopy.empty
        case .failed(_, let offline):
            redeemStatus = offline ? BillingRedeemCopy.offline : BillingRedeemCopy.error
        }
    }

    func clear() {
        generation += 1
        billing = nil
        status = ""
        redeemStatus = BillingRedeemCopy.empty
        prices = [:]
        working = false
        loading = false
        roomId = nil
    }

    private func apply(_ phase: PurchasePhase) {
        status = phase.message
        if case .unlocked(let state) = phase {
            billing = state
        }
    }
}

/// Full Crew upgrade on Room members (clients/behavior/billing-upgrade.md).
@MainActor
@Observable
final class CrewUpgradeModel {
    private(set) var billing: RoomBillingState?
    private(set) var status = ""
    private(set) var price = BillingProduct.crewUpgrade.fallbackPrice
    private(set) var working = false
    private(set) var role: String?
    private(set) var roomId: String?

    private let client: AppClient
    private let purchaser: StorePurchaser
    private var generation = 0

    init(client: AppClient, purchaser: StorePurchaser) {
        self.client = client
        self.purchaser = purchaser
    }

    var canBuy: Bool { billing?.offers.contains(.crewUpgrade) == true }

    /// The runner's paid room has no crew seat left.
    var runnerLimitMessage: String? {
        guard role == "athlete", let billing, billing.isPaid, !billing.isUnlimited, !billing.hasCrewSeat else { return nil }
        return BillingErrors.crewLimitForRunner.message
    }

    func activate(roomId: String?, role: String?) async {
        generation += 1
        let ticket = generation
        self.role = role
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            self.roomId = nil
            billing = nil
            status = ""
            return
        }
        self.roomId = trimmed
        guard !working else { return }
        do {
            let state = try await RaceDayAPI.billing(graph: client.graph, roomId: trimmed)
            guard ticket == generation else { return }
            billing = state
            status = state.summary
        } catch {
            guard ticket == generation else { return }
            status = BillingErrors.userFacing(error) == BillingErrors.offline
                ? BillingErrors.offline.message
                : StorePurchasers.purchaseFailedMessage
        }
        let loaded = await purchaser.prices(for: [.crewUpgrade])
        if ticket == generation, let localized = loaded[.crewUpgrade] {
            price = localized
        }
    }

    func buy() async {
        guard let roomId, !working else { return }
        working = true
        defer { working = false }
        let product = BillingProduct.crewUpgrade
        status = PurchasePhase.purchasing(product).message
        let store = await purchaser.purchase(product: product, roomId: roomId)
        if store == .purchased {
            status = PurchasePhase.confirming(product).message
        }
        let phase = await BillingFlow.complete(graph: client.graph, roomId: roomId, product: product, store: store)
        status = phase.message
        if case .unlocked(let state) = phase {
            billing = state
        }
    }

    func clear() {
        generation += 1
        billing = nil
        status = ""
        price = BillingProduct.crewUpgrade.fallbackPrice
        working = false
        role = nil
        roomId = nil
    }
}
