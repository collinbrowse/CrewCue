import Foundation
import Testing
@testable import CrewCueClientCore

private let room = "4f3c2a10-8d1e-4c55-9a4b-2f0e6d7c8b91"

@Test func pushTapReadsTheKindsTheApiSends() {
    #expect(PushTapRoute.parse(type: "chat", roomId: room) == .chat(roomId: room))
    #expect(PushTapRoute.parse(type: "tracking", roomId: room) == .tracking(roomId: room))
    #expect(PushTapRoute.parse(type: "unlock", roomId: room) == .unlock(roomId: room))
    // Payloads sent before kinds existed carry no `type`: chat, as before.
    #expect(PushTapRoute.parse(type: nil, roomId: room) == .chat(roomId: room))
    #expect(PushTapRoute.parse(type: " Tracking ", roomId: " \(room) ") == .tracking(roomId: room))
}

@Test func pushTapIgnoresUnknownKindsAndMissingRooms() {
    for kind in ["schedule", "invite", "tracking2", "unlocked"] {
        #expect(PushTapRoute.parse(type: kind, roomId: room) == nil, "\(kind)")
    }
    for bad in [nil, "", "   ", "a b", String(repeating: "x", count: 129)] as [String?] {
        #expect(PushTapRoute.parse(type: "tracking", roomId: bad) == nil, "\(String(describing: bad))")
    }
}

@Test func pushTapReadsNotificationUserInfo() {
    let apns: [AnyHashable: Any] = ["aps": ["alert": ["title": "Start tracking"]], "type": "tracking", "roomId": room]
    #expect(PushTapRoute.parse(userInfo: apns) == .tracking(roomId: room))
    #expect(PushTapRoute.parse(userInfo: ["roomId": room]) == .chat(roomId: room))
    #expect(PushTapRoute.parse(userInfo: ["type": "unlock"]) == nil)
    #expect(PushTapRoute.parse(userInfo: ["type": 3, "roomId": room]) == nil)
    #expect(PushTapRoute.parse(userInfo: ["type": "unlock", "roomId": 42]) == nil)
    #expect(PushTapRoute.parse(userInfo: [:]) == nil)
}

private func race(_ id: String = room, role: String = "athlete", owner: String? = "u1", paid: Bool? = false) -> RaceSummary {
    RaceSummary(id: id, name: "Western States", role: role, ownerId: owner, paid: paid)
}

@Test func pushTapOpensTheRouteForTheRunnersOwnRace() {
    let races = [race()]
    func resolve(_ route: PushTapRoute) -> PushTapResolution {
        route.resolve(signedIn: true, userId: "u1", races: races, listedSinceTap: false)
    }
    #expect(resolve(.chat(roomId: room)) == .open(roomId: room, destination: .chat))
    #expect(resolve(.tracking(roomId: room)) == .open(roomId: room, destination: .startTracking))
    #expect(resolve(.unlock(roomId: room)) == .open(roomId: room, destination: .paywall))
}

@Test func pushTapUnlockOnAPaidOrCrewRaceOpensTheMap() {
    let paid = [race(paid: true)]
    #expect(PushTapRoute.unlock(roomId: room).resolve(signedIn: true, userId: "u1", races: paid, listedSinceTap: true)
        == .open(roomId: room, destination: .map))
    let crew = [race(role: "crew_member", owner: "runner")]
    #expect(PushTapRoute.unlock(roomId: room).resolve(signedIn: true, userId: "u1", races: crew, listedSinceTap: true)
        == .open(roomId: room, destination: .map))
    #expect(PushTapRoute.tracking(roomId: room).resolve(signedIn: true, userId: "u1", races: crew, listedSinceTap: true)
        == .open(roomId: room, destination: .map))
}

@Test func pushTapWaitsForTheRaceListThenDropsARaceThatIsNotTheUsers() {
    let other = [race("another-room")]
    #expect(PushTapRoute.tracking(roomId: room).resolve(signedIn: true, userId: "u1", races: other, listedSinceTap: false) == .awaitRaces)
    #expect(PushTapRoute.tracking(roomId: room).resolve(signedIn: true, userId: "u1", races: other, listedSinceTap: true) == .drop)
    #expect(PushTapRoute.unlock(roomId: room).resolve(signedIn: true, userId: "u1", races: [], listedSinceTap: true) == .drop)
}

@Test func pushTapSignedOutIsHeldUntilSignIn() {
    #expect(PushTapRoute.unlock(roomId: room).resolve(signedIn: false, userId: nil, races: [], listedSinceTap: true) == .holdUntilSignIn)

    var inbox = PushTapInbox()
    inbox.receive(.unlock(roomId: room))
    #expect(inbox.take(signedIn: false, userId: nil, races: []) == .holdUntilSignIn)
    #expect(inbox.pending == .unlock(roomId: room))
    // Signed in: the restored session has no list yet, then the list answers.
    #expect(inbox.take(signedIn: true, userId: "u1", races: []) == .awaitRaces)
    inbox.noteRacesListed()
    #expect(inbox.take(signedIn: true, userId: "u1", races: [race()]) == .open(roomId: room, destination: .paywall))
    #expect(inbox.pending == nil)
    #expect(inbox.take(signedIn: true, userId: "u1", races: [race()]) == nil)
}

@Test func pushTapHeldForOneAccountNeverOpensAnothersRace() {
    var inbox = PushTapInbox()
    inbox.receive(.tracking(roomId: room))
    #expect(inbox.take(signedIn: false, userId: nil, races: []) == .holdUntilSignIn)
    // Someone else signs in: their list doesn't have the race.
    #expect(inbox.take(signedIn: true, userId: "u2", races: [race("theirs", owner: "u2")]) == .awaitRaces)
    inbox.noteRacesListed()
    #expect(inbox.take(signedIn: true, userId: "u2", races: [race("theirs", owner: "u2")]) == .drop)
    #expect(inbox.pending == nil)
}

@Test func pushTapNewerTapReplacesTheHeldOneAndSignOutClears() {
    var inbox = PushTapInbox()
    inbox.receive(.chat(roomId: "a"))
    inbox.noteRacesListed()
    #expect(inbox.listedSinceTap)
    inbox.receive(.unlock(roomId: room))
    #expect(inbox.pending == .unlock(roomId: room))
    // A list read before the newer tap says nothing about it.
    #expect(!inbox.listedSinceTap)
    inbox.clear()
    #expect(inbox.pending == nil)
    // A list answering with nothing held marks nothing.
    inbox.noteRacesListed()
    #expect(!inbox.listedSinceTap)
}

@Test func unpaidBannerExpiryCountsWholeDaysLikeTheReminders() {
    let now = Date(timeIntervalSince1970: 1_795_000_000)
    func iso(_ offset: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(offset))
    }
    let day: TimeInterval = 86_400
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: iso(7 * day), now: now) == "Expires in 7 days")
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: iso(7 * day - 60), now: now) == "Expires in 6 days")
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: iso(day + 3600), now: now) == "Expires in 1 day")
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: iso(3600), now: now) == "Expires in 1 day")
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: iso(-1), now: now) == nil)
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: nil, now: now) == nil)
    #expect(OnboardingCopy.unpaidExpiry(expiresAt: "soon", now: now) == nil)
}

@Test func raceSummaryCarriesTheUnpaidExpiryAndOldSummariesStillDecode() throws {
    let old = #"{"id":"a","name":"A","role":"athlete","paid":false}"#
    let decoded = try JSONDecoder().decode(RaceSummary.self, from: Data(old.utf8))
    #expect(decoded.unpaidExpiresAt == nil)
}
