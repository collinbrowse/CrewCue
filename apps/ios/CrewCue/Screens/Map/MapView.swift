import CoreLocation
import SwiftUI
import CrewCueClientCore

enum MapTool: String, Hashable {
    case none
    case pick
    case navigate
    case location

    static func forFocus(_ focus: String) -> MapTool {
        switch focus {
        case "map-checkpoint-pick": .pick
        case "map-navigate": .navigate
        case "location-heartbeat": .location
        default: .none
        }
    }

    var title: String {
        switch self {
        case .none: "Aid stations"
        case .pick: "Place checkpoint"
        case .navigate: "Navigate"
        case .location: "Tracking"
        }
    }
}

/// Course map tab. The shell activates `MapModel` so progress is live on every tab.
struct MapView: View {
    @Bindable var model: MapModel
    var focus: String = "map-track"
    /// The race's name, in the top bar.
    var title: String = "CrewCue"
    var onSettings: () -> Void = {}
    /// The race isn't unlocked: a banner under the top bar.
    var access: RaceAccess? = nil
    /// The runner's unpaid race: the banner and Start tracking open the paywall instead.
    var onUnlock: (() -> Void)? = nil
    /// The onboarding replay: the course, the runner and the aid sheet only. No top bar and no map
    /// tools (placing a checkpoint, navigating, tracking), since the replay never writes.
    var readOnly = false
    /// The onboarding replay's course line, the one its runner follows. Empty on the race map:
    /// the line is the race's saved GPX (else the checkpoints joined).
    var route: [CLLocationCoordinate2D] = []
    /// The onboarding replay's runner between updates: the dot glides along the course. Nil on
    /// the race map, where the dot is the runner's latest ping.
    var glide: RunnerGlide? = nil
    /// The replay plays and its Map is on screen (not under Pace or Chat): the dot glides frame by
    /// frame. Otherwise it holds where the replay is.
    var glidePlaying = false
    /// The onboarding replay: how many pings the runner's path holds. The replay's path adds
    /// points along the course between pings, so the path chip counts the pings, as on a race,
    /// where every path point is a ping. Nil on the race map.
    var pathPings: Int? = nil
    /// The runner's setup checklist, under the top bar until it is done or hidden.
    var checklist: SetupChecklistCardConfig? = nil
    @State private var tool = MapTool.none
    /// The map style has loaded or failed. Until then a loader sits over the map.
    @State private var styleSettled = false
    /// Window-space edges the crosshair sits between: the top bar's bottom and the sheet's top.
    @State private var barBottom: CGFloat = 0
    @State private var sheetTop: CGFloat = 0
    @State private var sheetBottom: CGFloat = 0
    @State private var mapFrame: CGRect = .zero
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .bottom) {
            MapCanvas(
                points: model.points,
                track: model.trackCoordinates,
                trackTimes: glide == nil ? [] : model.track.points.map(\.recordedAt),
                route: readOnly ? route : model.route,
                glide: glide,
                glidePlaying: glidePlaying,
                recenterRequest: model.recenterRequest,
                replay: readOnly,
                baseStyle: readOnly ? .automatic : model.baseMap,
                pickAnchor: tool == .pick ? crosshair : nil,
                pickTarget: model.pickTarget,
                pickCoordinate: CoordinateText.parse(model.coordinateText).map {
                    CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
                },
                onPickCenter: { latitude, longitude in
                    model.selectCoordinate(latitude: latitude, longitude: longitude)
                },
                runnerCoordinate: readOnly ? nil : model.runnerCoordinate,
                runnerFocusRequest: model.runnerFocusRequest,
                focusAnchor: crosshair,
                startLine: readOnly ? nil : model.startLineCoordinate,
                startLineRequest: model.startLineRequest,
                hidesAttributionButton: !readOnly,
                onStyleFailure: { offline in
                    styleSettled = true
                    model.noteStyleFailure(offline: offline)
                },
                onStyleLoaded: {
                    styleSettled = true
                    model.noteStyleLoaded()
                }
            )
            .ignoresSafeArea()
            .overlay {
                if MapCanvas.available && !styleSettled {
                    CairnLoader(onLight: scheme == .light)
                        .frame(width: 64, height: 64)
                        .accessibilityIdentifier("crewcue.map-loading")
                        .allowsHitTesting(false)
                }
            }
            MapOverlayControls(
                model: model, tool: $tool, title: title, onSettings: onSettings, access: access, onUnlock: onUnlock ?? {},
                readOnly: readOnly, pathPings: pathPings, part: .chips,
                onBarBottom: { _ in }
            )
            .padding(.top, CrewSpace.stackSm)
            .frame(maxHeight: .infinity, alignment: .top)
            .avoidsReservedRegions(when: readOnly)
            MapAidSheet(model: model, tool: $tool, onUnlock: onUnlock, maxHeight: max(0, sheetBottom - barBottom - CrewSpace.stackSm))
                .padding(.horizontal, 8)
                // The replay's Map is a pane a fold can run through: its sheet and chips stay off
                // the fold while the canvas under them stays full-bleed.
                .avoidsReservedRegions(when: readOnly)
                // Below a camera column (iPhone Duo's outer display) the sheet runs to the edge.
                // Expanded, or open on Navigate, its top can reach beside the column: it then
                // narrows to keep clear of it, quickly, and opens again with a spring.
                .fullWidthClearOfOcclusions()
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: {
                    sheetTop = $0.minY
                    sheetBottom = $0.maxY
                }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            MapOverlayControls(
                model: model, tool: $tool, title: title, onSettings: onSettings, access: access, onUnlock: onUnlock ?? {},
                readOnly: readOnly, pathPings: pathPings, part: .bar,
                checklist: readOnly ? nil : checklist,
                checklistListHeight: sheetTop - barBottom - 140,
                onBarBottom: { barBottom = $0 }
            )
            .avoidsReservedRegions(when: readOnly)
        }
        .overlay {
            if tool == .pick, let crosshair {
                PickCrosshair()
                    .position(x: crosshair.x - mapFrame.minX, y: crosshair.y - mapFrame.minY)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { mapFrame = $0 }
        .overlay(alignment: .bottom) {
            // Just above the aid sheet, clear of the chips under the top bar.
            if let note = model.mapNote {
                Text(verbatim: note)
                    .font(CrewFont.body)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .crewGlass(in: Capsule())
                    .padding(.bottom, max(0, mapFrame.maxY - sheetTop) + CrewSpace.stackSm)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .allowsHitTesting(false)
                    .accessibilityIdentifier("crewcue.map-note")
            }
        }
        .animation(.snappy, value: model.mapNote)
        .onChange(of: tool) { old, _ in
            // Closing the place-checkpoint sheet (saved or not) clears its form for the next one.
            if old == .pick { model.resetPick() }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.map")
        .accessibilityLabel("Map")
        .task(id: focus) {
            tool = MapTool.forFocus(focus)
        }
        .animation(.snappy, value: tool)
    }

    /// Where the crosshair sits, in window coordinates: across the middle of the map, halfway
    /// between the top bar and the sheet. Nil until both are laid out.
    private var crosshair: CGPoint? {
        guard mapFrame.width > 0, sheetTop > barBottom + 40 else { return nil }
        return CGPoint(x: mapFrame.midX, y: (barBottom + sheetTop) / 2)
    }
}

/// The X the map moves under while placing a checkpoint: the checkpoint goes where it points.
private struct PickCrosshair: View {
    @Environment(\.crew) private var theme

    var body: some View {
        ZStack {
            Image(systemName: "xmark")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
            Image(systemName: "xmark")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(theme.primary)
        }
        .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
        .accessibilityHidden(true)
        .accessibilityIdentifier("crewcue.map-crosshair")
    }
}

/// Glass top bar, status chips, and the round map buttons that float over the course.
private struct MapOverlayControls: View {
    var model: MapModel
    @Binding var tool: MapTool
    var title: String
    var onSettings: () -> Void
    var access: RaceAccess?
    var onUnlock: () -> Void
    var readOnly = false
    var pathPings: Int?
    /// The top bar (and race banner) sits in the top safe area; the chips and map buttons sit
    /// on the map, under the aid sheet when it opens all the way.
    var part: Part
    var checklist: SetupChecklistCardConfig? = nil
    var checklistListHeight: CGFloat = .infinity
    var onBarBottom: (CGFloat) -> Void
    @Environment(\.crew) private var theme

    enum Part { case bar, chips }

    var body: some View {
        switch part {
        case .bar: bar
        case .chips: chips
        }
    }

    private var bar: some View {
        VStack(spacing: CrewSpace.stackSm) {
            if !readOnly {
                CrewTopBar(title: title, onSettings: onSettings)
                    .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
                    .padding(.horizontal, 8)
                    .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { onBarBottom($0) }
            }
            if let access {
                RaceAccessBanner(access: access, onUnlock: onUnlock)
                    .padding(.horizontal, CrewSpace.gutter)
            }
            if let checklist {
                SetupChecklistCard(config: checklist, maxListHeight: checklistListHeight)
                    .padding(.horizontal, CrewSpace.gutter)
                    .transition(.opacity)
            }
        }
        // The replay has no bar: report its top edge so the crosshair math still has one.
        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { if readOnly { onBarBottom($0) } }
    }

    private var chips: some View {
        HStack(alignment: .top, spacing: CrewSpace.base) {
            if !readOnly {
                // Under the runner in the top bar: map licensing, then the runner and layers buttons.
                VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                    MapLicensingButton()
                    runnerButton
                    mapTools
                }
                .padding(.leading, -2)
                .zIndex(1)
            }
            if model.readout.statusLabel.isEmpty == false {
                StatusChip(text: model.readout.statusLabel, style: model.readout.status == .behind ? .soft : .filled)
                    .accessibilityLabel("Status \(model.readout.statusLabel)")
            }
            Spacer()
            VStack(alignment: .trailing, spacing: CrewSpace.stackSm) {
                StatusChip(text: model.readout.pingLabel, style: .glass, dot: model.readout.pingState == .live)
                    .accessibilityLabel(pingAccessibility)
                StatusChip(text: trackLabel, style: .glass)
                    .accessibilityIdentifier("crewcue.runner-track")
                    .accessibilityLabel(trackAccessibility)
            }
        }
        .padding(.horizontal, CrewSpace.gutter)
    }

    private static let buttonSize: CGFloat = 40

    /// Zooms to the runner's latest ping. Dimmed until the runner's phone sends one; a tap then
    /// says so in a note beside the button instead of moving the map.
    private var runnerButton: some View {
        let tracking = model.runnerCoordinate != nil
        return Button(action: model.focusRunner) {
            Image(systemName: "scope")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(theme.primary)
                .frame(width: Self.buttonSize, height: Self.buttonSize)
                .opacity(tracking ? 1 : 0.4)
        }
        .buttonStyle(.plain)
        .crewGlass(in: Circle(), interactive: true)
        .accessibilityLabel("Zoom to runner")
        .accessibilityValue(tracking ? "" : "The runner isn't tracking yet")
        .accessibilityIdentifier("crewcue.map-runner")
        // Beside the button, over the map: it moves nothing else.
        .overlay(alignment: .leading) {
            if let note = model.runnerNote {
                Text(verbatim: note)
                    .font(CrewFont.body)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .crewGlass(in: Capsule())
                    .fixedSize()
                    .offset(x: Self.buttonSize + CrewSpace.stackSm)
                    .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .leading)))
                    .accessibilityIdentifier("crewcue.map-runner-note")
            }
        }
        .animation(.snappy, value: model.runnerNote)
    }

    /// The base map, and the map tools (place checkpoint, navigate, tracking). Not in the replay.
    private var mapTools: some View {
        Menu {
            Section("Base map") {
                Picker("Base map", selection: Binding(get: { model.baseMap }, set: { model.baseMap = $0 })) {
                    ForEach(MapBaseStyle.allCases) { style in
                        Label(style.title, systemImage: style.systemImage).tag(style)
                    }
                }
            }
            Section("Map tools") {
                Picker("Map tool", selection: $tool) {
                    Label("Aid stations", systemImage: "flag").tag(MapTool.none)
                    Label("Place checkpoint", systemImage: "mappin.and.ellipse").tag(MapTool.pick)
                    Label("Navigate", systemImage: "arrow.triangle.turn.up.right.diamond").tag(MapTool.navigate)
                    Label("Tracking", systemImage: "location.circle").tag(MapTool.location)
                }
            }
        } label: {
            Image(systemName: "square.3.layers.3d")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: Self.buttonSize, height: Self.buttonSize)
                .foregroundStyle(theme.primary)
        }
        .crewGlass(in: Circle(), interactive: true)
        .accessibilityLabel("Map layers and tools")
        .accessibilityIdentifier("crewcue.map-tools")
    }

    /// The runner's path drawn on the map, from the API: one point per ping (the replay's count).
    private var trackLabel: String {
        let count = trackCount
        return count == 0 ? "NO PATH YET" : "PATH · \(count) \(count == 1 ? "POINT" : "POINTS")"
    }

    private var trackAccessibility: String {
        let count = trackCount
        return count == 0 ? "No runner path yet" : "Runner path, \(count) points"
    }

    private var trackCount: Int {
        model.track.points.isEmpty ? 0 : pathPings ?? model.track.points.count
    }

    private var pingAccessibility: String {
        switch model.readout.pingState {
        case .none: return "No runner ping yet"
        case .live: return "Runner \(model.readout.pingLabel.lowercased())"
        case .stale: return "Runner signal is stale. \(model.readout.pingLabel.lowercased())"
        }
    }
}

