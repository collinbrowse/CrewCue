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
    let accountDeletionModel: AccountDeletionModel
    let membersModel: RoomMembersModel
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
    /// The dev route's `?at=&paused=` (dev links only): where its fixture replay opens.
    var racePreviewDevStart: RacePreviewDevStart?

    private(set) var signedInUserId: String? { didSet { syncChat() } }
    private(set) var signedInRole: String? { didSet { syncChat() } }
    private(set) var signedInRoomId: String? { didSet { syncChat() } }
    /// A tapped chat push for a race the roster has not loaded yet.
    private var pendingChatRoomId: String?
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
        self.accountDeletionModel = AccountDeletionModel(client: client)
        self.membersModel = RoomMembersModel(client: client)
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
        self.racePreview = RacePreviewModel(client: client)
        self.authModel.bindSession { [weak self] session in
            self?.adopt(session)
        }
        self.joinModel.onJoined = { [weak self] roomId, role in
            self?.noteJoined(roomId: roomId, role: role)
        }
        self.athleteModel.onSaved = { [weak self] name in
            self?.updateDisplayName(name)
        }
        self.profileModel.bindSignOut { [weak self] in
            self?.signOut()
        }
        PushRouter.shared.handler = { [weak self] roomId in
            self?.openChat(roomId: roomId)
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
        if isUnpaidRunnerRace { return .unlock }
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

    /// A tapped chat notification: switch to that race and show its chat.
    func openChat(roomId: String) {
        guard isSignedIn else { return }
        if roomId != signedInRoomId {
            if roster.races.contains(where: { $0.id == roomId }) {
                selectRace(roomId)
            } else {
                pendingChatRoomId = roomId
                Task { await loadRaces() }
                return
            }
        }
        fixtureOverlay = false
        show(Route(featureId: "chat-thread", state: .success))
        enterShellIfNeeded()
    }

    private func syncChat() {
        chatModel.activate(userId: signedInUserId, roomId: signedInRoomId, role: signedInRole)
    }

    func open(_ url: URL) {
        guard url.scheme?.caseInsensitiveCompare("crewcue") == .orderedSame else { return }
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
            if let pending = pendingChatRoomId {
                pendingChatRoomId = nil
                if next.races.contains(where: { $0.id == pending }) {
                    openChat(roomId: pending)
                }
            }
            if let active = next.active {
                if active.id != signedInRoomId || active.role != signedInRole {
                    apply(active)
                }
            } else if signedInRoomId != nil {
                clearActiveRoom()
            }
            syncOnboarding(races: rooms.map { OnboardingRace(room: $0, userId: userId) })
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

    /// A race the runner just created: note it, then open its Race Pass paywall.
    func noteCreated(roomId: String) {
        noteJoined(roomId: roomId, role: "athlete")
        showBilling()
    }

    /// The Race Pass paywall for the active race. A full-screen route, like join.
    func showBilling() {
        show(Route(featureId: "billing-purchase", state: .success))
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
        racesMessage = ""
        racesLoading = false
        pendingChatRoomId = nil
        profileModel.clear()
        stravaModel.clear()
        activityImportModel.clear()
        accountDeletionModel.clear()
        membersModel.clear()
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
