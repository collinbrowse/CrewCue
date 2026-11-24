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
