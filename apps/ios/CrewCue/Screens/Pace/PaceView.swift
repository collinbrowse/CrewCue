import SwiftUI
import UniformTypeIdentifiers

import CrewCueClientCore

private let paceToolFocuses: Set<String> = ["check-in", "gpx-import", "crew-sheet-export", "course-settings", "outbox-status"]

struct PaceView: View {
    @Bindable var model: PaceModel
    var userId: String?
    var roomId: String?
    var role: String?
    var focus: String = "schedule-sheet"
    var runner: RunnerProgress = .none
    @State private var showsTools = false
    @State private var toolFocus = "gpx-import"
    @Environment(\.crew) private var theme

    var body: some View {
        let rows = model.timeline(runner: runner)
        let readout = model.readout(runner: runner)
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                PaceProgressHeader(raceName: model.raceName, readout: readout)
                PaceEstimateSection(model: model)
                if model.canEditStops || model.stopsMessage.isEmpty == false {
                    PaceStopEditBar(model: model, runner: runner)
                }
                PaceTimeline(
                    rows: rows,
                    stops: model.displayStops,
                    message: model.scheduleMessage,
                    draft: model.stopDraft,
                    onStopMinutes: model.setStopMinutes,
                    onStepStop: model.stepStop,
                    onCheckIn: openCheckIn,
                    onImport: { openTools("gpx-import") }
                )
            }
            .padding(.horizontal, CrewSpace.gutter)
            .padding(.top, CrewSpace.gutter)
            .padding(.bottom, 96)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.hidden)
        .overlay(alignment: .bottomTrailing) {
            Button {
                openTools("gpx-import")
            } label: {
                Image(systemName: "calendar.badge.clock")
                    .font(CrewFont.headline)
                    .foregroundStyle(theme.onPrimary)
                    .frame(width: 60, height: 60)
                    .background(theme.primary, in: Circle())
                    .shadow(color: theme.primary.opacity(0.35), radius: 14, y: 6)
            }
            .buttonStyle(.plain)
            .padding(.trailing, CrewSpace.gutter)
            .padding(.bottom, CrewSpace.gutter)
            .accessibilityLabel("Race tools")
        }
        .sheet(isPresented: $showsTools) {
            PaceToolsSheet(model: model, focus: toolFocus)
        }
        .task(id: activationID) {
            if focus == "check-in", let first = model.stops.first {
                model.openCheckIn(checkpointId: first.checkpointId)
            }
            await model.activate(userId: userId, roomId: roomId, role: role)
            if focus == "check-in", let first = model.stops.first {
                model.openCheckIn(checkpointId: first.checkpointId)
            }
            if paceToolFocuses.contains(focus) {
                openTools(focus)
            }
            if focus == "pace-stop-edit" {
                model.beginStopEdit(runner: runner)
            }
        }
    }

    private func openCheckIn(_ checkpointId: String) {
        model.openCheckIn(checkpointId: checkpointId)
        openTools("check-in")
    }

    private func openTools(_ section: String) {
        toolFocus = section
        showsTools = true
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(role ?? "")|\(focus)"
    }
}

/// Race name, total distance, and the course progress bar.
struct PaceProgressHeader: View {
    let raceName: String
    let readout: RaceDayReadout
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            HStack(alignment: .bottom, spacing: CrewSpace.stackSm) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Course progress")
                        .crewKicker()
                        .foregroundStyle(theme.primary)
                    Text(verbatim: raceName.isEmpty ? "Your race" : raceName)
                        .font(CrewFont.display)
                        .foregroundStyle(theme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(verbatim: readout.totalMilesLabel)
                        .font(CrewFont.metricLarge)
                        .foregroundStyle(theme.primary)
                    Text("Total miles")
                        .crewKicker()
                        .foregroundStyle(theme.body)
                }
            }
            CrewProgressBar(fraction: readout.progressFraction)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Checkpoint list: completed stops muted, the current stop expanded, later stops compact.
