import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

public struct HTTPRequest: Sendable {
    public var url: URL
    public var method: HTTPMethod
    public var headers: [String: String]
    public var body: Data?

    public init(url: URL, method: HTTPMethod, headers: [String: String] = [:], body: Data? = nil) {
        self.url = url
        self.method = method
        self.headers = headers
        self.body = body
    }
}

public struct HTTPResponse: Sendable {
    public var status: Int
    public var body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

public protocol HTTPTransport: Sendable {
    func send(_ request: HTTPRequest) async throws -> HTTPResponse
}

public struct URLSessionTransport: HTTPTransport {
    public init() {}

    public func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method.rawValue
        for (field, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: field)
        }
        if let body = request.body {
            urlRequest.httpBody = body
            if urlRequest.value(forHTTPHeaderField: "Content-Type") == nil {
                urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
        }
        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return HTTPResponse(status: status, body: data)
    }
}

public protocol AccessTokenProvider: Sendable {
    func accessToken() async -> String?
}

public struct StaticTokenProvider: AccessTokenProvider {
    public var token: String?

    public init(token: String? = nil) {
        self.token = token
    }

    public func accessToken() async -> String? {
        token
    }
}

public enum APIClient {
    public static func endpoint(_ baseURL: URL, _ path: String, query: [String: String] = [:]) -> URL? {
        var root = baseURL.absoluteString
        if root.hasSuffix("/") {
            root.removeLast()
        }
        let suffix = path.hasPrefix("/") ? path : "/\(path)"
        guard var components = URLComponents(string: root + suffix) else { return nil }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        return components.url
    }

    public static func decodeHealth(_ data: Data) throws -> HealthStatus {
        try JSONDecoder().decode(HealthStatus.self, from: data)
    }

    public static func failure(status: Int, data: Data) -> ClientHTTPError {
        struct Body: Decodable {
            var error: String?
            var message: String?
            var decision: String?
            var reason: String?
            var code: String?
        }
        let body = try? JSONDecoder().decode(Body.self, from: data)
        let message = body?.message ?? body?.error ?? "Request failed"
        return ClientHTTPError(
            status: status,
            message: message,
            bodyError: body?.error,
            decision: body?.decision ?? body?.code,
            reason: body?.reason ?? body?.code,
            serverMessage: body?.message ?? body?.error
        )
    }

    public static func send(
        _ request: HTTPRequest,
        transport: any HTTPTransport
    ) async throws -> HTTPResponse {
        let response = try await transport.send(request)
        guard (200..<300).contains(response.status) else {
            throw failure(status: response.status, data: response.body)
        }
        return response
    }

    public static func send<T: Decodable>(
        _ request: HTTPRequest,
        transport: any HTTPTransport,
        as type: T.Type = T.self
    ) async throws -> T {
        let response = try await send(request, transport: transport)
        if T.self == EmptyBody.self {
            return EmptyBody() as! T
        }
        return try JSONDecoder().decode(T.self, from: response.body)
    }

    public static func authorized(
        url: URL,
        method: HTTPMethod,
        token: String?,
        body: Data? = nil,
        idempotencyKey: String? = nil
    ) -> HTTPRequest {
        var headers: [String: String] = [:]
        if let token, !token.isEmpty {
            headers["Authorization"] = "Bearer \(token)"
        }
        if let idempotencyKey, !idempotencyKey.isEmpty {
            headers["Idempotency-Key"] = idempotencyKey
        }
        return HTTPRequest(url: url, method: method, headers: headers, body: body)
    }

    public static func fetchHealth(baseURL: URL, transport: any HTTPTransport) async throws -> HealthStatus {
        guard let url = endpoint(baseURL, "/health") else {
            throw ClientHTTPError(status: 0, message: "Invalid health URL")
        }
        return try await send(authorized(url: url, method: .get, token: nil), transport: transport)
    }
}

public struct EmptyBody: Decodable, Sendable {
    public init() {}
}
