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
        case .location: "Share location"
        }
    }
}

/// Course map tab. The shell activates `MapModel` so progress is live on every tab.
struct MapView: View {
    @Bindable var model: MapModel
    var focus: String = "map-track"
    var onSettings: () -> Void = {}
    @State private var tool = MapTool.none
    /// The map style has loaded or failed. Until then a loader sits over the map.
    @State private var styleSettled = false
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .bottom) {
            MapCanvas(
                points: model.points,
                recenterRequest: model.recenterRequest,
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
                }
            }
            MapAidSheet(model: model, tool: $tool)
                .padding(.horizontal, 8)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            MapOverlayControls(model: model, tool: $tool, onSettings: onSettings)
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
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(spacing: CrewSpace.stackSm) {
            CrewTopBar(onSettings: onSettings)
                .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.card, style: .continuous))
                .padding(.horizontal, 8)
            HStack(alignment: .top) {
                if model.readout.statusLabel.isEmpty == false {
                    StatusChip(text: model.readout.statusLabel, style: model.readout.status == .behind ? .soft : .filled)
                        .accessibilityLabel("Status \(model.readout.statusLabel)")
                }
                Spacer()
                VStack(alignment: .trailing, spacing: CrewSpace.stackSm) {
                    if let ping = model.readout.lastPingLabel {
                        StatusChip(text: "LAST PING: \(ping)", style: .glass, dot: true)
                    }
                    CircleIconButton(systemImage: "scope", label: "Fit course") {
                        model.recenter()
                    }
                    Menu {
                        Picker("Map tool", selection: $tool) {
                            Label("Aid stations", systemImage: "flag").tag(MapTool.none)
                            Label("Place checkpoint", systemImage: "mappin.and.ellipse").tag(MapTool.pick)
                            Label("Navigate", systemImage: "arrow.triangle.turn.up.right.diamond").tag(MapTool.navigate)
                            Label("Share location", systemImage: "location").tag(MapTool.location)
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
            }
            .padding(.horizontal, CrewSpace.gutter)
        }
    }
}

struct AidPager: View {
    @Bindable var model: MapModel
    @ScaledMetric private var height: CGFloat = 228

    var body: some View {
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
        .scrollPosition(id: aidScroll)
        .frame(height: height)
    }

    private var aidScroll: Binding<Int?> {
        Binding(
            get: { model.aidPages.isEmpty ? nil : model.aidIndex },
            set: { value in
                guard let value, value != model.aidIndex else { return }
                model.showAid(index: value)
            }
        )
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
                MapLocationSection(message: model.locationMessage, onShare: model.beginLocation)
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
    var recenterRequest = 0
    @Environment(\.crew) private var theme
    let onTap: (Double, Double) -> Void
    let onStyleFailure: (Bool) -> Void
    let onStyleLoaded: () -> Void

    var body: some View {
        #if canImport(MapLibre)
        MapLibreCourseMap(
            points: points,
            onTap: onTap,
            onStyleFailure: onStyleFailure,
            onStyleLoaded: onStyleLoaded,
            recenterRequest: recenterRequest,
            lineColor: UIColor(theme.primary)
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel("Course map")
        #else
        EmptyView()
        #endif
    }
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
    let onShare: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: message)
                .font(CrewFont.bodyLarge)
            Button("Share location", action: onShare)
                .buttonStyle(.crewPrimary)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.location-heartbeat")
        .accessibilityLabel("Location")
    }
}