struct PaceTimeline: View {
    let rows: [CheckpointTimelineRow]
    let stops: [PaceStop]
    let message: String
    var draft: StopPlanDraft? = nil
    var onStopMinutes: (String, String) -> Void = { _, _ in }
    var onStepStop: (String, Int) -> Void = { _, _ in }
    let onCheckIn: (String) -> Void
    let onImport: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if rows.isEmpty {
                VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                    Text("No aid stations yet")
                        .font(CrewFont.title)
                    Text(verbatim: message.isEmpty ? "Import a GPX course to build the schedule." : message)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                    Button("Import a course", action: onImport)
                        .buttonStyle(.crewPrimary)
                }
                .crewGlassCard()
            } else {
                if message.isEmpty == false {
                    Text(verbatim: message)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                }
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                        PaceCheckpointCard(row: row, stop: stops.first { $0.checkpointId == row.checkpointId }) {
                            onCheckIn(row.checkpointId)
                        }
                        if let draftRow = draft?.row(row.checkpointId), draftRow.editable {
                            PaceStopEditor(
                                row: draftRow,
                                onMinutes: { onStopMinutes($0, row.checkpointId) },
                                onStep: { onStepStop(row.checkpointId, $0) }
                            )
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.schedule-sheet")
        .accessibilityLabel("Schedule")
    }
}

struct PaceCheckpointCard: View {
    let row: CheckpointTimelineRow
    let stop: PaceStop?
    let onCheckIn: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        Group {
            if row.state == .current {
                current
            } else {
                compact
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(stop?.line ?? row.title)
    }

    private var compact: some View {
        HStack(alignment: .center, spacing: CrewSpace.stackSm) {
            marker
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: row.kicker)
                    .font(CrewFont.kicker)
                    .tracking(0.6)
                    .foregroundStyle(row.isFinish ? theme.primary : theme.body)
                Text(verbatim: row.title)
                    .font(CrewFont.title)
                    .tracking(0.8)
                    .foregroundStyle(row.state == .done ? theme.body : theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: CrewClock.short(row.clockArrivalAt) ?? "—")
                    .font(CrewFont.metric)
                    .foregroundStyle(row.isFinish ? theme.primary : (row.state == .done ? theme.body : theme.ink))
                Text(verbatim: caption)
                    .font(CrewFont.kicker)
                    .tracking(0.6)
                    .foregroundStyle(theme.body)
            }
        }
        .padding(.horizontal, CrewSpace.margin - 4)
        .padding(.vertical, CrewSpace.gutter + 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            let shape = RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous)
            if row.isFinish {
                shape.fill(theme.well)
            } else {
                Color.clear.crewGlass(in: shape)
            }
        }
        .opacity(row.state == .done ? 0.75 : 1)
    }

    private var current: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            HStack(alignment: .top, spacing: CrewSpace.stackSm) {
                marker
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: row.kicker)
                        .font(CrewFont.kicker)
                        .tracking(0.6)
                        .foregroundStyle(theme.primary)
                    Text(verbatim: row.title)
                        .font(CrewFont.headline)
                        .tracking(0.8)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                StatusChip(text: "IN PROGRESS", style: .filled)
            }
            Divider().overlay(theme.divider)
            HStack(alignment: .top, spacing: 0) {
                MetricColumn(
                    label: "Est. arrival",
                    value: CrewClock.short(row.clockArrivalAt) ?? "—",
                    alignment: .leading,
                    valueColor: theme.primary
                )
                MetricColumn(
                    label: "Cutoff",
                    value: CrewClock.short(row.cutoffAt) ?? "—",
                    valueColor: cutoffColor
                )
                MetricColumn(label: "Dist. to", value: row.distanceToLabel, alignment: .trailing)
            }
            if let stop {
                Text("\(stop.arrival) · \(stop.elapsed) elapsed · \(stop.stopLabel.lowercased())")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
            }
            Button("Check in", action: onCheckIn)
                .buttonStyle(.crewSecondary)
        }
        .padding(CrewSpace.margin)
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous)
                .stroke(theme.primary.opacity(0.45), lineWidth: 1.5)
        }
        .shadow(color: theme.shadow, radius: 16, y: 6)
    }

    @ViewBuilder
    private var marker: some View {
        if row.isFinish {
            Image(systemName: "flag.checkered")
                .font(.system(.title3, weight: .bold))
                .foregroundStyle(theme.primary)
                .frame(width: 28)
        } else if row.state == .done {
            Image(systemName: "checkmark.circle")
                .font(.system(.title3, weight: .semibold))
                .foregroundStyle(theme.primary.opacity(0.7))
                .frame(width: 28)
        } else {
            Circle()
                .fill(row.state == .current ? theme.primary : Color.clear)
                .stroke(theme.primary.opacity(0.6), lineWidth: 2)
                .frame(width: 12, height: 12)
                .frame(width: 28)
        }
    }

    private var caption: String {
        if row.isFinish { return "TARGET" }
        if row.state == .done { return stop.map { "\($0.arrival) · \($0.elapsed)" } ?? "PLANNED" }
        if let stop, stop.stopLabel != "NO STOP" { return "PROJECTED · \(stop.stopLabel)" }
        return "PROJECTED"
    }

    private var cutoffColor: Color {
        switch row.cutoffStatus {
        case "warn", "breach": theme.danger
        default: theme.ink
        }
    }
}

