import Foundation

public enum FeatureState: String, Sendable, Codable, Hashable {
    case success
    case empty
    case error
    case offline
}

public struct FeatureScreen: Equatable, Sendable, Codable {
    public var featureId: String
    public var accessibilityIdentifier: String
    public var title: String
    public var body: String

    public init(featureId: String, accessibilityIdentifier: String, title: String, body: String) {
        self.featureId = featureId
        self.accessibilityIdentifier = accessibilityIdentifier
        self.title = title
        self.body = body
    }
}

public enum CrewCueClientCore {
    public static func helloStamp() -> String {
        "CrewCue"
    }

    public static func featureScreen(id: String, state: FeatureState) -> FeatureScreen {
        let copy = FeatureCopy.resolve(id: id, state: state)
        return FeatureScreen(
            featureId: id,
            accessibilityIdentifier: copy.accessibilityIdentifier,
            title: copy.title,
            body: copy.body
        )
    }

    public static func featureScreenJSON(featureId: String, state: String) -> String {
        let parsed = FeatureState(rawValue: state) ?? .success
        return encode(featureScreen(id: featureId, state: parsed))
    }

    public static func featureScreenJSON(forCrewCueURL urlString: String) -> String {
        guard let screen = featureScreen(forCrewCueURL: urlString) else {
            return featureScreenJSON(featureId: "hello", state: "success")
        }
        return encode(screen)
    }

    private static func encode(_ screen: FeatureScreen) -> String {
        // Sorted keys match JSONEncoder. Built by hand so the Android JNI
        // library does not call through a synthesized Encodable witness.
        let pairs = [
            jsonField("accessibilityIdentifier", screen.accessibilityIdentifier),
            jsonField("body", screen.body),
            jsonField("featureId", screen.featureId),
            jsonField("title", screen.title)
        ]
        return "{\(pairs.joined(separator: ","))}"
    }

    private static func jsonField(_ key: String, _ value: String) -> String {
        "\"\(key)\":\"\(jsonEscaped(value))\""
    }

    private static func jsonEscaped(_ value: String) -> String {
        var escaped = ""
        for scalar in value.unicodeScalars {
            switch scalar {
            case "\\":
                escaped += "\\\\"
            case "\"":
                escaped += "\\\""
            case "\n":
                escaped += "\\n"
            case "\r":
                escaped += "\\r"
            case "\t":
                escaped += "\\t"
            default:
                if scalar.value < 0x20 {
                    escaped += "\\u\(PortableFormat.hex4(scalar.value))"
                } else {
                    escaped.unicodeScalars.append(scalar)
                }
            }
        }
        return escaped
    }

    public static func featureScreen(forCrewCueURL urlString: String) -> FeatureScreen? {
        guard let route = Route.parse(urlString) else { return nil }
        return featureScreen(id: route.featureId, state: route.state)
    }
}

private struct FeatureCopy {
    var accessibilityIdentifier: String
    var title: String
    var body: String