struct AidPager: View {
    @Bindable var model: MapModel
    @ScaledMetric private var height: CGFloat = 200
    /// The page on show, kept on the model's aid. Only the person picks an aid: a drag, or
    /// VoiceOver's scroll. A pager laid out again (built with its pages already there by a display
    /// switch or a map tool closing, or at a new width after a rotation) lands on whatever page its
    /// layout gives, often the first; it is put back on the model's aid, so it never selects Start
    /// and stops the sheet following the next aid station.
    @State private var position: Int?
    /// The person is dragging the pager, or it is settling from their drag.
    @State private var dragging = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    ForEach(model.aidPages) { page in
                        AidPeek(page: page, averagePace: model.readout.averagePaceLabel)
                            .frame(maxHeight: .infinity, alignment: .top)
                            .containerRelativeFrame(.horizontal)
                            .id(page.index)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $position)
            .onScrollPhaseChange { _, phase in
                switch phase {
                case .interacting, .decelerating:
                    dragging = true
                case .idle:
                    if dragging { select(position) }
                    dragging = false
                case .tracking, .animating:
                    // A touch that hasn't moved yet, or a scroll that isn't the person's drag
                    // (the pager's own, or a layout's): neither picks an aid.
                    break
                @unknown default:
                    break
                }
            }
            .onChange(of: position) { _, value in
                if dragging {
                    select(value)
                } else if value != shown {
                    show(shown, proxy)
                }
            }
            .onChange(of: shown, initial: true) { _, index in
                if !dragging { show(index, proxy) }
            }
            // The pages laid out at a new width move under the pager without a report: back to
            // the model's aid.
            .onScrollGeometryChange(for: CGSize.self) { geometry in
                CGSize(width: geometry.containerSize.width, height: geometry.contentSize.width)
            } action: { _, _ in
                if !dragging { show(shown, proxy) }
            }
            .accessibilityScrollAction { edge in
                switch edge {
                case .leading: step(-1)
                case .trailing: step(1)
                default: break
                }
            }
        }
        .frame(height: height)
    }

    /// The model's aid: the next aid station while the sheet follows the runner.
    private var shown: Int? { model.aidPages.isEmpty ? nil : model.aidIndex }

    private func show(_ index: Int?, _ proxy: ScrollViewProxy) {
        position = index
        if let index { proxy.scrollTo(index, anchor: .leading) }
    }

    private func select(_ value: Int?) {
        guard let value, value != model.aidIndex else { return }
        model.showAid(index: value)
    }

    /// VoiceOver's three-finger scroll: the next or previous page.
    private func step(_ delta: Int) {
        let next = model.aidIndex + delta
        guard model.aidPages.indices.contains(next) else { return }
        model.showAid(index: next)
    }
}

