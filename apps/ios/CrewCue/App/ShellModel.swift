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
    let membersModel: RoomMembersModel
    let incidentsModel: IncidentsModel
    let paceModel: PaceModel
    let mapModel: MapModel
    let chatModel: ChatModel
    let chatPrefsModel: ChatNotificationPrefsModel
    let pushModel: PushRegistrationModel

    private(set) var signedInUserId: String?
    private(set) var signedInRole: String?
    private(set) var signedInRoomId: String?
    private(set) var signedInDisplayName: String?
    /// Every race the user belongs to. `signedInRoomId` is the active one; every tab follows it.
    private(set) var roster = RaceRoster()
    private(set) var racesMessage = ""
    private(set) var racesLoading = false
    private var racesGeneration = 0
    private var suppressTabRouteSync = false
    private var didRegisterSessionWipe = false

    var isSignedIn: Bool { signedInUserId != nil }

    init(client: AppClient, route: Route, fixtureOverlay: Bool, authConfiguration: Auth0Configuration) {
        self.client = client
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
        self.membersModel = RoomMembersModel(client: client)
        self.incidentsModel = IncidentsModel(client: client)
        self.paceModel = PaceModel(client: client)
        self.mapModel = MapModel(client: client)
        self.chatModel = ChatModel(client: client)
        self.chatPrefsModel = ChatNotificationPrefsModel(client: client)
        self.pushModel = PushRegistrationModel(client: client)
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
    }

    func open(_ url: URL) {
        guard url.scheme?.caseInsensitiveCompare("crewcue") == .orderedSame else { return }
        if Self.isStravaReturn(url) {
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
        fixtureOverlay = LaunchConfiguration.isFixtureOverlay(raw)
        let next = Route.parse(raw) ?? Route(featureId: "app-shell", state: .success)
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

    func prepareStores() {
        guard !didRegisterSessionWipe else { return }
        didRegisterSessionWipe = true
        guard let root = try? AppDirectories.root() else { return }
        client.graph.session?.register(id: "session-file") {
            try SessionFile.wipe(directory: root)
        }
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
        enterShellIfNeeded()
        Task { await loadRaces() }
    }

    /// Load the user's races. The stored active room stays active while the server still lists it.
    func loadRaces() async {
        guard let userId = signedInUserId else { return }
        racesGeneration += 1
        let ticket = racesGeneration
        racesLoading = true
        defer { if ticket == racesGeneration { racesLoading = false } }
        do {
            let races = try await RaceDayAPI.myRaces(graph: client.graph, userId: userId)
            guard ticket == racesGeneration, signedInUserId == userId else { return }
            let next = RaceRoster.reconciled(races: races, preferred: signedInRoomId)
            roster = next
            racesMessage = races.isEmpty ? "No races yet." : ""
            if let active = next.active {
                if active.id != signedInRoomId || active.role != signedInRole {
                    apply(active)
                }
            } else if signedInRoomId != nil {
                clearActiveRoom()
            }
        } catch {
            guard ticket == racesGeneration else { return }
            racesMessage = APIFailure.isOffline(error) ? "Offline. Showing your last race." : "Couldn't load your races."
        }
    }

    /// Switch every tab to another loaded race.
    func selectRace(_ roomId: String) {
        guard roomId != signedInRoomId, let race = roster.races.first(where: { $0.id == roomId }) else { return }
        roster.select(roomId)
        apply(race)
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
        Task { await loadRaces() }
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
        racesMessage = ""
        racesLoading = false
        profileModel.clear()
        stravaModel.clear()
        membersModel.clear()
        incidentsModel.clear()
        paceModel.clear()
        mapModel.clear()
        chatModel.clear()
        chatPrefsModel.clear()
        pushModel.clear()
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

    private func installOutbox(userId: String) {
        do {
            let directory = try AppDirectories.userDirectory(userId: userId)
            let outbox = try OutboxStore(userId: userId, directory: directory)
            client.graph.outbox = outbox
            client.graph.session?.register(id: "outbox") {
                try outbox.wipe()
            }
        } catch {
            client.graph.logger.log("outbox unavailable")
        }
    }

    private func persist(_ session: ClientSession) {
        guard let root = try? AppDirectories.root() else { return }
        try? SessionFile.save(session, directory: root)
    }
}
