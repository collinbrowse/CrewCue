import SwiftUI
import CrewCueClientCore

/// The runner's setup checklist on Map, under the top bar (clients/behavior/onboarding-runner-tour.md).
/// Which items are done and which is next is client-core's `SetupChecklistPolicy`.
struct SetupChecklistCardConfig {
    var checklist: SetupChecklist
    var expanded: Binding<Bool>
    var onItem: (SetupChecklistItemKind) -> Void
    var onHide: () -> Void
}

struct SetupChecklistCard: View {
    var config: SetupChecklistCardConfig
    /// The most height the open list may take before it scrolls (the map between its top bar and
    /// its sheet), so a short display (iPhone Duo's inner display on its side) keeps the bar.
    var maxListHeight: CGFloat = .infinity
    @State private var listHeight: CGFloat = 0
    @Environment(\.crew) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.base) {
            header
            if config.expanded.wrappedValue {
                ScrollView {
                    VStack(alignment: .leading, spacing: CrewSpace.base) {
                        ForEach(config.checklist.items) { item in
                            row(item)
                        }
                    }
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { listHeight = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: min(listHeight, max(120, maxListHeight)))
                Button(SetupChecklist.hide, action: config.onHide)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.primary)
                    .accessibilityIdentifier("crewcue.setup-checklist.hide")
            } else if let next = config.checklist.next {
                row(SetupChecklistItem(kind: next, done: false))
            }
        }
        .padding(CrewSpace.stackSm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: config.expanded.wrappedValue)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.setup-checklist")
    }

    private var header: some View {
        Button {
            config.expanded.wrappedValue.toggle()
        } label: {
            HStack(spacing: CrewSpace.base) {
                Text(SetupChecklist.title)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.ink)
                Text(config.checklist.summary)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                Spacer(minLength: 0)
                Text(config.expanded.wrappedValue ? SetupChecklist.showLess : SetupChecklist.show)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.primary)
                Image(systemName: config.expanded.wrappedValue ? "chevron.up" : "chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(theme.primary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(SetupChecklist.title), \(config.checklist.summary)")
        .accessibilityHint(config.expanded.wrappedValue ? SetupChecklist.showLess : SetupChecklist.show)
        .accessibilityIdentifier("crewcue.setup-checklist.toggle")
    }

    private func row(_ item: SetupChecklistItem) -> some View {
        Button {
            config.onItem(item.kind)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: CrewSpace.base) {
                Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(item.done ? theme.primary : theme.body)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.kind.title)
                        .font(CrewFont.button)
                        .foregroundStyle(theme.ink)
                        .strikethrough(item.done, color: theme.body)
                    if !item.done {
                        Text(item.kind.detail)
                            .font(CrewFont.body)
                            .foregroundStyle(theme.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                if !item.done {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(theme.body)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.done)
        .accessibilityLabel(item.kind.title)
        .accessibilityValue(item.done ? "Done" : item.kind.detail)
        .accessibilityIdentifier(item.kind.accessibilityIdentifier)
    }
}
