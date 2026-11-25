import Foundation

/// Android's push-tap ops (clients/behavior/push-tap.md). The payload read, the hold and the
/// destination are `PushTapRoute` and `PushTapInbox`; the app keeps the inbox as the opaque
/// `inbox` object these ops answer and maps the answer onto its navigation.
///
/// - `pushTapReceive`: `type?` and `roomId?`, the tapped notification's FCM `data` keys →
///   `inbox`: the held tap (`type`, `roomId`, `listedSinceTap`), or null when the payload isn't
///   one this build routes (the tap opens the app where it was).
/// - `pushTapTake`: `inbox` (from `pushTapReceive` or the last `pushTapTake`), `signedIn`,
///   `userId`, `races` (the last `myRaces` rows; left out while the list is unknown) and
///   `racesListed` (true right after the race list answered) → `resolution` (`open`,
///   `holdUntilSignIn`, `awaitRaces`, `drop`, or `none` with nothing held), `roomId` and
///   `destination` (`chat`, `startTracking`, `map`, `paywall`) for `open`, and `inbox`: what is
///   still held, or null.
/// - `unpaidExpiry`: `expiresAt?` (a race's `unpaidExpiresAt`) and `now?` (ISO, tests only) →
///   `text`: "Expires in N days" (`OnboardingCopy.unpaidExpiry`) or null.
extension RuntimeCall {
    static func pushTapReceive(_ object: [String: Any]) -> Any {
        // Values that aren't strings count as missing, as on iOS (`parse(userInfo:)`).
        let rawType = object["type"]
        let type = rawType as? String
        if rawType != nil, !(rawType is NSNull), type == nil { return ["inbox": NSNull()] }
        guard let route = PushTapRoute.parse(type: type, roomId: object["roomId"] as? String) else {
            return ["inbox": NSNull()]
        }
        var inbox = PushTapInbox()
        inbox.receive(route)
        return ["inbox": inboxJSON(inbox)]
    }

    static func pushTapTake(_ object: [String: Any]) -> Any {
        var inbox = pushTapInbox(object["inbox"] as? [String: Any])
        if boolValue(object["racesListed"]) == true { inbox.noteRacesListed() }
        let races = (object["races"] as? [Any] ?? []).compactMap(raceSummary)
        let resolution = inbox.take(
            signedIn: boolValue(object["signedIn"]) ?? false,
            userId: text(object, "userId"),
            races: races
        )
        var answer: [String: Any] = ["inbox": inboxJSON(inbox)]
        switch resolution {
        case nil: answer["resolution"] = "none"
        case .holdUntilSignIn: answer["resolution"] = "holdUntilSignIn"
        case .awaitRaces: answer["resolution"] = "awaitRaces"
        case .drop: answer["resolution"] = "drop"
        case .open(let roomId, let destination):
            answer["resolution"] = "open"
            answer["roomId"] = roomId
            answer["destination"] = destinationName(destination)
        }
        return answer
    }

    static func unpaidExpiry(_ object: [String: Any]) -> Any {
        let now = text(object, "now").flatMap(ScheduleFormat.parseISO8601) ?? clock(object).now()
        let line = OnboardingCopy.unpaidExpiry(expiresAt: text(object, "expiresAt"), now: now)
        return ["text": line ?? NSNull()] as [String: Any]
    }

    private static func inboxJSON(_ inbox: PushTapInbox) -> Any {
        guard let route = inbox.pending else { return NSNull() }
        return [
            "type": routeType(route),
            "roomId": route.roomId,
            "listedSinceTap": inbox.listedSinceTap
        ] as [String: Any]
    }

    /// The inbox an `inboxJSON` object stands for: the tap received again, then the list mark.
    private static func pushTapInbox(_ object: [String: Any]?) -> PushTapInbox {
        var inbox = PushTapInbox()
        guard let object,
              let route = PushTapRoute.parse(type: object["type"] as? String, roomId: object["roomId"] as? String) else {
            return inbox
        }
        inbox.receive(route)
        if boolValue(object["listedSinceTap"]) == true { inbox.noteRacesListed() }
        return inbox
    }

    private static func routeType(_ route: PushTapRoute) -> String {
        switch route {
        case .chat: "chat"
        case .tracking: "tracking"
        case .unlock: "unlock"
        }
    }

    private static func destinationName(_ destination: PushTapDestination) -> String {
        switch destination {
        case .chat: "chat"
        case .startTracking: "startTracking"
        case .map: "map"
        case .paywall: "paywall"
        }
    }

    /// A `myRaces` row (a `RaceSummary` plus display fields) back into the summary.
    private static func raceSummary(_ row: Any) -> RaceSummary? {
        guard JSONSerialization.isValidJSONObject(row),
              let data = try? JSONSerialization.data(withJSONObject: row) else { return nil }
        return try? JSONDecoder().decode(RaceSummary.self, from: data)
    }
}
