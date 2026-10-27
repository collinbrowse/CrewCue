import SwiftUI
import CrewCueClientCore

@main
struct CrewCueApp: App {
    @UIApplicationDelegateAdaptor(CrewCueAppDelegate.self) private var appDelegate
    @State private var model: ShellModel
    /// Dev deeplink launches go straight to their fixture.
    @State private var showSplash = !CommandLine.arguments.contains("--deeplink")
    private let configurationProblem = LaunchConfiguration.resolve().configurationProblem

    init() {
        self.model = CompositionRoot().makeModel()
    }

    var body: some Scene {
        WindowGroup {
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
}
