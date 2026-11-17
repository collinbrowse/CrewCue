import SwiftUI
import UniformTypeIdentifiers
import CrewCueClientCore

/// Runner setup, phase 1 (`crewcue.onboarding-runner-setup`).
///
/// Compact width: one pane, one step per screen, its preview under the form. Regular width
/// (iPhone Duo's inner display, a wide Split View): an `ArrangementView` puts the step form beside
/// a live preview (the course map, or the teaser), each pane with its own scroll, so a long form
/// never carries the preview off screen. The form pane is the arrangement's primary view at every
/// width, so its scroll position and keyboard focus survive a fold or a display switch; only the
/// preview moves between panes. Every value lives in the model, and both panes keep their
/// controls out of reserved regions (the fold).
struct RunnerSetupView: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.crew) private var theme

    var body: some View {
        arrangement
            .animation(.snappy(duration: 0.3), value: sizeClass)
            .animation(.snappy(duration: 0.25), value: model.step)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(CrewBackground())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("crewcue.onboarding-runner-setup")
            .accessibilityLabel(OnboardingCopy.title(for: model.step) ?? "")
            .sheet(isPresented: $model.showsZonePicker) {
                TimeZonePicker(model: model)
            }
            .task(id: teaserKey) {
                guard model.step == .projectionTeaser else { return }
                await model.loadTeaser()
                // A teaser that failed offline loads again as soon as the network is back.
                await model.retryTeaserWhenOnline()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await model.retryTeaserIfNeeded() }
                }
            }
    }

    private var teaserKey: String {
        "\(model.step.rawValue)|\(model.roomId ?? "")"
    }

    /// The preview has its own pane only on a regular width.
    private var splitsPreview: Bool { sizeClass == .regular }

    @ViewBuilder
    private var arrangement: some View {
        if #available(iOS 27.1, *) {
            ArrangementView {
                formPane
            } secondary: {
                if splitsPreview {
                    previewPane
                }
            }
            .arrangementViewStyle(.split.axes(.horizontal))
        } else {
            // Before ArrangementView: the same two panes in a row.
            HStack(alignment: .top, spacing: 0) {
                formPane
                if splitsPreview {
                    previewPane
                }
            }
        }
    }

    /// The step form, and on a compact width the preview under it.
    private var formPane: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.margin) {
                form
                if !splitsPreview {
                    preview
                        .transition(.opacity)
                }
            }
            .padding(.horizontal, CrewSpace.margin)
            .padding(.vertical, CrewSpace.margin)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .avoidsReservedRegions()
        }
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("crewcue.onboarding.form-pane")
    }

    /// Regular width: the live preview beside the form, scrolling on its own.
    private var previewPane: some View {
        ScrollView {
            preview
                .padding(.horizontal, CrewSpace.margin)
                .padding(.vertical, CrewSpace.margin)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .avoidsReservedRegions()
        }
        .transition(.opacity)
        .accessibilityIdentifier("crewcue.onboarding.preview-pane")
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            if model.canGoBack {
                Button(OnboardingCopy.back, action: model.onBack)
                    .font(CrewFont.bodyLarge)
                    .foregroundStyle(theme.primary)
                    .accessibilityIdentifier("crewcue.onboarding.back")
            }
            StepHeader(step: model.step, index: model.stepIndex, count: model.stepCount)
            Group {
                switch model.step {
                case .account: AccountStep(model: model)
                case .course: CourseStep(model: model)
                case .startTime: StartTimeStep(model: model)
                case .history: HistoryStep(model: model)
                default: TeaserStep(model: model)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("crewcue.onboarding.step.\(model.step.rawValue)")
            if let failure = model.shownFailure {
                Text(failure.message)
                    .font(CrewFont.body)
                    .foregroundStyle(failure == .offline ? theme.body : theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.error")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Preview

    @ViewBuilder
    private var preview: some View {
        switch model.step {
        case .projectionTeaser:
            VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                TeaserTimeline(rows: model.teaserRows, timeZone: model.raceTimeZone)
                if let course = model.coursePreview {
                    CoursePreviewPanel(preview: course, summary: model.courseSummary)
                }
            }
        case .course, .startTime, .history:
            if let course = model.coursePreview {
                CoursePreviewPanel(preview: course, summary: model.courseSummary)
            } else if splitsPreview {
                SetupIllustration()
            }
        default:
            if splitsPreview {
                SetupIllustration()
            }
        }
    }
}

// MARK: Reserved regions

private extension View {
    /// Keeps the content's controls off a reserved region (the fold) that runs through it.
    func avoidsReservedRegions() -> some View {
        modifier(ReservedRegionInsets())
    }
}

/// Insets content away from any active division region (a fold) crossing it: the side of the
/// pane the region is on gets padded up to the region's far edge, margins included. Displays
/// without one, and systems before reserved regions, leave the content as it is. The insets are
/// read from the padded view's own frame, which the padding doesn't move, so they settle at once.
private struct ReservedRegionInsets: ViewModifier {
    @State private var insets = EdgeInsets()

    func body(content: Content) -> some View {
        if #available(iOS 27.1, *) {
            content
                .padding(insets)
                .onGeometryChange(for: EdgeInsets.self) { proxy in
                    Self.insets(
                        for: proxy.reservedRegions(kind: .division).map { region in
                            // The region plus the clearance it asks for around it.
                            CGRect(
                                x: region.frame.minX - region.margins.leading,
                                y: region.frame.minY - region.margins.top,
                                width: region.frame.width + region.margins.leading + region.margins.trailing,
                                height: region.frame.height + region.margins.top + region.margins.bottom
                            )
                        },
                        width: proxy.size.width
                    )
                } action: { next in
                    insets = next
                }
        } else {
            content
        }
    }

    /// Leading or trailing padding for each region that crosses the content's width. A region
    /// left of the middle pushes the content past its trailing edge; one right of it stops the
    /// content before its leading edge.
    nonisolated static func insets(for regions: [CGRect], width: CGFloat) -> EdgeInsets {
        var insets = EdgeInsets()
        for frame in regions where frame.maxX > 0 && frame.minX < width && frame.height >= frame.width {
            if frame.midX < width / 2 {
                insets.leading = max(insets.leading, min(frame.maxX, width))
            } else {
                insets.trailing = max(insets.trailing, min(width - frame.minX, width))
            }
        }
        return insets
    }
}

private struct StepHeader: View {
    let step: OnboardingStep
    let index: Int
    let count: Int
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            CrewProgressBar(fraction: Double(index + 1) / Double(max(count, 1)), height: 6)
                .accessibilityHidden(true)
            Text(OnboardingCopy.title(for: step) ?? "")
                .font(CrewFont.display)
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            if let explanation = OnboardingCopy.explanation(for: step) {
                Text(explanation)
                    .font(CrewFont.bodyLarge)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct SetupIllustration: View {
    var body: some View {
        Image("OnboardingRunner")
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}

// MARK: Steps

private struct AccountStep: View {
    @Bindable var model: RunnerSetupModel

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if model.signedIn {
                TextField(OnboardingCopy.displayName, text: $model.displayName)
                    .textFieldStyle(.crew)
                    .textContentType(.name)
                    .submitLabel(.continue)
                    .onSubmit(model.saveName)
                    .accessibilityLabel(OnboardingCopy.displayName)
                    .accessibilityIdentifier("crewcue.onboarding.display-name")
                Button(OnboardingCopy.continueLabel, action: model.saveName)
                    .buttonStyle(.crewPrimary)
                    .disabled(!model.canSaveName)
                    .accessibilityIdentifier("crewcue.onboarding.continue")
            } else {
                // Auth0 is open: the button that started it shows busy, and neither starts another.
                Button(OnboardingCopy.createAccount, action: model.signUp)
                    .buttonStyle(.crewPrimary)
                    .crewBusy(model.authWorking && model.authSigningUp)
                    .disabled(model.authWorking)
                    .accessibilityIdentifier("crewcue.onboarding.create-account")
                Button(OnboardingCopy.signIn, action: model.signIn)
                    .buttonStyle(.crewGhost)
                    .crewBusy(model.authWorking && !model.authSigningUp)
                    .disabled(model.authWorking)
                    .accessibilityIdentifier("crewcue.onboarding.sign-in")
            }
        }
    }
}

private struct CourseStep: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if model.courseFileName == nil {
                // The checklist's Empty state.
                Text(CrewCueClientCore.featureScreen(id: "onboarding-runner-setup", state: .empty).body)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.empty")
            }
            if let name = model.courseFileName {
                Label(name, systemImage: "doc")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.ink)
                    .accessibilityIdentifier("crewcue.onboarding.course-file")
            }
            Button(model.courseFileName == nil ? OnboardingCopy.chooseCourseFile : OnboardingCopy.chooseAnotherCourseFile) {
                model.importingCourse = true
            }
            .buttonStyle(model.courseFileName == nil ? .crewPrimary : .crewSecondary)
            .crewBusy(model.busy && model.coursePreview == nil && model.courseFileName != nil)
            .disabled(model.busy)
            .accessibilityIdentifier("crewcue.onboarding.choose-course")
            if model.courseNeedsRetry {
                // The preview failed: this previews the same file again, it doesn't move on.
                Button(OnboardingCopy.tryAgain) {
                    Task { await model.previewCourse() }
                }
                .buttonStyle(.crewPrimary)
                .accessibilityIdentifier("crewcue.onboarding.retry")
            } else if model.courseFileName != nil {
                Button(OnboardingCopy.continueLabel) {
                    if model.coursePreview == nil {
                        Task { await model.previewCourse() }
                    } else {
                        model.continueCourse()
                    }
                }
                .buttonStyle(.crewPrimary)
                .disabled(model.busy)
                .accessibilityIdentifier("crewcue.onboarding.continue")
            }
        }
        .courseImporter(model: model)
    }
}

