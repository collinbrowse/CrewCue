import Foundation
import Testing
@testable import CrewCueClientCore

private func race(
    _ roomId: String,
    role: String = "athlete",
    status: String = "unpaid",
    start: String? = "2026-08-15T12:00:00.000Z",
    course: Bool = true
) -> OnboardingRace {
    OnboardingRace(roomId: roomId, role: role, entitlementStatus: status, raceStartAt: start, hasCourse: course)
}

/// `races: nil` is a list that hasn't loaded; the default is a loaded, empty one.
private func resolve(
    signedIn: Bool = true,
    userId: String? = "ada",
    invite: String? = nil,
    races: [OnboardingRace]? = [],
    active: String? = nil,
    progress: OnboardingProgress = .empty
) -> OnboardingState {
    Onboarding.resolve(OnboardingInput(
        signedIn: signedIn, userId: userId, pendingInvite: invite, races: races, activeRoomId: active, progress: progress
    ))
}

private func store() -> (store: OnboardingStore, storageRoot: URL) {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("onboarding-\(UUID().uuidString)", isDirectory: true)
    let root = base.appendingPathComponent("crewcue", isDirectory: true)
    return (OnboardingStore(directory: OnboardingStore.directory(besideStorageRoot: root)), root)
}

@Test func onboardingWithNoRaceAndNoInviteShowsTheChooser() {
    let state = resolve()
    #expect(state == .chooser)
    #expect(resolve(signedIn: false, userId: nil) == .chooser)
}

@Test func onboardingFreshRunnerGetsThePhaseOneSteps() throws {
    var progress = OnboardingProgress(choice: .runner)
    var state = resolve(signedIn: false, userId: nil, progress: progress)
    #expect(state.flow == .runner)
    #expect(state.phase == .setup)
    #expect(state.step == .account)
    #expect(state.showsTabBar == false)
    #expect(state.steps.prefix(5).map(\.step) == OnboardingStep.runnerSetup)
    #expect(state.steps.map(\.step) == OnboardingStep.runnerSetup + OnboardingStep.runnerPreview + OnboardingStep.runnerTour)
    #expect(state.checklist.map(\.step) == OnboardingStep.runnerChecklist)
    #expect(state.steps.allSatisfy { !$0.isComplete })

    // Signed in, no name saved yet: still the account step.
    #expect(resolve(progress: progress).step == .account)
    try progress.record(.account, outcome: .done, roomId: nil)
    state = resolve(progress: progress)
    #expect(state.step == .course)
    #expect(state.roomId == nil)

    // The race exists (course uploaded), the start is set: history, then the teaser.
    state = resolve(races: [race("r1", start: nil)], progress: progress)
    #expect(state.step == .startTime)
    #expect(state.roomId == "r1")
    state = resolve(races: [race("r1")], progress: progress)
    #expect(state.step == .history)
    try progress.record(.history, outcome: .skipped, roomId: nil)
    state = resolve(races: [race("r1")], progress: progress)
    #expect(state.step == .projectionTeaser)
    #expect(state.status(.history)?.outcome == .skipped)
    try progress.record(.projectionTeaser, outcome: .done, roomId: "r1")

    // Phase 2: the replay (skippable), then the paywall. The tab bar shows from here on.
    state = resolve(races: [race("r1")], progress: progress)
    #expect(state.phase == .preview && state.step == .preview && state.showsTabBar)
    try progress.record(.preview, outcome: .skipped, roomId: "r1")
    state = resolve(races: [race("r1")], progress: progress)
    #expect(state.step == .paywall)
    #expect(state.flow == .runner)
}

@Test func onboardingRaceWithoutCourseKeepsTheCourseStep() {
    let progress = OnboardingProgress(choice: .runner, account: [.account: .done])
    #expect(resolve(races: [race("r1", course: false)], progress: progress).step == .course)
}

