import SwiftUI
import UniformTypeIdentifiers
import CrewCueClientCore

/// Settings → Past runs: import an exported .gpx, .fit or .tcx and list pacing history.
struct SettingsActivityImportSection: View {
    @Bindable var model: ActivityImportModel
    var userId: String?
    @State private var picking = false
    @State private var showsRuns = false
    @Environment(\.crew) private var theme

    /// FIT and TCX have no system type; accept them by extension, falling back to any data file.
    static let contentTypes: [UTType] = {
        var types: [UTType] = [UTType(filenameExtension: "gpx") ?? .xml]
        types += ["fit", "tcx"].compactMap { UTType(filenameExtension: $0) }
        types.append(.data)
        return types
    }()

    var body: some View {
        CrewSettingRow(
            systemImage: "square.and.arrow.down",
            title: "Import your training history",
            hint: hint,
            trailing: {
                Button("Import") {
                    picking = true
                }
                .buttonStyle(.crewPillProminent)
                .crewBusy(model.busy)
                .accessibilityLabel("Import past run")
                .accessibilityHint("Choose a .gpx, .fit or .tcx file")
            },
            below: {
                if model.items.isEmpty == false {
                    Button {
                        showsRuns = true
                    } label: {
                        HStack(spacing: CrewSpace.base) {
                            Text(verbatim: ActivityImport.countLabel(model.items.count))
                                .font(.system(.subheadline, weight: .medium))
                                .foregroundStyle(theme.ink)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.system(.footnote, weight: .bold))
                                .foregroundStyle(theme.outline)
                        }
                        .frame(minHeight: 36)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("crewcue.activity-import.runs")
                    .accessibilityHint("Shows each imported run")
                }
            }
        )
        .sheet(isPresented: $showsRuns) {
            ImportedRunsSheet(items: model.items)
        }
        .accessibilityIdentifier("crewcue.activity-import")
        .accessibilityLabel("Training history")
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.contentTypes) { result in
            Task { await model.picked(result) }
        }
        .task(id: userId ?? "") {
            await model.activate()
        }
    }

    /// Status from the last import when there is one; otherwise what to choose and why.
    private var hint: String {
        if model.message.isEmpty || model.message == ActivityImport.emptyMessage {
            return "Runs from Garmin, COROS, Suunto or any watch app (.gpx, .fit, .tcx). They sharpen your estimate."
        }
        return model.message
    }
}

/// Every run in the pacing history, newest first, with its distance, time and pace.
struct ImportedRunsSheet: View {
    let items: [ActivityHistoryItem]
    @Environment(\.crew) private var theme

    var body: some View {
        ToolSheet(title: "Imported runs") {
            VStack(alignment: .leading, spacing: CrewSpace.base) {
                Text(verbatim: ActivityImport.countLabel(items.count) + ". Each one shapes your pace estimate.")
                    .font(CrewFont.hint)
                    .foregroundStyle(theme.outline)
                    .padding(.horizontal, CrewSpace.base)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { index, item in
                        if index > 0 { CrewRowDivider() }
                        ImportedRunRow(item: item)
                    }
                }
                .padding(.horizontal, CrewSpace.gutter)
                .padding(.vertical, 4)
                .background(theme.card, in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
            }
        }
        .accessibilityIdentifier("crewcue.activity-import.list")
    }

    private var sorted: [ActivityHistoryItem] {
        items.sorted { $0.recordedAt > $1.recordedAt }
    }
}

struct ImportedRunRow: View {
    let item: ActivityHistoryItem
    @Environment(\.crew) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: CrewSpace.stackSm) {
            Image(systemName: "figure.run")
                .font(.system(.body, weight: .medium))
                .foregroundStyle(theme.primary)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                // A named run ("Morning Run") shows its name over the date; others show the date.
                Text(verbatim: item.titleLabel)
                    .font(CrewFont.rowTitle)
                    .foregroundStyle(theme.ink)
                    .lineLimit(2)
                Text(verbatim: [item.subtitleDateLabel, item.sourceLabel].compactMap { $0 }.joined(separator: " · "))
                    .font(CrewFont.hint)
                    .foregroundStyle(theme.outline)
            }
            Spacer(minLength: CrewSpace.base)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: [item.distanceLabel, item.durationLabel].compactMap { $0 }.joined(separator: " · "))
                    .font(.system(.subheadline, weight: .semibold).monospacedDigit())
                    .foregroundStyle(theme.ink)
                if let pace = item.paceLabel {
                    Text(verbatim: pace)
                        .font(CrewFont.hint.monospacedDigit())
                        .foregroundStyle(theme.outline)
                }
            }
            .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }
}
