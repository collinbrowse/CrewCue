import SwiftUI
import CrewCueClientCore

struct FixtureRouteView: View {
    let route: Route
    let screen: FeatureScreen

    var body: some View {
        switch route.featureId {
        case "map-track", "map-checkpoint-pick", "map-navigate":
            MapLibrePocket(screen: screen)
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
        case "onboarding-runner-setup":
            RunnerSetupView(model: model.runnerSetup)
        case "auth-sign-in":
            AuthOrShell(model: model)
        case "billing-purchase", "billing-redeem", "billing-upgrade":
            BillingRouteView(model: model)
        case "app-shell", "map-track", "chat-thread", "chat-notification-prefs", "push-registration", "profile", "strava", "activity-import", "account-deletion", "room-members", "readouts-incidents":
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

/// The explicit sign-in route. Signed in, onboarding decides between setup and the tab bar.
struct AuthOrShell: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn {
            OnboardingGate(model: model)
        } else {
            AuthSignInView(model: model.authModel, onJoin: {
                model.show(Route(featureId: "join-crew", state: .success))
            })
        }
    }
}

/// The app's own launch (`app-shell`) and every tab route. Signed out, the app shell starts
/// onboarding (the chooser, or the step a relaunch resumes); other dev links show their fixture.
struct ShellOrSignedOut: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn || model.route.featureId == "app-shell" {
            OnboardingGate(model: model)
        } else {
            FixtureRouteView(route: model.route, screen: model.screen)
        }
    }
}

/// Picks the screen from the onboarding state (`OnboardingStore.read`): the chooser, runner
/// setup, the paywall after the teaser, crew join, a neutral loader while the first race list
/// loads, or the tab bar.
struct OnboardingGate: View {
    @Bindable var model: ShellModel

    var body: some View {
        Group {
            switch model.onboarding.entry {
            case .chooser:
                OnboardingChooserView(
                    onRunner: { choose(.runner) },
                    onCrew: { choose(.crew) },
                    onSignIn: model.isSignedIn ? nil : {
                        model.show(Route(featureId: "auth-sign-in", state: .success))
                    }
                )
            case .runnerSetup:
                RunnerSetupView(model: model.runnerSetup)
            case .paywall:
                BillingPurchaseView(
                    model: model.billingModel,
                    roomId: model.onboarding.state.roomId,
                    onContinue: { Task { await model.loadRaces() } },
                    onLeave: { model.leaveOnboardingPaywall() },
                    leaveLabel: OnboardingCopy.paywallNotNow
                )
            case .crewJoin:
                JoinCrewView(model: model.joinModel, onBack: { back() })
            case .signIn:
                AuthSignInView(model: model.authModel, onJoin: {
                    model.show(Route(featureId: "join-crew", state: .success))
                })
            case .loading:
                OnboardingLoadingView()
            case .shell:
                ProductShellView(model: model)
            }
        }
        .animation(.snappy(duration: 0.3), value: model.onboarding.entry)
    }

    private func choose(_ choice: OnboardingChoice) {
        model.onboarding.choose(choice)
        model.syncOnboarding()
    }

    private func back() {
        model.onboarding.clearChoice()
        model.syncOnboarding()
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
        // The race is paid now: onboarding reads the new entitlement from the race list.
        Task { await model.loadRaces() }
    }
}
