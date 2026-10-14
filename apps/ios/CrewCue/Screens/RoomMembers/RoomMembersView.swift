import SwiftUI

struct RoomMembersView: View {
    @Bindable var model: RoomMembersModel
    var userId: String?
    var roomId: String?
    var onProfile: () -> Void
    var onNameSaved: (String) -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(title: "Room members", subtitle: "Names your crew sees during the race.")
                if model.members.isEmpty == false {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(model.members) { member in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(verbatim: model.visibleName(member))
                                    .font(CrewFont.button)
                                if model.canRemove(member) {
                                    Button("Remove \(model.visibleName(member))") {
                                        Task { await model.remove(member) }
                                    }
                                    .buttonStyle(.crewSecondary)
                                    .disabled(model.working)
                                }
                            }
                        }
                    }
                    .crewCard()
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.body)
                }
                if hasRoom {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Your display name")
                            .font(CrewFont.button)
                        TextField("Display name", text: $model.nameDraft)
                            .font(CrewFont.bodyLarge)
                            .textFieldStyle(.crew)
                            .textContentType(.name)
                            .accessibilityLabel("Display name")
                        Button("Save") {
                            Task {
                                if let saved = await model.saveDisplayName() {
                                    onNameSaved(saved)
                                }
                            }
                        }
                        .buttonStyle(.crewPrimary)
                        .disabled(model.working)
                    }
                    .crewCard()
                }
                Button("Profile", action: onProfile)
                    .buttonStyle(.crewSecondary)
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
