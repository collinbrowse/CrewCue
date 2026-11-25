import Foundation
import Observation
import CrewCueClientCore

@MainActor
@Observable
final class ShellModel {
    let client: AppClient
    var route: Route
    var path: [Route] = []
    /// The settings sheet opens over any tab. `settingsFocus` is the section to scroll to.
    var showsSettings = false
    /// The active race was just deleted: the person picks another race, or creates or joins
    /// one. Until they do, no race is active (the race list never picks one for them).
    var choosingRace = false
    var settingsFocus: String?
    /// Where the Race Pass page was opened from, so its X returns there (`leaveBilling`).
    private var billingOrigin: BillingOrigin?
    /// The tab the join page was opened from by hand (`openJoin`).
    private var joinReturnRoute: Route?
    /// The runner closed a Race Pass page they opened from the tab bar, on a race whose setup
    /// isn't finished: the tab bar stays for that race (Profile, not the setup flow) until they
    /// pick Finish race setup on Profile.
    private(set) var shellOverSetupRoomId: String?
    var screen: FeatureScreen
    /// True when a dev URL included `?state=`. That query is fixture copy, not product state.
    var fixtureOverlay: Bool
    var selectedTab: ShellTab = .map {
        didSet {
            guard !suppressTabRouteSync, selectedTab != oldValue else { return }
            applyTabRoute(selectedTab)
        }
    }

    let paceScreen: FeatureScreen
    let chatScreen: FeatureScreen
    let authModel: AuthSignInModel
    let joinModel: JoinCrewModel
    let athleteModel: AthleteSetupModel
    let profileModel: ProfileModel
    let stravaModel: StravaModel
    let activityImportModel: ActivityImportModel
    /// A run file shared or opened in CrewCue (run-share-import).
    let sharedRunImport: SharedRunImportModel
    let accountDeletionModel: AccountDeletionModel
    let membersModel: RoomMembersModel
    /// The runner's invite link and code (Room members → Invite crew).
    let inviteModel: InviteShareModel
    let incidentsModel: IncidentsModel
    let paceModel: PaceModel
    let mapModel: MapModel
    let chatModel: ChatModel
    let chatPrefsModel: ChatNotificationPrefsModel
    let pushModel: PushRegistrationModel
    /// Race Pass paywall and redeem code (#649).
    let billingModel: BillingPurchaseModel
    /// Full Crew upgrade on Room members (#649).
    let upgradeModel: CrewUpgradeModel
    /// Which flow the entry shows: chooser, runner setup, paywall, join, or the tab bar.
    let onboarding: OnboardingModel
    /// Runner setup, phase 1.
    let runnerSetup: RunnerSetupModel
    /// Runner phase 2: the race-day replay and the paywall after it.
    let racePreview: RacePreviewModel
    /// Runner phase 3 and the crew tour: the tab-bar tour's state on this phone.
    let tour: OnboardingTourModel
    /// The dev route's `?at=&paused=` (dev links only): where its fixture replay opens.
    var racePreviewDevStart: RacePreviewDevStart?

    private(set) var signedInUserId: String? { didSet { syncChat() } }
    private(set) var signedInRole: String? { didSet { syncChat() } }
    private(set) var signedInRoomId: String? { didSet { syncChat() } }
    /// A tapped push waiting for sign-in or for the race list (clients/behavior/push-tap.md).
    private var pushTaps = PushTapInbox()
    private(set) var signedInDisplayName: String?
    /// Every race the user belongs to. `signedInRoomId` is the active one; every tab follows it.
    private(set) var roster = RaceRoster()
    private(set) var racesMessage = ""
    private(set) var racesLoading = false
    private var racesGeneration = 0
    private var suppressTabRouteSync = false
    private var didRegisterSessionWipe = false
    private let sessionVault: any SessionVault

    var isSignedIn: Bool { signedInUserId != nil }

    /// The person's races other than the active one: the way out of setup opens one of them.
    var otherRaces: [RaceSummary] {
        roster.races.filter { $0.id != signedInRoomId }
    }

    init(
        client: AppClient,
        route: Route,
        fixtureOverlay: Bool,
        authConfiguration: Auth0Configuration,
        sessionVault: any SessionVault = InMemorySessionVault(),
        purchaser: StorePurchaser = UnavailablePurchaser()
    ) {
        self.client = client
        self.sessionVault = sessionVault
        self.route = route
        self.fixtureOverlay = fixtureOverlay
        self.screen = client.graph.featureScreen(for: route)
        self.paceScreen = client.graph.featureScreen(for: Route(featureId: "schedule-sheet", state: .success))
        self.chatScreen = client.graph.featureScreen(for: Route(featureId: "chat-thread", state: .success))
        self.authModel = AuthSignInModel(configuration: authConfiguration)
        self.joinModel = JoinCrewModel(client: client)
        self.athleteModel = AthleteSetupModel(client: client)
        self.profileModel = ProfileModel(client: client)
        self.stravaModel = StravaModel(client: client)
        self.activityImportModel = ActivityImportModel(client: client)
        self.sharedRunImport = SharedRunImportModel(client: client)
        self.accountDeletionModel = AccountDeletionModel(client: client)
        self.membersModel = RoomMembersModel(client: client)
        self.inviteModel = InviteShareModel(client: client)
        self.incidentsModel = IncidentsModel(client: client)
        self.paceModel = PaceModel(client: client)
        self.mapModel = MapModel(client: client)
        self.chatModel = ChatModel(client: client)
        self.chatPrefsModel = ChatNotificationPrefsModel(client: client)
        self.pushModel = PushRegistrationModel(client: client)
        self.billingModel = BillingPurchaseModel(client: client, purchaser: purchaser)
        self.upgradeModel = CrewUpgradeModel(client: client, purchaser: purchaser)
        self.onboarding = OnboardingModel(
            store: try? AppDirectories.onboardingStore(),
            clock: client.graph.clock,
            logger: client.graph.logger
        )
        self.runnerSetup = RunnerSetupModel(client: client, activityImport: activityImportModel, auth: authModel)
        self.sharedRunImport.onImported = { [activityImportModel] in
            await activityImportModel.activate()
        }
        self.racePreview = RacePreviewModel(client: client)
        self.tour = OnboardingTourModel(clock: client.graph.clock)
        self.authModel.bindSession { [weak self] session in
            self?.adopt(session)
        }
        self.joinModel.onJoined = { [weak self] roomId, role, code in
            self?.noteJoinedByHand(roomId: roomId, role: role, code: code)
        }
        self.joinModel.onNeedsAccount = { [weak self] code in
            self?.requestAccount(toJoin: code)
        }
        self.athleteModel.onSaved = { [weak self] name in
            self?.updateDisplayName(name)
        }
        self.profileModel.bindSignOut { [weak self] in
            self?.signOut()
        }
        PushRouter.shared.handler = { [weak self] route in
            self?.receivePushTap(route)
        }
        bindRunnerSetup()
        syncOnboarding()
    }

