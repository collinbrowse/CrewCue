import Foundation

/// Why the client is asking the server for a new plan-of-record estimate. The server checks it too.
public enum PlanTrigger: String, Sendable, CaseIterable {
    /// The athlete's own history changed (or arrived on a cold start). Athlete only.
    case auto
    /// Crew seeds the first estimate when the room has no plan of record yet.
    case coldStart = "cold_start"
    /// Someone tapped Recalculate.
    case recalculate
}

public enum PlanAuthorityError: Error, Equatable, Sendable {
    case notAllowed

    public var message: String {
        "Only the athlete's history updates the plan automatically."
    }
}

extension PlanAuthority {
    /// Only the athlete's history may automatically create or recompute the plan of record.
    /// Crew may seed a cold start (no plan yet) or tap Recalculate.
    public static func allows(role: String, trigger: PlanTrigger, hasPlanOfRecord: Bool) -> Bool {
        switch trigger {
        case .auto:
            mayAutoRecompute(role: role)
        case .coldStart:
            maySeedColdStart(role: role) && (mayAutoRecompute(role: role) || !hasPlanOfRecord)
        case .recalculate:
            mayExplicitRecalculate(role: role)
        }
    }
}

public enum PlanOfRecord {
    /// Computes an estimate for the room and attaches it as the plan of record. Refused locally,
    /// before any request, when the role may not use this trigger.
    public static func recompute(
        graph: ClientGraph,
        roomId: String,
        role: String,
        trigger: PlanTrigger,
        hasPlanOfRecord: Bool
    ) async throws -> PacingEstimate {
        guard PlanAuthority.allows(role: role, trigger: trigger, hasPlanOfRecord: hasPlanOfRecord) else {
            throw PlanAuthorityError.notAllowed
        }
        let computed: PacingEstimate = try await send(
            graph,
            "/pacing-estimates",
            method: .post,
            body: ["roomId": roomId, "trigger": trigger.rawValue]
        )
        let attached: AttachEnvelope = try await send(
            graph,
            "/race-rooms/\(roomId)/pacing-estimate",
            method: .put,
            body: ["pacingEstimateId": computed.id, "trigger": trigger.rawValue]
        )
        return attached.estimate
    }

    private struct AttachEnvelope: Decodable {
        var estimate: PacingEstimate
    }

    private static func send<T: Decodable>(
        _ graph: ClientGraph,
        _ path: String,
        method: HTTPMethod,
        body: [String: String]
    ) async throws -> T {
        guard let baseURL = graph.baseURL, let url = APIClient.endpoint(baseURL, path) else {
            throw ClientHTTPError(status: 0, message: "API base URL is not configured.")
        }
        let token = await graph.tokenProvider?.accessToken()
        let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
        let request = APIClient.authorized(url: url, method: method, token: token, body: data)
        return try await APIClient.send(request, transport: graph.transport)
    }
}