    static func resolve(id: String, state: FeatureState) -> FeatureCopy {
        switch id {
        case "hello":
            return FeatureCopy(accessibilityIdentifier: "crewcue.hello", title: "CrewCue", body: helloBody(state))
        case "schedule-sheet":
            return FeatureCopy(accessibilityIdentifier: "crewcue.schedule-sheet", title: "Schedule", body: scheduleBody(state))
        case "cold-start":
            return FeatureCopy(accessibilityIdentifier: "crewcue.cold-start", title: "Cold start", body: coldStartBody(state))
        case "pace-estimate":
            return FeatureCopy(accessibilityIdentifier: "crewcue.pace-estimate", title: "Pace estimate", body: coldStartBody(state))
        case "crew-sheet-export":
            return FeatureCopy(accessibilityIdentifier: "crewcue.crew-sheet-export", title: "Crew sheet", body: exportBody(state))
        case "outbox-status":
            return FeatureCopy(accessibilityIdentifier: "crewcue.outbox", title: "Outbox", body: outboxBody(state))
        case "auth-sign-in":
            return FeatureCopy(accessibilityIdentifier: "crewcue.auth-signed-out", title: "Sign in", body: authBody(state))
        case "join-crew":
            return FeatureCopy(accessibilityIdentifier: "crewcue.join-crew", title: "Join crew", body: joinBody(state))
        case "athlete-setup":
            return FeatureCopy(accessibilityIdentifier: "crewcue.athlete-setup", title: "Athlete setup", body: athleteBody(state))
        case "onboarding-notifications":
            return FeatureCopy(accessibilityIdentifier: "crewcue.onboarding-notifications", title: "Notifications", body: notifyBody(state))
        case "check-in":
            return FeatureCopy(accessibilityIdentifier: "crewcue.check-in", title: "Check in", body: checkInBody(state))
        case "course-settings":
            return FeatureCopy(accessibilityIdentifier: "crewcue.course-settings", title: "Course settings", body: courseSettingsBody(state))
        case "pace-stop-edit":
            return FeatureCopy(accessibilityIdentifier: "crewcue.pace-stop-edit", title: "Planned stops", body: stopEditBody(state))
        case "readouts-incidents":
            return FeatureCopy(accessibilityIdentifier: "crewcue.readouts-incidents", title: "Incidents", body: incidentsBody(state))
        case "gpx-import":
            return FeatureCopy(accessibilityIdentifier: "crewcue.gpx-import", title: "GPX import", body: gpxBody(state))
        case "map-track":
            return FeatureCopy(accessibilityIdentifier: "crewcue.map", title: "Map", body: mapBody(state))
        case "map-checkpoint-pick":
            return FeatureCopy(accessibilityIdentifier: "crewcue.map-checkpoint-pick", title: "Pick checkpoint", body: pickBody(state))
        case "map-navigate":
            return FeatureCopy(accessibilityIdentifier: "crewcue.map-navigate", title: "Navigate", body: navigateBody(state))
        case "location-heartbeat":
            return FeatureCopy(accessibilityIdentifier: "crewcue.location-heartbeat", title: "Location", body: locationBody(state))
        case "runner-track":
            return FeatureCopy(accessibilityIdentifier: "crewcue.runner-track", title: "Runner path", body: runnerTrackBody(state))
        case "live-eta":
            return FeatureCopy(accessibilityIdentifier: "crewcue.live-eta", title: "Live ETAs", body: liveEtaBody(state))
        case "chat-thread":
            return FeatureCopy(accessibilityIdentifier: "crewcue.chat", title: "Chat", body: chatBody(state))
        case "chat-notification-prefs":
            return FeatureCopy(accessibilityIdentifier: "crewcue.chat-notification-prefs", title: "Chat alerts", body: chatPrefsBody(state))
        case "push-registration":
            return FeatureCopy(accessibilityIdentifier: "crewcue.push-registration", title: "Push", body: pushBody(state))
        case "profile":
            return FeatureCopy(accessibilityIdentifier: "crewcue.profile", title: "Profile", body: profileBody(state))
        case "room-members":
            return FeatureCopy(accessibilityIdentifier: "crewcue.room-members", title: "Room members", body: membersBody(state))
        case "activity-import":
            return FeatureCopy(accessibilityIdentifier: "crewcue.activity-import", title: "Past runs", body: activityImportBody(state))
        case "strava":
            return FeatureCopy(accessibilityIdentifier: "crewcue.strava", title: "Strava", body: stravaBody(state))
        case "account-deletion":
            return FeatureCopy(accessibilityIdentifier: "crewcue.account-deletion", title: AccountDeletion.rowTitle, body: accountDeletionBody(state))
        case "app-shell":
            return FeatureCopy(accessibilityIdentifier: "crewcue.app-shell", title: "CrewCue", body: shellBody(state))
        case "brand-loader":
            return FeatureCopy(accessibilityIdentifier: "crewcue.loader", title: "Loading", body: loaderBody(state))
        case "billing-purchase":
            return FeatureCopy(accessibilityIdentifier: "crewcue.billing-purchase", title: "Race Pass", body: billingPurchaseBody(state))
        case "billing-upgrade":
            return FeatureCopy(accessibilityIdentifier: "crewcue.billing-upgrade", title: "Full Crew", body: billingUpgradeBody(state))
        case "billing-redeem":
            return FeatureCopy(accessibilityIdentifier: "crewcue.billing-redeem", title: "Redeem code", body: billingRedeemBody(state))
        default:
            return FeatureCopy(accessibilityIdentifier: "crewcue.unknown", title: "CrewCue", body: "Unknown fixture.")
        }
    }
}

private func helloBody(_ state: FeatureState) -> String {
    switch state {
    case .success: CrewCueClientCore.helloStamp()
    case .empty: "No message yet."
    case .error: "Hello failed."
    case .offline: "Offline."
    }
}

private func scheduleBody(_ state: FeatureState) -> String {
    switch state {
    case .success: ScheduleFixture.sheetText()
    case .empty: "No stops on this sheet."
    case .error: "Couldn't load the schedule."
    case .offline: "Offline. Schedule not updated."
    }
}

private func coldStartBody(_ state: FeatureState) -> String {
    switch state {
    case .success:
        return "Cold start: no history yet. Coarse estimate only."
    case .empty:
        return "No estimate yet."
    case .error:
        return "Couldn't load the pace estimate."
    case .offline:
        return "Offline. Estimate not updated."
    }
}