/// #250 Pace edit: enter/leave planned-stop editing and save the draft.
struct PaceStopEditBar: View {
    @Bindable var model: PaceModel
    let runner: RunnerProgress
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if model.isEditingStops {
                Text("Planned stops")
                    .crewKicker()
                    .foregroundStyle(theme.primary)
                Text("Minutes at each aid. Later arrivals move with your changes; nothing is saved until you tap Save.")
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                HStack(spacing: CrewSpace.stackSm) {
                    Button("Cancel") { model.cancelStopEdit() }
                        .buttonStyle(.crewGhost)
                        .disabled(model.stopsBusy)
                        .accessibilityIdentifier("crewcue.pace.cancel-stops")
                    Button("Save stops") {
                        Task { await model.saveStopEdit() }
                    }
                    .buttonStyle(.crewPrimary)
                    .crewBusy(model.stopsBusy)
                    .disabled(model.stopDraft?.canSave != true)
                    .accessibilityIdentifier("crewcue.pace.save-stops")
                }
            } else if model.canEditStops {
                Button("Edit planned stops") { model.beginStopEdit(runner: runner) }
                    .buttonStyle(.crewSecondary)
                    .accessibilityIdentifier("crewcue.pace.edit-stops")
            }
            if model.stopsMessage.isEmpty == false {
                Text(verbatim: model.stopsMessage)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                    .accessibilityIdentifier("crewcue.pace.stops-message")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.pace-stop-edit")
        .accessibilityLabel("Planned stops")
    }
}

/// Minutes field with − / + for one checkpoint's planned stop.
struct PaceStopEditor: View {
    let row: StopPlanDraft.Row
    let onMinutes: (String) -> Void
    let onStep: (Int) -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: CrewSpace.stackSm) {
                Text("Stop at \(row.title.capitalized)")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                Button {
                    onStep(-1)
                } label: {
                    Image(systemName: "minus")
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.crewGhost)
                .accessibilityLabel("One minute less at \(row.title.capitalized)")
                TextField("0", text: Binding(get: { row.minutesText }, set: onMinutes))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .textFieldStyle(.crew)
                    .frame(width: 64)
                    .accessibilityLabel("Planned stop minutes at \(row.title.capitalized)")
                    .accessibilityIdentifier("crewcue.pace.stop-minutes.\(row.checkpointId)")
                Text("min")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                Button {
                    onStep(1)
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.crewGhost)
                .accessibilityLabel("One minute more at \(row.title.capitalized)")
            }
            if let error = row.error {
                Text(verbatim: error)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.danger)
            } else if row.isChanged {
                Text("Was \(StopPlanDraft.stopLabel(seconds: Double(row.savedSeconds)).lowercased())")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
            }
        }
        .padding(.horizontal, CrewSpace.margin - 4)
        .padding(.vertical, CrewSpace.stackSm)
        .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
    }
}

