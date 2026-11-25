import SwiftUI
import UIKit
import CrewCueClientCore

/// The runner's invite (Profile → Room members → Invite crew, a sheet closed with its X): the join
/// link and the 6-digit code, with the share sheet and Copy code. Regular width puts the code beside the link and actions.
struct InviteShareView: View {
    var model: InviteShareModel
    var roomId: String?
    @Environment(\.crew) private var theme
    @Environment(\.horizontalSizeClass) private var sizeClass
    @ScaledMetric(relativeTo: .largeTitle) private var codeSize: CGFloat = 40

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ProductTitle(title: InviteCopy.shareTitle, subtitle: InviteCopy.shareDetail)
                content
            }
            // The shell page supplies the margins, as on Room members.
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .animation(.snappy, value: sizeClass)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .crewCueScreen(identifier: "crewcue.invite-share", label: InviteCopy.shareTitle)
        .task(id: roomId ?? "") {
            await model.activate(roomId: roomId)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Loading the invite")
        case .ready(let details):
            let layout = sizeClass == .regular
                ? AnyLayout(HStackLayout(alignment: .top, spacing: CrewSpace.gutter))
                : AnyLayout(VStackLayout(alignment: .leading, spacing: 18))
            layout {
                codeCard(details)
                    .frame(maxWidth: .infinity, alignment: .leading)
                actions(details)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .empty, .error, .offline:
            Text(verbatim: model.message)
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
                .crewCard()
                .accessibilityIdentifier("crewcue.invite-share.message")
        }
    }

    private func codeCard(_ details: InviteShareDetails) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(InviteCopy.codeLabel)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
            Text(verbatim: details.code)
                .font(.system(size: codeSize, weight: .bold, design: .monospaced))
                .foregroundStyle(theme.ink)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .textSelection(.enabled)
                .accessibilityLabel("\(InviteCopy.codeLabel) \(details.code.map(String.init).joined(separator: " "))")
                .accessibilityIdentifier("crewcue.invite-share.code")
            Text(verbatim: details.raceName)
                .font(CrewFont.button)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewCard()
    }

    private func actions(_ details: InviteShareDetails) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(InviteCopy.linkLabel)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                Text(verbatim: details.link.absoluteString)
                    .font(CrewFont.button)
                    .foregroundStyle(theme.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.invite-share.link")
            }
            // The share text carries the link and the code, so a crew member without the app (or
            // whose link opens the browser) can still type the code.
            HStack(spacing: CrewSpace.base) {
                ShareLink(item: details.shareText, subject: Text(InviteCopy.shareTitle)) {
                    Label(InviteCopy.shareButton, systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.crewPillProminent)
                .accessibilityIdentifier("crewcue.invite-share.share")
                Button {
                    UIPasteboard.general.string = details.code
                    model.noteCopied()
                } label: {
                    Label(InviteCopy.copyCode, systemImage: "doc.on.doc")
                }
                .buttonStyle(.crewPill)
                .accessibilityIdentifier("crewcue.invite-share.copy")
            }
            Text(verbatim: model.notice.isEmpty ? model.message : model.notice)
                .font(CrewFont.body)
                .foregroundStyle(details.locked ? theme.danger : theme.body)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier(details.locked ? "crewcue.invite-share.locked" : "crewcue.invite-share.status")
        }
    }
}
