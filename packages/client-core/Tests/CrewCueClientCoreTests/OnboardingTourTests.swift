import Foundation
import Testing
@testable import CrewCueClientCore

private let enUS = Locale(identifier: "en_US")
private let utc = TimeZone(identifier: "UTC")!

private func plain(_ text: String) -> String {
    text.replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
}

private let paidRunner = OnboardingRace(roomId: "room-1", role: "athlete", entitlementStatus: "paid", raceStartAt: "2026-08-15T13:00:00Z", hasCourse: true)
private let paidCrew = OnboardingRace(roomId: "room-2", role: "crew", entitlementStatus: "paid", raceStartAt: "2026-08-15T13:00:00Z", hasCourse: true)

private func state(_ race: OnboardingRace, _ progress: OnboardingProgress = .empty) -> OnboardingState {
    Onboarding.resolve(OnboardingInput(signedIn: true, userId: "u1", races: [race], activeRoomId: race.roomId, progress: progress))
}

private func progress(_ marks: [(OnboardingStep, OnboardingOutcome, OnboardingChoice)], room: String? = nil) throws -> OnboardingProgress {
    var progress = OnboardingProgress.empty
    progress.account[.account] = .done
    for (step, outcome, role) in marks {
        try progress.record(step, outcome: outcome, roomId: room, role: role)
    }
    return progress
}

// MARK: Tour cards

@Test func paidRunnerTourStartsWithInvitesOnTheProfileTab() throws {
    let card = try #require(OnboardingTour.card(for: state(paidRunner)))
    #expect(card.step == .invites)
    #expect(card.anchor == .profile)
    #expect(card.anchor?.accessibilityIdentifier == "crewcue.tab.profile")
    #expect(card.action == .shareInvite)
    #expect(card.primaryLabel == "Share invite")
    #expect(card.secondaryLabel == "Later")
    #expect(card.secondaryOutcome == .skipped)
    #expect(card.progressLabel == "1 of 5")
    #expect(card.accessibilityIdentifier == "crewcue.onboarding.tour.invites")
}

@Test func runnerTourWalksNotificationsLocationStartLineChat() throws {
    var marks: [(OnboardingStep, OnboardingOutcome, OnboardingChoice)] = [(.invites, .done, .runner)]
    let notifications = try #require(OnboardingTour.card(for: state(paidRunner, progress(marks))))
    #expect(notifications.step == .notifications)
    #expect(notifications.anchor == nil)
    #expect(notifications.action == .enableNotifications)
    #expect(notifications.body.contains("remind you to start tracking"))

    marks.append((.notifications, .skipped, .runner))
    let location = try #require(OnboardingTour.card(for: state(paidRunner, progress(marks))))
    #expect(location.step == .location)
    #expect(location.anchor == .map)
    #expect(location.primaryLabel == "Test tracking now")
    #expect(location.secondaryLabel == "On race morning")
    #expect(location.secondaryOutcome == .deferred)

    marks.append((.location, .deferred, .runner))
    let start = try #require(OnboardingTour.card(for: state(paidRunner, progress(marks))))
    #expect(start.step == .mapStartLine)
    #expect(start.action == .showStartLine)
    #expect(start.anchor == .map)

    marks.append((.mapStartLine, .done, .runner))
    let chat = try #require(OnboardingTour.card(for: state(paidRunner, progress(marks))))
    #expect(chat.step == .chat)
    #expect(chat.anchor == .chat)
    #expect(chat.primaryLabel == "Done")
    #expect(chat.progressLabel == "5 of 5")

    marks.append((.chat, .done, .runner))
    let finished = state(paidRunner, try progress(marks))
    #expect(finished.flow == .done)
    #expect(OnboardingTour.card(for: finished) == nil)
}

