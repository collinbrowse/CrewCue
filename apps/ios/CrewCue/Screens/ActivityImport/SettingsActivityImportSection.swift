import SwiftUI
import UniformTypeIdentifiers
import CrewCueClientCore

/// Settings → Past runs: import an exported .gpx, .fit or .tcx and list pacing history.
struct SettingsActivityImportSection: View {
    @Bindable var model: ActivityImportModel
    var userId: String?
    @State private var picking = false
    @Environment(\.crew) private var theme

    /// FIT and TCX have no system type; accept them by extension, falling back to any data file.
    static let contentTypes: [UTType] = {
        var types: [UTType] = [UTType(filenameExtension: "gpx") ?? .xml]
        types += ["fit", "tcx"].compactMap { UTType(filenameExtension: $0) }
        types.append(.data)
        return types
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CrewSectionHeader(title: "Past runs")
            Text("Import runs exported from Garmin, COROS, Suunto or another watch app. They improve the pace estimate.")
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
            Text(verbatim: model.message)
                .font(CrewFont.body)
                .foregroundStyle(theme.body)
                .accessibilityIdentifier("crewcue.activity-import.message")
            Button("Import past run") {
                picking = true
            }
            .buttonStyle(.crewPrimary)
            .disabled(model.busy)
            .accessibilityHint("Choose a .gpx, .fit or .tcx file")
            ForEach(model.items, id: \.id) { item in
                Text(verbatim: item.summary)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
            }
        }
        .crewCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("crewcue.activity-import")
        .accessibilityLabel("Past runs")
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.contentTypes) { result in
            Task { await model.picked(result) }
        }
        .task(id: userId ?? "") {
            await model.activate()
        }
    }
}
