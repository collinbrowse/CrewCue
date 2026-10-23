import SwiftUI
import CrewCueClientCore

@main
struct CrewCueApp: App {
    @UIApplicationDelegateAdaptor(CrewCueAppDelegate.self) private var appDelegate
    @State private var model: ShellModel
    /// Dev deeplink launches go straight to their fixture.
    @State private var showSplash = !CommandLine.arguments.contains("--deeplink")

    init() {
        self.model = CompositionRoot().makeModel()
    }

    var body: some Scene {
        WindowGroup {
            AppRouter(model: model)
                .overlay {
                    if showSplash {
                        LaunchSplash { showSplash = false }
                    }
                }
        }
    }
}
