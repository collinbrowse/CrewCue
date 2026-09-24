import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HTTPMethod: String, Sendable {
    case get = "GET"
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
    func send(url: URL, method: HTTPMethod) async throws -> HTTPResponse
}

public struct URLSessionTransport: HTTPTransport {
    public init() {}

    public func send(url: URL, method: HTTPMethod) async throws -> HTTPResponse {
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return HTTPResponse(status: status, body: data)
    }
}

public enum APIClient {
    public static func decodeHealth(_ data: Data) throws -> HealthStatus {
        try JSONDecoder().decode(HealthStatus.self, from: data)
    }

    public static func fetchHealth(baseURL: URL, transport: any HTTPTransport) async throws -> HealthStatus {
        let url = baseURL.appending(path: "health")
        let response = try await transport.send(url: url, method: .get)
        guard (200..<300).contains(response.status) else {
            throw ClientHTTPError(status: response.status, message: "Health request failed")
        }
        return try decodeHealth(response.body)
    }
}
