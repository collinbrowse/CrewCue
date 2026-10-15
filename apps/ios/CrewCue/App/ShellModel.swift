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
        enterShellIfNeeded()
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
    }

    func updateDisplayName(_ name: String) {
        client.graph.session?.update { session in
            session.displayName = name
        }
        signedInDisplayName = name
        if let session = client.graph.session?.session {
            persist(session)
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
