import Foundation

enum APIFailure {
    static func isTransport(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            return urlError.code != .cancelled
        }
        let bridged = error as NSError
        return bridged.domain == NSURLErrorDomain && bridged.code != URLError.cancelled.rawValue
    }

    static func isOffline(_ error: Error) -> Bool {
        isOffline(error, depth: 0)
    }

    private static func isOffline(_ error: Error, depth: Int) -> Bool {
        if isTransport(error) { return true }
        guard depth < 4 else { return false }
        guard let underlying = (error as NSError).userInfo[NSUnderlyingErrorKey] as? Error else { return false }
        return isOffline(underlying, depth: depth + 1)
    }
}
