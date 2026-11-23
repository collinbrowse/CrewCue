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
///
/// Back is the navigation bar's leading item (the setup screen is the root of the app's
/// `NavigationStack`, and its steps are one model's state rather than pushed views), plus the
/// edge swipe. It opens the previous step with everything entered kept; from the first step it
/// returns to the chooser. The system places the bar, on iPhone Duo too.
struct RunnerSetupView: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.layoutDirection) private var layoutDirection
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
            .toolbar {
                if model.showsBack {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: model.goBack) {
                            // The chevron and the word "Back", like a pushed screen's back button.
                            // Not `Label(...).labelStyle(.titleAndIcon)`: tried on the iOS 27
                            // simulator, the bar still draws a Label item as its icon alone.
                            HStack(spacing: 4) {
                                Image(systemName: "chevron.left")
                                    .fontWeight(.semibold)
                                Text(OnboardingCopy.back)
                            }
                            // Tinted like the bar's other items (an image-only item takes the tint).
                            .foregroundStyle(model.canGoBack ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        }
                        .disabled(!model.canGoBack)
                        .accessibilityLabel(OnboardingCopy.back)
                        .accessibilityIdentifier("crewcue.onboarding.back")
                        // Right to left, the column and this item are both on the leading edge.
                        .keepsFullWidthRowsClear()
                    }
                }
            }
            .gesture(EdgeSwipeBack(enabled: model.canGoBack, rightToLeft: layoutDirection == .rightToLeft, onBack: model.goBack))
            // VoiceOver's escape (the two-finger Z) goes Back too, like a pushed screen's.
            .accessibilityAction(.escape) {
                if model.canGoBack { model.goBack() }
            }
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
        // ArrangementView and reserved regions ship in the iOS 27.1 SDK. CI still builds with
        // Xcode 26 (Swift 6.2), so they are compiled only by a Swift 6.4 (Xcode 27) toolchain;
        // older toolchains build the HStack below. Drop the `#if` once CI's Xcode has that SDK.
        #if compiler(>=6.4)
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
            rowOfPanes
        }
        #else
        rowOfPanes
        #endif
    }

    /// Before ArrangementView: the same two panes in a row.
    private var rowOfPanes: some View {
        HStack(alignment: .top, spacing: 0) {
            formPane
            if splitsPreview {
                previewPane
            }
        }
    }

    /// The step form, and on a compact width the preview under it. Each row pads itself, so the
    /// rows below a camera column (iPhone Duo's outer display) can run to the display's edge
    /// while the rows beside the column stay clear of it.
    private var formPane: some View {
        OcclusionScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.margin) {
                form
                if !splitsPreview {
                    preview
                        .padding(.horizontal, CrewSpace.margin)
                        .fullWidthClearOfOcclusions()
                        .transition(.opacity)
                }
            }
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
            StepHeader(step: model.step, index: model.stepIndex, count: model.stepCount)
                .padding(.horizontal, CrewSpace.margin)
                .fullWidthClearOfOcclusions()
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
            .padding(.horizontal, CrewSpace.margin)
            .fullWidthClearOfOcclusions()
            if let failure = model.shownFailure {
                Text(failure.message)
                    .font(CrewFont.body)
                    .foregroundStyle(failure == .offline ? theme.body : theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.error")
                    .padding(.horizontal, CrewSpace.margin)
                    .fullWidthClearOfOcclusions()
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
                if model.coursePreview != nil {
                    coursePreview
                }
            }
        case .course, .startTime, .history:
            if model.coursePreview != nil || model.previewingCourse {
                coursePreview
            } else if splitsPreview {
                SetupIllustration()
            }
        default:
            if splitsPreview {
                SetupIllustration()
            }
        }
    }

    /// The course preview, or the loader in its place while the file is read and the map loads.
    private var coursePreview: some View {
        CoursePreviewSlot(
            preview: model.coursePreview,
            summary: model.courseSummary,
            previewing: model.previewingCourse,
            reading: model.readingCourse,
            mapReady: model.courseMapReady,
            onMapReady: model.noteCourseMapReady
        )
    }
}