private func exportBody(_ state: FeatureState) -> String {
    switch state {
    case .success: ScheduleFixture.exportText()
    case .empty: "Nothing to export."
    case .error: "Couldn't build the crew sheet."
    case .offline: "Offline. Crew sheet is ready to share from this device."
    }
}

private func outboxBody(_ state: FeatureState) -> String {
    switch state {
    case .success:
        let pending = OutboxOperation(id: "op-1", type: "ping", status: "pending", conflictKey: "ping:room")
        return "Pending \(OutboxPolicy.countPending([pending])). Safe retry \(OutboxPolicy.isSafeRetry(pending))."
    case .empty:
        return "Outbox is empty."
    case .error:
        let resolved = OutboxPolicy.resolve(ClientHTTPError(status: 422, message: "no", decision: "rejected"))
        return resolved.feedback
    case .offline:
        let resolved = OutboxPolicy.resolve(URLError(.notConnectedToInternet))
        return resolved.feedback
    }
}

private func authBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Signed out. Auth0 is the sign-in pocket."
    case .empty: "No session."
    case .error: "Sign-in failed."
    case .offline: "Offline. Can't reach Auth0."
    }
}

private func joinBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Invite code ready for preview."
    case .empty: "Enter an invite code."
    case .error: "That invite code was not found."
    case .offline: "Offline. Invite preview needs the network."
    }
}

private func athleteBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Athlete profile saved on this device."
    case .empty: "Name is required."
    case .error: "Couldn't save athlete setup."
    case .offline: "Offline. Setup will sync when the network returns."
    }
}

private func notifyBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Notification permission is the platform prompt."
    case .empty: "Notifications are off."
    case .error: "Notification permission was denied."
    case .offline: "Offline. Permission is decided on this device."
    }
}

private func checkInBody(_ state: FeatureState) -> String {
    switch state {
    case .success:
        let result = CheckIn.validate(arrivalAt: "2026-08-15T14:10:00.000Z", departureAt: "2026-08-15T14:16:00.000Z")
        if case .ok = result { return "Check-in queued." }
        return "Check-in queued."
    case .empty:
        if case .invalid(let message) = CheckIn.validate(arrivalAt: "", departureAt: "") { return message }
        return "Arrival and departure are required."
    case .error:
        if case .invalid(let message) = CheckIn.validate(arrivalAt: "2026-08-15T14:16:00.000Z", departureAt: "2026-08-15T14:10:00.000Z") {
            return message
        }
        return "Departure must be after arrival."
    case .offline:
        return "Offline. Check-in queued in the outbox."
    }
}

private func courseSettingsBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Cutoff and stoppage saved as a draft."
    case .empty: "No course settings yet."
    case .error: "Couldn't save course settings."
    case .offline: "Offline. Course settings stay on this device."
    }
}

private func stopEditBody(_ state: FeatureState) -> String {
    switch state {
    case .success: StopPlanCopy.saved
    case .empty: StopPlanCopy.empty
    case .error: StopPlanCopy.failed
    case .offline: StopPlanCopy.offline
    }
}

private func incidentsBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "No open incidents."
    case .empty: "No incidents."
    case .error: "Couldn't load incidents."
    case .offline: "Offline. Incidents not updated."
    }
}

private func gpxBody(_ state: FeatureState) -> String {
    switch state {
    case .success: CourseImportStage.calculating.message
    case .empty: "Choose a route file."
    case .error: "Couldn't read the route file."
    case .offline: "Offline. The file stays on this device until upload."
    }
}

private func mapBody(_ state: FeatureState) -> String {
    let title = ScheduleFormat.checkpointDisplayTitle(id: "aid-1", title: "Aid 1")
    switch state {
    case .success: return "MapLibre pocket. \(title)."
    case .empty: return "No course on the map."
    case .error: return "Couldn't load the map style."
    case .offline: return "Offline. Map tiles are unavailable."
    }
}

private func pickBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Tap the map to place a checkpoint."
    case .empty: "No checkpoint selected."
    case .error: "Couldn't save the checkpoint."
    case .offline: "Offline. Checkpoint placement needs the network."
    }
}

private func navigateBody(_ state: FeatureState) -> String {
    let miles = ScheduleFormat.milesRemaining(progressMeters: 1000, checkpointDistanceMeters: 2609.344)
    switch state {
    case .success: return "Navigate. \(miles) to the next aid."
    case .empty: return "No destination."
    case .error: return "Couldn't start navigation."
    case .offline: return "Offline. Navigation needs a route."
    }
}