@Test func onboardingPaidRaceGoesToTheTour() throws {
    var progress = OnboardingProgress.empty
    var state = resolve(races: [race("r1", status: "paid")], progress: progress)
    #expect(state.flow == .runner)
    #expect(state.phase == .tour)
    #expect(state.step == .invites)
    #expect(state.showsTabBar)
    #expect([.account, .course, .startTime, .history, .projectionTeaser, .preview, .paywall].allSatisfy {
        state.status($0)?.isComplete == true
    })
    // Paid, the course and start time are checklist items, never setup steps.
    #expect(state.steps.map(\.step) == [.account, .history, .projectionTeaser] + OnboardingStep.runnerPreview + OnboardingStep.runnerTour)
    for step in OnboardingStep.runnerTour {
        try progress.record(step, outcome: step == .location ? .deferred : .done, roomId: "r1", role: .runner)
    }
    state = resolve(races: [race("r1", status: "paid")], progress: progress)
    #expect(state.flow == .done)
    #expect(state.role == .runner)
    #expect(state.roomId == "r1")
    #expect(state.status(.location)?.outcome == .deferred)
    // The optional checklist never blocks done and stays visible until ticked.
    #expect(state.checklist.map(\.step) == [.course, .startTime, .etaEdits, .checkpointDetails])
    #expect(state.checklist.filter { !$0.isComplete }.map(\.step) == [.etaEdits, .checkpointDetails])
    try progress.record(.etaEdits, outcome: .done, roomId: "r1")
    #expect(resolve(races: [race("r1", status: "paid")], progress: progress).status(.etaEdits)?.isComplete == true)
}

@Test func onboardingPaidRaceKeepsTheTabBarWithoutCourseOrStartTime() {
    let state = resolve(races: [race("r1", status: "paid", start: nil, course: false)])
    #expect(state.flow == .runner)
    #expect(state.phase == .tour && state.step == .invites)
    #expect(state.showsTabBar)
    #expect(state.checklist.filter { !$0.isComplete }.map(\.step) == [.course, .startTime, .etaEdits, .checkpointDetails])
    // Unpaid, a missing start time is still a setup step.
    #expect(resolve(races: [race("r1", start: nil)], progress: OnboardingProgress(account: [.account: .done])).step == .startTime)
}

@Test func onboardingTreatsTheLegacyActivatedAtAsTheStartTime() throws {
    var room = try JSONDecoder().decode(RoomEnvelope.self, from: try demoRoomData()).room
    room.raceStartAt = nil
    room.activatedAt = "2026-08-15T12:00:00.000Z"
    let legacy = OnboardingRace(room: room, userId: "runner-1")
    #expect(legacy.raceStartAt == "2026-08-15T12:00:00.000Z")
    let progress = OnboardingProgress(account: [.account: .done])
    #expect(resolve(races: [legacy], progress: progress).step == .history)
    room.activatedAt = "  "
    #expect(OnboardingRace(room: room, userId: "runner-1").raceStartAt == nil)
    #expect(OnboardingRace.raceClockStart(raceStartAt: "2026-08-15T13:00:00.000Z", activatedAt: "2026-08-15T12:00:00.000Z") == "2026-08-15T13:00:00.000Z")
}

@Test func onboardingExpiredRaceHasNothingToSetUp() {
    let state = resolve(races: [race("r1", status: "expired")])
    #expect(state.flow == .done)
    #expect(state.role == .runner)
}

@Test func onboardingPendingInviteGivesTheCrewFlow() throws {
    // Signed out: the invite preview first, then sign in once it's confirmed.
    var state = resolve(signedIn: false, userId: nil, invite: "tok-a")
    #expect(state.flow == .crew)
    #expect(state.phase == .join)
    #expect(state.step == .join)
    #expect(state.showsTabBar == false)
    #expect(state.steps.map(\.step) == OnboardingStep.crewJoin + OnboardingStep.crewTour)
    var guest = OnboardingProgress.empty
    #expect(throws: OnboardingError.inviteRequired) { try guest.record(.join, outcome: .done, roomId: nil) }
    try guest.record(.join, outcome: .done, roomId: nil, invite: "tok-a")
    state = resolve(signedIn: false, userId: nil, invite: "tok-a", progress: guest)
    #expect(state.step == .account)
    #expect(state.inviteConfirmed)

    // Signed in: accept it. A pending invite wins over the race the runner already has, and is
    // shown over that race's tab bar.
    state = resolve(invite: "tok-a", races: [race("r1", status: "paid")], active: "r1", progress: guest)
    #expect(state.flow == .crew)
    #expect(state.step == .join)
    #expect(state.roomId == nil)
    #expect(state.status(.account)?.isComplete == true)
    #expect(state.showsTabBar)
    // No race yet: the join is all there is.
    #expect(resolve(invite: "tok-a", progress: guest).showsTabBar == false)

    // Joined: the crew tour, for that race.
    state = resolve(races: [race("r2", role: "crew_member", status: "paid")])
    #expect(state.flow == .crew && state.phase == .tour && state.step == .runnerLocation && state.roomId == "r2")
    #expect(state.status(.join)?.isComplete == true)
}