private struct StartTimeStep: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.crew) private var theme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            // The picker edits wall-clock fields in UTC, which has no daylight saving: every local
            // time can be picked, and `RaceStartInput` then checks it in the chosen zone.
            DatePicker(OnboardingCopy.startLabel, selection: $model.startWallClock, displayedComponents: [.date, .hourAndMinute])
                .datePickerStyle(.compact)
                .font(CrewFont.bodyLarge)
                .environment(\.timeZone, TimeZone(identifier: "UTC") ?? .gmt)
                .accessibilityIdentifier("crewcue.onboarding.start-picker")
            Button {
                model.showsZonePicker = true
            } label: {
                let layout = typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                    : AnyLayout(HStackLayout(spacing: CrewSpace.stackSm))
                layout {
                    Text(OnboardingCopy.timeZoneLabel)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.ink)
                    if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
                    Text(model.timeZoneIdentifier.replacingOccurrences(of: "_", with: " "))
                        .font(CrewFont.label)
                        .foregroundStyle(theme.primary)
                        .multilineTextAlignment(.leading)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(OnboardingCopy.timeZoneLabel)
            .accessibilityValue(model.timeZoneIdentifier)
            .accessibilityIdentifier("crewcue.onboarding.time-zone")
            if model.showsDaylightSavingGap {
                Text(OnboardingCopy.startTimeDstGap)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.dst-gap")
            }
            if model.courseXml == nil {
                // The race has no saved course and this phone lost the file: pick it again.
                Button(OnboardingCopy.chooseCourseFile) { model.importingCourse = true }
                    .buttonStyle(.crewSecondary)
                    .accessibilityIdentifier("crewcue.onboarding.choose-course")
            }
            Button(OnboardingCopy.continueLabel) {
                Task { await model.saveStart() }
            }
            .buttonStyle(.crewPrimary)
            .disabled(!model.canSaveStart)
            .crewBusy(model.busy)
            .accessibilityIdentifier("crewcue.onboarding.continue")
        }
        .courseImporter(model: model)
    }
}