struct AidPeek: View {
    let page: AidStationPage
    var averagePace: String = "—"
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            HStack(alignment: .top, spacing: CrewSpace.stackSm) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: kicker)
                        .crewKicker()
                        .foregroundStyle(theme.primary)
                    Text(verbatim: page.title.capitalized)
                        .font(CrewFont.headline)
                        .foregroundStyle(theme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(verbatim: CrewClock.short(page.arrivalAt) ?? page.clockLabel)
                        .font(CrewFont.metricLarge)
                        .foregroundStyle(theme.primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("EST. ARRIVAL")
                        .font(CrewFont.kicker)
                        .tracking(1)
                        .foregroundStyle(theme.body)
                    Text(verbatim: page.remainLabel)
                        .font(CrewFont.title.monospacedDigit())
                        .foregroundStyle(theme.onPrimarySoft)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(theme.primarySoft, in: Capsule())
                }
            }
            Divider().overlay(theme.divider)
            HStack(alignment: .top, spacing: 0) {
                MetricColumn(label: "Distance\nremaining", value: page.distanceLabel.uppercased())
                MetricDivider()
                MetricColumn(label: "Elevation\nremaining", value: page.elevationLabel ?? "—")
                MetricDivider()
                MetricColumn(label: "Avg\npace", value: averagePace)
            }
        }
        .padding(.horizontal, CrewSpace.margin)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(page.scheduleLine)
        // The eyebrow ("Next aid station"), which the schedule line leaves out.
        .accessibilityValue(Text(verbatim: kicker))
        .accessibilityIdentifier("crewcue.aid-page")
    }

    private var kicker: String {
        switch page.kicker {
        case "NEXT": "Next aid station"
        case "START": "Start"
        case "FINISHED": "Finished"
        default: page.kicker
        }
    }
}

