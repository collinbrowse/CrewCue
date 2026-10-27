import Foundation

/// A newer course import replaced this upload before it was sent.
public struct CourseUploadSuperseded: Error, Equatable, Sendable {}

/// One course PUT at a time per room. A newer import skips an older queued upload
/// instead of letting the older PUT land last and replace the course.
public actor CourseUploadGate {
    private var generation: [String: Int] = [:]
    private var chain: [String: Task<Void, Never>] = [:]
    private var waiting: [String: Int] = [:]

    public func bump(roomId: String) -> Int {
        let next = (generation[roomId] ?? 0) + 1
        generation[roomId] = next
        return next
    }

    /// Roll back a bump that never committed, so an older queued file can still send.
    public func abandon(roomId: String, ticket: Int) {
        guard generation[roomId] == ticket, ticket > 0 else { return }
        generation[roomId] = ticket - 1
    }

    public func current(roomId: String) -> Int {
        generation[roomId] ?? 0
    }

    /// True while a caller is blocked behind another upload for this room.
    public func isWaiting(roomId: String) -> Bool {
        (waiting[roomId] ?? 0) > 0
    }

    public func perform(
        roomId: String,
        ticket: Int,
        _ body: @escaping @Sendable () async throws -> Data
    ) async throws -> Data {
        let previous = chain[roomId]
        beginWait(roomId: roomId)
        let box = CourseUploadBox()
        let task = Task {
            await previous?.value
            self.endWait(roomId: roomId)
            let latest = self.current(roomId: roomId)
            guard latest == ticket else {
                await box.fail(CourseUploadSuperseded())
                return
            }
            do {
                let data = try await body()
                await box.succeed(data)
            } catch {
                await box.fail(error)
            }
        }
        chain[roomId] = Task { _ = await task.value }
        return try await box.result()
    }

    private func beginWait(roomId: String) {
        waiting[roomId, default: 0] += 1
    }

    private func endWait(roomId: String) {
        let next = (waiting[roomId] ?? 1) - 1
        if next <= 0 {
            waiting[roomId] = nil
        } else {
            waiting[roomId] = next
        }
    }
}

/// Hands the upload result from the chained task back to `perform`.
private actor CourseUploadBox {
    private var continuation: CheckedContinuation<Data, Error>?
    private var stored: Result<Data, Error>?

    func result() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            if let stored {
                continuation.resume(with: stored)
            } else {
                self.continuation = continuation
            }
        }
    }

    func succeed(_ data: Data) {
        finish(.success(data))
    }

    func fail(_ error: Error) {
        finish(.failure(error))
    }

    private func finish(_ result: Result<Data, Error>) {
        if let continuation {
            self.continuation = nil
            continuation.resume(with: result)
        } else {
            stored = result
        }
    }
}
