import SwiftUI
import CrewCueClientCore

@main
struct CrewCueApp: App {
    @UIApplicationDelegateAdaptor(CrewCueAppDelegate.self) private var appDelegate
    @State private var model: ShellModel
    private let configurationProblem = LaunchConfiguration.resolve().configurationProblem

    init() {
        CrashReporting.start()
        // A replay killed mid-way (PR 9b) leaves its temporary directory behind; sweep it once.
        DemoRace.removeStaleDirectories()
        self.model = CompositionRoot().makeModel()
    }

    var body: some Scene {
        // Read nothing here that changes after launch. SwiftUI runs this closure as a view body, and
        // on iOS 27 its async renderer re-runs it off the main thread when state it read changes
        // while an animation plays. Swift 6 checks the closure's main-actor isolation at runtime, so
        // that re-run traps (EXC_BREAKPOINT). SwiftUI keeps a View's own body on the main thread, so
        // state that changes, like the splash, lives in `AppRoot`.
        WindowGroup {
            AppRoot(model: model, configurationProblem: configurationProblem)
        }
    }
}

/// The window's root view: the app, or the configuration error, under the launch splash.
struct AppRoot: View {
    let model: ShellModel
    let configurationProblem: String?
    @State private var showSplash = Self.showsSplashAtLaunch

    /// Dev deeplink launches go straight to their fixture. `--launch-splash` (Debug) plays the splash
    /// over one anyway, so a launch test can end it over a screen that animates.
    private static var showsSplashAtLaunch: Bool {
        let arguments = CommandLine.arguments
        return !arguments.contains("--deeplink") || (DevLinks.enabled && arguments.contains("--launch-splash"))
    }

    var body: some View {
        if let configurationProblem {
            ConfigurationErrorView(problem: configurationProblem)
        } else {
            AppRouter(model: model)
                .overlay {
                    if showSplash {
                        LaunchSplash { showSplash = false }
                    }
                }
        }
    }
}