private struct MetricDivider: View {
    @Environment(\.crew) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.divider)
            .frame(width: 1, height: 52)
    }
}

/// Bottom sheet on the map: aid station pager by default, or the active map tool.
///
/// The aid sheet has three heights: closed (one row, the next aid and its arrival), half (the
/// pager) and open (the pager and the details). A drag moves it with the finger, point for
/// point; on lift it settles at the nearest height, taking the flick's speed into account.
struct MapAidSheet: View {
    @Bindable var model: MapModel
    @Binding var tool: MapTool
    /// Set on the runner's unpaid race: Start tracking opens the paywall (pings answer 402 there).
    var onUnlock: (() -> Void)? = nil
    /// The most the sheet may grow to: the room between the top bar and the sheet's bottom.
    var maxHeight: CGFloat = .infinity
    @Environment(\.crew) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The finger's travel since the drag began (down is positive). Zero between drags.
    @State private var drag: CGFloat = 0
    /// The gesture is a vertical drag of the sheet (not a swipe through the pager), decided on
    /// its first movement.
    @State private var dragAxis: DragAxis?
    /// Measured content heights for the three detents.
    @State private var handleHeight: CGFloat = 31
    @State private var compactHeight: CGFloat = 56
    @State private var halfHeight: CGFloat = 240
    @State private var openHeight: CGFloat = 420

    private enum DragAxis { case vertical, horizontal }

