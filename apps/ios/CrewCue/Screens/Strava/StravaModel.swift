import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class StravaModel {
    private(set) var message = ""
    private(set) var athleteId: String?
    private(set) var connected = false
    private(set) var busy = false

    private let client: AppClient
    private let webAuth = StravaWebAuth()
    private var generation = 0
    private var returnFailure = false

    init(client: AppClient) {
        self.client = client
    }

    func activate() async {
        await refresh()
    }

    /// `crewcue://strava` opened the app. The next refresh reads the connection.
    func prepareReturn(_ url: URL) {
        if Self.callbackFailed(url) {
            returnFailure = true
        }
    }

    func connect() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let start = try await RaceDayAPI.stravaStart(graph: client.graph)
            guard let url = URL(string: start.authorizeUrl), url.scheme != nil else {
                applyFailure()
                return
            }
            if let callback = await webAuth.start(authorizeURL: url) {
                prepareReturn(callback)
                await refresh()
            }
        } catch {
            guard !Task.isCancelled else { return }
            applyTransport(error)
        }
    }

    func disconnect() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await RaceDayAPI.stravaDisconnect(graph: client.graph)
            returnFailure = false
            await refresh()
        } catch {
            guard !Task.isCancelled else { return }
            applyTransport(error)
        }
    }

    func clear() {
        generation += 1
        returnFailure = false
        connected = false
        athleteId = nil
        message = ""
        busy = false
    }

    private func refresh() async {
        generation += 1
        let ticket = generation
        let failed = returnFailure
        do {
            let status = try await RaceDayAPI.stravaConnection(graph: client.graph)
            guard ticket == generation, !Task.isCancelled else { return }
            apply(status)
            if failed {
                returnFailure = false
                if connected == false, message != "Offline. Can't reach Strava." {
                    applyFailure()
                }
            }
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            if failed, APIFailure.isOffline(error) == false {
                returnFailure = false
                applyFailure()
                return
            }
            returnFailure = false
            applyTransport(error)
        }
    }

    private func apply(_ status: StravaConnection) {
        let isConnected = status.connected == true
        connected = isConnected
        let athlete = status.athleteId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if isConnected {
            athleteId = athlete.isEmpty ? nil : athlete
            if let athleteId {
                message = "Strava is connected. Athlete id \(athleteId)."
            } else {
                message = "Strava is connected."
            }
        } else {
            athleteId = nil
            message = "Strava is not connected."
        }
    }

    private func applyTransport(_ error: Error) {
        connected = false
        athleteId = nil
        message = APIFailure.isOffline(error) ? "Offline. Can't reach Strava." : "Strava connection failed."
    }

    private func applyFailure() {
        connected = false
        athleteId = nil
        message = "Strava connection failed."
    }

    private static func callbackFailed(_ url: URL) -> Bool {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return false
        }
        return items.contains { item in
            item.name == "error" && (item.value?.isEmpty == false)
        }
    }
}
