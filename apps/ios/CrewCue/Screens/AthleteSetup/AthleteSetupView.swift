import SwiftUI

struct AthleteSetupView: View {
    @Bindable var model: AthleteSetupModel
    @Environment(\.kinetic) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                AthleteSetupTitle()
                AthleteNameField(name: $model.displayName)
                AthleteSetupStatus(message: model.statusText)
                AthleteSaveButton(isWorking: model.isWorking, action: model.save)
            }
            .kineticCard()
            Spacer(minLength: 0)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.background)
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
            .buttonStyle(KineticProductButtonStyle())
            .disabled(isWorking)
    }
}
