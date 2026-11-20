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
    var onSettings: () -> Void = {}
    /// The race isn't unlocked: a banner under the top bar.
    var access: RaceAccess? = nil
    /// The runner's unpaid race: the banner and Start tracking open the paywall instead.
    var onUnlock: (() -> Void)? = nil
    /// The onboarding replay: the course, the runner and the aid sheet only. No top bar and no map
    /// tools (placing a checkpoint, navigating, tracking), since the replay never writes.
    var readOnly = false
    /// The onboarding replay's course line, the one its runner follows. Empty on the race map: the
    /// line joins the checkpoints.
    var route: [CLLocationCoordinate2D] = []
    /// The onboarding replay's runner between updates: the dot glides along the course. Nil on
    /// the race map, where the dot is the runner's latest ping.
    var glide: RunnerGlide? = nil
    /// The replay's Map is on screen (not under Pace or Chat), so the glide is worth drawing.
    var glideOnScreen = true
    @State private var tool = MapTool.none
    /// The map style has loaded or failed. Until then a loader sits over the map.
    @State private var styleSettled = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .bottom) {
            MapCanvas(
                points: model.points,
                track: model.trackCoordinates,
                trackTimes: glide == nil ? [] : model.track.points.map(\.recordedAt),
                route: route,
                glide: glide,
                glideOnScreen: glideOnScreen,
                recenterRequest: model.recenterRequest,
                replay: readOnly,
                onTap: { latitude, longitude in
                    model.selectCoordinate(latitude: latitude, longitude: longitude)
                },
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
            MapAidSheet(model: model, tool: $tool, onUnlock: onUnlock)
                .padding(.horizontal, 8)
                // The replay's Map is a pane a fold can run through: its sheet and chips stay off
                // the fold while the canvas under them stays full-bleed.
                .avoidsReservedRegions(when: readOnly)
                // Below a camera column (iPhone Duo's outer display) the sheet runs to the edge.
                // Expanded, or open on Navigate, its top can reach beside the column: it then
                // narrows to keep clear of it, quickly, and opens again with a spring.
                .fullWidthClearOfOcclusions()
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            MapOverlayControls(model: model, tool: $tool, onSettings: onSettings, access: access, onUnlock: onUnlock ?? {}, readOnly: readOnly)
                .avoidsReservedRegions(when: readOnly)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.map")
        .accessibilityLabel("Map")
        .task(id: focus) {
            tool = MapTool.forFocus(focus)
        }
    }
}

