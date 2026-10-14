import SwiftUI
import CrewCueClientCore

private enum MapTool: String {
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
}

struct MapView: View {
    @Bindable var model: MapModel
    var userId: String?
    var roomId: String?
    var role: String?
    var focus: String = "map-track"

    var body: some View {
        ZStack(alignment: .bottom) {
            MapCanvas(
                points: model.points,
                onTap: { latitude, longitude in
                    model.selectCoordinate(latitude: latitude, longitude: longitude)
                },
                onStyleFailure: { offline in
                    model.noteStyleFailure(offline: offline)
                },
                onStyleLoaded: {
                    model.noteStyleLoaded()
                }
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            MapAidSheet(model: model, focus: focus)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.map")
        .accessibilityLabel("Map")
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, role: role)
            model.beginLocation()
        }
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(role ?? "")"
    }
}

struct AidPager: View {
    @Bindable var model: MapModel

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 0) {
                ForEach(model.aidPages) { page in
                    AidPeek(page: page)
                        .containerRelativeFrame(.horizontal)
                        .id(page.index)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollPosition(id: aidScroll)
        .frame(height: 148)
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
    @Environment(\.kinetic) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: page.kicker)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(theme.body)
                    Text(verbatim: page.title)
                        .font(.system(size: 20, weight: .heavy))
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(verbatim: page.clockLabel)
                        .font(.system(size: 20, weight: .heavy))
                    Text("EST. ARRIVAL")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(theme.body)
                    Text(verbatim: page.remainLabel)
                        .font(.system(size: 12, weight: .heavy))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(theme.secondaryButton, in: Capsule())
                }
            }
            HStack {
                Text(verbatim: page.distanceLabel)
                Spacer()
                Text(verbatim: page.stoppageLabel)
                if let delay = page.delayLabel {
                    Text(verbatim: delay)
                        .foregroundStyle(theme.primary)
                }
            }
            .font(.system(size: 13, weight: .semibold))
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(page.scheduleLine)
    }
}

struct MapAidSheet: View {
    @Bindable var model: MapModel
    var focus: String
    @Environment(\.kinetic) private var theme
    @State private var tool = MapTool.none

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Capsule()
                    .fill(theme.body.opacity(0.45))
                    .frame(width: 36, height: 4)
                    .frame(maxWidth: .infinity)
                if model.aidPages.isEmpty == false {
                    AidPager(model: model)
                }
                if model.aidFollow == false, let live = model.aidLiveNextIndex, live != model.aidIndex {
                    Button("Next station", action: model.jumpToNextAid)
                        .buttonStyle(KineticSecondaryButtonStyle())
                }
                if model.mapMessage.isEmpty == false {
                    Text(verbatim: model.mapMessage)
                        .font(.system(size: 16))
                        .foregroundStyle(theme.body)
                }
                MapToolBar(tool: tool, onSelect: selectTool)
                mapTool
            }
            .padding(16)
            .padding(.bottom, 8)
        }
        .frame(maxHeight: tool == .none ? 280 : 420)
        .background(theme.card)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 16))
        .task(id: focus) {
            tool = MapTool.forFocus(focus)
        }
    }

    @ViewBuilder
    private var mapTool: some View {
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
            MapNavigateSection(
                origin: $model.originId,
                destination: $model.destinationId,
                mode: $model.routeMode,
                points: model.points,
                message: model.navigateMessage,
                isBusy: model.navigateBusy,
                onStart: model.startNavigation
            )
        case .location:
            MapLocationSection(message: model.locationMessage, onShare: model.beginLocation)
        }
    }

    private func selectTool(_ next: MapTool) {
        tool = tool == next ? .none : next
    }
}

private struct MapToolBar: View {
    let tool: MapTool
    let onSelect: (MapTool) -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        HStack(spacing: 8) {
            MapToolButton(title: "Place", selected: tool == .pick) { onSelect(.pick) }
            MapToolButton(title: "Navigate", selected: tool == .navigate) { onSelect(.navigate) }
            MapToolButton(title: "Location", selected: tool == .location) { onSelect(.location) }
        }
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(theme.ink)
    }
}

private struct MapToolButton: View {
    let title: String
    let selected: Bool
    let action: () -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        Button(title, action: action)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(selected ? theme.onPrimary : theme.ink)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(selected ? theme.primary : theme.secondaryButton, in: Capsule())
    }
}

struct MapCanvas: View {
    let points: [MapCoursePoint]
    let onTap: (Double, Double) -> Void
    let onStyleFailure: (Bool) -> Void
    let onStyleLoaded: () -> Void

    var body: some View {
        #if canImport(MapLibre)
        MapLibreCourseMap(
            points: points,
            onTap: onTap,
            onStyleFailure: onStyleFailure,
            onStyleLoaded: onStyleLoaded
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
            Text("Pick checkpoint")
                .font(.title2)
            MapCoordinateField(title: "Latitude", text: $latitude)
            MapCoordinateField(title: "Longitude", text: $longitude)
            TextField("Title", text: $title)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.words)
                .accessibilityLabel("Checkpoint title")
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(.body)
            }
            Button("Save checkpoint") {
                Task { await onSave() }
            }
            .buttonStyle(KineticProductButtonStyle())
            .disabled(isBusy)
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
            .font(.body)
            .textFieldStyle(.roundedBorder)
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
            Text("Navigate")
                .font(.title2)
            TextField("Origin", text: $origin)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Origin")
            TextField("Destination", text: $destination)
                .font(.body)
                .textFieldStyle(.roundedBorder)
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
                    .font(.body)
            }
            Button("Start navigation") {
                Task { await onStart() }
            }
            .buttonStyle(KineticProductButtonStyle())
            .disabled(isBusy)
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
                .font(.body)
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
            Text("Location")
                .font(.title2)
            Text(verbatim: message)
                .font(.body)
            Button("Share location", action: onShare)
                .buttonStyle(KineticProductButtonStyle())
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.location-heartbeat")
        .accessibilityLabel("Location")
    }
}