@Test func unpaidRunnerGetsNoTourCard() {
    let unpaid = OnboardingRace(roomId: "room-1", role: "athlete", entitlementStatus: "unpaid", raceStartAt: "2026-08-15T13:00:00Z", hasCourse: true)
    var progress = OnboardingProgress.empty
    progress.account = [.account: .done, .history: .done]
    progress.races["room-1"] = [.projectionTeaser: .done, .preview: .skipped]
    // The paywall stays open until the race is paid, so the tour waits for it.
    let resolved = state(unpaid, progress)
    #expect(resolved.phase == .preview)
    #expect(OnboardingTour.card(for: resolved) == nil)
}

@Test func crewTourCardsUseTheExampleRaceNotTheRealOne() throws {
    let demo = CrewTourDemo.fixture(timeZone: utc, locale: enUS)
    let dot = try #require(OnboardingTour.card(for: state(paidCrew), demo: demo))
    #expect(dot.step == .runnerLocation)
    #expect(dot.anchor == .map)
    #expect(dot.example == [TourExampleLine(label: "Runner", value: "Ada · Mile 13.0")])
    #expect(dot.progressLabel == "1 of 8")

    let age = try #require(OnboardingTour.card(step: .lastUpdateAge, role: .crew, demo: demo))
    #expect(age.example == [TourExampleLine(label: "Last update", value: "4 min ago")])

    let eta = try #require(OnboardingTour.card(step: .etaVsPlan, role: .crew, demo: demo))
    #expect(eta.anchor == .pace)
    #expect(eta.example.map(\.label) == ["Aid 2 ETA", "PLAN"])
    #expect(eta.example.map { plain($0.value) } == ["4:12 PM", "4:00 PM"])

    let directions = try #require(OnboardingTour.card(step: .directionsToNextAid, role: .crew, demo: demo))
    #expect(directions.anchor == .map)
    #expect(directions.example.first?.value == "Aid 2 · 2.5 mi ahead")

    #expect(OnboardingTour.card(step: .checkInWhenNoService, role: .crew)?.anchor == .pace)
    #expect(OnboardingTour.card(step: .editCheckpointDetails, role: .crew)?.anchor == .pace)
    #expect(OnboardingTour.card(step: .chatAndAlerts, role: .crew)?.anchor == .chat)
    let notifications = try #require(OnboardingTour.card(step: .notifications, role: .crew))
    #expect(notifications.position == 8)
    #expect(notifications.primaryLabel == "Turn on notifications")
    #expect(!notifications.body.contains("tracking"))
    // A runner-only step isn't in the crew tour.
    #expect(OnboardingTour.card(step: .location, role: .crew) == nil)
}

@Test func crewTourEndsAfterNotifications() throws {
    var marks = OnboardingStep.crewTour.dropLast().map { ($0, OnboardingOutcome.done, OnboardingChoice.crew) }
    let last = try #require(OnboardingTour.card(for: state(paidCrew, progress(marks))))
    #expect(last.step == .notifications)
    #expect(last.primaryLabel == "Turn on notifications")
    marks.append((.notifications, .done, .crew))
    #expect(state(paidCrew, try progress(marks)).flow == .done)
}

@Test func skipTourSkipsWhatIsLeftAndDefersTheLocationTest() throws {
    let marks: [(OnboardingStep, OnboardingOutcome, OnboardingChoice)] = [(.invites, .done, .runner)]
    let skip = OnboardingTour.skipAll(state(paidRunner, try progress(marks)))
    #expect(skip.map(\.step) == [.notifications, .location, .mapStartLine, .chat])
    #expect(skip.map(\.outcome) == [.skipped, .deferred, .skipped, .skipped])
    // Every outcome it names is one the store accepts.
    var saved = try progress(marks)
    for item in skip { try saved.record(item.step, outcome: item.outcome, roomId: "room-1", role: .runner) }
    #expect(state(paidRunner, saved).flow == .done)
    #expect(OnboardingTour.skipAll(state(paidRunner, saved)).isEmpty)
}

@Test func notificationsOutcomeFollowsThePrompt() {
    #expect(OnboardingTour.notificationsOutcome(allowed: true) == .done)
    #expect(OnboardingTour.notificationsOutcome(allowed: false) == .skipped)
}

