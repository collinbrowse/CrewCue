import Foundation
import Testing
@testable import CrewCueClientCore

@Test func inviteRouteReadsJoinLinksAndLeavesTheRest() {
    #expect(InviteLink.route("https://collinbrowse.github.io/crewcue/join/?code=123456") == .invite(InviteMatch(code: "123456", source: .link)))
    #expect(InviteLink.route("crewcue://join/654321") == .invite(InviteMatch(code: "654321", source: .link)))
    for withoutCode in [
        "https://collinbrowse.github.io/crewcue/join/",
        "https://collinbrowse.github.io/crewcue/join",
        "https://COLLINBROWSE.github.io/crewcue/join/?code=12",
        "https://collinbrowse.github.io/crewcue/join/x/?code=abc",
        "crewcue://join/",
        "crewcue://join/12345",
        "crewcue://JOIN"
    ] {
        #expect(InviteLink.route(withoutCode) == .withoutCode, "\(withoutCode)")
        #expect(InviteLink.isJoinLink(withoutCode), "\(withoutCode)")
    }
    for other in [
        "crewcue://dev/join-crew",
        "crewcue://strava",
        "https://collinbrowse.github.io/",
        "https://collinbrowse.github.io/crewcue/joinx/",
        "https://example.com/crewcue/join/?code=123456",
        "http://collinbrowse.github.io/crewcue/join/?code=123456",
        "",
        "not a url"
    ] {
        #expect(InviteLink.route(other) == nil, "\(other)")
    }
}

private let routeT0 = Date(timeIntervalSince1970: 1_795_000_000)

private func routeStore() -> OnboardingStore {
    OnboardingStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent("invite-route-\(UUID().uuidString)"))
}

@Test func signInJoinsOnlyACurrentConfirmedInvite() throws {
    let store = routeStore()
    // Link opened, never confirmed: nothing joins on sign-in.
    try store.pendingJoins.save(code: "123456", source: .link, userId: nil, now: routeT0)
    #expect(store.confirmedInviteForSignIn(now: routeT0) == nil)

    // Sign up to join: the next sign-in joins it.
    try store.mark(.join, invite: "123456", userId: nil, now: routeT0)
    #expect(store.confirmedInviteForSignIn(now: routeT0.addingTimeInterval(120))?.code == "123456")

    // A different code opened afterwards isn't the one confirmed.
    try store.pendingJoins.save(code: "654321", source: .link, userId: nil, now: routeT0.addingTimeInterval(130))
    #expect(store.confirmedInviteForSignIn(now: routeT0.addingTimeInterval(140)) == nil)

    // The confirmed code again, but past the lifetime (a shared device, days later): nothing joins.
    try store.pendingJoins.save(code: "123456", source: .link, userId: nil, now: routeT0.addingTimeInterval(150))
    #expect(store.confirmedInviteForSignIn(now: routeT0.addingTimeInterval(150))?.code == "123456")
    #expect(store.confirmedInviteForSignIn(now: routeT0.addingTimeInterval(OnboardingProgress.confirmedInviteLifetime + 1)) == nil)
}

@Test func givingUpAnInviteForgetsTheCodeAndTheConfirmation() throws {
    let store = routeStore()
    try store.pendingJoins.save(code: "123456", source: .link, userId: nil, now: routeT0)
    try store.mark(.join, invite: "123456", userId: nil, now: routeT0)
    try store.giveUpInvite(userId: nil)
    #expect(store.pendingJoins.read(userId: nil, now: routeT0) == nil)
    #expect(store.load(userId: nil).confirmedInvite == nil)

    // Reopening the same link: preview first, and sign-in joins nothing.
    try store.pendingJoins.save(code: "123456", source: .link, userId: nil, now: routeT0.addingTimeInterval(60))
    #expect(store.confirmedInviteForSignIn(now: routeT0.addingTimeInterval(60)) == nil)
    #expect(try store.read(signedIn: false, userId: nil, now: routeT0.addingTimeInterval(60)).state.step == .join)
}

@Test func givingUpWithNothingConfirmedWritesNoGuestFile() throws {
    let store = routeStore()
    try store.giveUpInvite(userId: "bo")
    #expect(!FileManager.default.fileExists(atPath: store.file(userId: nil).path))
}
