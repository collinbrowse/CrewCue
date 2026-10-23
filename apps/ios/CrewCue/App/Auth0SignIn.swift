import Foundation
import CrewCueClientCore

#if canImport(Auth0)
import Auth0
#endif

enum Auth0SignInFailure: Error, Equatable {
    case cancelled
    case offline
    case failed
}

/// Auth0 authorize integration. Compiles without the SDK when the package is not linked.
enum Auth0SignIn {
    static var sdkAvailable: Bool {
        #if canImport(Auth0)
        true
        #else
        false
        #endif
    }

    @MainActor
    static func authorize(
        _ configuration: Auth0Configuration,
        connection: String? = nil,
        signUp: Bool = false
    ) async throws -> ClientSession {
        guard sdkAvailable, configuration.hasKeys else {
            throw Auth0SignInFailure.failed
        }
        #if canImport(Auth0)
        do {
            var web = Auth0
                .webAuth(clientId: configuration.clientId, domain: configuration.domain)
                .audience(configuration.audience)
                .scope("openid profile email")
                .useEphemeralSession()
            if let connection, !connection.isEmpty {
                web = web.connection(connection)
            }
            if signUp {
                web = web.parameters(["screen_hint": "signup"])
            }
            if let callback = URL(string: "crewcue://auth") {
                web = web.redirectURL(callback)
            }
            let credentials = try await web.start()
            guard let session = session(accessToken: credentials.accessToken, idToken: credentials.idToken) else {
                throw Auth0SignInFailure.failed
            }
            return session
        } catch let failure as Auth0SignInFailure {
            throw failure
        } catch {
            throw map(error)
        }
        #else
        throw Auth0SignInFailure.failed
        #endif
    }

    #if canImport(Auth0)
    private static func map(_ error: Error) -> Auth0SignInFailure {
        if WebAuthError.userCancelled ~= error {
            return .cancelled
        }
        if let web = error as? WebAuthError, let cause = web.cause, APIFailure.isTransport(cause) {
            return .offline
        }
        if APIFailure.isTransport(error) {
            return .offline
        }
        return .failed
    }
    #endif

    static func session(accessToken: String, idToken: String) -> ClientSession? {
        let claims = IDTokenClaims.read(idToken)
        guard let userId = claims["sub"], !userId.isEmpty else { return nil }
        let role = claims["role"].flatMap { $0.isEmpty ? nil : $0 } ?? "crew"
        let name = claims["name"] ?? claims["nickname"]
        let displayName = name?.isEmpty == false ? name : nil
        return ClientSession(
            userId: userId,
            role: role,
            roomId: nil,
            displayName: displayName,
            accessToken: accessToken
        )
    }
}

enum IDTokenClaims {
    static func read(_ idToken: String) -> [String: String] {
        let parts = idToken.split(separator: ".")
        guard parts.count >= 2 else { return [:] }
        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64 += String(repeating: "=", count: 4 - remainder)
        }
        guard let data = Data(base64Encoded: base64),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        var claims: [String: String] = [:]
        for (key, value) in object {
            if let string = value as? String {
                claims[key] = string
            }
        }
        return claims
    }
}
