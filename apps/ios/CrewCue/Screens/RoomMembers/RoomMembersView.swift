import SwiftUI
import CrewCueClientCore

struct RoomMembersView: View {
    @Bindable var model: RoomMembersModel
    var userId: String?
    var roomId: String?
    var role: String?
    var upgradeModel: CrewUpgradeModel?
    var onProfile: () -> Void
    /// Invites stay with the runner: only they see Invite crew.
    var onInvite: (() -> Void)? = nil
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Back to Profile, at the top where a pushed page's back control sits.
                Button(action: onProfile) {
                    Label("Profile", systemImage: "chevron.left")
                }
                .buttonStyle(.crewPill)
                .accessibilityLabel("Back to Profile")
                .accessibilityIdentifier("crewcue.room-members.back")
                ProductTitle(title: "Room members", subtitle: "Your crew for this race. Change your own name in Settings.")
                if model.members.isEmpty == false || (onInvite != nil && model.isRunner) {
                    CrewSettingsGroup(title: "Crew") {
                        // Invite sits on the CREW label's row, not among the members. Allowed
                        // before the race is paid: crew who use it wait for the runner to unlock.
                        if let onInvite, model.isRunner {
                            Button(action: onInvite) {
                                Label(InviteCopy.invitePill, systemImage: "person.badge.plus")
                            }
                            .buttonStyle(.crewPillProminent)
                            .accessibilityLabel(InviteCopy.inviteCrewButton)
                            .accessibilityIdentifier("crewcue.room-members.invite")
                        }
                    } content: {
                        ForEach(model.members) { member in
                            CrewSettingRow(
                                systemImage: "person",
                                title: model.visibleName(member),
                                trailing: {
                                    if model.canRemove(member) {
                                        Button("Remove") {
                                            Task { await model.remove(member) }
                                        }
                                        .buttonStyle(CrewPillButtonStyle(destructive: true))
                                        .disabled(model.working)
                                        .accessibilityLabel("Remove \(model.visibleName(member))")
                                    }
                                }
                            )
                        }
                    }
                }
                if let upgradeModel {
                    CrewUpgradeCard(model: upgradeModel)
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.body)
                }
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.room-members", label: "Room members")
        .accessibilityAction(.escape, onProfile)
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId)
        }
        .task(id: "\(activationID)|\(role ?? "")") {
            await upgradeModel?.activate(roomId: roomId, role: role)
        }
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")"
    }
}
