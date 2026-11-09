import Foundation
import CrewCueClientCore

struct Auth0Configuration: Equatable, Sendable {
    var domain: String
    var clientId: String
    var audience: String

    var hasKeys: Bool {
        !domain.isEmpty && !clientId.isEmpty && !audience.isEmpty
    }

    static func load(bundle: Bundle = .main) -> Auth0Configuration {
        Auth0Configuration(
            domain: string("CrewCueAuth0Domain", bundle: bundle),
            clientId: string("CrewCueAuth0ClientId", bundle: bundle),
            audience: string("CrewCueAuth0Audience", bundle: bundle)
        )
    }

    private static func string(_ key: String, bundle: Bundle) -> String {
        let raw = bundle.object(forInfoDictionaryKey: key) as? String ?? ""
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct LaunchConfiguration: Equatable {
    var route: Route
    var fixtureOverlay: Bool
    var devSession: ClientSession?
    /// `--signed-out` ignores the persisted session so UI tests start from a clean launch.
    var signedOut: Bool
    /// Nil only in a Release build made without a usable https server address.
    var baseURL: URL?
    var auth: Auth0Configuration
    /// Why this build can't reach its server or Auth0. Release shows it instead of the app.
    var configurationProblem: String?
    /// RevenueCat public iOS SDK key (`CREWCUE_REVENUECAT_API_KEY`). Empty means no store in this build.
    var revenueCatAPIKey: String = ""
    /// Debug fake store only: dev links and launch arguments that shape the fake purchase.
    var fakeStore = FakeStoreOptions()

    static func resolve(
        arguments: [String] = CommandLine.arguments,
        bundle: Bundle = .main,
        devLinks: Bool = DevLinks.enabled,
        localFallback: Bool = DevLinks.enabled
    ) -> LaunchConfiguration {
        let deeplink = devLinks ? parsedDeeplink(arguments: arguments) : nil
        let plistBase = (bundle.object(forInfoDictionaryKey: "CrewCueAPIBaseURL") as? String) ?? ""
        // `--api-base-url` points a Debug build at another local server (an offline proxy for proofs).
        let raw = devLinks ? (argument(arguments, flag: "--api-base-url", offset: 1) ?? plistBase) : plistBase
        let baseURL = baseURL(raw: raw, localFallback: localFallback)
        let auth = Auth0Configuration.load(bundle: bundle)
        let revenueCatKey = ((bundle.object(forInfoDictionaryKey: "CrewCueRevenueCatAPIKey") as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var fakeStore = FakeStoreOptions()
        if devLinks {
            if let link = argument(arguments, flag: "--deeplink", offset: 1) {
                fakeStore.apply(deeplink: link)
            }
            if let delay = argument(arguments, flag: "--webhook-delay", offset: 1).flatMap(Double.init) {
                fakeStore.webhookDelaySeconds = delay
            }
            if let result = argument(arguments, flag: "--store-result", offset: 1) {
                fakeStore.storeResult = result
            }
        }
        return LaunchConfiguration(
            route: deeplink?.route ?? Route(featureId: "app-shell", state: .success),
            fixtureOverlay: deeplink?.fixtureOverlay ?? false,
            devSession: devLinks ? devSession(arguments: arguments) : nil,
            signedOut: arguments.contains("--signed-out"),
            baseURL: baseURL,
            auth: auth,
            configurationProblem: configurationProblem(baseURL: baseURL, auth: auth, localFallback: localFallback),
            revenueCatAPIKey: revenueCatKey,
            fakeStore: fakeStore
        )
    }

    /// Debug falls back to the local API. Release takes only an https server that is not this machine.
    static func baseURL(raw: String, localFallback: Bool) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if localFallback {
            if !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme != nil {
                return url
            }
            return URL(string: "http://127.0.0.1:3000")
        }
        guard let url = URL(string: trimmed),
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              !host.isEmpty,
              !["localhost", "127.0.0.1", "0.0.0.0", "::1"].contains(host) else {
            return nil
        }
        return url
    }

    static func configurationProblem(baseURL: URL?, auth: Auth0Configuration, localFallback: Bool) -> String? {
        if localFallback { return nil }
        if baseURL == nil { return "This build has no server address." }
        if !auth.hasKeys { return "This build has no sign-in settings." }
        return nil
    }

    /// `?state=` selects fixture copy. It is not the product's own empty, error, or offline state.
    static func isFixtureOverlay(_ urlString: String) -> Bool {
        guard let queryStart = urlString.firstIndex(of: "?") else { return false }
        let query = urlString[urlString.index(after: queryStart)...]
        for pair in query.split(separator: "&") {
            let bits = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            if bits.first == "state", bits.count == 2 {
                return true
            }
        }
        return false
    }

    private static func parsedDeeplink(arguments: [String]) -> (route: Route, fixtureOverlay: Bool)? {
        guard let raw = argument(arguments, flag: "--deeplink", offset: 1),
              let route = Route.parse(raw) else {
            return nil
        }
        return (route, isFixtureOverlay(raw))
    }

    /// `--dev-session <userId> <role> [token] [roomId]` enters the shell without Auth0.
    private static func devSession(arguments: [String]) -> ClientSession? {
        guard let userId = argument(arguments, flag: "--dev-session", offset: 1),
              let role = argument(arguments, flag: "--dev-session", offset: 2),
              !userId.isEmpty,
              !role.isEmpty else {
            return nil
        }
        return ClientSession(
            userId: userId,
            role: role,
            roomId: argument(arguments, flag: "--dev-session", offset: 4),
            displayName: nil,
            accessToken: argument(arguments, flag: "--dev-session", offset: 3)
        )
    }

    private static func argument(_ arguments: [String], flag: String, offset: Int) -> String? {
        guard let index = arguments.firstIndex(of: flag) else { return nil }
        let target = index + offset
        guard arguments.indices.contains(target) else { return nil }
        let value = arguments[target]
        guard !value.hasPrefix("--") else { return nil }
        return value
    }
}

/// Debug fake store knobs. `?webhookDelay=<seconds>` lets the server unlock late, the way a slow
/// RevenueCat webhook does, so the billing poll shows. `?storeResult=fail|cancel` makes the fake
/// store decline or cancel the way the App Store can.
struct FakeStoreOptions: Equatable, Sendable {
    var webhookDelaySeconds: Double = 0
    var storeResult: String?

    mutating func apply(deeplink urlString: String) {
        guard let queryStart = urlString.firstIndex(of: "?") else { return }
        let query = urlString[urlString.index(after: queryStart)...]
        for pair in query.split(separator: "&") {
            let bits = pair.split(separator: "=", maxSplits: 1)
            guard bits.count == 2 else { continue }
            switch bits[0] {
            case "webhookDelay":
                if let seconds = Double(bits[1]) { webhookDelaySeconds = max(0, seconds) }
            case "storeResult":
                storeResult = String(bits[1])
            default:
                break
            }
        }
    }
}
