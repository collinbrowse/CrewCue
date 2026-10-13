import SwiftUI
import CrewCueClientCore

struct FeatureScreenView: View {
    let screen: FeatureScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(screen.accessibilityIdentifier)
                .font(.caption)
            Text(screen.title)
                .font(.title2)
            Text(screen.body)
                .font(.body)
        }
        .foregroundStyle(Color.black)
        .padding()
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
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .foregroundStyle(Color.black)
            .accessibilityIdentifier(identifier)
            .accessibilityLabel(label)
    }
}

extension View {
    func crewCueScreen(identifier: String, label: String) -> some View {
        modifier(CrewCueScreenModifier(identifier: identifier, label: label))
    }
}
