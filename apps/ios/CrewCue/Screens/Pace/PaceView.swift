import SwiftUI
import UniformTypeIdentifiers

struct PaceView: View {
    @Bindable var model: PaceModel
    var userId: String?
    var roomId: String?
    var role: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                PaceScheduleSection(lines: model.stopLines, message: model.scheduleMessage)
                PaceEstimateSection(model: model)
                PaceCheckInSection(model: model)
                PaceGpxSection(model: model)
                PaceExportSection(text: model.exportText, message: model.exportMessage)
                PaceCourseSection(model: model)
                PaceOutboxSection(rows: model.outboxRows, message: model.outboxMessage)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("crewcue.schedule-sheet")
            .accessibilityLabel("Schedule")
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: activationID) {
            await model.activate(userId: userId, roomId: roomId, role: role)
        }
    }

    private var activationID: String {
        "\(userId ?? "")|\(roomId ?? "")|\(role ?? "")"
    }
}

struct PaceScheduleSection: View {
    let lines: [PaceLine]
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Schedule")
                .font(.system(size: 28, weight: .bold))
            ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(index + 1)")
                        .font(.system(size: 12, weight: .semibold))
                    Text(verbatim: line.text)
                        .font(.system(size: 17, weight: .bold))
                }
                .kineticCard()
            }
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(.system(size: 16))
            }
        }
    }
}

struct PaceSheetLine: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(.body)
    }
}

struct PaceEstimateSection: View {
    @Bindable var model: PaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Pace estimate")
                .font(.title2)
            PaceEstimateMessage(message: model.estimateMessage, coldStart: model.showColdStart)
            if model.canRecalculate {
                PaceRecalculateButton(isBusy: model.estimateBusy, action: model.recalculate)
            }
            if model.canSeedColdStart {
                PaceSeedButton(isBusy: model.estimateBusy, action: model.seedColdStart)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.pace-estimate")
        .accessibilityLabel("Pace estimate")
    }
}

struct PaceEstimateMessage: View {
    let message: String
    let coldStart: Bool

    var body: some View {
        Text(verbatim: message)
            .font(.body)
            .accessibilityLabel(coldStart ? "Cold start" : "Pace estimate")
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
        .buttonStyle(.borderedProminent)
        .disabled(isBusy)
    }
}

struct PaceSeedButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Seed cold start") {
            Task { await action() }
        }
        .buttonStyle(.bordered)
        .disabled(isBusy)
    }
}

struct PaceCheckInSection: View {
    @Bindable var model: PaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Check in")
                .font(.title2)
            TextField("Arrival", text: $model.arrivalAt)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Arrival")
            TextField("Departure", text: $model.departureAt)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Departure")
            TextField("Checkpoint", text: $model.checkpointId)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Checkpoint")
            if model.checkInMessage.isEmpty == false {
                Text(verbatim: model.checkInMessage)
                    .font(.body)
            }
            PaceCheckInButton(isBusy: model.checkInBusy, action: model.submitCheckIn)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.check-in")
        .accessibilityLabel("Check in")
    }
}

struct PaceCheckInButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Queue check-in") {
            Task { await action() }
        }
        .buttonStyle(.borderedProminent)
        .disabled(isBusy)
    }
}

struct PaceGpxSection: View {
    @Bindable var model: PaceModel
    @State private var importing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GPX import")
                .font(.title2)
            Text(verbatim: model.gpxMessage)
                .font(.body)
            TextField("GPX", text: $model.gpxText, axis: .vertical)
                .font(.body)
                .lineLimit(3...8)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("GPX text")
            PaceChooseGpxButton(isBusy: model.gpxBusy) {
                importing = true
            }
            PaceImportGpxButton(isBusy: model.gpxBusy) {
                await model.importGpx(fileName: "course.gpx", xml: model.gpxText)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.gpx-import")
        .accessibilityLabel("GPX import")
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
        Button("Choose GPX file", action: action)
            .buttonStyle(.bordered)
            .disabled(isBusy)
    }
}

struct PaceImportGpxButton: View {
    let isBusy: Bool
    let action: () async -> Void

    var body: some View {
        Button("Import GPX") {
            Task { await action() }
        }
        .buttonStyle(.borderedProminent)
        .disabled(isBusy)
    }
}

struct PaceExportSection: View {
    let text: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Crew sheet")
                .font(.title2)
            if text.isEmpty == false {
                Text(verbatim: text)
                    .font(.body)
                ShareLink(item: text) {
                    Text("Share crew sheet")
                }
            }
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(.body)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.crew-sheet-export")
        .accessibilityLabel("Crew sheet")
    }
}

struct PaceCourseSection: View {
    @Bindable var model: PaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Course settings")
                .font(.title2)
            if model.cutoffLines.isEmpty == false {
                Text("Cutoff")
                    .font(.headline)
                ForEach(model.cutoffLines) { line in
                    PaceSheetLine(text: line.text)
                }
            }
            if model.stoppageLines.isEmpty == false {
                Text("Stoppage")
                    .font(.headline)
                ForEach(model.stoppageLines) { line in
                    PaceSheetLine(text: line.text)
                }
            }
            TextField("Cutoff", text: $model.cutoffNote)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Cutoff")
            TextField("Stoppage seconds", text: $model.stoppageText)
                .font(.body)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.decimalPad)
                .accessibilityLabel("Stoppage")
            if model.courseMessage.isEmpty == false {
                Text(verbatim: model.courseMessage)
                    .font(.body)
            }
            PaceSaveCourseButton(action: model.saveCourseDraft)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.course-settings")
        .accessibilityLabel("Course settings")
    }
}

struct PaceSaveCourseButton: View {
    let action: () -> Void

    var body: some View {
        Button("Save", action: action)
            .buttonStyle(.borderedProminent)
    }
}

struct PaceOutboxSection: View {
    let rows: [PaceLine]
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Outbox")
                .font(.title2)
            ForEach(rows) { row in
                PaceSheetLine(text: row.text)
            }
            if message.isEmpty == false {
                Text(verbatim: message)
                    .font(.body)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.outbox")
        .accessibilityLabel("Outbox")
    }
}