private struct HistoryStep: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if let message = model.historyMessage {
                Text(message)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.history-message")
            }
            if let line = model.historyLine {
                Text(line)
                    .font(CrewFont.title)
                    .foregroundStyle(theme.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.history-comparison")
            }
            Button(OnboardingCopy.importPastRun) { model.importingHistory = true }
                .buttonStyle(model.historyLine == nil ? .crewPrimary : .crewSecondary)
                .disabled(model.busy)
                .accessibilityIdentifier("crewcue.onboarding.import-history")
            if model.historyImported {
                Button(OnboardingCopy.continueLabel) {
                    Task { await model.continueHistory() }
                }
                .buttonStyle(.crewPrimary)
                .crewBusy(model.busy)
                .accessibilityIdentifier("crewcue.onboarding.continue")
            }
            Button(OnboardingCopy.skipHistory) {
                Task { await model.skipHistory() }
            }
            .buttonStyle(.crewGhost)
            .crewBusy(model.busy && model.historyLine == nil)
            .accessibilityIdentifier("crewcue.onboarding.skip-history")
        }
        .fileImporter(isPresented: $model.importingHistory, allowedContentTypes: SettingsActivityImportSection.contentTypes) { result in
            Task { await model.pickedHistory(result) }
        }
    }
}

private struct TeaserStep: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            VStack(alignment: .leading, spacing: 4) {
                Text(OnboardingCopy.finishLabel)
                    .crewKicker()
                    .foregroundStyle(theme.body)
                // In the race's zone, like the start the runner picked.
                Text(verbatim: CrewClock.short(model.teaser?.finishAt, timeZone: model.raceTimeZone) ?? "—")
                    .font(CrewFont.metricLarge)
                    .foregroundStyle(theme.primary)
                if let zone = model.raceTimeZoneLabel {
                    Text(verbatim: zone)
                        .font(CrewFont.label)
                        .foregroundStyle(theme.body)
                        .accessibilityIdentifier("crewcue.onboarding.teaser-zone")
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("crewcue.onboarding.teaser-finish")
            // The checklist's Success state once the finish is in.
            Text(model.teaser?.finishAt == nil
                ? OnboardingCopy.lockedAidExplanation
                : CrewCueClientCore.featureScreen(id: "onboarding-runner-setup", state: .success).body)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
            if model.teaserNeedsRetry {
                // The load failed or came back without a finish: nothing else on this step moves on.
                Button(OnboardingCopy.tryAgain) {
                    Task { await model.loadTeaser() }
                }
                .buttonStyle(.crewPrimary)
                .accessibilityIdentifier("crewcue.onboarding.retry")
            } else {
                Button(OnboardingCopy.continueLabel, action: model.continueTeaser)
                    .buttonStyle(.crewPrimary)
                    .disabled(!model.canContinueTeaser)
                    .crewBusy(model.busy)
                    .accessibilityIdentifier("crewcue.onboarding.continue")
            }
        }
    }
}

