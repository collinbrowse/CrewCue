import Foundation

public protocol Logger: Sendable {
    func log(_ message: String)
}
