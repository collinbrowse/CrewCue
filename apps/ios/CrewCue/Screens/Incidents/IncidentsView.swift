import SwiftUI

struct IncidentsView: View {
    @Bindable var model: IncidentsModel
    var roomId: String?
    var onProfile: () -> Void
    @Environment(\.kinetic) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductTitle(title: "Incidents", subtitle: "Log what the crew needs to know.")
                if model.lines.isEmpty == false {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(model.lines) { line in
                            Text(verbatim: line.summary)
                                .font(.system(size: 16, weight: .semibold))
                        }
                    }
                    .kineticCard()
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(.system(size: 16))
                        .foregroundStyle(theme.body)
                }
                if hasRoom {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("Summary", text: $model.summaryDraft, axis: .vertical)
                            .font(.body)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityLabel("Summary")
                        Picker("Category", selection: $model.category) {
                            ForEach(IncidentsModel.categories, id: \.self) { category in
                                Text(category).tag(category)
                            }
                        }
                        .accessibilityLabel("Category")
                        Picker("Severity", selection: $model.severity) {
                            ForEach(IncidentsModel.severities, id: \.self) { severity in
                                Text(severity).tag(severity)
                            }
                        }
                        .accessibilityLabel("Severity")
                        TextField("Checkpoint", text: $model.checkpointDraft)
                            .font(.body)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityLabel("Checkpoint")
                        Button("Submit") {
                            Task { await model.submit() }
                        }
                        .buttonStyle(KineticProductButtonStyle())
                        .disabled(model.working || model.summaryDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .kineticCard()
                }
                Button("Profile", action: onProfile)
                    .buttonStyle(KineticSecondaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .crewCueScreen(identifier: "crewcue.readouts-incidents", label: "Incidents")
        .task(id: roomId ?? "") {
            await model.activate(roomId: roomId)
        }
    }

    private var hasRoom: Bool {
        let trimmed = roomId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty == false
    }
}