/// Glass top bar, status chips, and the round map buttons that float over the course.
private struct MapOverlayControls: View {
    var model: MapModel
    @Binding var tool: MapTool
    var onSettings: () -> Void
    var access: RaceAccess?
    var onUnlock: () -> Void
    var readOnly = false
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(spacing: CrewSpace.stackSm) {
            if !readOnly {
                CrewTopBar(onSettings: onSettings)
                    .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
                    .padding(.horizontal, 8)
            }
            if let access {
                RaceAccessBanner(access: access, onUnlock: onUnlock)
                    .padding(.horizontal, CrewSpace.gutter)
            }
            HStack(alignment: .top) {
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
                    CircleIconButton(systemImage: "scope", label: "Fit course") {
                        model.recenter()
                    }
                    if !readOnly {
                        mapTools
                    }
                }
            }
            .padding(.horizontal, CrewSpace.gutter)
        }
    }

    /// Place checkpoint, navigate and tracking. Not in the replay.
    private var mapTools: some View {
        Menu {
            Picker("Map tool", selection: $tool) {
                Label("Aid stations", systemImage: "flag").tag(MapTool.none)
                Label("Place checkpoint", systemImage: "mappin.and.ellipse").tag(MapTool.pick)
                Label("Navigate", systemImage: "arrow.triangle.turn.up.right.diamond").tag(MapTool.navigate)
                Label("Tracking", systemImage: "location").tag(MapTool.location)
            }
        } label: {
            Image(systemName: "square.3.layers.3d")
                .font(.system(size: 21, weight: .semibold))
                .frame(width: 52, height: 52)
                .foregroundStyle(theme.primary)
        }
        .crewGlass(in: Circle(), interactive: true)
        .accessibilityLabel("Map tools")
    }

    /// The runner's path drawn on the map, from the API.
    private var trackLabel: String {
        let count = model.track.points.count
        return count == 0 ? "NO PATH YET" : "PATH · \(count) \(count == 1 ? "POINT" : "POINTS")"
    }

    private var trackAccessibility: String {
        let count = model.track.points.count
        return count == 0 ? "No runner path yet" : "Runner path, \(count) points"
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
    @ScaledMetric private var height: CGFloat = 228
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
struct MapAidSheet: View {
    @Bindable var model: MapModel
    @Binding var tool: MapTool
    /// Set on the runner's unpaid race: Start tracking opens the paywall (pings answer 402 there).
    var onUnlock: (() -> Void)? = nil
    @Environment(\.crew) private var theme
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: CrewSpace.gutter) {
            Capsule()
                .fill(theme.outline.opacity(0.45))
                .frame(width: 44, height: 5)
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(.snappy) { expanded.toggle() } }
                .accessibilityLabel(expanded ? "Collapse details" : "Expand details")
                .accessibilityAddTraits(.isButton)
            if tool == .none {
                aidContent
            } else {
                toolContent
            }
        }
        .padding(.bottom, CrewSpace.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .crewGlass(in: UnevenRoundedRectangle(
            topLeadingRadius: CrewRadius.sheet,
            bottomLeadingRadius: CrewRadius.card,
            bottomTrailingRadius: CrewRadius.card,
            topTrailingRadius: CrewRadius.sheet,
            style: .continuous
        ))
        .shadow(color: theme.shadow, radius: 20, y: -2)
        .gesture(
            DragGesture(minimumDistance: 20).onEnded { value in
                withAnimation(.snappy) {
                    if value.translation.height < -30 { expanded = true }
                    if value.translation.height > 30 { expanded = false }
                }
            }
        )
    }

    @ViewBuilder
    private var aidContent: some View {
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
            if expanded {
                expandedDetails
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
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
                    latitude: $model.latitudeText,
                    longitude: $model.longitudeText,
                    title: $model.checkpointTitle,
                    message: model.pickMessage,
                    isBusy: model.pickBusy,
                    onSave: model.placeCheckpoint
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
    var glideOnScreen = true
    var recenterRequest = 0
    /// The onboarding replay: no top bar to clear, and a pane that a fold or a size change
    /// resizes, so the course is framed again when it does.
    var replay = false
    @Environment(\.crew) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let onTap: (Double, Double) -> Void
    let onStyleFailure: (Bool) -> Void
    let onStyleLoaded: () -> Void

    var body: some View {
        #if canImport(MapLibre)
        if let glide {
            // The onboarding replay: a frame on every display refresh while it plays, so the dot
            // glides along the course. Paused it holds; with Reduce Motion it steps at each update.
            TimelineView(.animation(minimumInterval: nil, paused: reduceMotion || !glideOnScreen || !glide.isPlaying)) { _ in
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
        MapLibreCourseMap(
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
            shrinksPaddingToFit: replay
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel("Course map")
    }
    #endif
}

struct MapPickSection: View {
    @Binding var latitude: String
    @Binding var longitude: String
    @Binding var title: String
    let message: String
    let isBusy: Bool
    let onSave: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Tap the map to place a checkpoint.")
                .font(CrewFont.body)
                .foregroundStyle(.secondary)
            MapCoordinateField(title: "Latitude", text: $latitude)
            MapCoordinateField(title: "Longitude", text: $longitude)
            TextField("Title", text: $title)
                .font(CrewFont.bodyLarge)
                .textFieldStyle(.crew)
                .textInputAutocapitalization(.words)
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
            .font(CrewFont.bodyLarge)
            .textFieldStyle(.crew)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.numbersAndPunctuation)
            .accessibilityLabel(title)
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
