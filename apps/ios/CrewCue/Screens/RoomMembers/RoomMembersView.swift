import SwiftUI

struct RoomMembersView: View {
    @Bindable var model: RoomMembersModel
    var userId: String?
    var roomId: String?
    var onProfile: () -> Void
    var onNameSaved: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Room members")
                    .font(.title2)
                ForEach(model.members) { member in
                    Text(verbatim: model.visibleName(member))
                        .font(.body)
                    if model.canRemove(member) {
                        Button("Remove \(model.visibleName(member))") {
                            Task { await model.remove(member) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.working)
                    }
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(.body)
                }
                if hasRoom {
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
                    .buttonStyle(.borderedProminent)
                    .disabled(model.working)
                }
                Button("Profile", action: onProfile)
                    .buttonStyle(.bordered)
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