@Test func onboardingInviteConfirmationCountsOnlyForThatInvite() throws {
    var guest = OnboardingProgress.empty
    try guest.record(.join, outcome: .done, roomId: nil, invite: "tok-a")
    // Invite A was confirmed and never signed in for; invite B starts over at its own preview.
    let other = resolve(signedIn: false, userId: nil, invite: "tok-b", progress: guest)
    #expect(other.step == .join)
    #expect(other.inviteConfirmed == false)
    // An invite the app can't name is never confirmed.
    #expect(resolve(signedIn: false, userId: nil, invite: "", progress: guest).step == .join)
    // Confirming B replaces A.
    try guest.record(.join, outcome: .done, roomId: nil, invite: " tok-b ")
    #expect(resolve(signedIn: false, userId: nil, invite: "tok-b", progress: guest).step == .account)
    #expect(resolve(signedIn: false, userId: nil, invite: "tok-a", progress: guest).step == .join)
    // The file keeps a digest, not the token.
    let saved = OnboardingProgress(jsonObject: guest.jsonObject)
    #expect(saved == guest)
    #expect(!"\(guest.jsonObject)".contains("tok-b"))
}

@Test func onboardingWithoutTheRaceListAndNothingSavedIsLoading() {
    // Signed in before `GET /race-rooms/mine` answers, on a device that never had the list.
    let state = resolve(races: nil, progress: OnboardingProgress(choice: .runner))
    #expect(state.flow == .loading)
    #expect(state.step == nil)
    #expect(state.showsTabBar == false)
    // A stored active race keeps the tab bar while the list loads.
    let stored = resolve(races: nil, active: "r1")
    #expect(stored.flow == .loading)
    #expect(stored.roomId == "r1")
    #expect(stored.showsTabBar)
    // A pending invite still shows its join, over the stored race's tab bar.
    let invited = resolve(invite: "tok-a", races: nil, active: "r1")
    #expect(invited.flow == .crew && invited.step == .join && invited.showsTabBar)
    // Signed out, races never apply: no loading.
    #expect(resolve(signedIn: false, userId: nil, races: nil) == .chooser)
}

@Test func onboardingWithoutTheRaceListResolvesFromTheSavedOne() throws {
    // A crew member who finished the tour relaunches at an aid station with no service.
    var crew = OnboardingProgress(account: [.account: .done], knownRaces: [race("r2", role: "crew_member", status: "paid")])
    for step in OnboardingStep.crewTour {
        try crew.record(step, outcome: .done, roomId: "r2", role: .crew)
    }
    var state = resolve(races: nil, active: "r2", progress: crew)
    #expect(state.flow == .done && state.role == .crew && state.roomId == "r2" && state.showsTabBar)

    // A paid runner keeps the tab bar too, never the course step.
    let runner = OnboardingProgress(choice: .runner, knownRaces: [race("r1", status: "paid", course: false)])
    state = resolve(races: nil, active: "r1", progress: runner)
    #expect(state.flow == .runner && state.phase == .tour && state.showsTabBar)

    // A fresh list wins over the saved one.
    #expect(resolve(races: [race("r1")], active: "r1", progress: runner).phase == .setup)
    // The saved list said no races: the chooser is right.
    #expect(resolve(races: nil, progress: OnboardingProgress(knownRaces: [])) == .chooser)
}

@Test func onboardingCrewChoiceWithoutInviteAsksForACode() {
    let state = resolve(signedIn: false, userId: nil, progress: OnboardingProgress(choice: .crew))
    #expect(state.flow == .crew)
    #expect(state.step == .join)
    #expect(state.inviteConfirmed == false)
}