    var body: some View {
        Group {
            if tool == .none {
                aidSheet
            } else {
                VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                    handle(interactive: false)
                    toolContent
                }
                .padding(.bottom, CrewSpace.gutter)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlass(in: UnevenRoundedRectangle(
            topLeadingRadius: CrewRadius.sheet,
            bottomLeadingRadius: CrewRadius.card,
            bottomTrailingRadius: CrewRadius.card,
            topTrailingRadius: CrewRadius.sheet,
            style: .continuous
        ))
        .shadow(color: theme.shadow, radius: 20, y: -2)
    }

    // MARK: Aid sheet

    private var aidSheet: some View {
        let height = currentHeight
        let pager = pagerVisibility(at: height)
        return VStack(alignment: .leading, spacing: 0) {
            handle(interactive: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { handleHeight = $0 }
            ZStack(alignment: .top) {
                VStack(alignment: .leading, spacing: CrewSpace.gutter) {
                    pagerSection
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { halfHeight = $0 }
                    if !model.aidPages.isEmpty {
                        expandedDetails
                    }
                }
                .padding(.top, CrewSpace.base)
                .padding(.bottom, CrewSpace.gutter)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { openHeight = $0 }
                .opacity(pager)
                .allowsHitTesting(pager > 0.5)
                .accessibilityHidden(pager < 0.5)
                compactRow
                    .padding(.top, CrewSpace.base)
                    .padding(.bottom, CrewSpace.gutter + 4)
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { compactHeight = $0 }
                    .opacity(1 - pager)
                    .allowsHitTesting(pager <= 0.5)
                    .accessibilityHidden(pager >= 0.5)
            }
        }
        .frame(height: height, alignment: .top)
        .clipped()
        .contentShape(Rectangle())
        .simultaneousGesture(sheetDrag)
        .accessibilityIdentifier("crewcue.aid-sheet")
    }

    /// The sheet's grab handle. A tap steps it open (closed → half → open → half).
    private func handle(interactive: Bool) -> some View {
        Capsule()
            .fill(theme.outline.opacity(0.45))
            .frame(width: 44, height: 5)
            .frame(maxWidth: .infinity)
            .padding(.top, 10)
            .padding(.bottom, interactive ? 6 : 0)
            .contentShape(Rectangle())
            .onTapGesture {
                guard interactive else { return }
                settle(at: model.sheetDetent == .half ? .open : (model.sheetDetent == .open ? .half : .half))
            }
            .accessibilityElement()
            .accessibilityLabel("Aid station details")
            .accessibilityValue(detentDescription)
            .accessibilityAddTraits(interactive ? .isButton : [])
            .accessibilityAdjustableAction { direction in
                guard interactive else { return }
                let detents = MapSheetDetent.allCases
                let index = detents.firstIndex(of: model.sheetDetent) ?? 1
                switch direction {
                case .increment: settle(at: detents[min(detents.count - 1, index + 1)])
                case .decrement: settle(at: detents[max(0, index - 1)])
                @unknown default: break
                }
            }
            .accessibilityIdentifier("crewcue.aid-sheet-handle")
    }

    private var detentDescription: String {
        switch model.sheetDetent {
        case .closed: "Closed"
        case .half: "Half open"
        case .open: "Open"
        }
    }

    @ViewBuilder
    private var pagerSection: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            if model.aidPages.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Next aid station")
                        .crewKicker()
                        .foregroundStyle(theme.primary)
                    Text(verbatim: model.mapMessage.isEmpty ? "No aid stations yet." : model.mapMessage)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.body)
                }
                .padding(.horizontal, CrewSpace.margin)
            } else {
                AidPager(model: model)
                if model.mapMessage.isEmpty == false {
                    Text(verbatim: model.mapMessage)
                        .font(CrewFont.body)
                        .foregroundStyle(theme.body)
                        .padding(.horizontal, CrewSpace.margin)
                }
            }
        }
    }

    /// The closed sheet's one row: the next aid station and the runner's estimated arrival.
    private var compactRow: some View {
        let page = model.aidPages.indices.contains(model.aidIndex) ? model.aidPages[model.aidIndex] : nil
        return HStack(alignment: .firstTextBaseline, spacing: CrewSpace.stackSm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: page.map { Self.kicker($0.kicker) } ?? "Next aid station")
                    .crewKicker()
                    .foregroundStyle(theme.primary)
                Text(verbatim: page?.title.capitalized ?? (model.mapMessage.isEmpty ? "No aid stations yet." : model.mapMessage))
                    .font(CrewFont.title)
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 8)
            if let page {
                VStack(alignment: .trailing, spacing: 2) {
                    Text("EST. ARRIVAL")
                        .font(CrewFont.kicker)
                        .tracking(1)
                        .foregroundStyle(theme.body)
                    Text(verbatim: CrewClock.short(page.arrivalAt) ?? page.clockLabel)
                        .font(CrewFont.title.monospacedDigit())
                        .foregroundStyle(theme.primary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.horizontal, CrewSpace.margin)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("crewcue.aid-compact")
    }

    private static func kicker(_ raw: String) -> String {
        switch raw {
        case "NEXT": "Next aid station"
        case "START": "Start"
        case "FINISHED": "Finished"
        default: raw
        }
    }

    // MARK: Heights and the drag

    private func height(for detent: MapSheetDetent) -> CGFloat {
        let closed = handleHeight + compactHeight
        let half = max(closed, handleHeight + halfHeight + CrewSpace.base + CrewSpace.gutter)
        switch detent {
        case .closed: return closed
        case .half: return half
        case .open:
            let full = model.aidPages.isEmpty ? half : max(half, handleHeight + openHeight)
            return maxHeight > half ? min(full, maxHeight) : full
        }
    }

    /// The sheet's height now: its detent, moved by the finger. Past the closed or open height
    /// it gives a little, with resistance.
    private var currentHeight: CGFloat {
        let resting = height(for: model.sheetDetent)
        let low = height(for: .closed)
        let high = height(for: .open)
        let raw = resting - drag
        if raw < low { return low - Self.rubber(low - raw) }
        if raw > high { return high + Self.rubber(raw - high) }
        return raw
    }

    private static func rubber(_ overshoot: CGFloat) -> CGFloat {
        let limit: CGFloat = 60
        return limit * (1 - 1 / (overshoot / limit + 1))
    }

    /// How much of the pager shows (1) against the closed row (0), between those two heights.
    private func pagerVisibility(at current: CGFloat) -> Double {
        let closed = height(for: .closed)
        let half = height(for: .half)
        guard half > closed else { return 1 }
        return Double(min(1, max(0, (current - closed) / (half - closed))))
    }

    private var sheetDrag: some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { value in
                if dragAxis == nil {
                    let dx = abs(value.translation.width)
                    let dy = abs(value.translation.height)
                    dragAxis = dy >= dx ? .vertical : .horizontal
                }
                guard dragAxis == .vertical else { return }
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { drag = value.translation.height }
            }
            .onEnded { value in
                defer { dragAxis = nil }
                guard dragAxis == .vertical else { return }
                // Where the flick would carry the sheet, so a quick swipe goes on to the next height.
                let projected = height(for: model.sheetDetent) - value.predictedEndTranslation.height
                let target = MapSheetDetent.allCases.min { a, b in
                    abs(height(for: a) - projected) < abs(height(for: b) - projected)
                } ?? .half
                settle(at: target, releasedAt: value.translation.height)
            }
    }

    /// Animates to `detent`. With `releasedAt`, the spring starts from where the finger let go.
    private func settle(at detent: MapSheetDetent, releasedAt translation: CGFloat? = nil) {
        let animation: Animation = reduceMotion ? .easeOut(duration: 0.2) : .interpolatingSpring(stiffness: 420, damping: 38)
        withAnimation(animation) {
            if model.aidPages.isEmpty && detent == .open {
                model.sheetDetent = .half
            } else {
                model.sheetDetent = detent
            }
            drag = 0
        }
    }

    @ViewBuilder
    private var expandedDetails: some View {
        let page = model.aidPages.indices.contains(model.aidIndex) ? model.aidPages[model.aidIndex] : nil
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
                HStack {
                    Text("Course progress")
                        .crewKicker()
                        .foregroundStyle(theme.body)
                    Spacer()
                    Text(verbatim: model.readout.progressLabel)
                        .font(CrewFont.title.monospacedDigit())
                }
                CrewProgressBar(fraction: model.readout.progressFraction)
            }
            .padding(CrewSpace.margin)
            .background(theme.well.opacity(0.85), in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
            if let page {
                HStack(spacing: 0) {
                    MetricColumn(label: "Planned stop", value: page.stoppageDurationLabel)
                    MetricColumn(label: "Elapsed", value: page.elapsedLabel)
                    MetricColumn(label: "Delay", value: page.delayLabel ?? "—")
                }
            }
            if model.aidFollow == false, let live = model.aidLiveNextIndex, live != model.aidIndex {
                Button("Next station", action: model.jumpToNextAid)
                    .buttonStyle(.crewSecondary)
            }
        }
        .padding(.horizontal, CrewSpace.margin)
    }

    // MARK: Map tools

    @ViewBuilder
    private var toolContent: some View {
        VStack(alignment: .leading, spacing: CrewSpace.stackSm) {
            HStack {
                Text(verbatim: tool.title)
                    .font(CrewFont.headline)
                Spacer()
                Button {
                    withAnimation(.snappy) { tool = .none }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(.body, weight: .bold))
                        .frame(width: 36, height: 36)
                        .background(theme.secondaryButton, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close \(tool.title)")
            }
            switch tool {
            case .none:
                EmptyView()
            case .pick:
                MapPickSection(
                    coordinate: $model.coordinateText,
                    title: $model.checkpointTitle,
                    invalid: model.coordinateInvalid,
                    message: model.pickMessage,
                    isBusy: model.pickBusy,
                    onSave: {
                        if await model.placeCheckpoint() {
                            withAnimation(.snappy) { tool = .none }
                        }
                    }
                )
            case .navigate:
                ScrollView {
                    MapNavigateSection(
                        origin: $model.originId,
                        destination: $model.destinationId,
                        mode: $model.routeMode,
                        points: model.points,
                        message: model.navigateMessage,
                        isBusy: model.navigateBusy,
                        onStart: model.startNavigation
                    )
                }
                .frame(maxHeight: 360)
            case .location:
                MapLocationSection(
                    message: model.locationMessage,
                    isAthlete: model.isAthlete,
                    isTracking: model.trackingActive,
                    intervalText: MapModel.intervalText(model.trackingIntervalSeconds),
                    onStart: onUnlock ?? model.startTracking,
                    onStop: model.stopTracking
                )
            }
        }
        .padding(.horizontal, CrewSpace.margin)
    }
}

