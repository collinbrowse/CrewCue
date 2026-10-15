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
    var progressMeters: Double = 0
    @State private var showsTools = false
    @State private var toolFocus = "gpx-import"
    @Environment(\.crew) private var theme

    var body: some View {
        let rows = model.timeline(progressMeters: progressMeters)
        let readout = model.readout(progressMeters: progressMeters)
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                PaceProgressHeader(raceName: model.raceName, readout: readout)
                PaceEstimateSection(model: model)
                PaceTimeline(
                    rows: rows,
                    stops: model.stops,
                    message: model.scheduleMessage,
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
                    PaceCheckpointCard(row: row, stop: stops.first { $0.checkpointId == row.checkpointId }) {
                        onCheckIn(row.checkpointId)
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
                Text("\(stop.arrival) · \(stop.elapsed) elapsed")
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
        return "PROJECTED"
    }

    private var cutoffColor: Color {
        switch row.cutoffStatus {
        case "warn", "breach": theme.danger
        default: theme.ink
        }
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
        .disabled(isBusy)
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
        .disabled(isBusy)
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
        .disabled(isBusy)
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
            .disabled(isBusy)
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
        .disabled(isBusy)
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