/// Secondary race tools behind the Pace FAB.
struct PaceToolsSheet: View {
    @Bindable var model: PaceModel
    var focus: String

    var body: some View {
        ToolSheet(title: "Race tools") {
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                    if model.checkInOpen || focus == "check-in" {
                        PaceCheckInSection(model: model)
                            .id("check-in")
                    }
                    PaceGpxSection(model: model)
                        .id("gpx-import")
                    PaceExportSection(text: model.exportText, message: model.exportMessage)
                        .id("crew-sheet-export")
                    PaceCourseSection(model: model)
                        .id("course-settings")
                    PaceOutboxSection(rows: model.outboxRows, message: model.outboxMessage)
                        .id("outbox-status")
                }
                .onAppear { proxy.scrollTo(focus, anchor: .top) }
            }
        }
    }
}

struct PaceSheetLine: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(CrewFont.bodyLarge)
    }
}

struct PaceEstimateSection: View {
    @Bindable var model: PaceModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            HStack(spacing: CrewSpace.stackSm) {
                IconDisc(systemImage: model.showColdStart ? "snowflake" : "chart.line.uptrend.xyaxis")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pace estimate")
                        .crewKicker()
                        .foregroundStyle(theme.primary)
                    PaceEstimateMessage(message: model.estimateMessage, coldStart: model.showColdStart)
                }
            }
            if model.canRecalculate || model.canSeedColdStart {
                HStack(spacing: CrewSpace.base) {
                    if model.canSeedColdStart {
                        PaceSeedButton(isBusy: model.estimateBusy, action: model.seedColdStart)
                    }
                    if model.canRecalculate {
                        PaceRecalculateButton(isBusy: model.estimateBusy, action: model.recalculate)
                    }
                }
                .controlSize(.small)
            }
        }
        .crewGlassCard(padding: CrewSpace.gutter + 4)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.pace-estimate")
        .accessibilityLabel("Pace estimate")
    }
}

struct PaceEstimateMessage: View {
    let message: String
    let coldStart: Bool

    var body: some View {
        Text(verbatim: message)
            .font(CrewFont.body)
            .accessibilityLabel(coldStart ? "Cold start" : "Pace estimate")
            .modifier(PaceColdStartIdentifier(enabled: coldStart))
    }
}

struct PaceColdStartIdentifier: ViewModifier {
    let enabled: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.accessibilityIdentifier("crewcue.cold-start")
        } else {
            content
        }
    }
}

struct PaceRecalculateButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Recalculate") {
            Task { await action() }
        }
        .buttonStyle(.crewPrimary)
        .crewBusy(isBusy)
    }
}

struct PaceSeedButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Starting estimate") {
            Task { await action() }
        }
        .buttonStyle(.crewSecondary)
        .crewBusy(isBusy)
    }
}

struct PaceCheckInSection: View {
    @Bindable var model: PaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Check in")
                .font(CrewFont.title)
            TextField("Arrival", text: $model.arrivalAt)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Arrival")
            TextField("Departure", text: $model.departureAt)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Departure")
            TextField("Checkpoint", text: $model.checkpointId)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Checkpoint")
            if model.checkInMessage.isEmpty == false {
                Text(verbatim: model.checkInMessage)
                    .font(CrewFont.bodyLarge)
            }
            PaceCheckInButton(isBusy: model.checkInBusy, action: model.submitCheckIn)
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.check-in")
        .accessibilityLabel("Check in")
    }
}

struct PaceCheckInButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Check in") {
            Task { await action() }
        }
        .buttonStyle(.crewPrimary)
        .crewBusy(isBusy)
    }
}

