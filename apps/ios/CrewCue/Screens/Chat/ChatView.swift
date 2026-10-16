import SwiftUI
import CrewCueClientCore

struct ChatTabPage: View {
    var model: ShellModel

    var body: some View {
        ChatView(
            model: model.chatModel,
            userId: model.signedInUserId,
            roomId: model.signedInRoomId,
            role: model.signedInRole,
            displayName: model.signedInDisplayName,
            raceName: model.roster.races.first { $0.id == model.signedInRoomId }?.name ?? "",
            status: ChatRaceStatus(map: model.mapModel)
        )
    }
}

/// Live race line pinned above the transcript: mile, track status, and next aid ETA.
struct ChatRaceStatus {
    var mileLabel: String
    var statusLabel: String
    var behind: Bool
    var nextAidTitle: String?
    var nextAidClock: String?

    @MainActor
    init(map: MapModel) {
        mileLabel = map.readout.currentMileLabel
        statusLabel = map.readout.statusLabel
        behind = map.readout.status == .behind
        let next = map.aidLiveNextIndex.flatMap { index in
            map.aidPages.indices.contains(index) ? map.aidPages[index] : nil
        }
        nextAidTitle = next?.title.capitalized
        nextAidClock = next.flatMap { CrewClock.short($0.arrivalAt) ?? $0.clockLabel }
    }
}

struct ChatView: View {
    @Bindable var model: ChatModel
    var userId: String?
    var roomId: String?
    var role: String?
    var displayName: String?
    var raceName: String
    var status: ChatRaceStatus

    var body: some View {
        VStack(spacing: 0) {
            ChatStatusHeader(status: status, raceName: raceName)
            ScrollViewReader { proxy in
                ScrollView {
                    ChatTranscript(lines: model.lines)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, CrewSpace.gutter)
                        .padding(.vertical, CrewSpace.gutter)
                }
                .scrollIndicators(.hidden)
                .defaultScrollAnchor(.bottom)
                .onChange(of: model.lines.last?.id) { _, last in
                    guard let last else { return }
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
            ChatStatusText(message: model.statusMessage)
                .padding(.horizontal, CrewSpace.margin)
            ChatComposer(draft: $model.draft, names: model.mentionNames, isSending: model.isSending, onSend: model.send)
                .padding(.horizontal, CrewSpace.gutter)
                .padding(.bottom, CrewSpace.base)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier("crewcue.chat")
        .accessibilityLabel("Chat")
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, role: role, displayName: displayName)
        }
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(role ?? "")|\(displayName ?? "")"
    }
}

struct ChatStatusHeader: View {
    let status: ChatRaceStatus
    let raceName: String
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            HStack(spacing: 8) {
                Circle().fill(theme.primary).frame(width: 8, height: 8)
                Text(verbatim: "Live runner tracking: mile \(status.mileLabel)")
                    .crewKicker()
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                if status.statusLabel.isEmpty == false {
                    StatusChip(text: status.statusLabel, style: status.behind ? .filled : .soft)
                }
            }
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Next aid station ETA")
                        .font(CrewFont.label)
                        .foregroundStyle(theme.body)
                    if let title = status.nextAidTitle {
                        Text(verbatim: title)
                            .font(CrewFont.body)
                            .foregroundStyle(theme.ink)
                    }
                }
                Spacer()
                Text(verbatim: status.nextAidClock ?? "—")
                    .font(CrewFont.metricLarge)
                    .foregroundStyle(theme.primary)
            }
            .padding(.horizontal, CrewSpace.margin)
            .padding(.vertical, CrewSpace.stackSm)
            .crewGlass(in: Capsule())
            ChatRaceLabel(raceName: raceName)
        }
        .padding(.horizontal, CrewSpace.gutter)
        .padding(.vertical, CrewSpace.stackSm)
        .accessibilityElement(children: .combine)
    }
}

/// Names the race this chat belongs to. The Stream channel id never reaches the screen.
struct ChatRaceLabel: View {
    let raceName: String

