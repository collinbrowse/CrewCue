import SwiftUI
import CrewCueClientCore

/// MapLibre owns the map view. The fixture deeplink renders shared screen copy and does not request a style.
struct MapLibrePocket: View {
    let screen: FeatureScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            FeatureScreenView(screen: screen)
            Text("MapLibre")
                .accessibilityIdentifier("crewcue.maplibre.pocket")
        }
    }
}
