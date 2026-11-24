import SwiftUI
import CrewCueClientCore

struct FixtureRouteView: View {
    let route: Route
    let screen: FeatureScreen
    /// Set for the top-level route: screens with a model of their own (the race-day replay) show
    /// a `?state=` on the real screen instead of its copy alone.
    var shell: ShellModel? = nil

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
        case "onboarding-race-preview":
            if let shell {
                RacePreviewDevRoute(shell: shell, state: route.state)
            } else {
                RacePreviewFixtureScreen(screen: screen)
            }
        default:
            FeatureScreenView(screen: screen)
        }
    }
}

/// `crewcue://dev/onboarding-race-preview[?state=…]`: the real replay and paywall on
/// `DemoRaceFixture` (no API, signed in or out), or the real screen in that state with Skip.
/// `?at=<seconds>&paused=1` opens the replay at that moment (`RacePreviewDevStart`).
struct RacePreviewDevRoute: View {
    var shell: ShellModel
    var state: FeatureState

    var body: some View {
        RacePreviewFlowView(
            model: shell.racePreview,
            source: .fixture(state: state, start: shell.racePreviewDevStart),
            onNotNow: { shell.leaveRacePreviewDevRoute() },
            onPurchased: {}
        )
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
            JoinCrewView(model: model.joinModel, signedIn: model.isSignedIn, onBack: model.isSignedIn ? { model.showProfile() } : {
                model.show(Route(featureId: "auth-sign-in", state: .success))
            })
        case "athlete-setup":
            AthleteSetupView(model: model.athleteModel)
        case "onboarding-notifications":
            NotificationPermissionScreen()
        case "onboarding-runner-setup":
            RunnerSetupView(model: model.runnerSetup)
        case "onboarding-race-preview":
            RacePreviewDevRoute(shell: model, state: model.route.state)
        case "auth-sign-in":
            AuthOrShell(model: model)
        case "billing-purchase", "billing-redeem", "billing-upgrade":
            BillingRouteView(model: model)
        case "app-shell", "map-track", "chat-thread", "chat-notification-prefs", "push-registration", "profile", "strava", "activity-import", "account-deletion", "room-members", "invite-share", "readouts-incidents", "race-rename", "race-delete":
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
/// Signed out, Back opens the app's own launch (the chooser), the screen sign-out lands on.
struct AuthOrShell: View {
    @Bindable var model: ShellModel

    var body: some View {
        if model.isSignedIn {
            OnboardingGate(model: model)
        } else {
            AuthSignInView(
                model: model.authModel,
                onJoin: { model.show(Route(featureId: "join-crew", state: .success)) },
                onBack: { model.leaveSignIn() }
            )
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
/// setup, the race-day replay and its paywall after the teaser, crew join, a neutral loader while
/// the first race list loads, or the tab bar.
struct OnboardingGate: View {
    @Bindable var model: ShellModel

    var body: some View {
        Group {
            switch model.onboarding.entry {
            case .chooser:
                OnboardingChooserView(
                    onRunner: { choose(.runner) },
                    onCrew: { choose(.crew) },
                    onSignIn: model.isSignedIn ? nil : { model.openSignIn() }
                )
            case .runnerSetup:
                RunnerSetupView(model: model.runnerSetup)
            case .racePreview:
                if let source = model.racePreviewSource {
                    RacePreviewFlowView(
                        model: model.racePreview,
                        source: source,
                        billing: model.billingModel,
                        roomId: model.onboarding.state.roomId,
                        onNotNow: { model.leaveOnboardingPaywall() },
                        onPurchased: { Task { await model.completeOnboardingPurchase() } }
                    )
                } else {
                    OnboardingLoadingView()
                }
            case .crewJoin:
                JoinCrewView(model: model.joinModel, signedIn: model.isSignedIn, onBack: { model.leaveCrewJoin() })
            case .signIn:
                // Signed out after confirming an invite: sign-up joins it. Back gives the invite up.
                AuthSignInView(
                    model: model.authModel,
                    onJoin: { model.show(Route(featureId: "join-crew", state: .success)) },
                    onBack: { model.leaveCrewJoin() }
                )
            case .loading:
                OnboardingLoadingView()
            case .shell:
                ProductShellView(model: model)
            }
        }
        .toolbar {
            if showsAccountMenu {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    OnboardingAccountMenu(
                        races: model.otherRaces,
                        onSelectRace: { model.selectRace($0) },
                        onSignOut: { model.signOut() }
                    )
                }
            }
        }
        .animation(.snappy(duration: 0.3), value: model.onboarding.entry)
    }

    /// Signed in, onboarding replaces the tab bar (and its settings) on these screens. The menu
    /// is the way out: sign out, or open another of the person's races.
    private var showsAccountMenu: Bool {
        guard model.isSignedIn else { return false }
        switch model.onboarding.entry {
        case .chooser, .runnerSetup, .crewJoin: return true
        default: return false
        }
    }

    private func choose(_ choice: OnboardingChoice) {
        model.onboarding.choose(choice)
        model.syncOnboarding()
    }
}

/// The setup screens' toolbar menu: every other race the person has, then Sign out.
struct OnboardingAccountMenu: View {
    let races: [RaceSummary]
    var onSelectRace: (String) -> Void
    var onSignOut: () -> Void

    var body: some View {
        Menu {
            if !races.isEmpty {
                Section(OnboardingCopy.switchRace) {
                    ForEach(races, id: \.id) { race in
                        Button {
                            onSelectRace(race.id)
                        } label: {
                            Label {
                                Text(verbatim: race.name)
                            } icon: {
                                Image(systemName: race.role == "athlete" ? "figure.run" : "person.2")
                            }
                        }
                        .accessibilityIdentifier("crewcue.onboarding.switch-race.\(race.id)")
                    }
                }
            }
            Button(role: .destructive, action: onSignOut) {
                Label(OnboardingCopy.signOut, systemImage: "rectangle.portrait.and.arrow.right")
            }
            .accessibilityIdentifier("crewcue.onboarding.sign-out")
        } label: {
            Label(OnboardingCopy.accountMenu, systemImage: "person.crop.circle")
        }
        .accessibilityIdentifier("crewcue.onboarding.account-menu")
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
