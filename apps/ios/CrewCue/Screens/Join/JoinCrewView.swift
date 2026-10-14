import SwiftUI

struct JoinCrewView: View {
    @Bindable var model: JoinCrewModel
    var onBack: (() -> Void)? = nil
    @Environment(\.crew) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let onBack {
                    Button("Back", action: onBack)
                        .font(CrewFont.bodyLarge)
                        .foregroundStyle(theme.primary)
                }
                Text("Join your crew")
                    .font(CrewFont.display)
                    .foregroundStyle(theme.ink)
                Text("Enter the 6-digit code from your crew.")
                    .font(CrewFont.button)
                    .foregroundStyle(theme.body)
                TextField("Invite code", text: $model.code)
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .multilineTextAlignment(.center)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .padding(.vertical, 18)
                    .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(theme.divider, lineWidth: 1)
                    }
                    .accessibilityLabel("Invite code")
                    .onChange(of: model.code) { _, code in
                        if code.count == 6 {
                            model.preview()
                        }
                    }
                if model.previewText.isEmpty == false {
                    Text(verbatim: model.previewText)
                        .font(CrewFont.button)
                        .foregroundStyle(theme.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .crewCard()
                }
                Text(verbatim: model.statusMessage)
                    .font(CrewFont.body)
                    .foregroundStyle(theme.body)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button("Join", action: model.join)
                    .buttonStyle(.crewPrimary)
                    .disabled(!model.canJoin)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 28)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.background)
        .crewCueScreen(identifier: "crewcue.join-crew", label: "Join crew")
    }
}
