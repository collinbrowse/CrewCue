import SwiftUI

struct NotificationPermissionScreen: View {
    @State private var model = NotificationPermissionModel()

    var body: some View {
        NotificationPermissionView(model: model)
    }
}

struct NotificationPermissionView: View {
    var model: NotificationPermissionModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            NotificationPermissionTitle()
            NotificationPermissionStatus(message: model.statusMessage)
            NotificationPermissionButton(isWorking: model.isWorking, action: model.request)
        }
        .crewCueScreen(identifier: "crewcue.onboarding-notifications", label: "Notifications")
        .task { await model.refresh() }
    }
}

struct NotificationPermissionTitle: View {
    var body: some View {
        Text("Notifications")
            .font(.title2)
    }
}

struct NotificationPermissionStatus: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.body)
    }
}

struct NotificationPermissionButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Allow notifications", action: action)
            .buttonStyle(.borderedProminent)
            .disabled(isWorking)
    }
}
