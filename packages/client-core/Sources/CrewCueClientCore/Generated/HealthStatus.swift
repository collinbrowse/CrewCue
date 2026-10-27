// Generated from packages/contracts. Do not edit.
import Foundation

public struct HealthStatus: Codable, Equatable, Sendable {
    public var service: String
    public var status: String
    public var timestamp: String

    public init(service: String, status: String, timestamp: String) {
        self.service = service
        self.status = status
        self.timestamp = timestamp
    }
}
