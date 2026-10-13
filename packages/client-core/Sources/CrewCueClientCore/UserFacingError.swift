import Foundation

public struct UserFacingError: Equatable, Sendable {
    public var code: String
    public var message: String
    public var retryable: Bool

    public init(code: String, message: String, retryable: Bool) {
        self.code = code
        self.message = message
        self.retryable = retryable
    }

    public init(_ error: ClientHTTPError) {
        let resolution = OutboxPolicy.resolve(error)
        let code: String
        if error.status == 422 && error.decision == "rejected" {
            code = "rejected"
        } else if error.status == 409 {
            code = "conflict"
        } else {
            code = String(error.status)
        }
        self.init(code: code, message: resolution.feedback, retryable: resolution.retryable)
    }
}
