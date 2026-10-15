import CrewCueClientCore

/// Holds the one live graph so session and token updates are visible to every screen.
@MainActor
final class AppClient {
    var graph: ClientGraph

    init(graph: ClientGraph) {
        self.graph = graph
    }
}
