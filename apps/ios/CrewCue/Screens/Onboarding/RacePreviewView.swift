import SwiftUI
import CrewCueClientCore

/// Runner onboarding phase 2: the race-day replay, then the paywall. The stage, the replay clock
/// and the beat live in `RacePreviewModel`, so nothing here restarts on a size change.
struct RacePreviewFlowView: View {
    @Bindable var model: RacePreviewModel
    let source: RacePreviewSource
    /// Nil on the dev route's fixture: the paywall shows the fallback prices and can't buy.
    var billing: BillingPurchaseModel?
    var roomId: String?
    var onNotNow: () -> Void
    var onPurchased: () -> Void
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            switch model.stage {
            case .replay:
                RacePreviewView(model: model)
            case .paywall:
                OnboardingPaywallView(
                    billing: billing,
                    roomId: roomId,
                    onBack: { model.replayFromStart() },
                    onNotNow: onNotNow,
                    onPurchased: onPurchased
                )
            }
        }
        .animation(.snappy(duration: 0.3), value: model.stage)
        .onAppear { model.viewAppeared() }
        .onDisappear { model.viewDisappeared() }
        .task(id: source.key) { model.show(source) }
        .onChange(of: scenePhase, initial: true) { _, phase in
            model.setScene(active: phase == .active)
        }
    }
}

/// The replay (`crewcue.onboarding-race-preview`): about 25 s on the runner's own course in the
/// real Map, Pace and Chat views, each beat captioned, with Skip always there.
///
/// Compact width: one view at a time under the caption, following the beats (Map, Pace, Map for
/// the dead zone, then Chat), with a strip to pick another. Regular width: an `ArrangementView`
/// puts Map beside Pace, and Chat takes Pace's place at its beat. The Map stays the primary
/// pane's view at every width, so a fold or a display switch never reloads it, and both panes keep
/// their controls off reserved regions (the fold).
struct RacePreviewView: View {
    @Bindable var model: RacePreviewModel
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var splits: Bool { sizeClass == .regular }
    private var showsSecondary: Bool { splits && model.status == .playing && model.replay != nil }

    var body: some View {
        arrangement
            .animation(.snappy(duration: 0.3), value: sizeClass)
            .animation(.snappy(duration: 0.25), value: model.panel)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(CrewBackground())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("crewcue.onboarding-race-preview")
            .accessibilityLabel(OnboardingCopy.title(for: .preview) ?? "")
            .onChange(of: model.beat) { _, _ in
                AccessibilityNotification.Announcement(model.caption).post()
            }
    }