struct MapCanvas: View {
    #if canImport(MapLibre)
    static let available = true
    #else
    static let available = false
    #endif

    let points: [MapCoursePoint]
    var track: [CLLocationCoordinate2D] = []
    var trackTimes: [Date] = []
    var route: [CLLocationCoordinate2D] = []
    var glide: RunnerGlide? = nil
    var glidePlaying = false
    var recenterRequest = 0
    /// The onboarding replay: no top bar to clear, and a pane that a fold or a size change
    /// resizes, so the course is framed again when it does.
    var replay = false
    var baseStyle = MapBaseStyle.automatic
    var pickAnchor: CGPoint? = nil
    var pickTarget: PickTarget? = nil
    var pickCoordinate: CLLocationCoordinate2D? = nil
    var onPickCenter: ((Double, Double) -> Void)? = nil
    var runnerCoordinate: CLLocationCoordinate2D? = nil
    var runnerFocusRequest = 0
    var focusAnchor: CGPoint? = nil
    var startLine: CLLocationCoordinate2D? = nil
    var startLineRequest = 0
    var hidesAttributionButton = false
    var onTap: (Double, Double) -> Void = { _, _ in }
    @Environment(\.crew) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onStyleFailure: (Bool) -> Void
    let onStyleLoaded: () -> Void