// MARK: Teaser timeline

/// The Pace timeline on an unpaid race: start and finish with their times, every aid station
/// between them locked.
struct TeaserTimeline: View {
    let rows: [CheckpointTimelineRow]
    /// The race's zone: the start and finish read in it.
    var timeZone: TimeZone = DeviceTimeZone.current

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.base) {
            ForEach(rows) { row in
                TeaserTimelineRow(row: row, timeZone: timeZone)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding.teaser-timeline")
    }
}

private struct TeaserTimelineRow: View {
    let row: CheckpointTimelineRow
    let timeZone: TimeZone
    @Environment(\.crew) private var theme
    @Environment(\.dynamicTypeSize) private var typeSize
    /// The icon column grows with the text, so the glyph never runs into the title.
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 28

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .center, spacing: CrewSpace.stackSm))
        layout {
            HStack(spacing: CrewSpace.stackSm) {
                Image(systemName: row.isFinish ? "flag.checkered" : (row.locked ? "lock" : "circle"))
                    .font(.system(.body, weight: .semibold))
                    .foregroundStyle(row.locked ? theme.body : theme.primary)
                    .frame(minWidth: iconWidth)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: row.kicker)
                        .font(CrewFont.kicker)
                        .foregroundStyle(theme.body)
                    Text(verbatim: row.title)
                        .font(CrewFont.title)
                        .foregroundStyle(theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            if row.locked {
                Label(OnboardingCopy.lockedAidRow, systemImage: "lock.fill")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.body)
            } else {
                Text(verbatim: CrewClock.short(row.clockArrivalAt, timeZone: timeZone) ?? "—")
                    .font(CrewFont.metric)
                    .foregroundStyle(row.isFinish ? theme.primary : theme.ink)
            }
        }
        .padding(.horizontal, CrewSpace.gutter)
        .padding(.vertical, CrewSpace.stackSm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
        .opacity(row.locked ? 0.8 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.title)
        .accessibilityValue(row.locked ? OnboardingCopy.lockedAidExplanation : (CrewClock.short(row.clockArrivalAt, timeZone: timeZone) ?? ""))
        .accessibilityIdentifier(row.locked ? "crewcue.onboarding.locked-row.\(row.checkpointId)" : "crewcue.onboarding.teaser-row.\(row.checkpointId)")
    }
}

// MARK: Time zone

private struct TimeZonePicker: View {
    @Bindable var model: RunnerSetupModel

    var body: some View {
        NavigationStack {
            List(model.zoneIdentifiers, id: \.self) { identifier in
                Button {
                    model.pickZone(identifier)
                } label: {
                    HStack {
                        Text(identifier.replacingOccurrences(of: "_", with: " "))
                        Spacer()
                        if identifier == model.timeZoneIdentifier {
                            Image(systemName: "checkmark")
                                .accessibilityHidden(true)
                        }
                    }
                }
                .accessibilityAddTraits(identifier == model.timeZoneIdentifier ? .isSelected : [])
            }
            .searchable(text: $model.zoneSearch, prompt: OnboardingCopy.timeZoneSearch)
            .navigationTitle(OnboardingCopy.timeZoneLabel)
            .navigationBarTitleDisplayMode(.inline)
        }
        .crewTheme()
        .accessibilityIdentifier("crewcue.onboarding.time-zone-picker")
    }
}

// MARK: Course file

private extension View {
    func courseImporter(model: RunnerSetupModel) -> some View {
        modifier(CourseImporter(model: model))
    }
}

private struct CourseImporter: ViewModifier {
    @Bindable var model: RunnerSetupModel

    func body(content: Content) -> some View {
        content.fileImporter(isPresented: $model.importingCourse, allowedContentTypes: Self.types, allowsMultipleSelection: false) { result in
            Task { await model.pickedCourse(result) }
        }
    }

    /// The same types Pace's GPX import takes.
    static let types: [UTType] = {
        var types: [UTType] = [.xml, .plainText]
        if let gpx = UTType(filenameExtension: "gpx") {
            types.insert(gpx, at: 0)
        }
        return types
    }()
}
