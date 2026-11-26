import SwiftUI

struct IncidentsView: View {
    @Bindable var model: IncidentsModel
    var roomId: String?
    var onProfile: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Back to Profile, at the top where a pushed page's back control sits.
                Button(action: onProfile) {
                    Label("Profile", systemImage: "chevron.left")
                }
                .buttonStyle(.crewPill)
                .accessibilityLabel("Back to Profile")
                .accessibilityIdentifier("crewcue.readouts-incidents.back")
                ProductTitle(title: "Incidents", subtitle: "Log what the crew needs to know.")
                if model.lines.isEmpty == false {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(model.lines) { line in
                            Text(verbatim: line.summary)
                                .font(CrewFont.bodyLarge)
                        }
                    }
                    .crewCard()
                }
                if model.message.isEmpty == false {
                    Text(verbatim: model.message)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.body)
                }
                if hasRoom {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("Summary", text: $model.summaryDraft, axis: .vertical)
                            .font(CrewFont.bodyLarge)
                            .textFieldStyle(.crew)
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
                            .font(CrewFont.bodyLarge)
                            .textFieldStyle(.crew)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .accessibilityLabel("Checkpoint")
                        Button("Submit") {
                            Task { await model.submit() }
                        }
                        .buttonStyle(.crewPillProminent)
                        .disabled(model.working || model.summaryDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .crewCard()
                }
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