    var body: some View {
        #if canImport(MapLibre)
        if let glide {
            // The onboarding replay: a frame on every display refresh while it plays, so the dot
            // glides along the course. Paused it holds; with Reduce Motion it steps at each update.
            TimelineView(.animation(minimumInterval: nil, paused: reduceMotion || !glidePlaying)) { _ in
                map(glideFrame: reduceMotion ? nil : glide.frame())
            }
        } else {
            map(glideFrame: nil)
        }
        #else
        EmptyView()
        #endif
    }

    #if canImport(MapLibre)
    private func map(glideFrame: RunnerGlideFrame?) -> some View {
        var map = MapLibreCourseMap(
            points: points,
            track: track,
            trackTimes: trackTimes,
            glideFrame: glideFrame,
            onTap: onTap,
            onStyleFailure: onStyleFailure,
            onStyleLoaded: onStyleLoaded,
            recenterRequest: recenterRequest,
            lineColor: UIColor(theme.primary),
            trackColor: UIColor(theme.secondary),
            route: route,
            fitPadding: replay ? MapLibreCourseMap.replayFitPadding : MapLibreCourseMap.raceFitPadding,
            refitOnResize: replay,
            shrinksPaddingToFit: replay,
            baseStyle: baseStyle,
            pickAnchor: pickAnchor,
            onPickCenter: onPickCenter,
            pickTarget: pickTarget,
            pickCoordinate: pickCoordinate,
            runnerCoordinate: runnerCoordinate,
            runnerFocusRequest: runnerFocusRequest,
            focusAnchor: focusAnchor
        )
        map.hidesAttributionButton = hidesAttributionButton
        map.startLine = startLine
        map.startLineRequest = startLineRequest
        return map
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel("Course map")
    }
    #endif
}

/// Placing a checkpoint: the map moves under the crosshair, or a position is typed or pasted
/// into the one coordinate field.
struct MapPickSection: View {
    @Binding var coordinate: String
    @Binding var title: String
    var invalid = false
    let message: String
    let isBusy: Bool
    let onSave: () async -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Drag the map to put the X where the checkpoint goes, or paste a position.")
                .font(CrewFont.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            MapCoordinateField(title: "Latitude, longitude", text: $coordinate)
            if invalid {
                Text("Enter latitude and longitude, like 39.2450, -120.2500.")
                    .font(CrewFont.body)
                    .foregroundStyle(theme.danger)
                    .accessibilityIdentifier("crewcue.map-coordinate-invalid")
            }
            TextField("Title", text: $title)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.words)
                .submitLabel(.done)
                .accessibilityLabel("Checkpoint title")
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(CrewFont.bodyLarge)
            }
            Button("Save checkpoint") {
                Task { await onSave() }
            }
            .buttonStyle(.crewPrimary)
            .crewBusy(isBusy)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.map-checkpoint-pick")
        .accessibilityLabel("Pick checkpoint")
    }
}

