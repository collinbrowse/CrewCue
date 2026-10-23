public enum IdempotencyKey {
    /// First 16 hex chars of SHA-256 over the canonical JSON string the caller supplies.
    public static func hashPayload(_ canonicalJSON: String) -> String {
        let digest = PortableSHA256.hash(Array(canonicalJSON.utf8))
        return PortableFormat.hex(digest.prefix(8))
    }
}
