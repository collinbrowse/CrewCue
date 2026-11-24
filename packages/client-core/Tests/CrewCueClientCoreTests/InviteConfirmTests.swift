import Foundation
import Testing
@testable import CrewCueClientCore

@Test func previewLineCountsMembers() {
    func line(_ count: Double) -> String {
        InviteCopy.previewLine(RaceRoomJoinPreview(roomName: "Western States 100", joinCode: "123456", status: "active", memberCount: count, members: []))
    }
    #expect(line(1) == "Western States 100, 1 member, active")
    #expect(line(2) == "Western States 100, 2 members, active")
    #expect(line(0) == "Western States 100, 0 members, active")
}

@Test func shareDetailsCarryTheLinkTheCodeAndTheLock() throws {
    func room(code: String?, status: String) -> RaceRoom {
        RaceRoom(
            id: "r1", joinCode: code, teamId: "t", athleteId: "a", name: "Western States 100", status: "active",
            createdAt: "2026-11-24T00:00:00.000Z", memberships: [],
            entitlement: RaceRoomEntitlement(status: status, lastUpdatedAt: "2026-11-24T00:00:00.000Z", source: "manual")
        )
    }
    let paid = try #require(InviteCopy.shareDetails(for: room(code: "123456", status: "paid")))
    #expect(paid.code == "123456")
    #expect(paid.link.absoluteString == "https://collinbrowse.github.io/crewcue/join/?code=123456")
    #expect(paid.shareText == InviteLink.shareText(raceName: "Western States 100", code: "123456"))
    #expect(!paid.locked && paid.status == InviteCopy.shareReady)
    let unpaid = try #require(InviteCopy.shareDetails(for: room(code: "123456", status: "unpaid")))
    #expect(unpaid.locked && unpaid.status == InviteCopy.shareLocked)
    #expect(InviteCopy.shareDetails(for: room(code: nil, status: "paid")) == nil)
    #expect(InviteCopy.shareDetails(for: room(code: "12345", status: "paid")) == nil)
}

@Test func joinFeedbackNamesTheRaceOrTheCode() {
    #expect(InviteCopy.joinedRace(" Western  States ") == "Joined Western States.")
    #expect(InviteCopy.joinedRace("") == "Joined the race.")
    #expect(InviteCopy.joinFailed(code: "123456", message: "That invite code was not found.") == "Code 123456: That invite code was not found.")
}

@Test func oneRaceFullMessageForJoinAndPendingJoin() {
    #expect(PendingJoinOutcome.raceFullMessage == BillingErrors.crewLimitForCrew.message)
    #expect(PendingJoinOutcome.raceFull.message == BillingErrors.crewLimitForCrew.message)
}

// MARK: Confirmed invite lifetime

private func onboardingStores() -> (OnboardingStore, PendingJoinStore) {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("invite-confirm-\(UUID().uuidString)")
    let store = OnboardingStore(directory: dir)
    return (store, store.pendingJoins)
}

private let confirmT0 = Date(timeIntervalSince1970: 1_795_000_000)

@Test func aConfirmedInviteCountsOnlyForItsLifetime() throws {
    let (store, pending) = onboardingStores()
    try pending.save(code: "123456", source: .link, userId: nil, now: confirmT0)
    try store.mark(.join, invite: "123456", userId: nil, now: confirmT0)
    let soon = confirmT0.addingTimeInterval(OnboardingProgress.confirmedInviteLifetime - 60)
    let current = try store.read(signedIn: false, userId: nil, now: soon)
    #expect(current.state.inviteConfirmed && current.state.step == .account)

    // Past the lifetime: the preview again (step join), and nothing auto-joins on sign-in.
    let late = confirmT0.addingTimeInterval(OnboardingProgress.confirmedInviteLifetime + 1)
    let expired = try store.read(signedIn: false, userId: nil, now: late)
    #expect(!expired.state.inviteConfirmed && expired.state.step == .join)
    // A clock moved back doesn't stretch it either.
    let back = confirmT0.addingTimeInterval(-OnboardingProgress.confirmedInviteLifetime - 1)
    #expect(try !store.read(signedIn: false, userId: nil, now: back).state.inviteConfirmed)
}

@Test func aConfirmationWithoutATimeDoesNotCount() {
    var progress = OnboardingProgress()
    progress.confirmedInvite = OnboardingProgress.inviteKey("123456")
    #expect(progress.inviteConfirmed("123456"))
    #expect(!progress.inviteConfirmed("123456", at: confirmT0))
    #expect(progress.withCurrentConfirmation(at: confirmT0).confirmedInvite == nil)
}

@Test func theConfirmationTimeSurvivesTheFile() throws {
    var progress = OnboardingProgress()
    try progress.record(.join, outcome: .done, roomId: nil, invite: "123456", at: confirmT0.addingTimeInterval(0.0004))
    let read = OnboardingProgress(jsonObject: progress.jsonObject)
    #expect(read == progress)
    #expect(read.confirmedInviteAt == confirmT0)
}

@Test func backAfterConfirmingThenReopeningTheLinkShowsThePreviewAndJoinsNothing() throws {
    let (store, pending) = onboardingStores()
    // Link opened, Sign up to join, then Back: the app clears the code and the confirmation.
    try pending.save(code: "123456", source: .link, userId: nil, now: confirmT0)
    try store.mark(.join, invite: "123456", userId: nil, now: confirmT0)
    try pending.clear()
    try store.clearConfirmedInvite(userId: nil)
    #expect(store.load(userId: nil).confirmedInvite == nil)

    // The same link again a minute later: the preview, not the sign-in.
    let later = confirmT0.addingTimeInterval(60)
    try pending.save(code: "123456", source: .link, userId: nil, now: later)
    let reopened = try store.read(signedIn: false, userId: nil, now: later)
    #expect(reopened.state.step == .join && !reopened.state.inviteConfirmed)

    // Signed in, it is still the join screen (accept by hand), never a confirmed invite.
    let signedIn = try store.read(signedIn: true, userId: "bo", races: [], now: later)
    #expect(!signedIn.state.inviteConfirmed && signedIn.state.step == .join)
}

@Test func clearIfStillLeavesANewerCode() throws {
    let (_, pending) = onboardingStores()
    let first = try pending.save(code: "111111", source: .link, userId: "bo", now: confirmT0)
    try pending.save(code: "222222", source: .link, userId: "bo", now: confirmT0.addingTimeInterval(1))
    #expect(try !pending.clear(ifStill: first))
    #expect(pending.read(userId: "bo", now: confirmT0)?.code == "222222")
}
