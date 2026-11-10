import SwiftUI
import CrewCueClientCore

struct FixtureRouteView: View {
    let route: Route
    let screen: FeatureScreen

    var body: some View {
        switch route.featureId {
        case "map-track", "map-checkpoint-pick", "map-navigate":
            MapLibrePocket(screen: screen)
        case "chat-thread", "chat-notification-prefs":
            StreamPocket(screen: screen)
        case "app-shell":
            FixtureShellView()
        case "brand-loader":
            BrandLoaderView(screen: screen)
        case "billing-purchase":
            BillingPurchaseView(fixture: screen)
        case "billing-redeem":
            BillingRedeemView(fixture: screen)
        case "billing-upgrade":
            CrewUpgradeView(fixture: screen)
        default:
            FeatureScreenView(screen: screen)
        }
    }
}

struct FixtureShellView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TabView {
                ForEach(ShellTab.allCases) { tab in
                    FixtureTabPage(featureId: tab.featureId)
                        .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                        .accessibilityIdentifier(tab.accessibilityIdentifier)
                }
            }
        }
        .accessibilityIdentifier("crewcue.app-shell")
        .accessibilityLabel("CrewCue")
    }
}

struct FixtureTabPage: View {
    let featureId: String

    var body: some View {
        FeatureScreenView(screen: CrewCueClientCore.featureScreen(id: featureId, state: .success))
    }
}

struct ProductRouteView: View {
    @Bindable var model: ShellModel

    var body: some View {
        switch model.route.featureId {
        case "join-crew":
            JoinCrewView(model: model.joinModel, onBack: model.isSignedIn ? { model.showProfile() } : {
                model.show(Route(featureId: "auth-sign-in", state: .success))
            })
        case "athlete-setup":
            AthleteSetupView(model: model.athleteModel)
        case "onboarding-notifications":
            NotificationPermissionScreen()
        case "auth-sign-in":
            AuthOrShell(model: model)
        case "billing-purchase", "billing-redeem", "billing-upgrade":
            BillingRouteView(model: model)
        case "app-shell", "map-track", "chat-thread", "chat-notification-prefs", "push-registration", "profile", "strava", "account-deletion", "room-members", "readouts-incidents":
            ShellOrSignedOut(model: model)
        default:
            if ShellTab.isPaceFeature(model.route.featureId) || ShellTab.isMapFeature(model.route.featureId) {
                ShellOrSignedOut(model: model)
            } else {
                FixtureRouteView(route: model.route, screen: model.screen)
            }
        }
    }
}

struct AuthOrShell: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn {
            ProductShellView(model: model)
        } else {
            AuthSignInView(model: model.authModel, onJoin: {
                model.show(Route(featureId: "join-crew", state: .success))
            })
        }
    }
}

struct ShellOrSignedOut: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn {
            ProductShellView(model: model)
        } else if model.route.featureId == "app-shell" {
            AuthSignInView(model: model.authModel, onJoin: {
                model.show(Route(featureId: "join-crew", state: .success))
            })
        } else {
            FixtureRouteView(route: model.route, screen: model.screen)
        }
    }
}

/// Billing routes are full-screen, like join. Signed out, the dev link shows its fixture copy.
struct BillingRouteView: View {
    @Bindable var model: ShellModel

    var body: some View {
        if !model.isSignedIn {
            FixtureRouteView(route: model.route, screen: model.screen)
        } else {
            switch model.route.featureId {
            case "billing-redeem":
                BillingRedeemView(
                    model: model.billingModel,
                    roomId: model.signedInRoomId,
                    onContinue: openRace
                )
            case "billing-upgrade":
                CrewUpgradeView(
                    model: model.upgradeModel,
                    roomId: model.signedInRoomId,
                    role: model.signedInRole,
                    onBack: { model.showProfile() }
                )
            default:
                BillingPurchaseView(
                    model: model.billingModel,
                    roomId: model.signedInRoomId,
                    onContinue: openRace,
                    onLeave: { model.showProfile() }
                )
            }
        }
    }

    private func openRace() {
        model.show(Route(featureId: "map-track", state: .success))
        model.enterShellIfNeeded()
    }
}
