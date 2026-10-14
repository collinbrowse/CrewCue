import SwiftUI

struct AthleteSetupView: View {
    @Bindable var model: AthleteSetupModel
    @Environment(\.crew) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ProductTitle(
                title: "Your name",
                subtitle: "Crew sees this on the schedule and in chat."
            )
            VStack(alignment: .leading, spacing: 12) {
                AthleteNameField(name: $model.displayName)
                AthleteSetupStatus(message: model.statusText)
                AthleteSaveButton(isWorking: model.isWorking, action: model.save)
            }
            .crewCard()
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.background)
        .crewCueScreen(identifier: "crewcue.athlete-setup", label: "Athlete setup")
    }
}

struct AthleteNameField: View {
    @Binding var name: String

    var body: some View {
        TextField("Display name", text: $name)
            .font(CrewFont.bodyLarge)
            .textFieldStyle(.crew)
            .textContentType(.name)
            .accessibilityLabel("Display name")
    }
}

struct AthleteSetupStatus: View {
    let message: String

    var body: some View {
        Text(message)
            .font(CrewFont.bodyLarge)
            .accessibilityHidden(message.isEmpty)
    }
}

struct AthleteSaveButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Save", action: action)
            .buttonStyle(.crewPrimary)
            .disabled(isWorking)
    }
}
