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
            ImportedRunsSheet(model: model)
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
/// Swipe a run and confirm to remove it, so it stops shaping the pace estimate.
struct ImportedRunsSheet: View {
    @Bindable var model: ActivityImportModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crew) private var theme

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(sorted, id: \.id) { item in
                        ImportedRunRow(item: item)
                            .opacity(model.removingId == item.id ? 0.4 : 1)
                            .listRowBackground(theme.card)
                            .accessibilityIdentifier("crewcue.activity-import.run")
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                // No destructive role: that animates the row away before the confirm.
                                Button(ActivityHistoryDelete.actionTitle, systemImage: "trash") {
                                    model.pendingRemoval = item
                                }
                                .tint(.red)
                                .accessibilityIdentifier("crewcue.activity-import.remove")
                            }
                    }
                } header: {
                    Text(verbatim: headerLine)
                        .font(CrewFont.hint)
                        .foregroundStyle(theme.outline)
                        .textCase(nil)
                } footer: {
                    removalStatus
                }
            }
            .scrollContentBackground(.hidden)
            .background(CrewBackground())
            .navigationTitle("Imported runs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                        .accessibilityIdentifier("crewcue.activity-import.done")
                }
            }
        }
        .crewTheme()
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(CrewRadius.sheet)
        .accessibilityIdentifier("crewcue.activity-import.list")
        .alert(
            ActivityHistoryDelete.confirmTitle,
            isPresented: confirmShown,
            presenting: model.pendingRemoval
        ) { item in
            Button(ActivityHistoryDelete.confirmButton, role: .destructive) {
                Task { await model.remove(item) }
            }
            .accessibilityIdentifier("crewcue.activity-import.remove-confirm")
            Button(ActivityHistoryDelete.cancelButton, role: .cancel) {
                model.pendingRemoval = nil
            }
        } message: { _ in
            Text(verbatim: ActivityHistoryDelete.confirmBody)
        }
        .onDisappear { model.dismissRemovalStatus() }
    }

    @ViewBuilder private var removalStatus: some View {
        if let message = model.removalMessage {
            VStack(alignment: .leading, spacing: CrewSpace.base) {
                Text(verbatim: message)
                    .font(CrewFont.hint)
                    .foregroundStyle(theme.ink)
                    .accessibilityIdentifier("crewcue.activity-import.removal-status")
                if model.offersRecalculate {
                    Button(ActivityHistoryDelete.recalculateButton) {
                        Task { await model.recalculateAfterRemoval() }
                    }
                    .buttonStyle(.crewPillProminent)
                    .crewBusy(model.recalculating)
                    .accessibilityIdentifier("crewcue.activity-import.recalculate")
                }
            }
            .padding(.top, CrewSpace.base)
        }
    }

    private var headerLine: String {
        let count = ActivityImport.countLabel(model.items.count)
        return model.items.isEmpty ? count : count + ". Each one shapes your pace estimate."
    }

    private var confirmShown: Binding<Bool> {
        Binding(get: { model.pendingRemoval != nil }, set: { if !$0 { model.pendingRemoval = nil } })
    }

    private var sorted: [ActivityHistoryItem] {
        model.items.sorted { $0.recordedAt > $1.recordedAt }
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
