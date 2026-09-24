import Foundation

public protocol Clock: Sendable {
    func now() -> Date
}

public struct SystemClock: Clock {
    public init() {}

    public func now() -> Date {
        Date()
    }
}

public struct ClientGraph: Sendable {
    public var transport: any HTTPTransport
    public var clock: any Clock
    public var logger: any Logger

    public init(transport: any HTTPTransport, clock: any Clock, logger: any Logger) {
        self.transport = transport
        self.clock = clock
        self.logger = logger
    }

    public func featureScreen(for route: Route) -> FeatureScreen {
        logger.log("route \(route.featureId) \(route.state.rawValue)")
        return CrewCueClientCore.featureScreen(id: route.featureId, state: route.state)
    }
}
