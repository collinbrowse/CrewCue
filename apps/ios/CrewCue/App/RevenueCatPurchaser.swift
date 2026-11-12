import Foundation
import RevenueCat
import StoreKit
import UIKit
import CrewCueClientCore

/// RevenueCat pocket (#649). The App Store charges; RevenueCat's webhook tells the API, which
/// unlocks the room named by the `crewcue_room_id` attribute set here before every purchase.
@MainActor
final class RevenueCatPurchaser: StorePurchaser {
    private let apiKey: String
    private let client: AppClient

    init(apiKey: String, client: AppClient) {
        self.apiKey = apiKey
        self.client = client
    }

    func prices(for products: [BillingProduct]) async -> [BillingProduct: String] {
        guard (try? await prepare()) == true else { return [:] }
        let found = await Purchases.shared.products(products.map(\.rawValue))
        var prices: [BillingProduct: String] = [:]
        for product in found {
            if let id = BillingProduct(rawValue: product.productIdentifier) {
                prices[id] = product.localizedPriceString
            }
        }
        return prices
    }

    func purchase(product: BillingProduct, roomId: String) async -> StorePurchaseResult {
        do {
            guard try await prepare() else {
                return .failed(message: StorePurchasers.purchaseFailedMessage, offline: false)
            }
            Purchases.shared.attribution.setAttributes([BillingProduct.roomAttribute: roomId])
            guard let storeProduct = await Purchases.shared.products([product.rawValue]).first else {
                client.graph.logger.log("store product missing \(product.rawValue)")
                return .failed(message: StorePurchasers.purchaseFailedMessage, offline: false)
            }
            let result = try await Purchases.shared.purchase(product: storeProduct)
            return result.userCancelled ? .cancelled : .purchased
        } catch {
            return map(error, fallback: StorePurchasers.purchaseFailedMessage)
        }
    }

    func presentRedeemSheet(roomId: String) async -> StorePurchaseResult {
        do {
            guard try await prepare() else {
                return .failed(message: BillingRedeemCopy.error, offline: false)
            }
            // A redeemed offer code arrives as a store purchase; the webhook reads this attribute.
            Purchases.shared.attribution.setAttributes([BillingProduct.roomAttribute: roomId])
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .first(where: { $0.activationState == .foregroundActive }) else {
                return .failed(message: BillingRedeemCopy.error, offline: false)
            }
            try await AppStore.presentOfferCodeRedeemSheet(in: scene)
            return .purchased
        } catch {
            return map(error, fallback: BillingRedeemCopy.error)
        }
    }

    /// Configure once with the signed-in user, or switch RevenueCat to them.
    private func prepare() async throws -> Bool {
        guard let userId = client.graph.session?.session?.userId, !userId.isEmpty else { return false }
        if !Purchases.isConfigured {
            Purchases.configure(withAPIKey: apiKey, appUserID: userId)
        } else if Purchases.shared.appUserID != userId {
            _ = try await Purchases.shared.logIn(userId)
        }
        return true
    }

    private func map(_ error: Error, fallback: String) -> StorePurchaseResult {
        if let code = error as? RevenueCat.ErrorCode {
            switch code {
            case .purchaseCancelledError:
                return .cancelled
            case .networkError, .offlineConnectionError:
                return .failed(message: fallback, offline: true)
            default:
                break
            }
        }
        if APIFailure.isOffline(error) {
            return .failed(message: fallback, offline: true)
        }
        client.graph.logger.log("store purchase failed")
        return .failed(message: fallback, offline: false)
    }
}
