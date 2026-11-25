import SwiftUI
import UIKit
import CrewCueClientCore

/// Join a race with its 6-digit code: typed, pasted, or carried in by a join link. A preview says
/// whose race it is before anything is joined. Signed out, Join saves the code and opens sign-up,
/// which joins straight after (`ShellModel.requestAccount(toJoin:)`).
struct JoinCrewView: View {
    /// How the page is left. Opened on its own (Profile, a race-less tab, sign-in) it is a page
    /// over the flow, closed with the X at the top right; inside onboarding it is a step, left
    /// with the same Back as every other step.
    enum Exit {
        case close
        case back
    }

    @Bindable var model: JoinCrewModel
    /// Read from the shell, which observes the session (the join model's own read doesn't redraw).
    var signedIn: Bool
    var onBack: (() -> Void)? = nil
    var exit: Exit = .close
    @Environment(\.crew) private var theme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ScaledMetric(relativeTo: .largeTitle) private var codeSize: CGFloat = 32

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(InviteCopy.joinTitle)
                    .font(CrewFont.display)
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                // Regular width: the code beside the race it opens. Compact: one column.
                let layout = sizeClass == .regular
                    ? AnyLayout(HStackLayout(alignment: .top, spacing: CrewSpace.gutter))
                    : AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
                layout {
                    entry
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if sizeClass == .regular || model.joiningHeadline.isEmpty == false {
                        preview
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                if model.notice.isEmpty == false {
                    Text(verbatim: model.notice)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("crewcue.join-crew.notice")
                }
                if model.waitingForUnlock {
                    // Not an error: the race exists and the code is right, the runner just
                    // hasn't unlocked it yet.
                    Label {
                        Text(verbatim: model.statusMessage)
                            .font(CrewFont.bodyLarge)
                            .foregroundStyle(theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "hourglass")
                            .foregroundStyle(theme.primary)
                            .accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .crewCard()
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("crewcue.join-crew.waiting")
                } else if model.showsStatus {
                    Text(verbatim: model.statusMessage)
                        .font(CrewFont.body)
                        .foregroundStyle(model.raceFull ? theme.danger : theme.body)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier(model.raceFull ? "crewcue.join-crew.race-full" : "crewcue.join-crew.status")
                }
                // The page's one primary action.
                Button(signedIn ? InviteCopy.joinButton : InviteCopy.signUpToJoin, action: model.join)
                    .buttonStyle(.crewPrimary)
                    .disabled(!model.canJoin)
                    .crewBusy(model.joining)
                    .accessibilityIdentifier("crewcue.join-crew.join")
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 28)
            .animation(.snappy, value: sizeClass)
            .animation(.snappy, value: model.joiningHeadline)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .crewCueScreen(identifier: "crewcue.join-crew", label: "Join crew")
        .barClose(identifier: "crewcue.join-crew.close", enabled: !model.joining, action: exit == .close ? leave : nil)
        .barBack(identifier: "crewcue.join-crew.back", enabled: !model.joining, action: exit == .back ? leave : nil)
        .task { await model.refreshClipboard() }
        .onReceive(NotificationCenter.default.publisher(for: UIPasteboard.changedNotification)) { _ in
            Task { await model.refreshClipboard() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Copied in another app: the Paste line shows when the person comes back.
            if phase == .active { Task { await model.refreshClipboard() } }
        }
    }

    private var leave: (() -> Void)? {
        guard let onBack else { return nil }
        return {
            model.dismissNotice()
            onBack()
        }
    }

    private var entry: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(InviteCopy.joinPrompt)
                .font(CrewFont.button)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
            TextField("Invite code", text: $model.code)
                .font(.system(size: codeSize, weight: .bold, design: .monospaced))
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .padding(.vertical, 18)
                .background(theme.card, in: RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(theme.divider, lineWidth: 1)
                }
                .accessibilityLabel("Invite code")
                .onChange(of: model.code) { _, code in
                    if code.count == 6 {
                        model.preview()
                    }
                }
            // The system Paste button reads the clipboard only when tapped, so no paste prompt.
            // Shown only while the clipboard holds digits or a link an invite could be in.
            if model.clipboardMayHaveCode {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    pasteCaption
                    Spacer(minLength: 0)
                    pasteButton
                }
                VStack(alignment: .leading, spacing: 8) {
                    pasteCaption
                    pasteButton
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("crewcue.join-crew.paste")
            }
        }
    }

    private var pasteCaption: some View {
        Text(InviteCopy.pasteLabel)
            .font(CrewFont.bodyLarge)
            .foregroundStyle(theme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var pasteButton: some View {
        PasteButton(payloadType: String.self) { strings in
            let text = strings.first
            Task { @MainActor in model.paste(text) }
        }
        .labelStyle(.titleAndIcon)
        .buttonBorderShape(.capsule)
        .tint(theme.primary)
        .accessibilityLabel(InviteCopy.pasteLabel)
    }

    @ViewBuilder
    private var preview: some View {
        if model.joiningHeadline.isEmpty {
            // Regular width keeps the preview's column while no race is shown yet.
            Text(InviteCopy.previewPlaceholder)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
                .crewCard()
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text(verbatim: model.joiningHeadline)
                    .font(CrewFont.headline)
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verbatim: model.previewText)
                    .font(CrewFont.button)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .crewCard()
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("crewcue.join-crew.preview")
        }
    }
}
