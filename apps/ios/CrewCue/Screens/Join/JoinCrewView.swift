import SwiftUI
import CrewCueClientCore

/// Join a race with its 6-digit code: typed, pasted, or carried in by a join link. A preview says
/// whose race it is before anything is joined. Signed out, Join saves the code and opens sign-up,
/// which joins straight after (`ShellModel.requestAccount(toJoin:)`).
struct JoinCrewView: View {
    @Bindable var model: JoinCrewModel
    /// Read from the shell, which observes the session (the join model's own read doesn't redraw).
    var signedIn: Bool
    var onBack: (() -> Void)? = nil
    @Environment(\.crew) private var theme
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ScaledMetric(relativeTo: .largeTitle) private var codeSize: CGFloat = 32

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let onBack {
                    Button("Back", action: onBack)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.primary)
                        .accessibilityIdentifier("crewcue.join-crew.back")
                }
                Text("Join your crew")
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
                Text(verbatim: model.statusMessage)
                    .font(CrewFont.body)
                    .foregroundStyle(model.raceFull ? theme.danger : theme.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(model.raceFull ? "crewcue.join-crew.race-full" : "crewcue.join-crew.status")
                Button(signedIn ? "Join" : InviteCopy.signUpToJoin, action: model.join)
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
    }

    private var entry: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Enter the 6-digit code from your crew.")
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
            Text("The race appears here once the code is found.")
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
