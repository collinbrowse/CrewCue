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
    public var baseURL: URL?
    public var tokenProvider: (any AccessTokenProvider)?
    public var outbox: OutboxStore?
    public var session: SessionController?

    public init(
        transport: any HTTPTransport,
        clock: any Clock,
        logger: any Logger,
        baseURL: URL? = nil,
        tokenProvider: (any AccessTokenProvider)? = nil,
        outbox: OutboxStore? = nil,
        session: SessionController? = nil
    ) {
        self.transport = transport
        self.clock = clock
        self.logger = logger
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
        self.outbox = outbox
        self.session = session
    }

    public func featureScreen(for route: Route) -> FeatureScreen {
        logger.log("route \(route.featureId) \(route.state.rawValue)")
        return CrewCueClientCore.featureScreen(id: route.featureId, state: route.state)
    }
}
