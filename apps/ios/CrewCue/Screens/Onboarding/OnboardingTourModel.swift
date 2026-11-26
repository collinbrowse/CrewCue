import Foundation
import Observation
import CrewCueClientCore

/// The tab-bar tour's state on this phone: the location test in progress, the invite shared, the
/// notification prompt working, and whether the setup checklist is open. Which card shows and how
/// a step ends is client-core (`OnboardingTour`, `LocationTest`, `SetupChecklistPolicy`); the
/// shell saves the outcomes. Kept here, not in the views, so a fold or a rotation keeps it.
@MainActor
@Observable
final class OnboardingTourModel {
    private(set) var locationTest = LocationTest()
    /// The runner tapped Share invite on the invites card.
    var inviteShared = false
    private(set) var notificationsWorking = false
    /// The setup checklist card shows every item, not only the next.
    var checklistExpanded = false
    /// Notifications are allowed (`SetupChecklistFacts`), read when the shell or the tour asks.
    private(set) var notificationsOn = false
    /// The dev route's tour (`crewcue://dev/onboarding-runner-tour`, `onboarding-crew`): the step
    /// shown, played on the example race with nothing saved or sent.
    var fixtureStep: OnboardingStep?
    var fixtureTab: ShellTab = .map

    @ObservationIgnored private var watch: Task<Void, Never>?
    private let clock: any Clock

    init(clock: any Clock) {
        self.clock = clock
    }

    func refreshNotifications() async {
        let model = NotificationPermissionModel()
        await model.refresh()
        notificationsOn = model.state == .granted
    }

    /// Asks for notification permission and registers this phone for push (`register` prompts
    /// when undecided). Answers whether notifications are on afterwards.
    func enableNotifications(push: PushRegistrationModel, role: String?) async -> Bool {
        guard !notificationsWorking else { return notificationsOn }
        notificationsWorking = true
        defer { notificationsWorking = false }
        await push.activate(role: role, registerNow: true)
        await refreshNotifications()
        return notificationsOn
    }

    /// The fixture tour asks for the permission only: there's no account to register.
    func requestNotificationPermissionOnly() async -> Bool {
        guard !notificationsWorking else { return notificationsOn }
        notificationsWorking = true
        defer { notificationsWorking = false }
        let model = NotificationPermissionModel()
        model.request()
        while model.isWorking { try? await Task.sleep(for: .milliseconds(200)) }
        notificationsOn = model.state == .granted
        return notificationsOn
    }

    /// Test tracking now: tracking starts on the runner's own race, the location manager asks for
    /// When In Use and Always, and the first ping this phone gets to the server ends the test.
    /// Tracking stops again unless it was on before.
    func startLocationTest(map: MapModel) {
        watch?.cancel()
        let wasTracking = map.trackingActive
        locationTest.start(alreadyTracking: wasTracking, at: clock.now())
        let sentBefore = map.pingsSent
        let queuedBefore = map.pingsQueuedOffline
        if !wasTracking { map.startTestTracking() }
        watch = Task { [weak self, weak map] in
            var sentAt: Date?
            while !Task.isCancelled {
                guard let self, let map else { return }
                self.locationTest.permission(map.locationPermission)
                if self.locationTest.isRunning {
                    if map.pingsSent > sentBefore {
                        self.locationTest.pingSent()
                    } else if map.pingsQueuedOffline > queuedBefore {
                        self.locationTest.pingQueuedOffline()
                    }
                    self.locationTest.tick(now: self.clock.now())
                }
                if !self.locationTest.isRunning {
                    let now = self.clock.now()
                    if self.locationTest.phase == .sent, sentAt == nil { sentAt = now }
                    // Sent with When In Use only: the OS asks for Always next, so tracking stays on
                    // a little longer for that answer. Offline, the queued ping stays in the outbox.
                    if let sentAt, self.locationTest.waitsForAlways(sentAt: sentAt, now: now) {
                        try? await Task.sleep(for: .milliseconds(500))
                        continue
                    }
                    if self.locationTest.stopsTracking { map.stopTestTracking() }
                    return
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
    }

    /// On race morning, Next, or Skip tour: the test ends, and so does the tracking it started
    /// (still on while the Always prompt was answered).
    func endLocationTest(map: MapModel) {
        watch?.cancel()
        watch = nil
        if locationTest.phase != .idle, !locationTest.wasTracking, map.trackingActive {
            map.stopTestTracking()
        }
        locationTest = LocationTest()
    }

    /// Played in the dev route: the test moves to sent with no tracking and no request.
    func fixtureLocationTest() {
        locationTest.start(alreadyTracking: false, at: clock.now())
        locationTest.permission(.always)
        locationTest.pingSent()
    }

    func resetLocationTest() {
        watch?.cancel()
        watch = nil
        locationTest = LocationTest()
    }

    func clear() {
        resetLocationTest()
        inviteShared = false
        checklistExpanded = false
        fixtureStep = nil
        fixtureTab = .map
    }
}
