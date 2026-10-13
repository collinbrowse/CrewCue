import SwiftUI
import CrewCueClientCore

struct FeatureScreenView: View {
    let screen: FeatureScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(screen.title)
                .font(.system(size: 28, weight: .bold))
            Text(screen.body)
                .font(.system(size: 16))
        }
        .padding(20)
        .kineticCard()
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .topLeading)
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
            .accessibilityIdentifier(identifier)
            .accessibilityLabel(label)
    }
}

extension View {
    func crewCueScreen(identifier: String, label: String) -> some View {
        modifier(CrewCueScreenModifier(identifier: identifier, label: label))
    }
}
