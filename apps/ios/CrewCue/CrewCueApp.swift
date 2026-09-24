import SwiftUI
import CrewCueClientCore

@main
struct CrewCueApp: App {
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