@Test func onboardingFlowFollowsTheActiveRaceAndRole() throws {
    var progress = OnboardingProgress(choice: .runner, account: [.account: .done, .history: .done])
    for step in OnboardingStep.runnerTour {
        try progress.record(step, outcome: .done, roomId: "mine", role: .runner)
    }
    let races = [race("mine", status: "paid"), race("theirs", role: "crew_chief", status: "paid")]
    #expect(resolve(races: races, active: "mine", progress: progress).flow == .done)
    let crew = resolve(races: races, active: "theirs", progress: progress)
    #expect(crew.flow == .crew)
    #expect(crew.step == .runnerLocation)
    #expect(crew.roomId == "theirs")
    // A race the list no longer has falls back to the first one.
    #expect(resolve(races: races, active: "gone", progress: progress).roomId == "mine")
    // Signed out, the server's races are unknown.
    #expect(resolve(signedIn: false, userId: nil, races: races, active: "theirs", progress: progress).flow == .runner)

    // Crew tour progress is the user's, not the race's: a second crew race skips it.
    var crewProgress = progress
    for step in OnboardingStep.crewTour {
        try crewProgress.record(step, outcome: .skipped, roomId: "theirs", role: .crew)
    }
    #expect(resolve(races: races, active: "theirs", progress: crewProgress).flow == .done)
    let other = races + [race("third", role: "crew_member", status: "paid")]
    #expect(resolve(races: other, active: "third", progress: crewProgress).flow == .done)
}

@Test func onboardingToursAreSavedOncePerUserPerRole() throws {
    // The runner tour seen in one race is done in the next race where they run.
    var progress = OnboardingProgress(choice: .runner, account: [.account: .done, .history: .done])
    for step in OnboardingStep.runnerTour {
        try progress.record(step, outcome: .done, roomId: "r1", role: .runner)
    }
    let races = [race("r1", status: "paid"), race("r2", status: "paid")]
    #expect(resolve(races: races, active: "r2", progress: progress).flow == .done)
    // Setup stays per race: an unpaid second race still goes through preview and the paywall.
    let unpaidSecond = [race("r1", status: "paid"), race("r2")]
    let second = resolve(races: unpaidSecond, active: "r2", progress: progress)
    #expect(second.flow == .runner && second.phase == .setup && second.step == .projectionTeaser)
    try progress.record(.projectionTeaser, outcome: .done, roomId: "r2")
    try progress.record(.preview, outcome: .done, roomId: "r2")
    #expect(resolve(races: unpaidSecond, active: "r2", progress: progress).step == .paywall)

    // Mixed roles: the runner tour does not complete the crew tour, `notifications` is per role.
    let mixed = [race("mine", status: "paid"), race("theirs", role: "crew_member", status: "paid")]
    let crew = resolve(races: mixed, active: "theirs", progress: progress)
    #expect(crew.flow == .crew && crew.step == .runnerLocation)
    #expect(crew.status(.notifications)?.outcome == nil)
    for step in OnboardingStep.crewTour {
        try progress.record(step, outcome: .done, roomId: "theirs", role: .crew)
    }
    #expect(progress.tourOutcome(.notifications, role: .crew) == .done)
    #expect(resolve(races: mixed, active: "theirs", progress: progress).flow == .done)
    #expect(resolve(races: mixed, active: "mine", progress: progress).flow == .done)

    // Crew first: the runner tour is still open for their own race.
    var crewOnly = OnboardingProgress(account: [.account: .done, .history: .done])
    for step in OnboardingStep.crewTour {
        try crewOnly.record(step, outcome: .done, roomId: "theirs", role: .crew)
    }
    let runnerState = resolve(races: mixed, active: "mine", progress: crewOnly)
    #expect(runnerState.flow == .runner && runnerState.phase == .tour && runnerState.step == .invites)

    // `notifications` without a role or a known race can't be placed.
    var bare = OnboardingProgress.empty
    #expect(throws: OnboardingError.roleRequired(.notifications)) { try bare.record(.notifications, outcome: .done, roomId: "r1") }
}

