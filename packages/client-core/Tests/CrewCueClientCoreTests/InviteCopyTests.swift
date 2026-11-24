import Foundation
import Testing
@testable import CrewCueClientCore

@Test func pastedCodeReadsLinksShareTextAndBareCodes() throws {
    let share = try #require(InviteLink.shareText(raceName: "Western States", code: "123456"))
    let inputs = [
        "https://collinbrowse.github.io/crewcue/join/?code=123456",
        "crewcue://join/123456",
        share,
        "123456",
        "  123456\n",
        "123 456",
        "123-456",
        "Code: 123456.",
        "Join here (https://collinbrowse.github.io/crewcue/join/?code=123456)"
    ]
    for input in inputs {
        #expect(InviteCopy.pastedCode(input) == "123456", "\(input)")
    }
}

@Test func pastedCodeRefusesTextWithoutOneCode() {
    let inputs = [
        "", "   ", "12345", "1234567", "abcdef", "１２３４５６", "call me at 555-1234",
        "111111 or 222222",
        "https://collinbrowse.github.io/crewcue/join/?code=111111 and code 222222",
        "https://example.com/join/?code=123456x",
        String(repeating: "1", count: 3000)
    ]
    for input in inputs {
        #expect(InviteCopy.pastedCode(input) == nil, "\(input)")
    }
    // The same code twice (the share text carries it in the link and on its own) is one code.
    #expect(InviteCopy.pastedCode("123456 https://collinbrowse.github.io/crewcue/join/?code=123456") == "123456")
}

@Test func joinPreviewNamesTheRunner() {
    func preview(_ members: [RaceRoomJoinPreviewMember]) -> RaceRoomJoinPreview {
        RaceRoomJoinPreview(roomName: "Western States", joinCode: "123456", status: "planned", memberCount: Double(members.count), members: members)
    }
    let named = preview([
        RaceRoomJoinPreviewMember(displayName: "Alex", role: "crew_member"),
        RaceRoomJoinPreviewMember(displayName: " Sam ", role: "athlete")
    ])
    #expect(InviteCopy.runnerName(named) == "Sam")
    #expect(InviteCopy.joiningRace(runner: InviteCopy.runnerName(named)) == "You're joining Sam's race")
    // The server's stand-in name, a blank name and no runner all read as no name.
    #expect(InviteCopy.runnerName(preview([RaceRoomJoinPreviewMember(displayName: "Member abc123", role: "athlete")])) == nil)
    #expect(InviteCopy.runnerName(preview([RaceRoomJoinPreviewMember(displayName: "  ", role: "athlete")])) == nil)
    #expect(InviteCopy.runnerName(preview([RaceRoomJoinPreviewMember(displayName: "Alex", role: "crew_member")])) == nil)
    #expect(InviteCopy.joiningRace(runner: nil) == "You're joining this race")
    #expect(InviteCopy.joiningRace(runner: "Sam\n  Lee") == "You're joining Sam Lee's race")
}

@Test func inviteFixtureRoutesHaveTheirOwnScreens() {
    for (id, label) in [("invite-share", "crewcue.invite-share"), ("join-link", "crewcue.join-link")] {
        for state in [FeatureState.success, .empty, .error, .offline] {
            let screen = CrewCueClientCore.featureScreen(id: id, state: state)
            #expect(screen.accessibilityIdentifier == label)
            #expect(!screen.body.isEmpty)
        }
    }
}

// MARK: - Android's invite ops

private func runtimeResult(_ request: String) async throws -> [String: Any] {
    let root = try #require(try JSONSerialization.jsonObject(with: Data(await RuntimeCall.perform(request).utf8)) as? [String: Any])
    #expect(root["ok"] as? Bool == true)
    return try #require(root["result"] as? [String: Any])
}

