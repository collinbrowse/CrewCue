import SwiftUI

struct MapView: View {
    @Bindable var model: MapModel
    var userId: String?
    var roomId: String?
    var role: String?

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
            MapAidSheet(model: model)
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

struct MapAidSheet: View {
    @Bindable var model: MapModel
    @Environment(\.kinetic) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Capsule()
                    .fill(theme.body.opacity(0.45))
                    .frame(width: 36, height: 4)
                    .frame(maxWidth: .infinity)
                if let station = model.points.first {
                    Text("AID STATION")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(theme.body)
                    Text(verbatim: station.title)
                        .font(.system(size: 20, weight: .heavy))
                }
                if model.mapMessage.isEmpty == false {
                    Text(verbatim: model.mapMessage)
                        .font(.system(size: 16))
                }
                ForEach(model.points) { point in
                    MapCheckpointLine(point: point)
                }
                MapPickSection(
                    latitude: $model.latitudeText,
                    longitude: $model.longitudeText,
                    title: $model.checkpointTitle,
                    message: model.pickMessage,
                    isBusy: model.pickBusy,
                    onSave: model.placeCheckpoint
                )
                MapNavigateSection(
                    origin: $model.originId,
                    destination: $model.destinationId,
                    mode: $model.routeMode,
                    points: model.points,
                    message: model.navigateMessage,
                    isBusy: model.navigateBusy,
                    onStart: model.startNavigation
                )
                MapLocationSection(message: model.locationMessage, onShare: model.beginLocation)
            }
            .padding(16)
            .padding(.bottom, 8)
        }
        .frame(maxHeight: 420)
        .background(theme.card)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 0, bottomTrailingRadius: 0, topTrailingRadius: 16))
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

struct MapCheckpointLine: View {
    let point: MapCoursePoint

    var body: some View {
        Text(verbatim: "\(point.title)  \(coordinate)")
            .font(.body)
    }

    private var coordinate: String {
        String(format: "%.5f, %.5f", point.latitude, point.longitude)
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
            .buttonStyle(.borderedProminent)
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
            .buttonStyle(.borderedProminent)
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
                .buttonStyle(.borderedProminent)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.location-heartbeat")
        .accessibilityLabel("Location")
    }
}
