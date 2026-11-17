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

private func resolve(
    signedIn: Bool = true,
    userId: String? = "ada",
    invite: Bool = false,
    races: [OnboardingRace] = [],
    active: String? = nil,
    progress: OnboardingProgress = .empty
) -> OnboardingState {
    Onboarding.resolve(OnboardingInput(
        signedIn: signedIn, userId: userId, hasPendingInvite: invite, races: races, activeRoomId: active, progress: progress
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
    for step in OnboardingStep.runnerTour {
        try progress.record(step, outcome: step == .location ? .deferred : .done, roomId: "r1")
    }
    state = resolve(races: [race("r1", status: "paid")], progress: progress)
    #expect(state.flow == .done)
    #expect(state.role == .runner)
    #expect(state.roomId == "r1")
    #expect(state.status(.location)?.outcome == .deferred)
    // The optional checklist never blocks done and stays visible until ticked.
    #expect(state.checklist.map(\.step) == [.etaEdits, .checkpointDetails])
    #expect(state.checklist.allSatisfy { !$0.isComplete })
    try progress.record(.etaEdits, outcome: .done, roomId: "r1")
    #expect(resolve(races: [race("r1", status: "paid")], progress: progress).status(.etaEdits)?.isComplete == true)
}

@Test func onboardingPaidRaceWithoutStartTimeAsksForIt() {
    #expect(resolve(races: [race("r1", status: "paid", start: nil)]).step == .startTime)
}

@Test func onboardingExpiredRaceHasNothingToSetUp() {
    let state = resolve(races: [race("r1", status: "expired")])
    #expect(state.flow == .done)
    #expect(state.role == .runner)
}

@Test func onboardingPendingInviteGivesTheCrewFlow() throws {
    // Signed out: the invite preview first, then sign in once it's confirmed.
    var state = resolve(signedIn: false, userId: nil, invite: true)
    #expect(state.flow == .crew)
    #expect(state.phase == .join)
    #expect(state.step == .join)
    #expect(state.showsTabBar == false)
    #expect(state.steps.map(\.step) == OnboardingStep.crewJoin + OnboardingStep.crewTour)
    var guest = OnboardingProgress.empty
    try guest.record(.join, outcome: .done, roomId: nil)
    state = resolve(signedIn: false, userId: nil, invite: true, progress: guest)
    #expect(state.step == .account)
    #expect(state.inviteConfirmed)

    // Signed in: accept it. A pending invite wins over the race the runner already has.
    state = resolve(invite: true, races: [race("r1", status: "paid")], active: "r1", progress: guest)
    #expect(state.flow == .crew)
    #expect(state.step == .join)
    #expect(state.roomId == nil)
    #expect(state.status(.account)?.isComplete == true)

    // Joined: the crew tour, for that race.
    state = resolve(races: [race("r2", role: "crew_member", status: "paid")])
    #expect(state.flow == .crew && state.phase == .tour && state.step == .runnerLocation && state.roomId == "r2")
    #expect(state.status(.join)?.isComplete == true)
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
        try progress.record(step, outcome: .done, roomId: "mine")
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

    // Crew tour progress is that race's: a second crew race starts its own tour.
    var crewProgress = progress
    for step in OnboardingStep.crewTour {
        try crewProgress.record(step, outcome: .skipped, roomId: "theirs")
    }
    #expect(resolve(races: races, active: "theirs", progress: crewProgress).flow == .done)
    let other = races + [race("third", role: "crew_member", status: "paid")]
    #expect(resolve(races: other, active: "third", progress: crewProgress).step == .runnerLocation)
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
    // A new process: a new store on the same directory.
    let relaunched = OnboardingStore(directory: first.directory)
    let state = resolve(races: [race("r1")], progress: relaunched.load(userId: "ada"))
    #expect(state.step == .preview)
    #expect(state.status(.history)?.outcome == .skipped)
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
    try onboarding.choose(.crew, userId: "bo")
    #expect(onboarding.load(userId: "ada").outcome(.invites, roomId: "r1") == .done)
    #expect(onboarding.load(userId: "bo").outcome(.invites, roomId: "r1") == nil)
    #expect(onboarding.load(userId: "bo").outcome(.account, roomId: nil) == nil)
    #expect(onboarding.load(userId: "ada").choice == nil)
    #expect(onboarding.file(userId: "ada") != onboarding.file(userId: "bo"))
    // Ids that need encoding still get their own file, never the signed-out one.
    #expect(onboarding.file(userId: "auth0|ada") != onboarding.file(userId: "auth0_ada"))
    #expect(onboarding.file(userId: "@signed-out") != onboarding.file(userId: nil))

    try onboarding.reset(userId: "ada", roomId: "r1")
    #expect(onboarding.load(userId: "ada").outcome(.invites, roomId: "r1") == nil)
    #expect(onboarding.load(userId: "ada").outcome(.account, roomId: nil) == .done)
    try onboarding.reset(userId: "ada")
    #expect(onboarding.load(userId: "ada") == .empty)
    #expect(onboarding.load(userId: "bo").choice == .crew)
}

@Test func onboardingSignInAdoptsTheSignedOutChoice() throws {
    let (onboarding, _) = store()
    try onboarding.mark(.history, outcome: .done, roomId: nil, userId: "ada")
    try onboarding.choose(.runner, userId: "ada")
    try onboarding.choose(.crew, userId: nil)
    try onboarding.mark(.join, roomId: nil, userId: nil)
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
