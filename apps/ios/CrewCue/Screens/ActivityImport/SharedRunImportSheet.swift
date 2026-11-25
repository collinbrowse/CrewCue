import SwiftUI
import CrewCueClientCore

/// The sheet a shared or opened run file shows (run-share-import): reading, preview, importing,
/// then done or an error. One column at every width; the run list scrolls.
struct SharedRunImportSheet: View {
    @Bindable var model: SharedRunImportModel
    @Environment(\.crew) private var theme

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
            .background(theme.background)
            .navigationTitle("Import runs")
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom) { actions }
        }
        .accessibilityIdentifier("crewcue.run-share-import")
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var content: some View {
        switch model.state {
        case .reading:
            busy(SharedRunImport.readingMessage)
        case .importing:
            busy(SharedRunImport.importingMessage)
        case .signedOut:
            message(SharedRunImport.signedOutMessage)
        case .done(let text), .failed(let text):
            message(text)
        case .preview(let preview):
            Text(preview.title)
                .font(CrewFont.headline)
                .foregroundStyle(theme.ink)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(preview.listedRuns.enumerated()), id: \.offset) { _, run in
                    HStack(alignment: .firstTextBaseline) {
                        Label(run.summary, systemImage: run.alreadyImported ? "checkmark.circle" : "figure.run")
                            .font(CrewFont.body)
                            .foregroundStyle(run.alreadyImported ? theme.body.opacity(0.6) : theme.ink)
                        if run.alreadyImported {
                            Spacer(minLength: 8)
                            Text("Already imported")
                                .font(CrewFont.label)
                                .foregroundStyle(theme.body)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if preview.runs.count == 1, let run = preview.runs.first, run.track.count >= 2 {
                RouteSketch(track: run.track)
                    .stroke(theme.primary, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    .frame(height: 110)
                    .padding(12)
                    .background(theme.well, in: RoundedRectangle(cornerRadius: 12))
                    .accessibilityHidden(true)
            }
            if let more = preview.moreRunsLine {
                Text(more)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
            }
            if let skipped = preview.skippedLine {
                Text(skipped)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !preview.unreadable.isEmpty {
                DisclosureGroup(preview.unreadableLine ?? "Unreadable files") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(preview.unreadable.enumerated()), id: \.offset) { _, file in
                            Text("\(file.fileName): \(file.error)")
                                .font(CrewFont.label)
                                .foregroundStyle(theme.body)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(CrewFont.body)
                .tint(theme.body)
            }
        case nil:
            EmptyView()
        }
    }

    @ViewBuilder private var actions: some View {
        VStack(spacing: 8) {
            if case .preview(let preview) = model.state, preview.canImport {
                Button(preview.confirmLabel) {
                    Task { await model.confirm() }
                }
                .buttonStyle(.crewPrimary)
                .accessibilityIdentifier("crewcue.run-share-import.confirm")
                Button("Cancel") { model.dismiss() }
                    .buttonStyle(.crewGhost)
                    .accessibilityIdentifier("crewcue.run-share-import.cancel")
            } else if !isBusy {
                Button(closeLabel) { model.dismiss() }
                    .buttonStyle(.crewSecondary)
                    .accessibilityIdentifier("crewcue.run-share-import.cancel")
            }
        }
        .padding()
        .background(theme.background)
    }

    private var isBusy: Bool {
        switch model.state {
        case .reading, .importing: true
        default: false
        }
    }

    private var closeLabel: String {
        if case .signedOut = model.state { return "OK" }
        return "Done"
    }

    private func busy(_ text: String) -> some View {
        HStack(spacing: 12) {
            ProgressView()
            Text(text)
                .font(CrewFont.bodyLarge)
                .foregroundStyle(theme.ink)
        }
        .accessibilityElement(children: .combine)
    }

    private func message(_ text: String) -> some View {
        Text(text)
            .font(CrewFont.title)
            .foregroundStyle(theme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The run's route line, fitted to the frame with its aspect kept (latitude scaled for longitude).
private struct RouteSketch: Shape {
    var track: [[Double]]

    func path(in rect: CGRect) -> Path {
        let points = track.compactMap { pair -> CGPoint? in
            guard pair.count == 2 else { return nil }
            return CGPoint(x: pair[1] * cos(pair[0] * .pi / 180), y: -pair[0])
        }
        guard let first = points.first, points.count >= 2 else { return Path() }
        var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
        for p in points {
            minX = min(minX, p.x); maxX = max(maxX, p.x)
            minY = min(minY, p.y); maxY = max(maxY, p.y)
        }
        let spanX = max(maxX - minX, 1e-9)
        let spanY = max(maxY - minY, 1e-9)
        let scale = min(rect.width / spanX, rect.height / spanY)
        let offsetX = rect.minX + (rect.width - spanX * scale) / 2
        let offsetY = rect.minY + (rect.height - spanY * scale) / 2
        var path = Path()
        for (index, p) in points.enumerated() {
            let point = CGPoint(x: offsetX + (p.x - minX) * scale, y: offsetY + (p.y - minY) * scale)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }
}