    var body: some View {
        let name = raceName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty == false {
            Text(verbatim: name)
                .font(CrewFont.kicker)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityLabel("Race: \(name)")
        }
    }
}

struct ChatTranscript: View {
    let lines: [ChatLine]
    @Environment(\.crew) private var theme

    var body: some View {
        LazyVStack(alignment: .leading, spacing: CrewSpace.gutter + 4) {
            ForEach(lines) { line in
                ChatBubble(line: line)
                    .id(line.id)
            }
        }
    }
}

struct ChatBubble: View {
    let line: ChatLine
    @Environment(\.crew) private var theme

    var body: some View {
        HStack(alignment: .bottom) {
            if line.mine { Spacer(minLength: 56) }
            VStack(alignment: line.mine ? .trailing : .leading, spacing: 6) {
                HStack(spacing: 8) {
                    if line.mine, line.time.isEmpty == false { time }
                    if line.author.isEmpty == false {
                        Text(verbatim: line.author)
                            .crewKicker()
                            .foregroundStyle(line.mine ? theme.primary : theme.body)
                    }
                    if line.mine == false, line.time.isEmpty == false { time }
                }
                VStack(alignment: .leading, spacing: 8) {
                    if line.text.isEmpty == false {
                        Text(verbatim: line.text)
                            .font(CrewFont.bodyLarge)
                            .foregroundStyle(line.mine ? theme.onPrimary : theme.ink)
                    }
                    if let imageURL = line.imageURL, let url = URL(string: imageURL) {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFit()
                        } placeholder: {
                            Color.clear.frame(height: 120)
                        }
                        .frame(maxWidth: 220, maxHeight: 180)
                        .clipShape(RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous))
                    }
                    if line.reactions.isEmpty == false {
                        Text(verbatim: line.reactions)
                            .font(CrewFont.body)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .background {
                    let shape = UnevenRoundedRectangle(
                        topLeadingRadius: line.mine ? CrewRadius.lg : 6,
                        bottomLeadingRadius: CrewRadius.lg,
                        bottomTrailingRadius: CrewRadius.lg,
                        topTrailingRadius: line.mine ? 6 : CrewRadius.lg,
                        style: .continuous
                    )
                    if line.mine {
                        shape.fill(theme.primary)
                            .shadow(color: theme.primary.opacity(0.25), radius: 10, y: 4)
                    } else {
                        Color.clear.crewGlass(in: shape)
                    }
                }
            }
            if line.mine == false { Spacer(minLength: 56) }
        }
        .accessibilityElement(children: .combine)
    }

    private var time: some View {
        Text(verbatim: line.time)
            .font(CrewFont.kicker)
            .foregroundStyle(theme.body)
    }
}

struct ChatStatusText: View {
    let message: String

    var body: some View {
        if message.isEmpty == false {
            Text(verbatim: message)
                .font(CrewFont.body)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
        }
    }
}

struct ChatComposer: View {
    @Binding var draft: String
    let names: [String]
    let isSending: Bool
    let onSend: () async -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if names.isEmpty == false {
                Text(verbatim: names.joined(separator: ", "))
                    .font(CrewFont.label)
                    .foregroundStyle(theme.primary)
                    .padding(.horizontal, CrewSpace.margin)
                    .accessibilityLabel("Mentions")
            }
            HStack(spacing: CrewSpace.base) {
                TextField("Send update to crew…", text: $draft, axis: .vertical)
                    .font(CrewFont.bodyLarge)
                    .lineLimit(1...4)
                    .padding(.leading, 20)
                    .padding(.vertical, 12)
                    .accessibilityLabel("Message")
                Button {
                    Task { await onSend() }
                } label: {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(theme.onPrimary)
                        .frame(width: 48, height: 48)
                        .background(theme.primary, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(cannotSend)
                .opacity(cannotSend ? 0.45 : 1)
                .accessibilityLabel("Send")
            }
            .padding(6)
            .crewGlass(in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        }
    }

    private var cannotSend: Bool {
        isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