private func locationBody(_ state: FeatureState) -> String {
    let sample = OutboxOperation(id: "loc-1", type: "ping", status: "pending", conflictKey: "ping:room")
    let merged = OutboxPolicy.merge([], sample, conflictKey: sample.conflictKey)
    switch state {
    case .success: return "Tracking. A sample every 3 min. Pending \(OutboxPolicy.countPending(merged))."
    case .empty: return "No location sample yet."
    case .error: return "Location permission was denied. Turn it on in Settings to share your position."
    case .offline: return "Offline. Sample queued in the outbox."
    }
}

private func runnerTrackBody(_ state: FeatureState) -> String {
    switch state {
    case .success: return "PATH · 12 POINTS"
    case .empty: return "NO PATH YET"
    case .error: return "The last path stays drawn and the ping chip ages to stale."
    case .offline: return "The last path stays drawn; new points appear after the connection returns."
    }
}

private func liveEtaBody(_ state: FeatureState) -> String {
    switch state {
    case .success: return "Finish ETA 14:20"
    case .empty: return "No Finish ETA row; the timeline shows planned times only."
    case .error: return "The last ETAs stay visible."
    case .offline: return "The last ETAs stay visible, marked old ping once the server's projection is stale."
    }
}

private func chatBody(_ state: FeatureState) -> String {
    let tokens = Mentions.parse("See @Ada at aid 1", members: [MentionMember(userId: "u1", displayName: "Ada")])
    let mentioned = tokens.contains { if case .mention(let name, _) = $0 { return name == "Ada" }; return false }
    switch state {
    case .success: return mentioned ? "Stream pocket. Mentioned Ada." : "Stream pocket."
    case .empty: return "No messages."
    case .error: return "Couldn't open the channel."
    case .offline: return "Offline. Message queued on this device."
    }
}

private func chatPrefsBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Mentions and check-ins notify."
    case .empty: "Alerts are off."
    case .error: "Couldn't save alert settings."
    case .offline: "Offline. Alert settings stay on this device."
    }
}

private func pushBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Push token queued for registration."
    case .empty: "No push token."
    case .error: "Push permission was denied."
    case .offline: "Offline. Token queued."
    }
}

private func profileBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Signed-in profile."
    case .empty: "Display name is empty."
    case .error: "Couldn't load profile."
    case .offline: "Offline. Profile not updated."
    }
}

private func membersBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "1 member on the roster."
    case .empty: "No members yet."
    case .error: "Couldn't update members."
    case .offline: "Offline. Roster not updated."
    }
}

private func activityImportBody(_ state: FeatureState) -> String {
    switch state {
    case .success: ActivityImport.successMessage
    case .empty: ActivityImport.emptyMessage
    case .error: ActivityImport.errorMessage
    case .offline: ActivityImport.offlineMessage
    }
}

private func stravaBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Strava disconnected."
    case .empty: "Strava is not connected."
    case .error: "Strava connection failed."
    case .offline: "Offline. Can't reach Strava."
    }
}

private func accountDeletionBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Account deleted. You are signed out."
    case .empty: AccountDeletion.confirmBody
    case .error: AccountDeletion.genericFailureMessage
    case .offline: AccountDeletion.offlineMessage
    }
}

private func shellBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Map Pace Chat Profile"
    case .empty: "Map Pace Chat Profile"
    case .error: "Couldn't open the shell."
    case .offline: "Offline. Shell is available on this device."
    }
}

private func loaderBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Three stones stack, then the stack clears and repeats."
    case .empty: "Loading."
    case .error: "Couldn't load."
    case .offline: "Offline. Waiting for a connection."
    }
}

/// Copy for clients/behavior/billing-purchase.md.
private func billingPurchaseBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Unlocked: you plus 1 crew member."
    case .empty: "No Race Pass yet. Buy one to open this race."
    case .error: "Couldn't complete the purchase."
    case .offline: "Offline. Purchases need the network."
    }
}

/// Copy for clients/behavior/billing-upgrade.md.
private func billingUpgradeBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Unlocked: unlimited crew."
    case .empty: "Race Pass: you plus 1 crew member (1 of 1 joined)."
    case .error: "This race is full. Ask the runner to add Full Crew so more crew can join."
    case .offline: "Offline. Purchases need the network."
    }
}

/// Copy for clients/behavior/billing-redeem.md.
private func billingRedeemBody(_ state: FeatureState) -> String {
    switch state {
    case .success: "Code redeemed. Unlocking your race."
    case .empty: "Have a code? Redeem it with the App Store or Google Play."
    case .error: "Couldn't open code redemption."
    case .offline: "Offline. Redeeming a code needs the network."
    }
}