@Test func onboardingToursSurviveAFileRoundTrip() throws {
    let (onboarding, _) = store()
    try onboarding.mark(.invites, roomId: "r1", userId: "ada")
    try onboarding.mark(.notifications, roomId: "r2", role: .crew, userId: "ada")
    let loaded = onboarding.load(userId: "ada")
    #expect(loaded.tourOutcome(.invites, role: .runner) == .done)
    #expect(loaded.tourOutcome(.notifications, role: .crew) == .done)
    #expect(loaded.tourOutcome(.notifications, role: .runner) == nil)
    #expect(loaded.races.isEmpty)
}

@Test func onboardingExistingAccountWithAPaidRaceSkipsTheTours() throws {
    let (onboarding, _) = store()
    let paid = race("r1", status: "paid")
    let unpaid = race("r2")
    // The list is unknown: no shortcut, and nothing is saved.
    var progress = try onboarding.progress(signedIn: true, userId: "ada", races: nil)
    #expect(progress == .empty)
    #expect(resolve(races: nil, progress: progress).flow == .loading)

    // No file, a loaded list with a paid race: straight to the tab bar, optional items open.
    progress = try onboarding.progress(signedIn: true, userId: "ada", races: [paid])
    var state = resolve(races: [paid], active: "r1", progress: progress)
    #expect(state.flow == .done && state.showsTabBar && state.role == .runner)
    let optional = state.checklist.filter { OnboardingStep.runnerChecklist.contains($0.step) }
    #expect(optional.count == 2 && optional.allSatisfy { !$0.isComplete })
    // Crew races of that account skip the crew tour too.
    let crewPaid = race("r3", role: "crew_member", status: "paid")
    #expect(resolve(races: [paid, crewPaid], active: "r3", progress: progress).flow == .done)
    // It stays done on the next read, and after the user marks something.
    try onboarding.mark(.etaEdits, roomId: "r1", userId: "ada")
    progress = try onboarding.progress(signedIn: true, userId: "ada", races: [paid])
    #expect(resolve(races: [paid], active: "r1", progress: progress).flow == .done)

    // An unpaid race still goes through the normal flow (they have to pay).
    let (second, _) = store()
    progress = try second.progress(signedIn: true, userId: "bo", races: [unpaid])
    state = resolve(races: [unpaid], active: "r2", progress: progress)
    #expect(state.flow == .runner && state.phase == .setup)
    // A later paid race on an account that has already seen a list is not an existing account.
    progress = try second.progress(signedIn: true, userId: "bo", races: [unpaid, paid])
    #expect(progress.tours.isEmpty)

    // Any saved progress turns the shortcut off.
    let (third, _) = store()
    try third.choose(.runner, userId: "cy")
    progress = try third.progress(signedIn: true, userId: "cy", races: [paid])
    #expect(progress.tours.isEmpty)
    #expect(resolve(races: [paid], active: "r1", progress: progress).flow == .runner)
}

@Test func onboardingCrewOnAnUnpaidRaceIsLocked() {
    let races = [race("mine", status: "paid"), race("theirs", role: "crew_member", status: "unpaid")]
    let locked = resolve(races: races, active: "theirs", progress: OnboardingProgress(account: [.account: .done]))
    #expect(locked.flow == .raceLocked && locked.role == .crew && locked.roomId == "theirs")
    #expect(locked.showsTabBar && locked.step == nil && locked.phase == nil && locked.steps.isEmpty)
    #expect(locked.reason == "The runner hasn't unlocked this race yet.")
    // Also from the saved list while the live one hasn't answered.
    let saved = OnboardingProgress(knownRaces: races)
    #expect(resolve(races: nil, active: "theirs", progress: saved).flow == .raceLocked)
    // The runner on an unpaid race keeps the normal flow; a paid crew race tours; expired is done.
    #expect(resolve(races: [race("mine")], active: "mine").flow == .runner)
    #expect(resolve(races: [race("c", role: "crew_member", status: "paid")], active: "c").flow == .crew)
    #expect(resolve(races: [race("c", role: "crew_member", status: "expired")], active: "c").flow == .done)
}