    // MARK: Onboarding

    /// The active race is the runner's own and not unlocked: Map, Pace and Chat show "Unlock race",
    /// and tracking and chat send open the paywall instead of failing.
    var isUnpaidRunnerRace: Bool {
        isSignedIn && onboarding.isUnpaidRunnerRace(signedInRoomId)
    }

    /// The banner Map, Pace and Chat show, if any.
    /// The top bar on every tab: the active race's name, else the app's.
    var topBarTitle: String {
        let name = roster.races.first(where: { $0.id == signedInRoomId })?.name
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (name?.isEmpty == false ? name : nil) ?? "CrewCue"
    }

    var raceAccess: RaceAccess? {
        if isUnpaidRunnerRace {
            let expiresAt = roster.races.first(where: { $0.id == signedInRoomId })?.unpaidExpiresAt
            return .unlock(expiry: OnboardingCopy.unpaidExpiry(expiresAt: expiresAt, now: client.graph.clock.now()))
        }
        if onboarding.state.flow == .raceLocked, let reason = onboarding.state.reason {
            return .locked(reason: reason)
        }
        return nil
    }

    /// Re-reads the onboarding state. `races` is the race list when one just answered.
    func syncOnboarding(races: [OnboardingRace]? = nil) {
        onboarding.refresh(signedIn: isSignedIn, userId: signedInUserId, races: races, activeRoomId: signedInRoomId)
        // Setup reads only its own race's entries (its race and the state's can differ, on the
        // dev route or while a new race isn't listed yet).
        runnerSetup.follow(
            state: onboarding.state,
            signedIn: isSignedIn,
            userId: signedInUserId,
            displayName: signedInDisplayName,
            races: onboarding.races,
            raceNames: Dictionary(roster.races.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first }),
            freshRaces: races != nil
        )
        syncRacePreview()
        // A pending invite read back (a relaunch, a sign-out) shows its code on the join screen.
        if let pending = onboarding.pendingJoin, joinModel.code.isEmpty, !joinModel.joining {
            joinModel.adopt(code: pending.code)
        }
    }

    // MARK: Invites

    /// A join link (the https join page, a Universal Link, or `crewcue://join/<code>`). Release
    /// builds open these too; only `crewcue://dev/*` is Debug-only. The code is saved as the
    /// device's pending invite, so a signed-out person keeps it through sign-up, and the
    /// onboarding gate shows the join screen with the race's preview.
    func openInvite(code: String, source: InviteSource) {
        fixtureOverlay = false
        racePreviewDevStart = nil
        showsSettings = false
        let saved = onboarding.savePendingJoin(code: code, source: source)
        joinModel.adopt(code: code)
        // Without the onboarding folder nothing is pending: the join screen still takes the code.
        show(Route(featureId: saved ? "app-shell" : "join-crew", state: .success))
        syncOnboarding()
    }

    /// A join link whose code couldn't be read: the join screen, offering Paste or typing it.
    private func openJoinWithoutCode() {
        fixtureOverlay = false
        racePreviewDevStart = nil
        showsSettings = false
        joinModel.noteLinkWithoutCode()
        show(Route(featureId: "join-crew", state: .success))
    }

    /// Signed out, Join on a previewed code: keep the code as the pending invite, confirm it, and
    /// open sign-up. Signing in within the confirmation's lifetime then joins it (`adopt`).
    func requestAccount(toJoin code: String) {
        guard !isSignedIn else { return }
        if onboarding.pendingJoin?.code != code {
            onboarding.savePendingJoin(code: code, source: .typed)
        }
        onboarding.confirmInvite(code)
        authModel.signingUp = true
        fixtureOverlay = false
        show(Route(featureId: "app-shell", state: .success))
        syncOnboarding()
    }

    /// Back from the join screen or the sign-in after it: the person gave up on the invite. The
    /// code and the confirmation both go, so the same link opened later shows the preview again
    /// and signing in joins nothing.
    func leaveCrewJoin() {
        onboarding.giveUpInvite()
        onboarding.clearChoice()
        joinModel.clear()
        syncOnboarding()
    }

    /// Join tapped on the join screen answered with a membership for `code`. Only that code's
    /// pending invite is cleared: one that arrived while the join was out stays, and its join
    /// screen stays up. The loader covers the gap until the race list has the new race, but only
    /// on the onboarding join (the gate's join screen with no race to fall back on), never over a
    /// shell that already has races.
    private func noteJoinedByHand(roomId: String, role: String?, code: String) {
        // No race yet: the onboarding join (or the chooser behind the join route) would show until
        // the list answers. With races, the shell stays as it is.
        let onboardingJoin = [.crewJoin, .chooser].contains(onboarding.entry) && onboarding.races.isEmpty
        let newer = onboarding.clearPendingJoin(ifCode: code)
        if newer == nil, onboardingJoin {
            onboarding.noteJoinedAwaitingRaces()
        }
        noteJoined(roomId: roomId, role: role)
    }

    /// Joins the pending invite right after sign-in. Joined: the race becomes active. Anything else
    /// (the race full or locked, offline) stays on the join screen with why; the code stays saved
    /// unless it can never work.
    func joinPendingInvite() async {
        guard let userId = signedInUserId else { return }
        joinModel.beginAutoJoin()
        let outcome = await onboarding.resolvePendingJoin(graph: client.graph)
        guard signedInUserId == userId else { return }
        switch outcome {
        case .joined(let roomId), .alreadyMember(let roomId):
            // `resolve` clears only the code it joined: a link opened meanwhile stays pending.
            if let newer = onboarding.nextCode(after: outcome) {
                joinModel.endAutoJoin(adopting: newer.code)
            } else {
                if onboarding.races.isEmpty { onboarding.noteJoinedAwaitingRaces() }
                joinModel.clear()
            }
            noteJoined(roomId: roomId, role: outcome == .joined(roomId: roomId) ? "crew_member" : nil)
        default:
            joinModel.show(outcome)
            syncOnboarding()
        }
    }

    /// The replay follows the gate: another race on its step starts over, and leaving the step
    /// any other way than Not now or a purchase (the race paid elsewhere, another race made
    /// active) ends its flow, so the room saved for it goes too.
    private func syncRacePreview() {
        switch onboarding.entry {
        case .racePreview:
            if let source = racePreviewSource {
                racePreview.follow(source)
            }
        case .runnerSetup, .loading:
            // Before the replay step, or the race list isn't known yet: nothing is decided.
            break
        default:
            // Signed out, `clear()` already ran. A tab bar shown only because the list is unknown
            // decides nothing either.
            guard isSignedIn, onboarding.state.flow != .loading else { return }
            racePreview.leave()
        }
    }

    /// The runner left the paywall that ends the replay (Not now): the race stays unpaid behind
    /// the Unlock race banner, and the next launch opens the tab bar.
    func leaveOnboardingPaywall() {
        onboarding.mark(.preview, outcome: .skipped, roomId: onboarding.state.roomId)
        racePreview.finish()
        syncOnboarding()
    }

    /// The paywall after the replay unlocked the race. The race list is read again first, so the
    /// tab bar opens on the paid race with no Unlock race banner; the step is marked either way,
    /// so a list that can't load (offline) still leaves the paywall.
    func completeOnboardingPurchase() async {
        let roomId = onboarding.state.roomId
        await loadRaces()
        onboarding.mark(.preview, outcome: .done, roomId: roomId)
        racePreview.finish()
        syncOnboarding()
    }

    /// The replay the onboarding gate shows: the runner's own race, starting from the finish the
    /// teaser showed when this session has it.
    var racePreviewSource: RacePreviewSource? {
        guard let userId = signedInUserId, let roomId = onboarding.state.roomId else { return nil }
        let teaserFinish = runnerSetup.roomId == roomId
            ? runnerSetup.teaser?.finishAt.flatMap(CrewClock.parse)
            : nil
        return .race(userId: userId, roomId: roomId, finishEtaAt: teaserFinish)
    }

    /// Leaves `crewcue://dev/onboarding-race-preview` (Not now) for the app's own launch.
    func leaveRacePreviewDevRoute() {
        racePreview.finish()
        fixtureOverlay = false
        show(Route(featureId: "app-shell", state: .success))
        enterShellIfNeeded()
    }

    // MARK: Tour

    /// The tab-bar tour's card over the shell: the runner's once the race is unlocked, the crew's
    /// once they joined a paid race. Nil on dev fixture links and outside the tour.
    var tourCard: TourCard? {
        guard isSignedIn, !fixtureOverlay, onboarding.entry == .shell else { return nil }
        return OnboardingTour.card(for: onboarding.state)
    }

    private var tourRole: OnboardingChoice { onboarding.state.role ?? .runner }

    /// A new card is on screen: its tab opens, so the highlight and the explanation match what's
    /// behind them, and the card's own setup runs (the invite loads, the map moves to the start).
    func tourCardAppeared(_ card: TourCard) {
        if let anchor = card.anchor, let tab = ShellTab(rawValue: anchor.rawValue), selectedTab != tab {
            selectedTab = tab
        }
        switch card.action {
        case .shareInvite:
            tour.inviteShared = false
            Task { await inviteModel.activate(roomId: signedInRoomId) }
        case .showStartLine:
            mapModel.showStartLine()
        case .enableNotifications:
            Task { await tour.refreshNotifications() }
        case .testTracking, .next:
            break
        }
    }

    /// The invites card's share text, once the race's invite loaded.
    var tourInviteShareText: String? {
        if case .ready(let details) = inviteModel.state { return details.shareText }
        return nil
    }

    func tourPrimary(_ card: TourCard) {
        switch card.action {
        case .shareInvite:
            markTour(card, .done)
        case .enableNotifications:
            Task {
                let allowed = await tour.enableNotifications(push: pushModel, role: signedInRole)
                markTour(card, OnboardingTour.notificationsOutcome(allowed: allowed))
            }
        case .testTracking:
            if tour.locationTest.phase == .sent {
                let outcome = tour.locationTest.outcome ?? .done
                tour.endLocationTest(map: mapModel)
                markTour(card, outcome)
            } else {
                tour.startLocationTest(map: mapModel)
            }
        case .showStartLine, .next:
            markTour(card, .done)
        }
    }

    func tourSecondary(_ card: TourCard) {
        if card.action == .testTracking {
            tour.endLocationTest(map: mapModel)
        }
        markTour(card, card.secondaryOutcome ?? .skipped)
    }

    /// Skip tour: everything left is skipped, and the location test waits for race morning.
    func skipTour() {
        tour.endLocationTest(map: mapModel)
        let role = tourRole
        let roomId = onboarding.state.roomId
        for item in OnboardingTour.skipAll(onboarding.state) {
            onboarding.mark(item.step, outcome: item.outcome, roomId: roomId, role: role)
        }
        syncOnboarding()
    }

    private func markTour(_ card: TourCard, _ outcome: OnboardingOutcome) {
        onboarding.mark(card.step, outcome: outcome, roomId: onboarding.state.roomId, role: card.role)
        syncOnboarding()
    }

    /// Leaves the tour's dev link (Skip tour or its last card) for the app's own launch.
    func leaveTourDevRoute() {
        fixtureOverlay = false
        show(Route(featureId: "app-shell", state: .success))
        enterShellIfNeeded()
    }

    // MARK: Setup checklist

    /// The runner's setup checklist on Map, nil once it is done, hidden, or not theirs.
    var setupChecklist: SetupChecklist? {
        guard isSignedIn, !fixtureOverlay, onboarding.entry == .shell else { return nil }
        let facts = SetupChecklistFacts(notificationsOn: tour.notificationsOn, locationAlways: mapModel.locationPermission == .always)
        return SetupChecklistPolicy.make(state: onboarding.state, progress: onboarding.progress, facts: facts)
    }

    /// An item opens where it is done: the invite, Edit planned stops on Pace, Place checkpoint on
    /// Map, the notification prompt, or the location test. Opening an optional item marks it done.
    func openChecklistItem(_ kind: SetupChecklistItemKind) {
        let roomId = onboarding.state.roomId
        // The item opens over the map; the card folds back to the next item.
        tour.checklistExpanded = false
        switch kind {
        case .invites:
            onboarding.mark(.invites, outcome: .done, roomId: roomId, role: .runner)
            show(Route(featureId: "invite-share", state: .success))
            enterShellIfNeeded()
        case .etaEdits:
            onboarding.mark(.etaEdits, outcome: .done, roomId: roomId)
            show(Route(featureId: "pace-stop-edit", state: .success))
            enterShellIfNeeded()
        case .checkpointDetails:
            onboarding.mark(.checkpointDetails, outcome: .done, roomId: roomId)
            show(Route(featureId: "map-checkpoint-pick", state: .success))
            enterShellIfNeeded()
        case .notifications:
            Task { _ = await tour.enableNotifications(push: pushModel, role: signedInRole) }
        case .location:
            show(Route(featureId: "location-heartbeat", state: .success))
            enterShellIfNeeded()
        }
        syncOnboarding()
    }

    func hideChecklist() {
        onboarding.mark(.setupChecklist, outcome: .skipped, roomId: onboarding.state.roomId)
        syncOnboarding()
    }

    // MARK: Sign-in

    /// The chooser's "I already have an account": the sign-in screen, set to sign in (runner
    /// setup's Create account may have left it on sign-up).
    func openSignIn() {
        authModel.signingUp = false
        show(Route(featureId: "auth-sign-in", state: .success))
    }

    /// Sign-in's Back. Signed out, the sign-in route always has the app's own launch behind it,
    /// the screen sign-out lands on: the chooser, or the step a saved pick resumes. So Back opens
    /// it however sign-in opened (the chooser, join's Back, a dev link), with the onboarding state
    /// untouched. Not while Auth0 is working.
    func leaveSignIn() {
        guard !isSignedIn, route.featureId == "auth-sign-in", !authModel.isWorking else { return }
        show(Route(featureId: "app-shell", state: .success))
    }

    private func bindRunnerSetup() {
        runnerSetup.onRaceCreated = { [weak self] roomId in
            self?.noteJoined(roomId: roomId, role: "athlete")
        }
        runnerSetup.onServerStepSaved = { [weak self] in
            await self?.loadRaces()
        }
        runnerSetup.onRoomLoaded = { [weak self] roomId, data in
            guard let self, let userId = signedInUserId else { return }
            racePreview.seed(roomData: data, userId: userId, roomId: roomId)
        }
        runnerSetup.onMark = { [weak self] step, outcome, roomId in
            self?.onboarding.mark(step, outcome: outcome, roomId: roomId)
            self?.syncOnboarding()
        }
        runnerSetup.onDisplayName = { [weak self] name in
            self?.updateDisplayName(name)
        }
        runnerSetup.onSignUp = { [weak self] in
            self?.authModel.signingUp = true
            self?.authModel.signIn()
        }
        runnerSetup.onSignIn = { [weak self] in
            self?.authModel.signingUp = false
            self?.authModel.signIn()
        }
        runnerSetup.onPaywall = { [weak self] in
            self?.showBilling()
        }
        runnerSetup.onBack = { [weak self] in
            guard let self else { return }
            onboarding.clearChoice()
            // `crewcue://dev/onboarding-runner-setup` shows setup whatever the state: Back leaves
            // it for the app's own launch, which now opens the chooser.
            if route.featureId == "onboarding-runner-setup" {
                fixtureOverlay = false
                show(Route(featureId: "app-shell", state: .success))
            }
            syncOnboarding()
        }
    }

    // MARK: Push taps

    /// A tapped notification (`PushRouter`): cold launch, from the background, or with the app
    /// open. Signed out, it's held until someone signs in in this launch, then opens only if the
    /// race is in that account's list. A race the list doesn't have is dropped.
    func receivePushTap(_ route: PushTapRoute) {
        pushTaps.receive(route)
        routePendingPushTap()
    }

    private func routePendingPushTap() {
        switch pushTaps.take(signedIn: isSignedIn, userId: signedInUserId, races: roster.races) {
        case nil, .holdUntilSignIn:
            return
        case .awaitRaces:
            // The race isn't listed yet (a new race, or a launch before the list answered).
            // `loadRaces` resolves it again when the list answers.
            if !racesLoading {
                Task { await loadRaces() }
            }
        case .drop:
            client.graph.logger.log("push tap for a race not in the list")
        case .open(let roomId, let destination):
            open(pushDestination: destination, roomId: roomId)
        }
    }

    private func open(pushDestination destination: PushTapDestination, roomId: String) {
        if roomId != signedInRoomId {
            selectRace(roomId)
        }
        fixtureOverlay = false
        racePreviewDevStart = nil
        showsSettings = false
        choosingRace = false
        switch destination {
        case .chat:
            show(Route(featureId: "chat-thread", state: .success))
            enterShellIfNeeded()
        case .startTracking:
            show(Route(featureId: "location-heartbeat", state: .success))
            enterShellIfNeeded()
        case .map:
            show(Route(featureId: "map-track", state: .success))
            enterShellIfNeeded()
        case .paywall:
            // Runner setup not finished on this phone: the gate shows setup, which leads to the
            // paywall (clients/behavior/push-tap.md). Android lands there the same way.
            if onboarding.entry == .runnerSetup {
                show(Route(featureId: "app-shell", state: .success))
            } else {
                showBilling()
            }
        }
    }

    private func syncChat() {
        chatModel.activate(userId: signedInUserId, roomId: signedInRoomId, role: signedInRole)
    }

    func open(_ url: URL) {
        if url.isFileURL {
            receiveRunFile { [weak self] in
                guard let self else { return }
                sharedRunImport.receive(url: url, signedIn: isSignedIn)
            }
            return
        }
        // Join links open in every build, ahead of the Debug-only dev routes.
        switch InviteLink.route(url.absoluteString) {
        case .invite(let invite):
            openInvite(code: invite.code, source: invite.source)
            return
        case .withoutCode:
            openJoinWithoutCode()
            return
        case nil:
            break
        }
        guard url.scheme?.caseInsensitiveCompare("crewcue") == .orderedSame else { return }
        if DevLinks.enabled, Route.parse(url.absoluteString)?.featureId == "run-share-import" {
            openRunShareDevLink(url.absoluteString)
            return
        }
        // Strava is off in v1 (#652): its return link then opens the shell like any other link.
        if ClientFeatureFlags.stravaEnabled, Self.isStravaReturn(url) {
            fixtureOverlay = false
            if isSignedIn {
                stravaModel.prepareReturn(url)
            }
            show(Route(featureId: "strava", state: .success))
            if isSignedIn {
                enterShellIfNeeded()
                Task { await stravaModel.activate() }
            }
            return
        }
        let raw = url.absoluteString
        fixtureOverlay = DevLinks.enabled && LaunchConfiguration.isFixtureOverlay(raw)
        racePreviewDevStart = DevLinks.enabled ? RacePreviewDevStart(deeplink: raw) : nil
        let parsed = DevLinks.enabled ? Route.parse(raw) : nil
        let next = parsed ?? Route(featureId: "app-shell", state: .success)
        show(next)
        if !fixtureOverlay {
            enterShellIfNeeded()
        }
    }

    /// `crewcue://dev/run-share-import?file=<name>`: the import sheet with a file from the app's
    /// documents folder, as if it had been shared. Without a file, the sheet shows the tip.
    func openRunShareDevLink(_ raw: String) {
        let name = URLComponents(string: raw)?.queryItems?.first(where: { $0.name == "file" })?.value
        receiveRunFile { [weak self] in
            guard let self else { return }
            guard let name, let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
                sharedRunImport.showTip()
                return
            }
            sharedRunImport.receive(url: documents.appendingPathComponent(name), signedIn: isSignedIn)
        }
    }

    /// The import sheet presents from the app's root, so close the shell's own sheets first.
    private func receiveRunFile(_ start: @escaping @MainActor () -> Void) {
        guard showsSettings || choosingRace else {
            start()
            return
        }
        showsSettings = false
        choosingRace = false
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(600))
            start()
        }
    }

    func show(_ route: Route) {
        self.route = route
        screen = client.graph.featureScreen(for: route)
        path = []
        if let tab = ShellTab.matching(featureId: route.featureId), selectedTab != tab {
            suppressTabRouteSync = true
            selectedTab = tab
            suppressTabRouteSync = false
        }
    }

    func openSettings(focus: String? = nil) {
        settingsFocus = focus
        showsSettings = true
    }

    func enterShellIfNeeded() {
        guard isSignedIn, !fixtureOverlay else { return }
        if ShellTab.isSettingsFeature(route.featureId) {
            openSettings(focus: route.featureId)
            return
        }
        if let tab = ShellTab.matching(featureId: route.featureId) {
            selectTab(tab)
            return
        }
        if route.featureId == "app-shell" || route.featureId == "auth-sign-in" {
            selectTab(.map)
        }
    }

    /// Sign-out and session expiry wipe every per-user store: the Keychain session, every account's
    /// directory (outbox, ping order, room caches, drafts), and the offline athlete-setup draft.
    func prepareStores() {
        guard !didRegisterSessionWipe else { return }
        didRegisterSessionWipe = true
        guard let root = try? AppDirectories.root() else { return }
        let storage = UserStorage(root: root)
        let athleteDraft = try? AppDirectories.athleteDraftURL()
        let vault = sessionVault
        client.graph.session?.register(id: "session-vault") {
            try vault.wipe()
            try SessionFile.wipe(directory: root)
        }
        client.graph.session?.register(id: "user-storage") {
            try storage.wipeAll()
        }
        client.graph.session?.register(id: "athlete-draft") {
            if let athleteDraft, FileManager.default.fileExists(atPath: athleteDraft.path) {
                try FileManager.default.removeItem(at: athleteDraft)
            }
        }
    }

    /// An authorized request came back 401. If it carried this session's token, the session is over.
    func expireSession(rejectedToken: String) {
        guard isSignedIn, client.graph.session?.session?.accessToken == rejectedToken else { return }
        client.graph.logger.log("session expired")
        signOut()
    }

    func adopt(_ session: ClientSession) {
        // Signed out, the person confirmed an invite before signing in: join it now.
        // Read before this sign-in adopts the guest progress, and only within the confirmation's
        // lifetime (`OnboardingStore.confirmedInviteForSignIn`).
        let joinsInvite = !isSignedIn && onboarding.confirmedInviteForSignIn() != nil
        prepareStores()
        client.graph.session?.adopt(session)
        client.graph.tokenProvider = StaticTokenProvider(token: session.accessToken)
        installOutbox(userId: session.userId)
        persist(session)
        signedInUserId = session.userId
        signedInRole = session.role
        signedInRoomId = session.roomId
        signedInDisplayName = session.displayName
        if let name = session.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            athleteModel.displayName = name
        }
        roster = RaceRoster(activeRoomId: session.roomId)
        syncOnboarding()
        enterShellIfNeeded()
        Task { await loadRaces() }
        if joinsInvite {
            Task { await joinPendingInvite() }
        }
        // Tokens rotate; re-register silently when notifications are already allowed.
        Task { await pushModel.refreshIfAuthorized(role: session.role) }
    }

    /// Called once at launch with the restored session. A background relaunch for location never
    /// shows the shell, so the athlete's saved tracking restarts here, not from a view.
    func resumeRaceTrackingAtLaunch() {
        guard isSignedIn, !fixtureOverlay else { return }
        mapModel.resumeTrackingAtLaunch(userId: signedInUserId, roomId: signedInRoomId, role: signedInRole)
    }

    /// Load the user's races. The stored active room stays active while the server still lists it.
    func loadRaces() async {
        guard let userId = signedInUserId else { return }
        racesGeneration += 1
        let ticket = racesGeneration
        racesLoading = true
        defer { if ticket == racesGeneration { racesLoading = false } }
        do {
            let rooms = try await RaceDayAPI.myRaceRooms(graph: client.graph)
            let races = rooms.map { RaceSummary(room: $0, userId: userId) }
            guard ticket == racesGeneration, signedInUserId == userId else { return }
            var next = RaceRoster.reconciled(races: races, preferred: signedInRoomId)
            if choosingRace, signedInRoomId == nil {
                // After deleting the active race, the person chooses the next one.
                next = RaceRoster(races: next.races, activeRoomId: nil)
            }
            roster = next
            racesMessage = races.isEmpty ? "No races yet." : ""
            if let active = next.active {
                if active.id != signedInRoomId || active.role != signedInRole {
                    apply(active)
                }
            } else if signedInRoomId != nil {
                clearActiveRoom()
            }
            syncOnboarding(races: rooms.map { OnboardingRace(room: $0, userId: userId) })
            // After the active race is applied, so the tapped race isn't switched back.
            pushTaps.noteRacesListed()
            routePendingPushTap()
        } catch {
            guard ticket == racesGeneration else { return }
            racesMessage = APIFailure.isOffline(error) ? "Offline. Showing your last race." : "Couldn't load your races."
            onboarding.noteRacesFailed()
            syncOnboarding()
        }
    }

    /// Switch every tab to another loaded race.
    func selectRace(_ roomId: String) {
        guard roomId != signedInRoomId, let race = roster.races.first(where: { $0.id == roomId }) else { return }
        choosingRace = false
        roster.select(roomId)
        apply(race)
        syncOnboarding()
    }

    private func apply(_ race: RaceSummary) {
        client.graph.session?.select(race)
        signedInRoomId = race.id
        signedInRole = race.role
        signedInDisplayName = race.displayName
        if let session = client.graph.session?.session {
            persist(session)
        }
    }

    private func clearActiveRoom() {
        client.graph.session?.update { session in
            session.roomId = nil
        }
        signedInRoomId = nil
        if let session = client.graph.session?.session {
            persist(session)
        }
    }

    func noteJoined(roomId: String, role: String?) {
        choosingRace = false
        client.graph.session?.update { session in
            session.roomId = roomId
            if let role, !role.isEmpty {
                session.role = role
            }
        }
        signedInRoomId = roomId
        if let role, !role.isEmpty {
            signedInRole = role
        }
        if let session = client.graph.session?.session {
            persist(session)
        }
        roster.adopt(RaceSummary(id: roomId, name: roster.races.first { $0.id == roomId }?.name ?? "New race", role: signedInRole ?? "crew_member"))
        syncOnboarding()
        Task { await loadRaces() }
        // Join is a full-screen route. Return to Profile, where the joined race is now active.
        if route.featureId == "join-crew" {
            showProfile()
        }
    }

    /// The owner deleted a race. It leaves the list at once. If it was the active race, no race
    /// is active and the person is asked to choose another race, or to create or join one; Map,
    /// Pace and Chat offer the same choices until they do.
    func noteDeleted(roomId: String) {
        let wasActive = roomId == signedInRoomId
        let remaining = roster.races.filter { $0.id != roomId }
        roster = RaceRoster(races: remaining, activeRoomId: wasActive ? nil : signedInRoomId)
        if wasActive {
            clearActiveRoom()
            choosingRace = true
        }
        racesMessage = remaining.isEmpty ? "No races yet." : ""
        syncOnboarding()
        Task { await loadRaces() }
    }

    /// A race the runner just created: note it, then open its Race Pass paywall. The page's X
    /// returns to where the race was created (Profile), not to the new race's setup flow.
    func noteCreated(roomId: String) {
        let origin = currentBillingOrigin()
        noteJoined(roomId: roomId, role: "athlete")
        showBilling(from: origin)
    }

    /// The Race Pass paywall for the active race. A full-screen route, like join.
    func showBilling() {
        showBilling(from: currentBillingOrigin())
    }

    private func showBilling(from origin: BillingOrigin) {
        // Opened again from the page itself (a gated action under it): keep where it came from.
        if route.featureId != "billing-purchase" {
            billingOrigin = origin
        }
        show(Route(featureId: "billing-purchase", state: .success))
    }

    /// Where a Race Pass page opened now would return to: this route, and whether it is the tab
    /// bar (rather than a setup screen the onboarding gate shows).
    private func currentBillingOrigin() -> BillingOrigin {
        BillingOrigin(route: route, fromShell: gateEntry == .shell)
    }

    /// The Race Pass page's X: back to wherever it was opened from. From the tab bar (Profile's
    /// Race Pass row, Create race, the Unlock race banner) that is the same tab, even when the
    /// race's setup isn't finished; from runner setup it is setup. Opened by a link or a push with
    /// nothing behind it, Profile.
    func leaveBilling() {
        let origin = billingOrigin ?? BillingOrigin(route: Route(featureId: "profile", state: .success), fromShell: true)
        billingOrigin = nil
        if origin.fromShell {
            if onboarding.entry == .runnerSetup {
                shellOverSetupRoomId = signedInRoomId
            }
            show(ShellTab.matching(featureId: origin.route.featureId) == nil ? Route(featureId: "profile", state: .success) : origin.route)
            enterShellIfNeeded()
        } else {
            show(origin.route)
        }
    }

    /// The join page opened by hand (Profile's Join race room, a race-less tab, sign-in): a fresh
    /// page every time, never the code or answer left from the last visit. A pending invite (a
    /// link, a code kept through sign-in) is filled in again.
    func openJoin() {
        joinReturnRoute = route.featureId == "join-crew" ? joinReturnRoute : route
        joinModel.clear()
        if let pending = onboarding.pendingJoin {
            joinModel.adopt(code: pending.code)
        }
        show(Route(featureId: "join-crew", state: .success))
    }

    /// The join page's X, signed in: back to the tab it was opened from (Profile when unknown).
    func leaveJoin() {
        let back = joinReturnRoute.flatMap { ShellTab.matching(featureId: $0.featureId) == nil ? nil : $0 }
        joinReturnRoute = nil
        joinModel.clear()
        show(back ?? Route(featureId: "profile", state: .success))
        enterShellIfNeeded()
    }

    /// Profile's Finish race setup: the setup flow for the active race again.
    func resumeRaceSetup() {
        shellOverSetupRoomId = nil
        show(Route(featureId: "app-shell", state: .success))
        syncOnboarding()
    }

    /// The screen the onboarding gate shows: the onboarding entry, except a race whose Race Pass
    /// page was closed back to the tab bar keeps the tab bar.
    var gateEntry: OnboardingEntry {
        let entry = onboarding.entry
        if entry == .runnerSetup, let held = shellOverSetupRoomId, held == signedInRoomId { return .shell }
        return entry
    }

    /// The active race's setup isn't finished but the person is in the tab bar (`gateEntry`).
    var canResumeRaceSetup: Bool {
        onboarding.entry == .runnerSetup && gateEntry == .shell
    }

    /// Leaves a full-screen route for the shell's Profile tab.
    func showProfile() {
        show(Route(featureId: "profile", state: .success))
        enterShellIfNeeded()
    }

    /// A race renamed from Profile: the race list (and the top bar, which reads it) shows the new
    /// name at once. Crew pick it up on their next race-list load.
    func noteRenamed(roomId: String, name: String) {
        roster.rename(roomId, to: name)
        if roomId == signedInRoomId {
            paceModel.noteRenamed(name)
        }
    }

    func updateDisplayName(_ name: String) {
        client.graph.session?.update { session in
            session.displayName = name
        }
        signedInDisplayName = name
        if let session = client.graph.session?.session {
            persist(session)
        }
        if var active = roster.active {
            active.displayName = name
            roster.adopt(active)
        }
    }

    func signOut() {
        // The account signing out. Its directory is checked once every model below has let go of it.
        let signedOutUserId = signedInUserId ?? client.graph.session?.session?.userId
        defer { verifyUserDataWiped(userId: signedOutUserId) }
        do {
            try client.graph.session?.signOut()
        } catch {
            client.graph.logger.log("sign out failed")
        }
        client.graph.tokenProvider = StaticTokenProvider(token: nil)
        client.graph.outbox = nil
        signedInUserId = nil
        signedInRole = nil
        signedInRoomId = nil
        signedInDisplayName = nil
        racesGeneration += 1
        roster = RaceRoster()
        choosingRace = false
        shellOverSetupRoomId = nil
        billingOrigin = nil
        racesMessage = ""
        racesLoading = false
        pushTaps.clear()
        profileModel.clear()
        stravaModel.clear()
        activityImportModel.clear()
        sharedRunImport.dismiss()
        accountDeletionModel.clear()
        membersModel.clear()
        inviteModel.clear()
        incidentsModel.clear()
        paceModel.clear()
        mapModel.clear()
        chatModel.clear()
        chatPrefsModel.clear()
        pushModel.clear()
        billingModel.clear()
        upgradeModel.clear()
        runnerSetup.clear()
        racePreview.clear()
        tour.clear()
        joinModel.clear()
        syncOnboarding()
        showsSettings = false
        settingsFocus = nil
        fixtureOverlay = false
        suppressTabRouteSync = true
        selectedTab = .map
        suppressTabRouteSync = false
        route = Route(featureId: "app-shell", state: .success)
        screen = client.graph.featureScreen(for: route)
        path = []
    }

    /// Nothing outlives the account. Every model above has let go of the user by now; the
    /// signed-out user's directory still on disk means one of them wrote after the wipe, so it is
    /// logged and wiped. Only that one directory: never the storage root, another account's
    /// directory, or the onboarding folder beside the root, which outlives sign-out. It runs
    /// synchronously inside `signOut()` on the main actor, so no new sign-in can come between.
    private func verifyUserDataWiped(userId: String?) {
        guard let userId = userId?.trimmingCharacters(in: .whitespacesAndNewlines), !userId.isEmpty,
              let storage = try? AppDirectories.userStorage(),
              let left = try? storage.userIds(), left.contains(userId) else { return }
        client.graph.logger.log("user data outlived sign-out")
        do {
            try storage.wipe(userId: userId)
        } catch {
            client.graph.logger.log("user data wipe after sign-out failed")
        }
    }

    private func selectTab(_ tab: ShellTab) {
        let keepDetail = keepsOpenDetail(tab)
        if selectedTab != tab {
            if keepDetail {
                suppressTabRouteSync = true
                selectedTab = tab
                suppressTabRouteSync = false
            } else {
                selectedTab = tab
            }
        } else if !keepDetail {
            applyTabRoute(tab)
        }
    }

    private func keepsOpenDetail(_ tab: ShellTab) -> Bool {
        switch tab {
        case .chat:
            route.featureId != tab.featureId && ShellTab.isChatFeature(route.featureId)
        case .profile:
            route.featureId != tab.featureId && ShellTab.isProfileFeature(route.featureId)
        case .map:
            route.featureId != tab.featureId && ShellTab.isMapFeature(route.featureId)
        case .pace:
            route.featureId != tab.featureId && ShellTab.isPaceFeature(route.featureId)
        }
    }

    static func isStravaReturn(_ url: URL) -> Bool {
        guard url.scheme?.caseInsensitiveCompare("crewcue") == .orderedSame else { return false }
        if url.host?.caseInsensitiveCompare("strava") == .orderedSame {
            return true
        }
        let host = url.host ?? ""
        guard host.isEmpty else { return false }
        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return path.caseInsensitiveCompare("strava") == .orderedSame
    }

    private func applyTabRoute(_ tab: ShellTab) {
        let next = Route(featureId: tab.featureId, state: .success)
        if route != next {
            route = next
        }
        if screen.featureId != tab.featureId {
            screen = client.graph.featureScreen(for: next)
        }
    }

    /// Opens this user's outbox. Another account's leftover files (a crash before sign-out
    /// finished, or a pre-#538 layout) are wiped first, so this user never sends or sees them.
    private func installOutbox(userId: String) {
        do {
            try AppDirectories.userStorage().wipeAll(except: userId)
            try AppDirectories.removeLegacyUserDirectories()
        } catch {
            client.graph.logger.log("stale user data wipe failed")
        }
        do {
            let directory = try AppDirectories.userDirectory(userId: userId)
            client.graph.outbox = try OutboxStore.shared(userId: userId, directory: directory)
        } catch {
            client.graph.logger.log("outbox unavailable")
        }
    }

    private func persist(_ session: ClientSession) {
        do {
            try sessionVault.save(session)
        } catch {
            client.graph.logger.log("session save failed")
        }
    }
}

/// Where the Race Pass page was opened from (`ShellModel.leaveBilling`).
struct BillingOrigin: Equatable {
    var route: Route
    /// The tab bar was on screen, not a setup screen the onboarding gate showed.
    var fromShell: Bool
}
