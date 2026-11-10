import Foundation

/// Hard time limit for a read that is safe to abandon.
///
/// A connection that dies without a reset (a phone leaving coverage, a carrier NAT dropping
/// state) can leave a request waiting forever: Foundation on Android does not always enforce
/// `URLRequest.timeoutInterval`. `run` returns `URLError(.timedOut)` once `seconds` pass and
/// abandons the request, so the caller's loop can reconnect.
///
/// It never cancels the request. On Android, cancelling a Swift task that is inside
/// `URLSession.data(for:)` deadlocks Foundation (the cancel handler's `URLSessionTask.cancel`
/// waits on the session queue while that queue waits to resume the same task), and the
/// stuck threads then stall every other request in the app.
enum Deadline {
    static func run<T: Sendable>(
        seconds: Double,
        _ operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<T, Error>) in
            let gate = ResumeOnce(continuation)
            Task {
                do {
                    gate.resume(.success(try await operation()))
                } catch {
                    gate.resume(.failure(error))
                }
            }
            let timer = Task {
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0) * 1_000_000_000))
                if Task.isCancelled { return }
                gate.resume(.failure(URLError(.timedOut)))
            }
            gate.onResume = { timer.cancel() }
        }
    }
}

/// Resumes a continuation at most once, from whichever side finishes first.
private final class ResumeOnce<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?
    private var callback: (@Sendable () -> Void)?
    private var resumed = false

    init(_ continuation: CheckedContinuation<T, Error>) {
        self.continuation = continuation
    }

    /// Runs once the continuation is resumed (at once if it already was).
    var onResume: (@Sendable () -> Void)? {
        get { nil }
        set {
            lock.lock()
            let runNow = resumed
            if !runNow { callback = newValue }
            lock.unlock()
            if runNow { newValue?() }
        }
    }

    /// True when this call resumed the continuation.
    @discardableResult
    func resume(_ result: Result<T, Error>) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        resumed = true
        let after = callback
        callback = nil
        lock.unlock()
        guard let pending else { return false }
        pending.resume(with: result)
        after?()
        return true
    }
}