@Test func onboardingRefusesStepsTheServerDecidesAndBadOutcomes() {
    var progress = OnboardingProgress.empty
    #expect(throws: OnboardingError.followsServer(.paywall)) { try progress.record(.paywall, outcome: .done, roomId: "r1") }
    #expect(throws: OnboardingError.followsServer(.course)) { try progress.record(.course, outcome: .done, roomId: "r1") }
    #expect(throws: OnboardingError.outcomeNotAllowed(.chat, .deferred)) { try progress.record(.chat, outcome: .deferred, roomId: "r1") }
    #expect(throws: OnboardingError.outcomeNotAllowed(.projectionTeaser, .skipped)) {
        try progress.record(.projectionTeaser, outcome: .skipped, roomId: "r1")
    }
    #expect(throws: OnboardingError.roomRequired(.preview)) { try progress.record(.preview, outcome: .done, roomId: " ") }
    #expect(progress == .empty)
}

@Test func onboardingResumesAfterRelaunch() throws {
    let (first, _) = store()
    try first.choose(.runner, userId: "ada")
    try first.mark(.account, userId: "ada")
    try first.mark(.history, outcome: .skipped, roomId: nil, userId: "ada")
    try first.mark(.projectionTeaser, roomId: "r1", userId: "ada")
    // The list answered once, so it is saved with the progress.
    _ = try first.progress(signedIn: true, userId: "ada", races: [race("r1")])
    // A new process: a new store on the same directory.
    let relaunched = OnboardingStore(directory: first.directory)
    var state = resolve(races: [race("r1")], progress: relaunched.load(userId: "ada"))
    #expect(state.step == .preview)
    #expect(state.status(.history)?.outcome == .skipped)
    // Relaunched offline (or before the list answers): the same step, from the saved list.
    let offline = try relaunched.progress(signedIn: true, userId: "ada", races: nil)
    #expect(offline.knownRaces == [race("r1")])
    state = resolve(races: nil, active: "r1", progress: offline)
    #expect(state.step == .preview && state.roomId == "r1" && state.showsTabBar)
}

@Test func onboardingStoreSavesOnlyLoadedListsForSignedInUsers() throws {
    let (onboarding, _) = store()
    // Signed out: the guest file never keeps races.
    _ = try onboarding.progress(signedIn: false, userId: nil, races: [race("r1")])
    #expect(onboarding.load(userId: nil).knownRaces == nil)
    // Signed in without the list: nothing saved yet.
    #expect(try onboarding.progress(signedIn: true, userId: "ada", races: nil).knownRaces == nil)
    #expect(try onboarding.progress(signedIn: true, userId: "ada", races: [race("r1"), race("r2", role: "crew_member")]).knownRaces?.map(\.roomId) == ["r1", "r2"])
    // A later answer replaces it, an empty one included.
    #expect(try onboarding.progress(signedIn: true, userId: "ada", races: []).knownRaces == [])
    #expect(onboarding.load(userId: "ada").knownRaces == [])
    #expect(onboarding.load(userId: "bo").knownRaces == nil)
}

