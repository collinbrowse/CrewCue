import SwiftUI

struct IncidentsView: View {
    @Bindable var model: IncidentsModel
    var roomId: String?
    var onProfile: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Incidents")
                    .font(.title2)
                ForEach(model.lines) { line in
                    Text(verbatim: line.summary)
                        .font(.body)
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(.body)
                }
                if hasRoom {
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
                    .buttonStyle(.borderedProminent)
                    .disabled(model.working || model.summaryDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                Button("Profile", action: onProfile)
                    .buttonStyle(.bordered)
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