/// The edge swipe that goes Back, as a pushed screen's would (from the right edge in a
/// right-to-left layout). A screen-edge recognizer only starts at the display's edge, so it leaves
/// the form's scrolling and its controls alone.
private struct EdgeSwipeBack: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var rightToLeft: Bool
    var onBack: () -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let recognizer = UIScreenEdgePanGestureRecognizer()
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        recognizer.edges = rightToLeft ? .right : .left
        recognizer.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        guard recognizer.state == .ended, enabled, let view = recognizer.view else { return }
        let direction: CGFloat = recognizer.edges == .right ? -1 : 1
        let travelled = recognizer.translation(in: view).x * direction
        let speed = recognizer.velocity(in: view).x * direction
        // Past a third of the width, or flicked: the same feel as the system's swipe back.
        if travelled > view.bounds.width / 3 || (travelled > 24 && speed > 500) {
            onBack()
        }
    }

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        // The form's scroll view keeps scrolling while the edge swipe is read.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
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
                // The runner's own name, the one crew see in chat. The race is named on the
                // course step.
                SetupField(label: OnboardingCopy.displayName, help: OnboardingCopy.displayNameHelp) {
                    TextField(OnboardingCopy.displayName, text: $model.displayName, prompt: Text(verbatim: ""))
                        .textFieldStyle(.crew)
                        .textContentType(.name)
                        .submitLabel(.continue)
                        .onSubmit(model.saveName)
                        .accessibilityLabel(OnboardingCopy.displayName)
                        .accessibilityHint(OnboardingCopy.displayNameHelp)
                        .accessibilityIdentifier("crewcue.onboarding.display-name")
                }
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

/// A text field with its label above and a line of help under it.
private struct SetupField<Field: View>: View {
    let label: String
    let help: String
    @ViewBuilder var field: Field
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // VoiceOver reads the field's own label and hint instead.
            Text(label)
                .font(CrewFont.label)
                .foregroundStyle(theme.ink)
                .accessibilityHidden(true)
            field
            Text(help)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(true)
        }
    }
}