@Test func tourRoutesParse() {
    #expect(Route.parse("crewcue://dev/onboarding-runner-tour")?.featureId == "onboarding-runner-tour")
    #expect(Route.parse("crewcue://dev/onboarding-crew?state=offline") == Route(featureId: "onboarding-crew", state: .offline))
    #expect(CrewCueClientCore.featureScreen(id: "onboarding-runner-tour", state: .success).accessibilityIdentifier == "crewcue.onboarding-runner-tour")
    #expect(CrewCueClientCore.featureScreen(id: "onboarding-crew", state: .success).accessibilityIdentifier == "crewcue.onboarding-crew")
}

// MARK: Location test

@Test func locationTestSendsOnePingThenStops() {
    let start = Date(timeIntervalSince1970: 1_000)
    var test = LocationTest()
    #expect(test.primaryLabel == "Test tracking now")
    #expect(test.outcome == .deferred)
    test.start(alreadyTracking: false, at: start)
    #expect(test.phase == .asking)
    #expect(test.isRunning)
    #expect(test.outcome == nil)
    #expect(test.primaryLabel == nil)
    #expect(!test.stopsTracking)
    test.permission(.always)
    #expect(test.phase == .waitingForPing)
    #expect(test.message == LocationTestCopy.waiting)
    test.pingSent()
    #expect(test.phase == .sent)
    #expect(test.stopsTracking)
    #expect(test.outcome == .done)
    #expect(test.primaryLabel == "Next")
    #expect(test.message == LocationTestCopy.sent)
}

@Test func locationTestWithWhenInUseOnlyStillSendsAndAsksForAlways() {
    var test = LocationTest()
    test.start(alreadyTracking: false, at: Date())
    test.permission(.whenInUse)
    #expect(test.message == LocationTestCopy.waitingWhenInUse)
    test.pingSent()
    #expect(test.outcome == .done)
    #expect(test.message == LocationTestCopy.sentWhenInUse)
}

@Test func locationTestDeniedOfflineAndTimeoutWaitForRaceMorning() {
    let start = Date(timeIntervalSince1970: 0)
    var denied = LocationTest()
    denied.start(alreadyTracking: false, at: start)
    denied.permission(.denied)
    #expect(denied.phase == .denied)
    #expect(denied.stopsTracking)
    #expect(denied.outcome == .deferred)
    #expect(denied.primaryLabel == "Try again")

    var offline = LocationTest()
    offline.start(alreadyTracking: false, at: start)
    offline.permission(.always)
    offline.pingQueuedOffline()
    #expect(offline.phase == .offline)
    #expect(offline.outcome == .deferred)
    // The queued ping reaching the server later still counts.
    offline.pingSent()
    #expect(offline.outcome == .done)

    var slow = LocationTest()
    slow.start(alreadyTracking: false, at: start)
    slow.permission(.always)
    slow.tick(now: start.addingTimeInterval(LocationTest.timeoutSeconds - 1))
    #expect(slow.phase == .waitingForPing)
    slow.tick(now: start.addingTimeInterval(LocationTest.timeoutSeconds))
    #expect(slow.phase == .failed)
    #expect(slow.outcome == .deferred)
    // Try again starts over.
    slow.start(alreadyTracking: false, at: start.addingTimeInterval(60))
    #expect(slow.phase == .asking)
}

@Test func locationTestLeavesRaceDayTrackingOn() {
    var test = LocationTest()
    test.start(alreadyTracking: true, at: Date())
    test.permission(.always)
    test.pingSent()
    #expect(test.outcome == .done)
    #expect(!test.stopsTracking)
    #expect(test.message == LocationTestCopy.sentStillTracking)
}

@Test func locationTestIgnoresEventsBeforeItStarts() {
    var test = LocationTest()
    test.permission(.denied)
    test.pingSent()
    test.tick(now: .distantFuture)
    #expect(test.phase == .idle)
}

// MARK: Setup checklist

private let tourDone: [(OnboardingStep, OnboardingOutcome, OnboardingChoice)] = [
    (.invites, .skipped, .runner), (.notifications, .skipped, .runner), (.location, .deferred, .runner),
    (.mapStartLine, .done, .runner), (.chat, .done, .runner)
]

