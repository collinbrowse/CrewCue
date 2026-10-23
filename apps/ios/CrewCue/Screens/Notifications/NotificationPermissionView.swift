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
            ProductTitle(
                title: "Notifications",
                subtitle: "Allow alerts so crew messages reach this phone."
            )
            VStack(alignment: .leading, spacing: 12) {
                NotificationPermissionStatus(message: model.statusMessage)
                NotificationPermissionButton(isWorking: model.isWorking, action: model.request)
            }
            .crewCard()
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .crewCueScreen(identifier: "crewcue.onboarding-notifications", label: "Notifications")
        .task { await model.refresh() }
    }
}

struct NotificationPermissionStatus: View {
    let message: String

    var body: some View {
        Text(message)
            .font(CrewFont.bodyLarge)
    }
}

struct NotificationPermissionButton: View {
    let isWorking: Bool
    let action: () -> Void

    var body: some View {
        Button("Allow notifications", action: action)
            .buttonStyle(.crewPrimary)
            .disabled(isWorking)
    }
}
