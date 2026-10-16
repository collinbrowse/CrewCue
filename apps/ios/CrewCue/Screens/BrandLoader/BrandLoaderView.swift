import SwiftUI
import CrewCueClientCore

/// Fixture for the brand loader: the animated app icon, a standalone loader, an inline spinner, and the shake loaders.
struct BrandLoaderView: View {
    let screen: FeatureScreen

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            FeatureScreenView(screen: screen)
            HStack(spacing: 28) {
                CairnLoader(onLight: false, crop: Cairn.iconCrop)
                    .frame(width: 120, height: 120)
                    .background(
                        LinearGradient(colors: [Cairn.slate, Color(red: 0x1F / 255, green: 0x28 / 255, blue: 0x33 / 255)], startPoint: .top, endPoint: .bottom),
                        in: RoundedRectangle(cornerRadius: 27, style: .continuous)
                    )
                CairnLoader()
                    .frame(width: 96, height: 96)
            }
            .padding(.horizontal)
            HStack(spacing: 10) {
                CairnLoader()
                    .frame(width: 24, height: 24)
                Text(screen.title)
                    .foregroundStyle(Color.black)
            }
            .padding(.horizontal)
            HStack(spacing: 28) {
                CairnShakeLoader()
                    .frame(width: 64, height: 64)
                CairnShakeLoader()
                    .frame(width: 24, height: 24)
                CairnShakeLoader()
                    .frame(width: 16, height: 16)
            }
            .padding(.horizontal)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("crewcue.loader-shake")
            Button("Recalculate") {}
                .buttonStyle(.crewPrimary)
                .crewBusy(true)
                .padding(.horizontal)
        }
    }
}