struct MapCoordinateField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        TextField(title, text: $text)
            .font(CrewFont.bodyLarge.monospacedDigit())
            .textFieldStyle(.crew)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.numbersAndPunctuation)
            .submitLabel(.done)
            .accessibilityLabel(title)
            .accessibilityHint("Paste or type a position, like 39.2450, -120.2500")
            .accessibilityIdentifier("crewcue.map-coordinate")
    }
}

struct MapNavigateSection: View {
    @Binding var origin: String
    @Binding var destination: String
    @Binding var mode: String
    let points: [MapCoursePoint]
    let message: String
    let isBusy: Bool
    let onStart: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Origin", text: $origin)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Origin")
            TextField("Destination", text: $destination)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Destination")
            Picker("Mode", selection: $mode) {
                Text("Hike").tag("hike")
                Text("Drive").tag("drive")
            }
            .pickerStyle(.segmented)
            .accessibilityLabel("Route mode")
            ForEach(points) { point in
                MapCheckpointChoice(
                    title: point.title,
                    onOrigin: { origin = point.id },
                    onDestination: { destination = point.id }
                )
            }
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(CrewFont.bodyLarge)
            }
            Button("Start navigation") {
                Task { await onStart() }
            }
            .buttonStyle(.crewPrimary)
            .crewBusy(isBusy)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.map-navigate")
        .accessibilityLabel("Navigate")
    }
}

struct MapCheckpointChoice: View {
    let title: String
    let onOrigin: () -> Void
    let onDestination: () -> Void

    var body: some View {
        HStack {
            Text(verbatim: title)
                .font(CrewFont.bodyLarge)
            Spacer()
            Button("Origin", action: onOrigin)
                .accessibilityLabel("Origin \(title)")
            Button("Destination", action: onDestination)
                .accessibilityLabel("Destination \(title)")
        }
    }
}

struct MapLocationSection: View {
    let message: String
    let isAthlete: Bool
    let isTracking: Bool
    let intervalText: String
    let onStart: () -> Void
    let onStop: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if isAthlete {
                Text(verbatim: message)
                    .font(CrewFont.bodyLarge)
                Text(verbatim: "Your phone sends your position every \(intervalText), saving it while you have no service and sending it all when you're back in range. Change the interval in Settings.")
                    .font(CrewFont.body)
                if isTracking {
                    Button("Stop tracking", action: onStop)
                        .buttonStyle(.crewSecondary)
                        .accessibilityHint("Stops sharing your position with your crew")
                } else {
                    Button("Start tracking", action: onStart)
                        .buttonStyle(.crewPrimary)
                        .accessibilityHint("Shares your position with your crew until the finish")
                }
            } else {
                Text(verbatim: "Location comes from the runner's phone. This phone never shares its own position.")
                    .font(CrewFont.bodyLarge)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.location-heartbeat")
        .accessibilityLabel("Location")
    }
}


/// The small info button under the top bar: who the base map comes from, with a link to each
/// source's license. Required by the map data's licenses (ODbL, OpenMapTiles).
private struct MapLicensingButton: View {
    @State private var open = false
    @Environment(\.crew) private var theme

    var body: some View {
        Button { open = true } label: {
            Image(systemName: "info")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(theme.primary)
                .frame(width: 28, height: 28)
                .crewGlass(in: Circle(), interactive: true)
                .frame(width: 40, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Map licensing")
        .accessibilityIdentifier("crewcue.map-attribution")
        .popover(isPresented: $open, attachmentAnchor: .rect(.bounds), arrowEdge: .top) {
            MapLicensing()
                .presentationCompactAdaptation(.popover)
        }
    }
}

private struct MapLicensing: View {
    private struct Source: Identifiable {
        let name: String
        let role: String
        let url: String
        var id: String { name }
    }

    private let sources = [
        Source(name: "OpenStreetMap contributors", role: "Map data, ODbL license", url: "https://www.openstreetmap.org/copyright"),
        Source(name: "OpenMapTiles", role: "Map tile schema", url: "https://openmaptiles.org/"),
        Source(name: "OpenFreeMap", role: "Map tiles and styles", url: "https://openfreemap.org/")
    ]
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Map licensing")
                    .font(CrewFont.title)
                Text("The base map is built from open data. Tap a source to read its license.")
                    .font(CrewFont.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(sources) { source in
                if let url = URL(string: source.url) {
                    Link(destination: url) {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: "© \(source.name)")
                                    .font(CrewFont.bodyLarge)
                                    .foregroundStyle(theme.primary)
                                Text(verbatim: source.role)
                                    .font(CrewFont.body)
                                    .foregroundStyle(.secondary)
                            }
                            .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .accessibilityHint("Opens the license in Safari")
                }
            }
        }
        .padding(16)
        .frame(width: 300, alignment: .leading)
        .accessibilityIdentifier("crewcue.map-licensing")
    }
}
