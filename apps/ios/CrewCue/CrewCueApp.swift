import SwiftUI
import CrewCueClientCore

@main
struct CrewCueApp: App {
    @UIApplicationDelegateAdaptor(CrewCueAppDelegate.self) private var appDelegate
    @State private var model: ShellModel

    init() {
        self.model = CompositionRoot().makeModel()
    }

    var body: some Scene {
        WindowGroup {
            AppRouter(model: model)
        }
    }
}
