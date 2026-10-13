import SwiftUI
import CrewCueClientCore

struct ProfileTabPage: View {
    var model: ShellModel

    var body: some View {
        switch model.route.featureId {
        case "strava":
            StravaView(model: model.stravaModel) {
                model.show(Route(featureId: "profile", state: .success))
            }
        case "room-members":
            RoomMembersView(
                model: model.membersModel,
                userId: model.signedInUserId,
                roomId: model.signedInRoomId,
                onProfile: { model.show(Route(featureId: "profile", state: .success)) },
                onNameSaved: { [weak model] name in
                    model?.updateDisplayName(name)
                }
            )
        case "readouts-incidents":
            IncidentsView(
                model: model.incidentsModel,
                roomId: model.signedInRoomId,
                onProfile: { model.show(Route(featureId: "profile", state: .success)) }
            )
        default:
            ProfileView(
                model: model.profileModel,
                userId: model.signedInUserId,
                roomId: model.signedInRoomId,
                displayName: model.signedInDisplayName,
                onStrava: { model.show(Route(featureId: "strava", state: .success)) },
                onMembers: { model.show(Route(featureId: "room-members", state: .success)) },
                onIncidents: { model.show(Route(featureId: "readouts-incidents", state: .success)) },
                onName: { [weak model] name in
                    model?.updateDisplayName(name)
                }
            )
        }
    }
}

struct ProfileView: View {
    @Bindable var model: ProfileModel
    var userId: String?
    var roomId: String?
    var displayName: String?
    var onStrava: () -> Void
    var onMembers: () -> Void
    var onIncidents: () -> Void
    var onName: @MainActor (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Profile")
                    .font(.title2)
                if model.showsName {
                    Text(verbatim: model.displayName)
                        .font(.body)
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(.body)
                }
                Button("Strava", action: onStrava)
                    .buttonStyle(.bordered)
                if hasRoom {
                    Button("Room members", action: onMembers)
                        .buttonStyle(.bordered)
                    Button("Incidents", action: onIncidents)
                        .buttonStyle(.bordered)
                }
                Button("Sign out", action: model.signOut)
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.profile", label: "Profile")
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, displayName: displayName, onName: onName)
        }
    }

    private var hasRoom: Bool {
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty == false
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(displayName ?? "")"
    }
}