@Test func inviteShareOpAnswersAStateAndTheCopy() async throws {
    // No base URL: the op still answers with the screen's words. Nothing reached the network,
    // so it is an error, never Offline.
    let body = try await runtimeResult(#"{"op":"inviteShare","roomId":"r1"}"#)
    #expect(body["state"] as? String == "error")
    #expect(body["status"] as? String == InviteCopy.shareError)
    #expect(body["details"] is NSNull)
    #expect((body["reason"] as? String)?.isEmpty == false)
    let copy = try #require(body["copy"] as? [String: String])
    #expect(copy["shareTitle"] == InviteCopy.shareTitle && copy["shareButton"] == InviteCopy.shareButton)
    #expect(copy["inviteCrewButton"] == InviteCopy.inviteCrewButton && copy["joinTitle"] == InviteCopy.joinTitle)
    let all = try await runtimeResult(#"{"op":"inviteCopy"}"#)
    #expect((all["copy"] as? [String: String])?["linkWithoutCode"] == InviteCopy.linkWithoutCode)
}

@Test func inviteJoinLineNamesAnEarlierJoin() async throws {
    #expect(try await runtimeResult(#"{"op":"inviteJoinLine","raceName":"Leadville  100"}"#)["line"] as? String == InviteCopy.joinedRace("Leadville 100"))
    let failed = try await runtimeResult(#"{"op":"inviteJoinLine","code":"123456","message":"That invite code was not found."}"#)
    #expect(failed["line"] as? String == InviteCopy.joinFailed(code: "123456", message: "That invite code was not found."))
}

@Test func confirmedInviteJoinsOnlyTheNextSignInAndGivingUpForgetsIt() async throws {
    let storage = FileManager.default.temporaryDirectory
        .appendingPathComponent("invite-confirm-\(UUID().uuidString)/crewcue-user", isDirectory: true).path
    func op(_ fields: [String: Any]) async throws -> [String: Any] {
        var request: [String: Any] = ["storageDir": storage, "userId": "", "token": ""]
        request.merge(fields) { $1 }
        let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self))
        let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        #expect(root["ok"] as? Bool == true, "\(root["message"] ?? "")")
        return try #require(root["result"] as? [String: Any])
    }
    _ = try await op(["op": "savePendingJoin", "code": "123456", "source": "link"])
    // Opened and left: nothing joins on sign-in.
    #expect(try await op(["op": "confirmedInviteForSignIn"])["pendingJoin"] is NSNull)
    // Sign up to join confirms it: the sign-in right after joins it.
    _ = try await op(["op": "markOnboardingStep", "step": "join", "invite": "123456"])
    #expect((try await op(["op": "confirmedInviteForSignIn"])["pendingJoin"] as? [String: Any])?["code"] as? String == "123456")
    // Back gives it up: the code and the confirmation go.
    _ = try await op(["op": "giveUpInvite"])
    #expect(try await op(["op": "confirmedInviteForSignIn"])["pendingJoin"] is NSNull)
    #expect(try await op(["op": "readPendingJoin"])["pendingJoin"] is NSNull)
}

@Test func pastedInviteCodeOpReadsTheClipboardText() async throws {
    #expect(try await runtimeResult(#"{"op":"pastedInviteCode","text":"123 456"}"#)["code"] as? String == "123456")
    #expect(try await runtimeResult(#"{"op":"pastedInviteCode","text":"hello"}"#)["code"] is NSNull)
    #expect(try await runtimeResult(#"{"op":"pastedInviteCode"}"#)["code"] is NSNull)
}

@Test func joinLinksAreKnownWithOrWithoutACode() async throws {
    for link in [
        "https://collinbrowse.github.io/crewcue/join/",
        "https://collinbrowse.github.io/crewcue/join",
        "https://COLLINBROWSE.github.io/crewcue/join/?code=12",
        "crewcue://join/",
        "crewcue://join/12"
    ] {
        #expect(InviteLink.isJoinLink(link), "\(link)")
    }
    for link in [
        "https://collinbrowse.github.io/",
        "https://collinbrowse.github.io/crewcue/joint/",
        "https://collinbrowse.github.io.evil.com/crewcue/join/",
        "http://collinbrowse.github.io/crewcue/join/",
        "crewcue://dev/join-crew",
        "crewcue_join=12",
        ""
    ] {
        #expect(!InviteLink.isJoinLink(link), "\(link)")
    }
    let lost = try await runtimeResult(#"{"op":"parseInviteLink","link":"crewcue://join/12"}"#)
    #expect(lost["code"] is NSNull && lost["joinLink"] as? Bool == true)
    let read = try await runtimeResult(#"{"op":"parseInviteLink","link":"crewcue://join/123456"}"#)
    #expect(read["code"] as? String == "123456" && read["joinLink"] as? Bool == true)
    #expect(try await runtimeResult(#"{"op":"parseInviteLink","link":"crewcue://dev/hello"}"#)["joinLink"] as? Bool == false)
}

// MARK: - inviteShare against a scripted server

/// Answers `GET /race-rooms/<id>` with a scripted status and body, or throws `failure`.
private struct InviteRoomServer: HTTPTransport {
    var status = 200
    var body = ""
    var failure: (any Error)?

    func send(_ request: HTTPRequest) async throws -> HTTPResponse {
        if let failure { throw failure }
        return HTTPResponse(status: status, body: Data(body.utf8))
    }
}

/// The API's `GET /race-rooms/:roomId` for the runner, as `services/api` sends it: the room inside
/// `room`, with `permissions` beside it.
private let inviteRoomBody = #"""
{"room":{"id":"r1","joinCode":"569806","creatorName":"Ana","teamId":"team-1","athleteId":"runner-ana","name":"Leadville 100","status":"active","createdAt":"2026-11-24T17:12:20.793Z","createdByUserId":"runner-ana","entitlement":{"status":"paid","lastUpdatedAt":"2026-11-24T17:12:20.800Z","source":"manual","crewTier":"unlimited"},"memberships":[{"userId":"runner-ana","role":"athlete","joinedAt":"2026-11-24T17:12:20.793Z","displayName":"Ana"}]},"permissions":{"canViewRoom":true,"canEditRaceSetup":true,"canIssueInvite":true}}
"""#

private func inviteShare(_ server: InviteRoomServer, base: String) async throws -> [String: Any] {
    RuntimeCall.setTransportForTests(server, baseURL: base)
    defer { RuntimeCall.setTransportForTests(nil, baseURL: base) }
    return try await runtimeResult(
        #"{"op":"inviteShare","roomId":"r1","baseURL":"\#(base)","token":"t","userId":"runner-ana"}"#
    )
}

@Test func inviteShareReadsTheRunnersRoom() async throws {
    let body = try await inviteShare(InviteRoomServer(body: inviteRoomBody), base: "https://invite-ready.test")
    #expect(body["state"] as? String == "ready")
    #expect(body["status"] as? String == InviteCopy.shareReady)
    let details = try #require(body["details"] as? [String: Any])
    #expect(details["code"] as? String == "569806")
    #expect(details["link"] as? String == "https://collinbrowse.github.io/crewcue/join/?code=569806")
    #expect(details["locked"] as? Bool == false)
    #expect(body["reason"] == nil)
}

@Test func inviteShareIsOfflineOnlyForATransportFailure() async throws {
    // No connection: Offline.
    let down = try await inviteShare(InviteRoomServer(failure: URLError(.notConnectedToInternet)), base: "https://invite-down.test")
    #expect(down["state"] as? String == "offline")
    #expect(down["status"] as? String == InviteCopy.shareOffline)
    // Android reports a refused connection as NSURLErrorDomain -1: Offline too.
    let refused = try await inviteShare(
        InviteRoomServer(failure: NSError(domain: NSURLErrorDomain, code: -1)), base: "https://invite-refused.test"
    )
    #expect(refused["state"] as? String == "offline")

    // The network answered: never Offline.
    let garbled = try await inviteShare(InviteRoomServer(body: #"{"room":{"id":"r1"}}"#), base: "https://invite-garbled.test")
    #expect(garbled["state"] as? String == "error")
    #expect(garbled["status"] as? String == InviteCopy.shareError)
    #expect((garbled["reason"] as? String)?.isEmpty == false)
    let notJSON = try await inviteShare(InviteRoomServer(body: "<html>proxy</html>"), base: "https://invite-html.test")
    #expect(notJSON["state"] as? String == "error")
    let server = try await inviteShare(InviteRoomServer(status: 500, body: #"{"error":"boom"}"#), base: "https://invite-500.test")
    #expect(server["state"] as? String == "error")
    // A non-HTTP answer (status 0) reached something: an error, not Offline.
    let nonHTTP = try await inviteShare(InviteRoomServer(status: 0, body: ""), base: "https://invite-zero.test")
    #expect(nonHTTP["state"] as? String == "error")
}

@Test func inviteShareWithoutAJoinCodeIsEmpty() async throws {
    let noCode = inviteRoomBody.replacingOccurrences(of: #""joinCode":"569806","#, with: "")
    let body = try await inviteShare(InviteRoomServer(body: noCode), base: "https://invite-empty.test")
    #expect(body["state"] as? String == "empty")
    #expect(body["status"] as? String == InviteCopy.shareEmpty)
}
