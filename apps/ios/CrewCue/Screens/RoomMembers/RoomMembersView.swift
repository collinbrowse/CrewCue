import SwiftUI

struct RoomMembersView: View {
    @Bindable var model: RoomMembersModel
    var userId: String?
    var roomId: String?
    var onProfile: () -> Void
    var onNameSaved: (String) -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(title: "Room members", subtitle: "Names your crew sees during the race.")
                if model.members.isEmpty == false {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(model.members) { member in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(verbatim: model.visibleName(member))
                                    .font(.system(size: 17, weight: .semibold))
                                if model.canRemove(member) {
                                    Button("Remove \(model.visibleName(member))") {
                                        Task { await model.remove(member) }
                                    }
                                    .buttonStyle(KineticSecondaryButtonStyle())
                                    .disabled(model.working)
                                }
                            }
                        }
                    }
                    .kineticCard()
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(.system(size: 16))
                        .foregroundStyle(theme.body)
                }
                if hasRoom {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Your display name")
                            .font(.system(size: 17, weight: .bold))
                        TextField("Display name", text: $model.nameDraft)
                            .font(.body)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(.name)
                            .accessibilityLabel("Display name")
                        Button("Save") {
                            Task {
                                if let saved = await model.saveDisplayName() {
                                    onNameSaved(saved)
                                }
                            }
                        }
                        .buttonStyle(KineticProductButtonStyle())
                        .disabled(model.working)
                    }
                    .kineticCard()
                }
                Button("Profile", action: onProfile)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.room-members", label: "Room members")
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId)
        }
    }

    private var hasRoom: Bool {
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty == false
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")"
    }
}
