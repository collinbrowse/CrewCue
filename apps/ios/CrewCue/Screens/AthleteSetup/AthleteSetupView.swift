import SwiftUI

struct AthleteSetupView: View {
    @Bindable var model: AthleteSetupModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            AthleteSetupTitle()
            AthleteNameField(name: $model.displayName)
            AthleteSetupStatus(message: model.statusText)
            AthleteSaveButton(isWorking: model.isWorking, action: model.save)
        }
        .crewCueScreen(identifier: "crewcue.athlete-setup", label: "Athlete setup")
    }
}

struct AthleteSetupTitle: View {
    var body: some View {
        Text("Athlete setup")
            .font(.title2)
    }
}

struct AthleteNameField: View {
    @Binding var name: String

    var body: some View {
        TextField("Display name", text: $name)
            .font(.body)
            .textFieldStyle(.roundedBorder)
            .textContentType(.name)
            .accessibilityLabel("Display name")
    }
}

struct AthleteSetupStatus: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.body)
            .accessibilityHidden(message.isEmpty)
    }
}

struct AthleteSaveButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Save", action: action)
            .buttonStyle(.borderedProminent)
            .disabled(isWorking)
    }
}
