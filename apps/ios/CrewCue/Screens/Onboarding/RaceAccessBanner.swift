import SwiftUI
import CrewCueClientCore

/// The race isn't unlocked. The runner gets "Unlock race", which opens the paywall; crew get the
/// reason (`OnboardingState.reason`). Shown on Map, Pace and Chat.
enum RaceAccess: Equatable {
    /// `expiry` is "Expires in N days" (`OnboardingCopy.unpaidExpiry`), nil without a date.
    case unlock(expiry: String?)
    case locked(reason: String)
}

struct RaceAccessBanner: View {
    let access: RaceAccess
    var onUnlock: () -> Void
    @Environment(\.crew) private var theme

    var body: some View {
        switch access {
        case .unlock(let expiry):
            Button(action: onUnlock) {
                HStack(spacing: CrewSpace.stackSm) {
                    Image(systemName: "lock.open")
                        .font(.system(.body, weight: .semibold))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(OnboardingCopy.unpaidBanner)
                            .font(CrewFont.button)
                        if let expiry {
                            Text(expiry)
                                .font(CrewFont.label)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right")
                        .font(.system(.footnote, weight: .bold))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(theme.onPrimary)
                .padding(.horizontal, CrewSpace.gutter)
                .padding(.vertical, CrewSpace.stackSm)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(theme.primary, in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("crewcue.unlock-race-banner")
            .accessibilityLabel(expiry.map { "\(OnboardingCopy.unpaidBanner). \($0)" } ?? OnboardingCopy.unpaidBanner)
            .accessibilityHint(OnboardingCopy.lockedAidExplanation)
        case .locked(let reason):
            HStack(spacing: CrewSpace.stackSm) {
                Image(systemName: "lock")
                    .font(.system(.body, weight: .semibold))
                    .accessibilityHidden(true)
                Text(reason)
                    .font(CrewFont.label)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, CrewSpace.gutter)
            .padding(.vertical, CrewSpace.stackSm)
            .frame(maxWidth: .infinity, minHeight: 44)
            .crewGlass(in: RoundedRectangle(cornerRadius: CrewRadius.lg, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("crewcue.race-locked-banner")
        }
    }
}
