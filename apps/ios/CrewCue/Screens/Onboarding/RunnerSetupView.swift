import SwiftUI
import UniformTypeIdentifiers
import CrewCueClientCore

/// Runner setup, phase 1 (`crewcue.onboarding-runner-setup`). Compact width: one step per screen,
/// its preview under the form. Regular width (iPhone Duo's inner display, a wide Split View): the
/// form beside a live preview (the course map, or the teaser). Every value lives in the model,
/// so a fold, a display switch or Split View keeps the step and what was typed or picked. One
/// layout switches between a column and a row, so the form and the preview keep their identity
/// (and the keyboard focus and scroll position) across the change and only move.
struct RunnerSetupView: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.crew) private var theme

    var body: some View {
        let layout = sizeClass == .regular
            ? AnyLayout(HStackLayout(alignment: .top, spacing: CrewSpace.stackLg))
            : AnyLayout(VStackLayout(alignment: .leading, spacing: CrewSpace.margin))
        ScrollView {
            layout {
                form
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                preview
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .padding(.horizontal, CrewSpace.margin)
            .padding(.vertical, CrewSpace.margin)
        }
        .scrollDismissesKeyboard(.interactively)
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
            if model.step == .projectionTeaser {
                await model.loadTeaser()
            }
        }
    }

    private var teaserKey: String {
        "\(model.step.rawValue)|\(model.roomId ?? "")"
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
            if let failure = model.failure {
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
                TeaserTimeline(rows: model.teaserRows)
                if let course = model.coursePreview {
                    CoursePreviewPanel(preview: course, summary: model.courseSummary)
                }
            }
        case .course, .startTime, .history:
            if let course = model.coursePreview {
                CoursePreviewPanel(preview: course, summary: model.courseSummary)
            } else if sizeClass == .regular {
                SetupIllustration()
            }
        default:
            if sizeClass == .regular {
                SetupIllustration()
            }
        }
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
                Button(OnboardingCopy.createAccount, action: model.signUp)
                    .buttonStyle(.crewPrimary)
                    .accessibilityIdentifier("crewcue.onboarding.create-account")
                Button(OnboardingCopy.signIn, action: model.signIn)
                    .buttonStyle(.crewGhost)
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
            if model.courseFileName != nil {
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
                Text(CrewClock.short(model.teaser?.finishAt) ?? "—")
                    .font(CrewFont.metricLarge)
                    .foregroundStyle(theme.primary)
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
            Button(OnboardingCopy.continueLabel, action: model.continueTeaser)
                .buttonStyle(.crewPrimary)
                .disabled(!model.canContinueTeaser)
                .crewBusy(model.busy)
                .accessibilityIdentifier("crewcue.onboarding.continue")
        }
    }
}

// MARK: Teaser timeline

/// The Pace timeline on an unpaid race: start and finish with their times, every aid station
/// between them locked.
struct TeaserTimeline: View {
    let rows: [CheckpointTimelineRow]

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.base) {
            ForEach(rows) { row in
                TeaserTimelineRow(row: row)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding.teaser-timeline")
    }
}

private struct TeaserTimelineRow: View {
    let row: CheckpointTimelineRow
    @Environment(\.crew) private var theme
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .center, spacing: CrewSpace.stackSm))
        layout {
            HStack(spacing: CrewSpace.stackSm) {
                Image(systemName: row.isFinish ? "flag.checkered" : (row.locked ? "lock" : "circle"))
                    .font(.system(.body, weight: .semibold))
                    .foregroundStyle(row.locked ? theme.body : theme.primary)
                    .frame(width: 28)
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
                Text(verbatim: CrewClock.short(row.clockArrivalAt) ?? "—")
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
        .accessibilityValue(row.locked ? OnboardingCopy.lockedAidExplanation : (CrewClock.short(row.clockArrivalAt) ?? ""))
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
