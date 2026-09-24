import Foundation
import CrewCueClientCore

@MainActor
struct CompositionRoot {
    func makeModel() -> ShellModel {
        let graph = ClientGraph(
            transport: URLSessionTransport(),
            clock: SystemClock(),
            logger: OSLogLogger()
        )
        return ShellModel(graph: graph, route: Self.launchRoute())
    }

    private static func launchRoute() -> Route {
        let arguments = CommandLine.arguments
        if let index = arguments.firstIndex(of: "--deeplink"),
           arguments.indices.contains(index + 1),
           let route = Route.parse(arguments[index + 1]) {
            return route
        }
        return Route(featureId: "app-shell", state: .success)
    }
}