@Test func onboardingProgressSurvivesSignOutAndSignIn() async throws {
    let (onboarding, root) = store()
    try onboarding.choose(.runner, userId: "ada")
    try onboarding.mark(.account, userId: "ada")
    try onboarding.mark(.preview, outcome: .skipped, roomId: "r1", userId: "ada")
    let userDirectory = try UserStorage(root: root).directory(userId: "ada")
    try Data("{}".utf8).write(to: userDirectory.appendingPathComponent("outbox.json"))

    // iOS sign-out wipes every user; Android also deletes the whole storage root.
    try UserStorage(root: root).wipeAll()
    try FileManager.default.removeItem(at: root)
    // Sign-in: `adoptUser` removes everything in the root but this user's directory.
    try FileManager.default.createDirectory(at: root.appendingPathComponent("stale"), withIntermediateDirectories: true)
    let adopted = await RuntimeCall.perform(#"{"op":"adoptUser","storageDir":"\#(root.path)","userId":"ada"}"#)
    #expect(adopted.contains(#""ok":true"#))

    let progress = onboarding.load(userId: "ada")
    #expect(progress.choice == .runner)
    #expect(progress.outcome(.preview, roomId: "r1") == .skipped)
    #expect(resolve(races: [race("r1")], progress: progress).step == .history)
    #expect(onboarding.directory.deletingLastPathComponent().standardizedFileURL.path == root.deletingLastPathComponent().standardizedFileURL.path)
}

@Test func onboardingKeepsEachUserSeparate() throws {
    let (onboarding, _) = store()
    try onboarding.mark(.account, userId: "ada")
    try onboarding.mark(.invites, roomId: "r1", userId: "ada")
    try onboarding.mark(.etaEdits, roomId: "r1", userId: "ada")
    try onboarding.choose(.crew, userId: "bo")
    #expect(onboarding.load(userId: "ada").tourOutcome(.invites, role: .runner) == .done)
    #expect(onboarding.load(userId: "bo").tourOutcome(.invites, role: .runner) == nil)
    #expect(onboarding.load(userId: "bo").outcome(.account, roomId: nil) == nil)
    #expect(onboarding.load(userId: "ada").choice == nil)
    #expect(onboarding.file(userId: "ada") != onboarding.file(userId: "bo"))
    // Ids that need encoding still get their own file, never the signed-out one.
    #expect(onboarding.file(userId: "auth0|ada") != onboarding.file(userId: "auth0_ada"))
    #expect(onboarding.file(userId: "@signed-out") != onboarding.file(userId: nil))

    // Resetting one race clears its steps, not the user's tours.
    try onboarding.reset(userId: "ada", roomId: "r1")
    #expect(onboarding.load(userId: "ada").outcome(.etaEdits, roomId: "r1") == nil)
    #expect(onboarding.load(userId: "ada").tourOutcome(.invites, role: .runner) == .done)
    #expect(onboarding.load(userId: "ada").outcome(.account, roomId: nil) == .done)
    try onboarding.reset(userId: "ada")
    #expect(onboarding.load(userId: "ada") == .empty)
    #expect(onboarding.load(userId: "bo").choice == .crew)
}

@Test func onboardingAccountDeletionRemovesOnlyThatUsersFile() throws {
    let (onboarding, _) = store()
    try onboarding.mark(.account, userId: "ada")
    try onboarding.choose(.crew, userId: "bo")
    try onboarding.choose(.runner, userId: nil)
    try onboarding.removeUser("ada")
    #expect(!FileManager.default.fileExists(atPath: onboarding.file(userId: "ada").path))
    #expect(onboarding.load(userId: "bo").choice == .crew)
    // Blank never reaches the signed-out file.
    try onboarding.removeUser("  ")
    #expect(onboarding.load(userId: nil).choice == .runner)
    try onboarding.removeUser("ada")
}

@Test func onboardingSignInAdoptsTheSignedOutChoice() throws {
    let (onboarding, _) = store()
    try onboarding.mark(.history, outcome: .done, roomId: nil, userId: "ada")
    try onboarding.choose(.runner, userId: "ada")
    try onboarding.choose(.crew, userId: nil)
    try onboarding.mark(.join, roomId: nil, invite: "tok-a", userId: nil)
    try onboarding.mark(.history, outcome: .skipped, roomId: nil, userId: nil)
    let merged = try onboarding.adoptGuest(userId: "ada")
    #expect(merged.choice == .crew)
    #expect(merged.outcome(.history, roomId: nil) == .done)
    #expect(merged.outcome(.join, roomId: nil) == nil)
    #expect(!FileManager.default.fileExists(atPath: onboarding.file(userId: nil).path))
    #expect(onboarding.load(userId: "ada") == merged)
    // Nothing left to adopt: unchanged.
    #expect(try onboarding.adoptGuest(userId: "ada") == merged)
}

@Test func onboardingRaceReadsRoleEntitlementAndCourseFromTheRoom() throws {
    let room = try JSONDecoder().decode(RoomEnvelope.self, from: try demoRoomData()).room
    let mine = OnboardingRace(room: room, userId: "runner-1")
    #expect(mine.isRunner && mine.entitlementStatus == "unpaid" && mine.hasCourse && mine.raceStartAt != nil)
    var bare = room
    bare.course = nil
    bare.courseFileName = nil
    #expect(OnboardingRace(room: bare, userId: "runner-1").hasCourse == false)
}