    @ViewBuilder
    private var arrangement: some View {
        // ArrangementView ships in the iOS 27.1 SDK. CI still builds with Xcode 26 (Swift 6.2), so
        // it is compiled only by a Swift 6.4 (Xcode 27) toolchain; older toolchains build the
        // HStack below. Drop the `#if` once CI's Xcode has that SDK.
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            ArrangementView {
                primaryPane
            } secondary: {
                if showsSecondary {
                    secondaryPane
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
        HStack(spacing: 0) {
            primaryPane
            if showsSecondary {
                secondaryPane
            }
        }
    }

    /// The controls and the caption, then the Map (or, on a compact width, the beat's view).
    private var primaryPane: some View {
        GeometryReader { proxy in
            VStack(spacing: 0) {
                RacePreviewControls(model: model)
                if model.status == .playing || model.fromSavedRace {
                    RacePreviewCaption(model: model, maxHeight: proxy.size.height * 0.4)
                }
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.status {
        case .playing:
            if let replay = model.replay {
                views(replay)
            } else {
                RacePreviewLoading()
            }
        case .loading:
            RacePreviewLoading()
        case .empty, .error, .offline:
            RacePreviewMessage(text: Self.message(model.status))
                .padding(CrewSpace.gutter)
                .avoidsReservedRegions()
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    /// The strip and the panes under it run to the display's edge below a camera column (iPhone
    /// Duo's outer display); the controls and caption above stay clear of it.
    private func views(_ replay: RacePreviewModel.Replay) -> some View {
        VStack(spacing: 0) {
            if !splits {
                RacePreviewPanelPicker(selection: $model.panel)
                    .padding(.horizontal, CrewSpace.gutter)
                    .padding(.bottom, CrewSpace.stackSm)
                    .fullWidthClearOfOcclusions()
            }
            ZStack {
                MapView(model: replay.map, readOnly: true)
                    .accessibilityHidden(!splits && model.panel != .map)
                if !splits && model.panel != .map {
                    panelView(model.panel, replay)
                        .transition(.opacity)
                }
            }
            .fullWidthClearOfOcclusions()
        }
    }

    /// Regular width: Pace beside the Map, or Chat at its beat.
    private var secondaryPane: some View {
        Group {
            if let replay = model.replay {
                panelView(model.panel == .chat ? .chat : .pace, replay)
            }
        }
        .avoidsReservedRegions()
        .transition(.opacity)
    }

    @ViewBuilder
    private func panelView(_ panel: RacePreviewModel.Panel, _ replay: RacePreviewModel.Replay) -> some View {
        switch panel {
        case .map:
            MapView(model: replay.map, readOnly: true)
        case .pace:
            PaceView(
                model: replay.pace,
                userId: replay.userId,
                roomId: replay.roomId,
                role: RacePreviewModel.viewerRole,
                runner: replay.map.runner,
                live: replay.map.live,
                readOnly: true
            )
            .background(CrewBackground())
        case .chat:
            ChatView(
                model: replay.chat,
                userId: replay.userId,
                roomId: replay.roomId,
                role: RacePreviewModel.viewerRole,
                raceName: replay.pace.raceName,
                status: ChatRaceStatus(map: replay.map),
                readOnly: true
            )
            .background(CrewBackground())
        }
    }

    static func message(_ status: RacePreviewModel.Status) -> String {
        switch status {
        case .empty: OnboardingCopy.replayEmpty
        case .offline: OnboardingCopy.replayOffline
        default: OnboardingCopy.replayError
        }
    }
}

/// Play or pause, the replay's progress and Skip: always on screen, at any text size.
struct RacePreviewControls: View {
    @Bindable var model: RacePreviewModel
    @Environment(\.crew) private var theme

    var body: some View {
        HStack(spacing: CrewSpace.stackSm) {
            // Nothing to play while it loads or when it can't: Skip alone.
            if model.status == .playing {
                playButton
            }
            CrewProgressBar(fraction: model.progress, height: 6)
                .animation(.linear(duration: DemoRaceScript.stepSeconds), value: model.progress)
                .accessibilityLabel(OnboardingCopy.title(for: .preview) ?? "")
            skipButton
        }
        .padding(.horizontal, CrewSpace.gutter)
        .padding(.vertical, CrewSpace.stackSm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .avoidsReservedRegions()
    }

    private var playButton: some View {
        Button {
            model.togglePlay()
        } label: {
            Label(
                model.pausedByUser ? OnboardingCopy.replayPlay : OnboardingCopy.replayPause,
                systemImage: model.pausedByUser ? "play.fill" : "pause.fill"
            )
            .labelStyle(.iconOnly)
            .font(.system(.body, weight: .semibold))
            .foregroundStyle(theme.primary)
            .frame(minWidth: 44, minHeight: 44)
        }
        .crewGlass(in: Circle(), interactive: true)
        .accessibilityIdentifier("crewcue.onboarding-race-preview.play-pause")
    }

    private var skipButton: some View {
        Button(OnboardingCopy.replaySkip) {
            model.skip()
        }
        .buttonStyle(.crewSecondary)
        .fixedSize()
        .accessibilityIdentifier("crewcue.onboarding-race-preview.skip")
    }
}

/// The beat's caption (and, offline, where the race came from). Its own height while that fits
/// in `maxHeight`; at the largest text sizes or in a short landscape pane it scrolls there,
/// instead of pushing the controls or the views off screen.
struct RacePreviewCaption: View {
    @Bindable var model: RacePreviewModel
    let maxHeight: CGFloat
    /// The caption's laid-out height, read back to size the scroll view. Layout only.
    @State private var height: CGFloat?
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                if model.status == .playing {
                    caption
                }
                if model.fromSavedRace {
                    Text(OnboardingCopy.replayOffline)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("crewcue.onboarding-race-preview.offline")
                }
            }
            .padding(.horizontal, CrewSpace.gutter)
            .padding(.bottom, CrewSpace.stackSm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .avoidsReservedRegions()
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: height.map { min($0, maxHeight) })
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(OnboardingCopy.title(for: .preview) ?? "")
                .crewKicker()
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(OnboardingCopy.replayBeatCount(model.beat))
                .crewKicker()
                .foregroundStyle(theme.primary)
            // Every caption laid out, hidden, so the card keeps the longest one's height: the views
            // under it don't move (and the map doesn't refit) at each beat.
            ZStack(alignment: .topLeading) {
                ForEach(DemoRaceBeat.allCases, id: \.self) { beat in
                    captionText(OnboardingCopy.replayCaption(beat))
                        .hidden()
                        .accessibilityHidden(true)
                }
                captionText(model.caption)
                    .contentTransition(.opacity)
                    .animation(.snappy(duration: 0.25), value: model.beat)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlassCard(padding: CrewSpace.gutter)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("crewcue.onboarding-race-preview.caption")
    }

    private func captionText(_ text: String) -> some View {
        Text(text)
            .font(CrewFont.bodyLarge)
            .foregroundStyle(theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Compact width: Map, Pace or Chat.
struct RacePreviewPanelPicker: View {
    @Binding var selection: RacePreviewModel.Panel

    var body: some View {
        Picker(selection: $selection) {
            ForEach(RacePreviewModel.Panel.allCases) { panel in
                Text(verbatim: panel.title).tag(panel)
            }
        } label: {
            Text(OnboardingCopy.title(for: .preview) ?? "")
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("crewcue.onboarding-race-preview.panel")
    }
}

/// The replay can't play: no course, an error, or offline with nothing saved. Skip stays above.
struct RacePreviewMessage: View {
    let text: String
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(OnboardingCopy.title(for: .preview) ?? "")
                .crewKicker()
                .foregroundStyle(theme.body)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(text)
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("crewcue.onboarding-race-preview.status")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlassCard()
    }
}

struct RacePreviewLoading: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        CairnLoader(onLight: scheme == .light)
            .frame(width: 64, height: 64)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel(OnboardingCopy.loading)
            .accessibilityIdentifier("crewcue.onboarding-race-preview.loading")
    }
}

/// The checklist copy for one state, where no shell model is at hand (a pushed fixture route).
/// The top-level dev route shows the real screen instead (`RacePreviewDevRoute`).
struct RacePreviewFixtureScreen: View {
    let screen: FeatureScreen

    var body: some View {
        RacePreviewMessage(text: screen.body)
            .padding(CrewSpace.gutter)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(CrewBackground())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(screen.accessibilityIdentifier)
            .accessibilityLabel(screen.title)
    }
}
