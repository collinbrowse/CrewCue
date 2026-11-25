import Foundation

/// One item on the runner's setup checklist card on Map (clients/behavior/onboarding-runner-tour.md).
public enum SetupChecklistItemKind: String, CaseIterable, Sendable {
    case invites, etaEdits, checkpointDetails, notifications, location

    public var title: String {
        switch self {
        case .invites: "Invite your crew"
        case .etaEdits: "Adjust aid station stops"
        case .checkpointDetails: "Check your checkpoints"
        case .notifications: "Turn on notifications"
        case .location: "Test tracking"
        }
    }

    public var detail: String {
        switch self {
        case .invites: "Share the link so your crew can follow you."
        case .etaEdits: "Planned stops move every aid station time after them."
        case .checkpointDetails: "Place a missing aid station or crew spot on the map."
        case .notifications: "We'll remind you to start tracking."
        case .location: "Send one ping now, or on race morning."
        }
    }

    public var accessibilityIdentifier: String { "crewcue.setup-checklist.\(rawValue)" }

    /// The onboarding step an item saves to when the runner opens it, nil for items read from the
    /// phone (notification permission) or from the tour (the location test).
    public var step: OnboardingStep? {
        switch self {
        case .invites: .invites
        case .etaEdits: .etaEdits
        case .checkpointDetails: .checkpointDetails
        case .notifications, .location: nil
        }
    }
}

/// What the phone knows that the saved progress doesn't.
public struct SetupChecklistFacts: Equatable, Sendable {
    /// Notification permission is granted.
    public var notificationsOn: Bool
    /// Location is allowed Always for CrewCue.
    public var locationAlways: Bool

    public init(notificationsOn: Bool, locationAlways: Bool) {
        self.notificationsOn = notificationsOn
        self.locationAlways = locationAlways
    }
}

public struct SetupChecklistItem: Equatable, Sendable, Identifiable {
    public var kind: SetupChecklistItemKind
    public var done: Bool
    public var id: String { kind.rawValue }
}

public struct SetupChecklist: Equatable, Sendable {
    public var items: [SetupChecklistItem]
    /// The first item not done: the card leads with it.
    public var next: SetupChecklistItemKind?
    public var doneCount: Int { items.filter(\.done).count }

    /// "2 of 5 done".
    public var summary: String { "\(doneCount) of \(items.count) done" }
    public static let title = "Race setup"
    public static let hide = "Hide"
    public static let show = "Show all"
    public static let showLess = "Show less"
}

/// Which setup items are done and which is next. The card shows on the runner's own race once the
/// tour is over, until every item is done or the runner hides it. Pure.
public enum SetupChecklistPolicy {
    /// `progress` is the saved onboarding progress: Hide saves `setupChecklist` for the race.
    public static func make(state: OnboardingState, progress: OnboardingProgress, facts: SetupChecklistFacts) -> SetupChecklist? {
        guard state.flow == .done, state.role == .runner, let roomId = state.roomId else { return nil }
        if progress.outcome(.setupChecklist, roomId: roomId) != nil { return nil }
        func ended(_ step: OnboardingStep) -> Bool { state.status(step)?.outcome == .done }
        let items = SetupChecklistItemKind.allCases.map { kind -> SetupChecklistItem in
            let done: Bool
            switch kind {
            case .invites: done = ended(.invites)
            case .etaEdits: done = ended(.etaEdits)
            case .checkpointDetails: done = ended(.checkpointDetails)
            case .notifications: done = facts.notificationsOn
            case .location: done = ended(.location) || facts.locationAlways
            }
            return SetupChecklistItem(kind: kind, done: done)
        }
        guard items.contains(where: { !$0.done }) else { return nil }
        return SetupChecklist(items: items, next: items.first { !$0.done }?.kind)
    }
}
