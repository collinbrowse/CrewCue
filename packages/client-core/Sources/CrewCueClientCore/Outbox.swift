import Foundation

public struct OutboxOperation: Equatable, Sendable {
    public var id: String
    public var type: String
    public var status: String
    public var conflictKey: String

    public init(id: String, type: String, status: String, conflictKey: String) {
        self.id = id
        self.type = type
        self.status = status
        self.conflictKey = conflictKey
    }
}

public struct OutboxFailureResolution: Equatable, Sendable {
    public var status: String
    public var retryable: Bool
    public var feedback: String

    public init(status: String, retryable: Bool, feedback: String) {
        self.status = status
        self.retryable = retryable
        self.feedback = feedback
    }
}

public struct ClientHTTPError: Error, Sendable {
    public var status: Int
    public var message: String
    public var bodyError: String?
    public var decision: String?
    public var reason: String?
    public var serverMessage: String?

    public init(
        status: Int,
        message: String,
        bodyError: String? = nil,
        decision: String? = nil,
        reason: String? = nil,
        serverMessage: String? = nil
    ) {
        self.status = status
        self.message = message
        self.bodyError = bodyError
        self.decision = decision
        self.reason = reason
        self.serverMessage = serverMessage
    }
}

public enum OutboxPolicy {
    public static func merge(_ operations: [OutboxOperation], _ operation: OutboxOperation, conflictKey: String) -> [OutboxOperation] {
        var withKey = operation
        withKey.conflictKey = conflictKey
        var next = operations
        if let mergeIndex = next.firstIndex(where: { $0.status == "pending" && $0.conflictKey == conflictKey }) {
            next[mergeIndex] = withKey
            return next
        }
        if let idIndex = next.firstIndex(where: { $0.id == withKey.id }) {
            next[idIndex] = withKey
            return next
        }
        next.append(withKey)
        return next
    }

    public static func resolve(_ error: Error) -> OutboxFailureResolution {
        guard let http = error as? ClientHTTPError else {
            return OutboxFailureResolution(
                status: "pending",
                retryable: true,
                feedback: "Network error. Will retry when the app is active."
            )
        }
        if http.status == 401 {
            return OutboxFailureResolution(
                status: "expired",
                retryable: false,
                feedback: "Session expired. Sign in again."
            )
        }
        if http.status == 422 && http.reason == "stale_recorded_at" {
            return OutboxFailureResolution(
                status: "dropped",
                retryable: false,
                feedback: "Stale location sample dropped."
            )
        }
        if http.status == 409 {
            let haystack = [http.reason, http.decision, http.bodyError, http.message]
                .compactMap { $0?.lowercased() }
                .joined(separator: " ")
            if haystack.contains("already") {
                return OutboxFailureResolution(status: "accepted", retryable: false, feedback: "Already recorded.")
            }
        }
        if http.status == 422 && http.decision == "rejected" {
            let feedback: String
            if let serverMessage = http.serverMessage, !serverMessage.isEmpty {
                feedback = serverMessage
            } else if let reason = http.reason, !reason.isEmpty {
                feedback = "Rejected: \(reason.replacingOccurrences(of: "_", with: " "))"
            } else {
                feedback = "Rejected by server policy."
            }
            return OutboxFailureResolution(status: "rejected", retryable: false, feedback: feedback)
        }
        if http.status == 409 {
            return OutboxFailureResolution(status: "conflict", retryable: false, feedback: http.bodyError ?? http.message)
        }
        if [400, 403, 404].contains(http.status) {
            return OutboxFailureResolution(status: "rejected", retryable: false, feedback: http.bodyError ?? http.message)
        }
        return OutboxFailureResolution(status: "pending", retryable: true, feedback: http.bodyError ?? http.message)
    }

    /// The server (or Stream) already has this client message id. A resend after a crash or a lost
    /// response lands here, and it counts as delivered.
    public static func isAlreadyDelivered(_ error: any Error) -> Bool {
        if let http = error as? ClientHTTPError {
            return resolve(http).status == "accepted"
        }
        let text = "\(error) \((error as NSError).localizedDescription)".lowercased()
        return text.contains("already exists")
    }

    public static func isSafeRetry(_ operation: OutboxOperation) -> Bool {
        operation.status == "pending" && operation.type == "ping"
    }

    public static func countPending(_ operations: [OutboxOperation]) -> Int {
        operations.filter { $0.status == "pending" }.count
    }
}
