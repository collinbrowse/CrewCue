import SwiftUI

struct RoomMembersView: View {
    @Bindable var model: RoomMembersModel
    var userId: String?
    var roomId: String?
    var onProfile: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(title: "Room members", subtitle: "Your crew for this race. Change your own name in Settings.")
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

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")"
    }
}
