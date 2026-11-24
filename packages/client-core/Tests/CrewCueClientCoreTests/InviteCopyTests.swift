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
    // No server: the op still answers, with the screen's state and words.
    let body = try await runtimeResult(#"{"op":"inviteShare","roomId":"r1"}"#)
    let state = try #require(body["state"] as? String)
    #expect(state == "offline" || state == "error")
    #expect(body["status"] as? String == (state == "offline" ? InviteCopy.shareOffline : InviteCopy.shareError))
    #expect(body["details"] is NSNull)
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