/// The race's name, above the course file that creates the race. Once the race exists the name
/// shows read-only: the API has no rename.
private struct RaceNameField: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.crew) private var theme

    var body: some View {
        if model.raceNameLocked {
            if let name = model.shownRaceName {
                VStack(alignment: .leading, spacing: 4) {
                    Text(OnboardingCopy.raceNameLabel)
                        .font(CrewFont.label)
                        .foregroundStyle(theme.body)
                    Text(verbatim: name)
                        .font(CrewFont.title)
                        .foregroundStyle(theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(OnboardingCopy.raceNameLabel)
                .accessibilityValue(name)
                .accessibilityIdentifier("crewcue.onboarding.race-name")
            }
        } else {
            SetupField(label: OnboardingCopy.raceNameLabel, help: OnboardingCopy.raceNameHelp) {
                TextField(OnboardingCopy.raceNameLabel, text: $model.raceName, prompt: Text(OnboardingCopy.raceNamePlaceholder))
                    .textFieldStyle(.crew)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .disabled(model.busy)
                    .accessibilityLabel(OnboardingCopy.raceNameLabel)
                    .accessibilityHint(OnboardingCopy.raceNameHelp)
                    .accessibilityIdentifier("crewcue.onboarding.race-name")
            }
        }
    }
}

private struct CourseStep: View {
    @Bindable var model: RunnerSetupModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            RaceNameField(model: model)
            courseFile
        }
        .courseImporter(model: model)
    }

    /// Nothing to continue with yet: the checklist's Empty state and Choose course file.
    private var empty: Bool { model.shownCourseFileName == nil && model.courseContinue == .chooseFile }

    private var courseFile: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            if empty {
                // The checklist's Empty state.
                Text(CrewCueClientCore.featureScreen(id: "onboarding-runner-setup", state: .empty).body)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("crewcue.onboarding.empty")
            }
            if let name = model.shownCourseFileName {
                Label(name, systemImage: "doc")
                    .font(CrewFont.label)
                    .foregroundStyle(theme.ink)
                    .accessibilityIdentifier("crewcue.onboarding.course-file")
            } else if model.courseContinue == .keepSavedCourse {
                // The race saved its course and this phone doesn't hold the file (signed out and
                // back in, another phone): Continue keeps it, nothing is uploaded again.
                SavedCourse(fileName: model.savedCourseFileName)
            }
            Button(empty ? OnboardingCopy.chooseCourseFile : OnboardingCopy.chooseAnotherCourseFile) {
                model.importingCourse = true
            }
            .buttonStyle(empty ? .crewPrimary : .crewSecondary)
            .crewBusy(model.previewingCourse)
            // The file creates the race, which needs its name first.
            .disabled(!model.canChooseCourse)
            .accessibilityIdentifier("crewcue.onboarding.choose-course")
            if model.courseNeedsRetry {
                // The preview failed: this reads the same file again, it doesn't move on. A race
                // still to be created needs its name first.
                Button(OnboardingCopy.tryAgain) {
                    Task { await model.retryCourse() }
                }
                .buttonStyle(.crewPrimary)
                .disabled(!model.canChooseCourse)
                .accessibilityIdentifier("crewcue.onboarding.retry")
                if model.pendingCourse != nil {
                    // A file picked after Back that couldn't be read: keep the course from before.
                    Button(OnboardingCopy.pickerCancel, action: model.cancelPendingCourse)
                        .buttonStyle(.crewGhost)
                        .accessibilityIdentifier("crewcue.onboarding.cancel-course")
                }
            } else if !empty {
                Button(OnboardingCopy.continueLabel) {
                    Task { await model.continueCourse() }
                }
                .buttonStyle(.crewPrimary)
                .disabled(!model.canContinueCourse)
                .accessibilityIdentifier("crewcue.onboarding.continue")
            }
        }
    }
}

/// The course the race saved, shown without its file on this phone.
private struct SavedCourse: View {
    let fileName: String?
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(OnboardingCopy.courseSaved, systemImage: "checkmark.circle")
                .font(CrewFont.label)
                .foregroundStyle(theme.ink)
            if let fileName {
                Text(verbatim: fileName)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("crewcue.onboarding.course-saved")
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
            if model.startNeedsCourseFile {
                // The race has no saved course and this phone lost the file: pick it again. A race
                // that has its course never needs the file here.
                Button(OnboardingCopy.chooseCourseFile) { model.importingCourse = true }
                    .buttonStyle(.crewSecondary)
                    .disabled(model.busy)
                    .accessibilityIdentifier("crewcue.onboarding.choose-course")
            }
            Button(OnboardingCopy.continueLabel) {
                Task { await model.continueStart() }
            }
            .buttonStyle(.crewPrimary)
            .disabled(!model.canContinueStart)
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
            HistoryTips()
                .padding(.bottom, CrewSpace.stackSm)
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
                .buttonStyle(model.historyShowsContinue ? .crewSecondary : .crewPrimary)
                .disabled(model.busy)
                .accessibilityIdentifier("crewcue.onboarding.import-history")
            if model.historyShowsContinue {
                // After an import, always on a history step already passed, and on a race that
                // already has an estimate: Continue keeps that estimate unless a course save
                // dropped it.
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

/// Which file to pick, the formats the importer takes, and that the step is optional, under the
/// step's lead (`OnboardingCopy.explanation(for: .history)`).
private struct HistoryTips: View {
    @Environment(\.crew) private var theme
    @ScaledMetric(relativeTo: .body) private var dot: CGFloat = 6

    var body: some View {
        let size = dot
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            ForEach(OnboardingCopy.historyTips, id: \.self) { tip in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    // Sits on the first line, about halfway up its lowercase letters.
                    Circle()
                        .fill(theme.primary)
                        .frame(width: size, height: size)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] + size / 2 }
                        .accessibilityHidden(true)
                    Text(tip)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.onboarding.history-tips")
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
