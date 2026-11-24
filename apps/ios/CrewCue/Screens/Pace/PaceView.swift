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
    var live: LiveProjection? = nil
    /// The onboarding replay: the progress, the estimate and the timeline only. No race tools,
    /// check-in or stop editing, since the replay never writes.
    var readOnly = false
    @State private var showsTools = false
    @State private var toolFocus = "gpx-import"
    @Environment(\.crew) private var theme

    var body: some View {
        let rows = model.timeline(runner: runner, live: live)
        let readout = model.readout(runner: runner, live: live)
        // Each section, and each timeline row, pads itself, so the ones below a camera column
        // (iPhone Duo's outer display) can run to the display's edge while the ones scrolled
        // beside it keep clear of it.
        OcclusionScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                PaceProgressHeader(raceName: model.raceName, readout: readout)
                    .padding(.horizontal, CrewSpace.gutter)
                    .fullWidthClearOfOcclusions()
                PaceEstimateSection(model: model)
                    .padding(.horizontal, CrewSpace.gutter)
                    .fullWidthClearOfOcclusions()
                if !readOnly, model.canEditStops || model.stopsMessage.isEmpty == false {
                    PaceStopEditBar(model: model)
                        .padding(.horizontal, CrewSpace.gutter)
                        .fullWidthClearOfOcclusions()
                }
                PaceTimeline(
                    rows: rows,
                    liveStale: readout.liveEtaStale,
                    stops: model.displayStops,
                    message: model.scheduleMessage,
                    draft: model.stopDraft,
                    onStopMinutes: model.setStopMinutes,
                    onStepStop: model.stepStop,
                    onCheckIn: openCheckIn,
                    onImport: { openTools("gpx-import") },
                    showsActions: !readOnly
                )
            }
            .padding(.top, CrewSpace.gutter)
            .padding(.bottom, 96)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .scrollIndicators(.hidden)
        .overlay(alignment: .bottomTrailing) {
            if !readOnly {
                // As wide as the page, so below a camera column it keeps to the edge the
                // timeline runs to.
                raceToolsButton
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .fullWidthClearOfOcclusions()
            }
        }
        .sheet(isPresented: $showsTools) {
            PaceToolsSheet(model: model, focus: toolFocus)
        }
        .onChange(of: runner, initial: true) { _, latest in
            model.runnerMoved(latest)
        }
        .task(id: activationID) {
            if focus == "check-in", let first = model.stops.first {
                model.openCheckIn(checkpointId: first.checkpointId)
            }
            await model.activate(userId: userId, roomId: roomId, role: role)
            guard !readOnly else { return }
            if focus == "check-in", let first = model.stops.first {
                model.openCheckIn(checkpointId: first.checkpointId)
            }
            if paceToolFocuses.contains(focus) {
                openTools(focus)
            }
            if focus == "course-locked" {
                openTools("gpx-import")
            }
            if focus == "pace-stop-edit" {
                model.beginStopEdit()
            }
        }
    }

    /// GPX import, check-in, the crew sheet, course settings and the outbox. Not in the replay.
    private var raceToolsButton: some View {
        Button {
            openTools("gpx-import")
        } label: {
            Image(systemName: "wrench.and.screwdriver")
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
            if let finish = CrewClock.short(readout.finishEtaAt) {
                HStack(spacing: CrewSpace.stackSm) {
                    Text("Finish ETA")
                        .crewKicker()
                        .foregroundStyle(theme.body)
                    Text(verbatim: finishText(finish))
                        .font(CrewFont.label)
                        .foregroundStyle(theme.ink)
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("crewcue.live-eta")
                .accessibilityLabel("Finish ETA \(finishText(finish))")
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// "14:20 · 13:10–16:05", plus "old ping" when the server built it from a stale sample.
    private func finishText(_ finish: String) -> String {
        var parts = [finish]
        if let start = CrewClock.short(readout.finishWindowStartAt), let end = CrewClock.short(readout.finishWindowEndAt) {
            parts.append("\(start)–\(end)")
        }
        if readout.liveEtaStale {
            parts.append("old ping")
        }
        return parts.joined(separator: " · ")
    }
}

/// Checkpoint list: completed stops muted, the current stop expanded, later stops compact.
struct PaceTimeline: View {
    let rows: [CheckpointTimelineRow]
    var liveStale = false
    let stops: [PaceStop]
    let message: String
    var draft: StopPlanDraft? = nil
    var onStopMinutes: (String, String) -> Void = { _, _ in }
    var onStepStop: (String, Int) -> Void = { _, _ in }
    let onCheckIn: (String) -> Void
    let onImport: () -> Void
    /// Off in the onboarding replay: no Check in and no Import a course.
    var showsActions = true
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
                    if showsActions {
                        Button("Import a course", action: onImport)
                            .buttonStyle(.crewPrimary)
                    }
                }
                .crewGlassCard()
                .timelineRow()
            } else {
                if message.isEmpty == false {
                    Text(verbatim: message)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                        .timelineRow()
                }
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                        PaceCheckpointCard(
                            row: row,
                            stop: stops.first { $0.checkpointId == row.checkpointId },
                            liveStale: liveStale,
                            onCheckIn: showsActions ? { onCheckIn(row.checkpointId) } : nil
                        )
                        if let draftRow = draft?.row(row.checkpointId), draftRow.editable {
                            PaceStopEditor(
                                row: draftRow,
                                onMinutes: { onStopMinutes($0, row.checkpointId) },
                                onStep: { onStepStop(row.checkpointId, $0) }
                            )
                        }
                    }
                    .timelineRow()
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.schedule-sheet")
        .accessibilityLabel("Schedule")
    }
}

