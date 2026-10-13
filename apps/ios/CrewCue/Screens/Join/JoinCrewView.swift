import SwiftUI

struct JoinCrewView: View {
    @Bindable var model: JoinCrewModel
    var onBack: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let onBack {
                Button("Back", action: onBack)
                    .buttonStyle(.bordered)
            }
            JoinCrewTitle()
            JoinCrewCodeField(code: $model.code)
            JoinCrewPreviewText(text: model.previewText)
            JoinCrewStatusText(message: model.statusMessage)
            JoinCrewPreviewButton(isWorking: model.isWorking, action: model.preview)
            JoinCrewJoinButton(isEnabled: model.canJoin, action: model.join)
        }
        .crewCueScreen(identifier: "crewcue.join-crew", label: "Join crew")
    }
}

struct JoinCrewTitle: View {
    var body: some View {
        Text("Join crew")
            .font(.title2)
    }
}

struct JoinCrewCodeField: View {
    @Binding var code: String

    var body: some View {
        TextField("Invite code", text: $code)
            .font(.body)
            .textFieldStyle(.roundedBorder)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .accessibilityLabel("Invite code")
    }
}

struct JoinCrewPreviewText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.body)
            .accessibilityHidden(text.isEmpty)
    }
}

struct JoinCrewStatusText: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.body)
    }
}

struct JoinCrewPreviewButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Preview", action: action)
            .buttonStyle(.borderedProminent)
            .disabled(isWorking)
    }
}

struct JoinCrewJoinButton: View {
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button("Join", action: action)
            .buttonStyle(.bordered)
            .disabled(!isEnabled)
    }
}
