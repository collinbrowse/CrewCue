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
                onJoin: { model.show(Route(featureId: "join-crew", state: .success)) },
                onCreated: { roomId in
                    model.noteJoined(roomId: roomId, role: "athlete")
                },
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
    var onJoin: () -> Void
    var onCreated: @MainActor (String) -> Void
    var onName: @MainActor (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(spacing: 8) {
                    Image("OnboardingRunner")
                        .resizable()
                        .scaledToFill()
                        .frame(width: 96, height: 96)
                        .clipShape(Circle())
                        .accessibilityLabel("Athlete")
                    Text("Profile")
                        .font(.system(size: 20, weight: .bold))
                    if model.showsName {
                        Text(verbatim: model.displayName)
                            .font(.system(size: 16))
                    }
                    if model.message.isEmpty == false {
                        Text(verbatim: model.message)
                            .font(.system(size: 16))
                    }
                }
                .frame(maxWidth: .infinity)
                .kineticCard()

                if hasRoom {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Race & workspace")
                            .font(.system(size: 17, weight: .bold))
                        Text("Manage members and room controls for your current race.")
                            .font(.system(size: 16))
                        Button("Room members", action: onMembers)
                            .buttonStyle(KineticSecondaryButtonStyle())
                        Button("Incidents", action: onIncidents)
                            .buttonStyle(KineticSecondaryButtonStyle())
                    }
                    .kineticCard()
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Your races")
                        .font(.system(size: 17, weight: .bold))
                    TextField("Race name", text: $model.raceName)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Race name")
                    Button("Create new race") {
                        Task { await model.createRace(onCreated: onCreated) }
                    }
                    .buttonStyle(KineticSecondaryButtonStyle())
                    .disabled(model.creatingRace)
                    Button("Join race room", action: onJoin)
                        .buttonStyle(KineticSecondaryButtonStyle())
                }
                .kineticCard()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Training history")
                        .font(.system(size: 17, weight: .bold))
                    Text("Connect Strava so pace can use your recent efforts.")
                        .font(.system(size: 16))
                    Button("Strava", action: onStrava)
                        .buttonStyle(KineticSecondaryButtonStyle())
                }
                .kineticCard()

                VStack(alignment: .leading, spacing: 10) {
                    Text("Account")
                        .font(.system(size: 17, weight: .bold))
                    Text("Sign out of this device and return to the login flow.")
                        .font(.system(size: 16))
                    Button("Sign out", action: model.signOut)
                        .buttonStyle(KineticDangerButtonStyle())
                }
                .kineticCard()
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
