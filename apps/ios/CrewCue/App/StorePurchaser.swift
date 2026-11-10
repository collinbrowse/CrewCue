import Foundation
import CrewCueClientCore

/// The store seam (#649). Screens buy through this; only `RevenueCatPurchaser` imports RevenueCat.
/// Every implementation reports a `StorePurchaseResult`, and the screen then waits for the server
/// (`BillingFlow`) because only the webhook marks a room paid.
@MainActor
protocol StorePurchaser: AnyObject {
    /// Localized store prices. Missing products fall back to `BillingProduct.fallbackPrice`.
    func prices(for products: [BillingProduct]) async -> [BillingProduct: String]
    func purchase(product: BillingProduct, roomId: String) async -> StorePurchaseResult
    /// Apple's offer code sheet. `.purchased` means the sheet closed and the room may unlock.
    func presentRedeemSheet(roomId: String) async -> StorePurchaseResult
}

@MainActor
enum StorePurchasers {
    static let notConfiguredMessage = "Purchases aren't set up in this build."
    static let purchaseFailedMessage = "Couldn't complete the purchase."

    /// Debug without a RevenueCat key buys through the fake store. Release without a key cannot buy.
    static func make(apiKey: String, client: AppClient, fakeStore: FakeStoreOptions) -> StorePurchaser {
        #if DEBUG
        if apiKey.isEmpty {
            return FakeDevPurchaser(client: client, options: fakeStore)
        }
        #endif
        if apiKey.isEmpty {
            return UnavailablePurchaser()
        }
        return RevenueCatPurchaser(apiKey: apiKey, client: client)
    }
}

/// Release built without `CREWCUE_REVENUECAT_API_KEY`.
@MainActor
final class UnavailablePurchaser: StorePurchaser {
    func prices(for products: [BillingProduct]) async -> [BillingProduct: String] { [:] }

    func purchase(product: BillingProduct, roomId: String) async -> StorePurchaseResult {
        .failed(message: StorePurchasers.notConfiguredMessage, offline: false)
    }

    func presentRedeemSheet(roomId: String) async -> StorePurchaseResult {
        .failed(message: StorePurchasers.notConfiguredMessage, offline: false)
    }
}

#if DEBUG
/// Debug store: client-core `FakeStorePurchaser` posts to the local API's dev purchase route,
/// the same grant path as the RevenueCat webhook. Redeem is a fake redemption of a Race Pass.
@MainActor
final class FakeDevPurchaser: StorePurchaser {
    private let client: AppClient
    var options: FakeStoreOptions

    init(client: AppClient, options: FakeStoreOptions) {
        self.client = client
        self.options = options
    }

    func prices(for products: [BillingProduct]) async -> [BillingProduct: String] { [:] }

    func purchase(product: BillingProduct, roomId: String) async -> StorePurchaseResult {
        switch options.storeResult {
        case "cancel":
            return .cancelled
        case "fail":
            return .failed(message: StorePurchasers.purchaseFailedMessage, offline: false)
        default:
            break
        }
        let result = await FakeStorePurchaser.purchase(
            graph: client.graph,
            roomId: roomId,
            product: product,
            webhookDelaySeconds: options.webhookDelaySeconds
        )
        // The fake reports HTTP feedback; the store would say only that the purchase failed.
        if case .failed(_, let offline) = result, !offline {
            return .failed(message: StorePurchasers.purchaseFailedMessage, offline: false)
        }
        return result
    }

    func presentRedeemSheet(roomId: String) async -> StorePurchaseResult {
        await purchase(product: .racePass, roomId: roomId)
    }
}
#endif
