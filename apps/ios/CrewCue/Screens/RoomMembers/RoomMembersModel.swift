import Foundation
import Observation
import CrewCueClientCore

struct RoomMemberLine: Identifiable, Equatable {
    var id: String
    var displayName: String
}

@MainActor
@Observable
final class RoomMembersModel {
    private(set) var members: [RoomMemberLine] = []
    private(set) var message = ""
    private(set) var working = false
    var nameDraft = ""

    private let client: AppClient
    private var generation = 0
    private var userId: String?
    private var roomId: String?
    private var athleteId: String?

    init(client: AppClient) {
        self.client = client
    }

    func activate(userId: String?, roomId: String?) async {
        generation += 1
        let ticket = generation
        self.userId = Self.trimmed(userId)
        self.roomId = Self.trimmed(roomId)
        guard let roomId = self.roomId else {
            members = []
            athleteId = nil
            message = "No members yet."
            return
        }
        await load(roomId: roomId, ticket: ticket)
    }

    func saveDisplayName() async -> String? {
        let name = nameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let roomId, let userId, !working else { return nil }
        guard name.isEmpty == false else {
            message = "Couldn't update members."
            return nil
        }
        let ticket = generation
        working = true
        defer { working = false }
        do {
            let envelope = try await RaceDayAPI.updateDisplayName(
                graph: client.graph,
                roomId: roomId,
                userId: userId,
                displayName: name
            )
            guard ticket == generation, !Task.isCancelled else { return nil }
            apply(envelope.room)
            return name
        } catch {
            guard ticket == generation, !Task.isCancelled else { return nil }
            message = Self.actionFailure(error)
            return nil
        }
    }

    func remove(_ member: RoomMemberLine) async {
        guard canRemove(member), let roomId, !working else { return }
        let ticket = generation
        working = true
        defer { working = false }
        do {
            try await RaceDayAPI.removeMember(graph: client.graph, roomId: roomId, userId: member.id)
            guard ticket == generation, !Task.isCancelled else { return }
            await load(roomId: roomId, ticket: ticket)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            message = Self.actionFailure(error)
        }
    }

    func canRemove(_ member: RoomMemberLine) -> Bool {
        guard let userId, let athleteId, userId == athleteId else { return false }
        return member.id != athleteId
    }

    func visibleName(_ member: RoomMemberLine) -> String {
        let trimmed = member.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? member.id : trimmed
    }

    func clear() {
        generation += 1
        members = []
        message = ""
        nameDraft = ""
        working = false
        userId = nil
        roomId = nil
        athleteId = nil
    }

    private func load(roomId: String, ticket: Int) async {
        do {
            let envelope = try await RaceDayAPI.loadRoom(graph: client.graph, roomId: roomId)
            guard ticket == generation, !Task.isCancelled else { return }
            apply(envelope.room)
        } catch {
            guard ticket == generation, !Task.isCancelled else { return }
            members = []
            athleteId = nil
            message = Self.loadFailure(error)
        }
    }

    private func apply(_ room: RaceRoom) {
        athleteId = room.athleteId
        members = room.memberships.map { membership in
            RoomMemberLine(id: membership.userId, displayName: membership.displayName ?? "")
        }
        if working == false, let userId, let mine = members.first(where: { $0.id == userId }) {
            nameDraft = mine.displayName
        }
        message = members.isEmpty ? "No members yet." : "Roster lists members."
    }

    private static func loadFailure(_ error: Error) -> String {
        APIFailure.isOffline(error) ? "Offline. Roster not updated." : "Couldn't update members."
    }

    private static func actionFailure(_ error: Error) -> String {
        if APIFailure.isOffline(error) {
            return "Offline. Roster not updated."
        }
        if let http = error as? ClientHTTPError {
            let text = http.message.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty == false {
                return text
            }
        }
        return "Couldn't update members."
    }

    private static func trimmed(_ value: String?) -> String? {
        let text = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}