struct PaceGpxSection: View {
    @Bindable var model: PaceModel
    @State private var importing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GPX import")
                .font(CrewFont.title)
            Text(verbatim: model.gpxMessage)
                .font(CrewFont.bodyLarge)
            TextField("GPX", text: $model.gpxText, axis: .vertical)
                .font(CrewFont.bodyLarge)
                .lineLimit(3...8)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("GPX text")
            PaceChooseGpxButton(isBusy: model.gpxBusy) {
                importing = true
            }
            PaceImportGpxButton(isBusy: model.gpxBusy) {
                await model.importGpx(fileName: "course.gpx", xml: model.gpxText)
            }
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.gpx-import")
        .accessibilityLabel("GPX import")
        .fileImporter(isPresented: $importing, allowedContentTypes: gpxTypes, allowsMultipleSelection: false) { result in
            Task { await importFile(result) }
        }
    }

    private var gpxTypes: [UTType] {
        var types: [UTType] = [.xml, .plainText]
        if let gpx = UTType(filenameExtension: "gpx") {
            types.insert(gpx, at: 0)
        }
        return types
    }

    private func importFile(_ result: Result<[URL], Error>) async {
        do {
            guard let url = try result.get().first else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer {
                if accessed {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let data = try Data(contentsOf: url)
            let xml = String(decoding: data, as: UTF8.self)
            await model.importGpx(fileName: url.lastPathComponent, xml: xml)
        } catch {
            if isCancellation(error) {
                return
            }
            model.noteGpxReadFailure()
        }
    }

    private func isCancellation(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError
    }
}

struct PaceChooseGpxButton: View {
    let isBusy: Bool
    let action: () -> Void

    var body: some View {
        Button("Choose GPX file", action: action)
            .buttonStyle(.crewSecondary)
            .crewBusy(isBusy)
    }
}

struct PaceImportGpxButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Import GPX") {
            Task { await action() }
        }
        .buttonStyle(.crewPrimary)
        .crewBusy(isBusy)
    }
}

struct PaceExportSection: View {
    let text: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Crew sheet")
                .font(CrewFont.title)
            if text.isEmpty == false {
                Text(verbatim: text)
                    .font(.system(.footnote, design: .monospaced))
                    .padding(CrewSpace.stackSm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous))
                ShareLink(item: text) {
                    Label("Share crew sheet", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.crewPrimary)
            }
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(CrewFont.bodyLarge)
            }
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.crew-sheet-export")
        .accessibilityLabel("Crew sheet")
    }
}

struct PaceCourseSection: View {
    @Bindable var model: PaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Course settings")
                .font(CrewFont.title)
            if model.cutoffLines.isEmpty == false {
                Text("Cutoff")
                    .crewKicker()
                ForEach(model.cutoffLines) { line in
                    PaceSheetLine(text: line.text)
                }
            }
            if model.stoppageLines.isEmpty == false {
                Text("Stoppage")
                    .crewKicker()
                ForEach(model.stoppageLines) { line in
                    PaceSheetLine(text: line.text)
                }
            }
            TextField("Cutoff", text: $model.cutoffNote)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .accessibilityLabel("Cutoff")
            TextField("Stoppage seconds", text: $model.stoppageText)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .keyboardType(.decimalPad)
                .accessibilityLabel("Stoppage")
            if model.courseMessage.isEmpty == false {
                Text(verbatim: model.courseMessage)
                    .font(CrewFont.bodyLarge)
            }
            PaceSaveCourseButton(action: model.saveCourseDraft)
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.course-settings")
        .accessibilityLabel("Course settings")
    }
}

struct PaceSaveCourseButton: View {
    let action: () -> Void

    var body: some View {
        Button("Save", action: action)
            .buttonStyle(.crewPrimary)
    }
}

struct PaceOutboxSection: View {
    let rows: [PaceLine]
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Outbox")
                .font(CrewFont.title)
            ForEach(rows) { row in
                PaceSheetLine(text: row.text)
            }
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(CrewFont.bodyLarge)
            }
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.outbox")
        .accessibilityLabel("Outbox")
    }
}
