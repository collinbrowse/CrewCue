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
        CrewSettingRow(
            systemImage: "square.and.arrow.down",
            title: "Import your training history",
            hint: hint,
            trailing: {
                Button("Import") {
                    picking = true
                }
                .buttonStyle(.crewPillProminent)
                .crewBusy(model.busy)
                .accessibilityLabel("Import past run")
                .accessibilityHint("Choose a .gpx, .fit or .tcx file")
            },
            below: {
                if model.items.isEmpty == false {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(model.items, id: \.id) { item in
                            Label(item.summary, systemImage: "checkmark.circle")
                                .font(CrewFont.hint)
                                .foregroundStyle(theme.body)
                        }
                    }
                }
            }
        )
        .accessibilityIdentifier("crewcue.activity-import")
        .accessibilityLabel("Training history")
        .fileImporter(isPresented: $picking, allowedContentTypes: Self.contentTypes) { result in
            Task { await model.picked(result) }
        }
        .task(id: userId ?? "") {
            await model.activate()
        }
    }

    /// Status from the last import when there is one; otherwise what to choose and why.
    private var hint: String {
        if model.message.isEmpty || model.message == ActivityImport.emptyMessage {
            return "Runs from Garmin, COROS, Suunto or any watch app (.gpx, .fit, .tcx). They sharpen your estimate."
        }
        return model.message
    }
}