private extension View {
    /// A timeline row decides its own width: scrolled up beside a camera column (iPhone Duo's
    /// outer display) it keeps clear of it, so its ETA stays readable, while the rows below run to
    /// the display's edge.
    func timelineRow() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, CrewSpace.gutter)
            .fullWidthClearOfOcclusions()
    }
}

struct PaceCheckpointCard: View {
    let row: CheckpointTimelineRow
    let stop: PaceStop?
    var liveStale = false
    /// Nil hides Check in (the onboarding replay).
    var onCheckIn: (() -> Void)?
    @Environment(\.crew) private var theme

    var body: some View {
        Group {
            if row.state == .current && !row.locked {
                current
            } else {
                compact
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(stop?.line ?? row.title)
        .accessibilityValue(row.locked ? OnboardingCopy.lockedAidExplanation : liveAccessibility)
    }

    /// Live arrival from the server's projection, when the room has one.
    private var liveClock: String? { CrewClock.short(row.liveArrivalAt) }

    /// "13:10–16:05" when the server sent a window for this stop.
    private var windowText: String? {
        guard let start = CrewClock.short(row.arrivalWindowStartAt), let end = CrewClock.short(row.arrivalWindowEndAt) else {
            return nil
        }
        return "\(start)–\(end)"
    }

    private var liveAccessibility: String {
        guard let liveClock else { return "" }
        var text = "Live arrival \(liveClock)"
        if let windowText { text += ", likely between \(windowText.replacingOccurrences(of: "–", with: " and "))" }
        if liveStale { text += ", based on an old ping" }
        return text
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
            if row.locked {
                Label(OnboardingCopy.lockedAidRow, systemImage: "lock.fill")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                    .accessibilityLabel(OnboardingCopy.lockedAidExplanation)
            } else {
                VStack(alignment: .trailing, spacing: 2) {
                    Text(verbatim: liveClock.map { "ETA \($0)" } ?? CrewClock.short(row.clockArrivalAt) ?? "—")
                        .font(CrewFont.metric)
                        .foregroundStyle(row.isFinish ? theme.primary : (row.state == .done ? theme.body : theme.ink))
                    Text(verbatim: caption)
                        .font(CrewFont.kicker)
                        .tracking(0.6)
                        .foregroundStyle(theme.body)
                }
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
                    label: liveClock == nil ? "Est. arrival" : (liveStale ? "Live ETA (old ping)" : "Live ETA"),
                    value: liveClock ?? CrewClock.short(row.clockArrivalAt) ?? "—",
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
            if liveClock != nil {
                Text(verbatim: caption)
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
                    .accessibilityIdentifier("crewcue.live-eta.current")
            }
            if let stop {
                Text("\(stop.arrival) · \(stop.elapsed) elapsed · \(stop.stopLabel.lowercased())")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
            }
            if let onCheckIn {
                Button("Check in", action: onCheckIn)
                    .buttonStyle(.crewSecondary)
            }
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
        if liveClock != nil {
            let plan = CrewClock.short(row.clockArrivalAt).map { "PLAN \($0)" } ?? "LIVE"
            let parts = [windowText, plan, liveStale ? "OLD PING" : nil].compactMap { $0 }
            return parts.joined(separator: " · ")
        }
        if row.isFinish { return "TARGET" }
        // Every stop shows its local clock and elapsed time; projected stops add the planned stop.
        if let stop {
            let times = "\(stop.arrival) · \(stop.elapsed)"
            return row.state != .done && stop.stopLabel != "NO STOP" ? "\(times) · \(stop.stopLabel)" : times
        }
        return row.state == .done ? "PLANNED" : "PROJECTED"
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
                Button("Edit planned stops") { model.beginStopEdit() }
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
        ToolSheet(title: RaceToolsCopy.sheetTitle) {
            ScrollViewReader { proxy in
                VStack(alignment: .leading, spacing: CrewSpace.margin) {
                    if model.checkInOpen || focus == "check-in" {
                        PaceCheckInSection(model: model)
                            .id("check-in")
                    }
                    CrewSettingsGroup(title: "Course") {
                        PaceGpxSection(model: model)
                        PaceCourseSection(model: model)
                            .id("course-settings")
                    }
                    .id("gpx-import")
                    CrewSettingsGroup(title: "Share") {
                        PaceExportSection(rows: model.crewSheetRows, text: model.exportText, message: model.exportMessage)
                    }
                    .id("crew-sheet-export")
                    CrewSettingsGroup(title: "This phone") {
                        PaceOutboxSection(rows: model.outboxRows, message: model.outboxMessage)
                    }
                    .id("outbox-status")
                }
                .onAppear { proxy.scrollTo(focus, anchor: .top) }
                // The crew sheet loads after the sheet opens and pushes later tools down; keep the focus in view.
                .onChange(of: model.exportText) { proxy.scrollTo(focus, anchor: .top) }
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
        // VoiceOver reads the estimate itself; the card is already labelled "Pace estimate".
        Text(verbatim: message)
            .font(CrewFont.body)
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
    @State private var pasting = false
    @Environment(\.crew) private var theme

    var body: some View {
        CrewSettingRow(
            systemImage: model.courseLocked ? "lock.fill" : "map",
            title: RaceToolsCopy.courseFileTitle,
            hint: model.courseLocked ? nil : model.gpxMessage,
            trailing: {
                if !model.courseLocked {
                    PaceChooseGpxButton(isBusy: model.gpxBusy) {
                        importing = true
                    }
                }
            },
            below: {
                if model.courseLocked {
                    // The race has started: say so instead of offering a file the server would refuse.
                    Text(verbatim: RaceLock.message)
                        .font(CrewFont.hint)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("crewcue.course-locked")
                } else {
                    DisclosureGroup(RaceToolsCopy.pasteGpxLabel, isExpanded: $pasting) {
                        VStack(alignment: .trailing, spacing: CrewSpace.base) {
                            TextField("<gpx>…</gpx>", text: $model.gpxText, axis: .vertical)
                                .font(.system(.footnote, design: .monospaced))
                                .lineLimit(3...6)
                                .padding(CrewSpace.stackSm)
                                .background(theme.well, in: RoundedRectangle(cornerRadius: CrewRadius.md, style: .continuous))
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .accessibilityLabel("GPX text")
                            PaceImportGpxButton(isBusy: model.gpxBusy) {
                                await model.importGpx(fileName: "course.gpx", xml: model.gpxText)
                            }
                        }
                        .padding(.top, CrewSpace.base)
                    }
                    .font(CrewFont.hint)
                    .tint(theme.primary)
                }
            }
        )
        .accessibilityIdentifier("crewcue.gpx-import")
        .accessibilityLabel("Course file")
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
        Button("Choose file", action: action)
            .buttonStyle(.crewPillProminent)
            .crewBusy(isBusy)
            .accessibilityLabel("Choose GPX file")
    }
}

struct PaceImportGpxButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Import") {
            Task { await action() }
        }
        .buttonStyle(.crewPill)
        .crewBusy(isBusy)
        .accessibilityLabel("Import GPX")
    }
}

/// The schedule as a table (stop, due time, race time) with a Share button for the text version.
struct PaceExportSection: View {
    let rows: [CrewSheetRow]
    let text: String
    let message: String
    @Environment(\.crew) private var theme

    var body: some View {
        CrewSettingRow(
            systemImage: "list.bullet.rectangle",
            title: RaceToolsCopy.crewSheetTitle,
            hint: message.isEmpty ? RaceToolsCopy.crewSheetHint : message,
            trailing: {
                if text.isEmpty == false {
                    ShareLink(item: text) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.crewPillProminent)
                    .accessibilityLabel("Share crew sheet")
                }
            },
            below: {
                if rows.isEmpty == false {
                    Grid(alignment: .leading, horizontalSpacing: CrewSpace.stackSm, verticalSpacing: 6) {
                        GridRow {
                            Text("Stop")
                            Text("Due").gridColumnAlignment(.trailing)
                            Text("Race time").gridColumnAlignment(.trailing)
                        }
                        .font(CrewFont.kicker)
                        .foregroundStyle(theme.outline)
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            GridRow {
                                Text(verbatim: row.title)
                                    .font(.system(.subheadline, weight: .medium))
                                    .foregroundStyle(theme.ink)
                                Text(verbatim: row.arrival)
                                    .font(.system(.subheadline).monospacedDigit())
                                    .foregroundStyle(theme.ink)
                                Text(verbatim: row.elapsed)
                                    .font(.system(.subheadline).monospacedDigit())
                                    .foregroundStyle(theme.outline)
                            }
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        )
        .accessibilityIdentifier("crewcue.crew-sheet-export")
        .accessibilityLabel("Crew sheet")
    }
}

/// Aid station stops and cutoffs from the schedule.
struct PaceCourseSection: View {
    @Bindable var model: PaceModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CrewSettingRow(
                systemImage: "clock",
                title: RaceToolsCopy.stopsTitle,
                hint: [model.stopSummary, model.courseMessage].filter { $0.isEmpty == false }.joined(separator: " "),
                trailing: { EmptyView() },
                below: {
                    if model.stoppageLines.isEmpty == false {
                        PaceTwoColumnLines(lines: model.stoppageLines)
                    }
                }
            )
            if model.cutoffLines.isEmpty == false {
                CrewRowDivider()
                CrewSettingRow(
                    systemImage: "flag.checkered",
                    title: RaceToolsCopy.cutoffsTitle,
                    trailing: { EmptyView() },
                    below: {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(model.cutoffLines) { line in
                                Text(verbatim: line.text)
                                    .font(.system(.subheadline))
                                    .foregroundStyle(theme.ink)
                            }
                        }
                    }
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.course-settings")
        .accessibilityLabel("Aid station stops")
    }
}

/// "Aid 1<TAB>2 min" lines as a name column and a right-aligned value column.
struct PaceTwoColumnLines: View {
    let lines: [PaceLine]
    @Environment(\.crew) private var theme

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: CrewSpace.stackSm, verticalSpacing: 4) {
            ForEach(lines) { line in
                let parts = line.text.split(separator: "\t", maxSplits: 1).map(String.init)
                GridRow {
                    Text(verbatim: parts.first ?? "")
                        .foregroundStyle(theme.ink)
                    Text(verbatim: parts.count > 1 ? parts[1] : "")
                        .monospacedDigit()
                        .foregroundStyle(theme.outline)
                        .gridColumnAlignment(.trailing)
                }
                .font(.system(.subheadline))
            }
        }
    }
}

/// Work made without signal that hasn't reached the server yet.
struct PaceOutboxSection: View {
    let rows: [PaceLine]
    let message: String
    @Environment(\.crew) private var theme

    var body: some View {
        CrewSettingRow(
            systemImage: "arrow.up.circle",
            title: RaceToolsCopy.outboxTitle,
            hint: RaceToolsCopy.outboxHint,
            trailing: {
                if rows.isEmpty == false {
                    Text(verbatim: "\(rows.count)")
                        .font(.system(.subheadline, weight: .semibold).monospacedDigit())
                        .foregroundStyle(theme.onPrimarySoft)
                        .padding(.horizontal, 10)
                        .frame(minHeight: 28)
                        .background(theme.primarySoft, in: Capsule())
                        .accessibilityLabel("\(rows.count) waiting")
                }
            },
            below: {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(rows) { row in
                        Label(row.text, systemImage: "clock.arrow.circlepath")
                            .font(.system(.subheadline))
                            .foregroundStyle(theme.ink)
                    }
                    if message.isEmpty == false {
                        Text(verbatim: message)
                            .font(.system(.subheadline))
                            .foregroundStyle(theme.body)
                    }
                }
            }
        )
        .accessibilityIdentifier("crewcue.outbox")
        .accessibilityLabel("Waiting to upload")
    }
}
