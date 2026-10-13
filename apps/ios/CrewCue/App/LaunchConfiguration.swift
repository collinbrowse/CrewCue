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
    var baseURL: URL
    var auth: Auth0Configuration

    static func resolve(arguments: [String] = CommandLine.arguments, bundle: Bundle = .main) -> LaunchConfiguration {
        let deeplink = parsedDeeplink(arguments: arguments)
        return LaunchConfiguration(
            route: deeplink?.route ?? Route(featureId: "app-shell", state: .success),
            fixtureOverlay: deeplink?.fixtureOverlay ?? false,
            devSession: devSession(arguments: arguments),
            baseURL: baseURL(bundle: bundle),
            auth: Auth0Configuration.load(bundle: bundle)
        )
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

    private static func baseURL(bundle: Bundle) -> URL {
        let raw = (bundle.object(forInfoDictionaryKey: "CrewCueAPIBaseURL") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !raw.isEmpty, let url = URL(string: raw), url.scheme != nil {
            return url
        }
        return URL(string: "http://127.0.0.1:3000") ?? URL(fileURLWithPath: "/")
    }
}