@Test func checklistWaitsForTheTourThenLeadsWithTheFirstOpenItem() throws {
    let facts = SetupChecklistFacts(notificationsOn: false, locationAlways: false)
    #expect(SetupChecklistPolicy.make(state: state(paidRunner), progress: .empty, facts: facts) == nil)
    let saved = try progress(tourDone)
    let checklist = try #require(SetupChecklistPolicy.make(state: state(paidRunner, saved), progress: saved, facts: facts))
    #expect(checklist.items.map(\.kind) == [.invites, .etaEdits, .checkpointDetails, .notifications, .location])
    #expect(checklist.items.allSatisfy { !$0.done })
    #expect(checklist.next == .invites)
    #expect(checklist.summary == "0 of 5 done")
}

@Test func checklistCountsTheTourThePhoneAndOpenedItems() throws {
    var saved = try progress([
        (.invites, .done, .runner), (.notifications, .done, .runner), (.location, .done, .runner),
        (.mapStartLine, .done, .runner), (.chat, .done, .runner)
    ])
    try saved.record(.etaEdits, outcome: .done, roomId: "room-1")
    let facts = SetupChecklistFacts(notificationsOn: false, locationAlways: false)
    let checklist = try #require(SetupChecklistPolicy.make(state: state(paidRunner, saved), progress: saved, facts: facts))
    #expect(checklist.items.filter(\.done).map(\.kind) == [.invites, .etaEdits, .location])
    // Notifications reads the phone's permission, not the tour: skipped or turned off later.
    #expect(checklist.next == .checkpointDetails)
    #expect(checklist.summary == "3 of 5 done")
    try saved.record(.checkpointDetails, outcome: .done, roomId: "room-1")
    let phoneOn = SetupChecklistFacts(notificationsOn: true, locationAlways: false)
    #expect(SetupChecklistPolicy.make(state: state(paidRunner, saved), progress: saved, facts: phoneOn) == nil)
}

@Test func checklistLocationIsDoneWithAlwaysEvenWithoutTheTest() throws {
    let saved = try progress(tourDone)
    let facts = SetupChecklistFacts(notificationsOn: true, locationAlways: true)
    let checklist = try #require(SetupChecklistPolicy.make(state: state(paidRunner, saved), progress: saved, facts: facts))
    #expect(checklist.items.filter(\.done).map(\.kind) == [.notifications, .location])
    #expect(checklist.next == .invites)
}

@Test func hiddenChecklistStaysHiddenForThatRaceOnly() throws {
    var saved = try progress(tourDone)
    try saved.record(.setupChecklist, outcome: .skipped, roomId: "room-1")
    let facts = SetupChecklistFacts(notificationsOn: false, locationAlways: false)
    #expect(SetupChecklistPolicy.make(state: state(paidRunner, saved), progress: saved, facts: facts) == nil)
    let other = OnboardingRace(roomId: "room-3", role: "athlete", entitlementStatus: "paid", raceStartAt: "2026-09-01T13:00:00Z", hasCourse: true)
    #expect(SetupChecklistPolicy.make(state: state(other, saved), progress: saved, facts: facts) != nil)
}

@Test func crewNeverGetsTheSetupChecklist() throws {
    let saved = try progress(OnboardingStep.crewTour.map { ($0, .done, .crew) })
    let resolved = state(paidCrew, saved)
    #expect(resolved.flow == .done)
    #expect(SetupChecklistPolicy.make(state: resolved, progress: saved, facts: SetupChecklistFacts(notificationsOn: false, locationAlways: false)) == nil)
}

@Test func checklistItemsNameTheirStepAndId() {
    #expect(SetupChecklistItemKind.invites.step == .invites)
    #expect(SetupChecklistItemKind.etaEdits.step == .etaEdits)
    #expect(SetupChecklistItemKind.notifications.step == nil)
    #expect(SetupChecklistItemKind.location.accessibilityIdentifier == "crewcue.setup-checklist.location")
    #expect(SetupChecklistItemKind.notifications.detail == "We'll remind you to start tracking.")
}
