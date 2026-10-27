import SwiftUI
import CrewCueClientCore

struct FeatureScreenView: View {
    let screen: FeatureScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(screen.title)
                .font(CrewFont.display)
            Text(screen.body)
                .font(CrewFont.bodyLarge)
        }
        .padding(20)
        .crewCard()
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(screen.accessibilityIdentifier)
        .accessibilityLabel(screen.title)
    }
}

struct CrewCueScreenModifier: ViewModifier {
    var identifier: String
    var label: String

    func body(content: Content) -> some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(CrewBackground())
            // Contain the children so the screen label names the screen, not every control on it.
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(identifier)
            .accessibilityLabel(label)
    }
}

extension View {
    func crewCueScreen(identifier: String, label: String) -> some View {
        modifier(CrewCueScreenModifier(identifier: identifier, label: label))
    }
}
