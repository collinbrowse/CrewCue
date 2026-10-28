import Foundation

/// Cooldown for athlete location uploads.
///
/// Switching races calls `advance()`. An in-flight cooldown must not stay held, or every later
/// GPS sample is dropped for the rest of the session.
public struct LocationUploadGate: Equatable, Sendable {
    public private(set) var generation: Int
    public private(set) var held: Bool

    public init() {
        generation = 0
        held = false
    }

    /// Drop any in-flight cooldown. Call when the signed-in room, role, or user changes.
    public mutating func advance() {
        generation += 1
        held = false
    }

    /// Begin a cooldown. Returns nil while one is already held.
    public mutating func acquire() -> Int? {
        guard !held else { return nil }
        held = true
        return generation
    }

    /// End the cooldown `acquire` started. A stale ticket leaves a newer hold alone.
    public mutating func release(ticket: Int) {
        guard ticket == generation else { return }
        held = false
    }
}
