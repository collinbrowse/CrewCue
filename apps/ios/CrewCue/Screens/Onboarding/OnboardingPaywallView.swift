import SwiftUI
import CrewCueClientCore

/// The paywall that ends the replay (`crewcue.onboarding-paywall`): "You + 1 crew" (Race Pass) or
/// "Your whole crew" (Race Pass + Full Crew), each with the store's localized price (the
/// `BillingProduct` fallback until it answers). `BillingPurchaseModel` does the purchase; only the
/// server's billing read unlocks the race, and then `onPurchased` runs once.
///
/// Regular width puts the two options side by side, compact width stacks them, and so do the
/// accessibility text sizes at any width. Back (the bar's, like every onboarding step) returns to
/// the replay's start; Not now leaves for the tab bar, the race still behind its Unlock race banner.
struct OnboardingPaywallView: View {
    var billing: BillingPurchaseModel?
    var roomId: String?
    var onBack: () -> Void
    var onNotNow: () -> Void
    var onPurchased: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.crew) private var theme

    /// One option: who it covers and the store product behind it.
    struct Option: Identifiable {
        let title: String
        let product: BillingProduct
        /// Stable accessibility id; the buy button adds `.buy`.
        let id: String
    }

    /// The two options, in the order they read.
    static let options = [
        Option(title: OnboardingCopy.paywallRunnerPlusOneTitle, product: .racePass, id: "crewcue.onboarding-paywall.runner-plus-one"),
        Option(title: OnboardingCopy.paywallFullCrewTitle, product: .racePassFullCrew, id: "crewcue.onboarding-paywall.full-crew")
    ]

    private var sideBySide: Bool { sizeClass == .regular && !typeSize.isAccessibilitySize }

    var body: some View {
        // Each row pads itself, so the options and the footer can run to the display's edge below
        // a camera column (iPhone Duo's outer display). The header, with Back, stays clear of it.
        OcclusionScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.margin) {
                header
                    .avoidsReservedRegions()
                    .padding(.horizontal, CrewSpace.margin)
                let layout = sideBySide
                    ? AnyLayout(HStackLayout(alignment: .top, spacing: CrewSpace.gutter))
                    : AnyLayout(VStackLayout(alignment: .leading, spacing: CrewSpace.gutter))
                layout {
                    ForEach(Self.options) { option in
                        PaywallOptionCard(
                            title: option.title,
                            product: option.product,
                            price: price(option.product),
                            busy: billing?.working == true,
                            enabled: canBuy,
                            identifier: option.id
                        ) {
                            Task { await billing?.buy(option.product) }
                        }
                        .avoidsReservedRegions()
                        // Stacked, each option pads itself and decides its own width: scrolled up
                        // beside the column it keeps clear of it, while the one below runs on.
                        .padding(.horizontal, sideBySide ? 0 : CrewSpace.margin)
                        .fullWidthClearOfOcclusions()
                    }
                }
                .padding(.horizontal, sideBySide ? CrewSpace.margin : 0)
                footer
                    .avoidsReservedRegions()
                    .padding(.horizontal, CrewSpace.margin)
                    .fullWidthClearOfOcclusions()
            }
            .padding(.vertical, CrewSpace.margin)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .animation(.snappy(duration: 0.3), value: sideBySide)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(CrewBackground())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding-paywall")
        .accessibilityLabel(OnboardingCopy.title(for: .paywall) ?? "")
        // The same Back as every other onboarding step: the bar's leading chevron, the edge swipe
        // and VoiceOver's escape. It returns to the replay's start.
        .barBack(identifier: "crewcue.onboarding-paywall.back", enabled: billing?.working != true, action: onBack)
        .task(id: roomId ?? "") {
            guard let billing, roomId != nil else { return }
            await billing.activate(roomId: roomId)
        }
        .onChange(of: unlocked, initial: true) { _, isUnlocked in
            if isUnlocked { onPurchased() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            Text(OnboardingCopy.title(for: .paywall) ?? "")
                .font(CrewFont.display)
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            // The one subtitle, at the top.
            if let explanation = OnboardingCopy.explanation(for: .paywall) {
                Text(explanation)
                    .font(CrewFont.bodyLarge)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding-paywall.subtitle")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            if !status.isEmpty {
                Text(verbatim: status)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding-paywall.status")
            }
            BillingRedeemSection(
                status: billing?.redeemStatus ?? BillingRedeemCopy.empty,
                enabled: canBuy,
                action: { Task { await billing?.redeem() } }
            )
            Button(OnboardingCopy.paywallNotNow, action: onNotNow)
                .buttonStyle(.crewPill)
                .disabled(billing?.working == true)
                .accessibilityIdentifier("crewcue.onboarding-paywall.not-now")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The billing model is shared with the Race Pass route: only this race's billing counts.
    private var forThisRace: Bool {
        guard let billing, let roomId else { return false }
        return billing.roomId == roomId && billing.billing?.roomId == roomId
    }

    private var unlocked: Bool { forThisRace && billing?.unlocked == true }

    private var status: String { billing?.roomId == roomId ? billing?.status ?? "" : "" }

    private var canBuy: Bool {
        guard let billing, forThisRace else { return false }
        return !billing.working && !billing.loading && !billing.unlocked
    }

    private func price(_ product: BillingProduct) -> String {
        billing?.price(product) ?? product.fallbackPrice
    }
}

/// One paywall option: who it covers, what it is, and the store product with its price.
struct PaywallOptionCard: View {
    let title: String
    let product: BillingProduct
    let price: String
    var busy: Bool
    var enabled: Bool
    let identifier: String
    let action: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            Text(title)
                .font(CrewFont.headline)
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: product.detail)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: action) {
                Text(verbatim: "\(product.title) \u{00B7} \(price)")
            }
            .buttonStyle(.crewPillProminent)
            .disabled(!enabled)
            .crewBusy(busy)
            .accessibilityLabel(Text(verbatim: OnboardingCopy.paywallBuyLabel(product: product, price: price)))
            .accessibilityIdentifier("\(identifier).buy")
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
        .accessibilityLabel(title)
    }
}
