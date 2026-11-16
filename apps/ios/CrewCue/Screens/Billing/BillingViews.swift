import SwiftUI
import CrewCueClientCore

/// Paywall (`crewcue.billing-purchase`). Live with a model; fixture copy when `fixture` is set.
struct BillingPurchaseView: View {
    var model: BillingPurchaseModel?
    var fixture: FeatureScreen?
    var roomId: String?
    var onContinue: () -> Void = {}
    var onLeave: (() -> Void)?
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ProductTitle(title: "Race Pass", subtitle: "Unlock this race for you and your crew.")
                Text(verbatim: status)
                    .font(CrewFont.bodyLarge)
                    .foregroundStyle(theme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("crewcue.billing-purchase.status")
                if unlocked {
                    Button("Open race", action: onContinue)
                        .buttonStyle(.crewPrimary)
                        .accessibilityIdentifier("crewcue.billing-purchase.continue")
                } else {
                    BillingOfferButton(product: .racePass, price: price(.racePass), busy: working, enabled: canBuy) {
                        Task { await model?.buy(.racePass) }
                    }
                    .accessibilityIdentifier("crewcue.billing-purchase.buy-pass")
                    BillingOfferButton(product: .racePassFullCrew, price: price(.racePassFullCrew), busy: false, enabled: canBuy) {
                        Task { await model?.buy(.racePassFullCrew) }
                    }
                    .accessibilityIdentifier("crewcue.billing-purchase.buy-full-crew")
                    BillingRedeemSection(
                        status: model?.redeemStatus ?? BillingRedeemCopy.empty,
                        enabled: canBuy,
                        action: { Task { await model?.redeem() } }
                    )
                }
                if let onLeave {
                    Button("Back to Profile", action: onLeave)
                        .buttonStyle(.crewSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.billing-purchase", label: "Race Pass")
        .task(id: roomId ?? "") {
            if fixture == nil {
                await model?.activate(roomId: roomId)
            }
        }
    }

    private var status: String {
        fixture?.body ?? model?.status ?? ""
    }

    private var unlocked: Bool {
        fixture == nil && model?.unlocked == true
    }

    private var working: Bool { model?.working ?? false }

    private var canBuy: Bool {
        guard fixture == nil, let model else { return false }
        return !model.working && !model.loading && model.billing != nil
    }

    private func price(_ product: BillingProduct) -> String {
        model?.price(product) ?? product.fallbackPrice
    }
}

/// One store product: title, what it covers, and its price.
struct BillingOfferButton: View {
    let product: BillingProduct
    let price: String
    var busy: Bool
    var enabled: Bool
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: product.detail)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
            Button(action: action) {
                Text(verbatim: "\(product.title) \u{00B7} \(price)")
            }
            .buttonStyle(.crewPrimary)
            .disabled(!enabled)
            .crewBusy(busy)
            .accessibilityLabel(Text(verbatim: "Buy \(product.title), \(price)"))
        }
        .crewCard()
    }
}

/// Redeem code (`crewcue.billing-redeem`). Apple's offer code sheet in Release; a fake redemption in Debug.
struct BillingRedeemSection: View {
    let status: String
    var enabled: Bool
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: status)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button("Redeem code", action: action)
                .buttonStyle(.crewSecondary)
                .disabled(!enabled)
                .accessibilityIdentifier("crewcue.billing-redeem.open")
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.billing-redeem")
        .accessibilityLabel("Redeem code")
    }
}

/// The `crewcue://dev/billing-redeem` screen: the paywall's redeem step on its own.
struct BillingRedeemView: View {
    var model: BillingPurchaseModel?
    var fixture: FeatureScreen?
    var roomId: String?
    var onContinue: () -> Void = {}
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ProductTitle(title: "Redeem code", subtitle: "A code from CrewCue unlocks this race through the App Store.")
                if let status = model?.status, fixture == nil, !status.isEmpty {
                    Text(verbatim: status)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.ink)
                        .accessibilityIdentifier("crewcue.billing-purchase.status")
                }
                BillingRedeemSection(
                    status: fixture?.body ?? model?.redeemStatus ?? BillingRedeemCopy.empty,
                    enabled: fixture == nil && model?.billing != nil && model?.working == false && model?.unlocked == false,
                    action: { Task { await model?.redeem() } }
                )
                if fixture == nil, model?.unlocked == true {
                    Button("Open race", action: onContinue)
                        .buttonStyle(.crewPrimary)
                        .accessibilityIdentifier("crewcue.billing-purchase.continue")
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(CrewBackground())
        .task(id: roomId ?? "") {
            if fixture == nil {
                await model?.activate(roomId: roomId)
            }
        }
    }
}

/// Full Crew upgrade card (`crewcue.billing-upgrade`), shown on Room members.
struct CrewUpgradeCard: View {
    var model: CrewUpgradeModel?
    var fixture: FeatureScreen?
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CrewSectionHeader(title: "Crew size")
            Text(verbatim: fixture?.body ?? model?.status ?? "")
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("crewcue.billing-upgrade.status")
            if fixture == nil, let limit = model?.runnerLimitMessage {
                Text(verbatim: limit)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .accessibilityIdentifier("crewcue.billing-upgrade.limit")
            }
            if fixture != nil || model?.canBuy == true {
                let price = model?.price ?? BillingProduct.crewUpgrade.fallbackPrice
                Text(verbatim: BillingProduct.crewUpgrade.detail)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                Button {
                    Task { await model?.buy() }
                } label: {
                    Text(verbatim: "Add Full Crew \u{00B7} \(price)")
                }
                .buttonStyle(.crewPrimary)
                .disabled(fixture != nil || model?.working == true)
                .crewBusy(model?.working == true)
                .accessibilityLabel(Text(verbatim: "Add Full Crew, \(price)"))
                .accessibilityIdentifier("crewcue.billing-upgrade.buy")
            }
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.billing-upgrade")
        .accessibilityLabel("Full Crew")
    }
}

/// The `crewcue://dev/billing-upgrade` screen: the Room members upgrade card on its own.
struct CrewUpgradeView: View {
    var model: CrewUpgradeModel?
    var fixture: FeatureScreen?
    var roomId: String?
    var role: String?
    var onBack: (() -> Void)?
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ProductTitle(title: "Full Crew", subtitle: "Room for your whole crew on race day.")
                CrewUpgradeCard(model: model, fixture: fixture)
                if let onBack {
                    Button("Back to Profile", action: onBack)
                        .buttonStyle(.crewSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(CrewBackground())
        .task(id: "\(roomId ?? "")|\(role ?? "")") {
            if fixture == nil {
                await model?.activate(roomId: roomId, role: role)
            }
        }
    }
}
