import Crypto
import Foundation

public enum IdempotencyKey {
    /// First 16 hex chars of SHA-256 over the canonical JSON string the caller supplies.
    public static func hashPayload(_ canonicalJSON: String) -> String {
        let digest = SHA256.hash(data: Data(canonicalJSON.utf8))
        return digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    }
}
