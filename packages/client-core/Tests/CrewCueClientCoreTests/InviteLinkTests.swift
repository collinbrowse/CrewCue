import Foundation
import Testing
@testable import CrewCueClientCore

@Test func inviteLinkHostAndPathLiveInOneConstant() throws {
    #expect(InviteLink.joinPage == "https://collinbrowse.github.io/crewcue/join/")
    #expect(InviteLink.host == "collinbrowse.github.io")
    #expect(InviteLink.path == "/crewcue/join/")
    let link = try #require(InviteLink.build(code: "123456"))
    #expect(link.absoluteString == "https://collinbrowse.github.io/crewcue/join/?code=123456")
    #expect(InviteLink.build(code: " 123456\n")?.absoluteString == link.absoluteString)
    #expect(InviteLink.parse(link.absoluteString) == "123456")
}

@Test func inviteLinkBuildRefusesAnythingButSixASCIIDigits() {
    for code in ["", "12345", "1234567", "12345a", "+12345", "-12345", "12 345", "１２３４５６", "١٢٣٤٥٦", "12345६", "123456\u{0301}"] {
        #expect(InviteLink.build(code: code) == nil, "\(code)")
        #expect(InviteLink.isCode(code) == false, "\(code)")
    }
    #expect(InviteLink.isCode("000000"))
    #expect(InviteLink.isCode("987654"))
}

@Test func inviteLinkParsesTheJoinPageLink() {
    let accepted = [
        "https://collinbrowse.github.io/crewcue/join/?code=123456",
        "https://collinbrowse.github.io/crewcue/join?code=123456",
        "https://collinbrowse.github.io/crewcue/join/index.html?code=123456",
        "HTTPS://CollinBrowse.GitHub.IO/crewcue/join/?code=123456",
        "https://collinbrowse.github.io:443/crewcue/join/?code=123456",
        "https://collinbrowse.github.io/crewcue/join/?utm_source=sms&code=123456#top",
        "https://collinbrowse.github.io/crewcue/join/?code=123456&code=123456",
        "https://collinbrowse.github.io/crewcue/join/?code=12345%36",
        "  https://collinbrowse.github.io/crewcue/join/?code=123456\n"
    ]
    for link in accepted {
        #expect(InviteLink.match(link) == InviteMatch(code: "123456", source: .link), "\(link)")
    }
}

@Test func inviteLinkParsesTheAppSchemeLink() {
    for link in ["crewcue://join/123456", "crewcue://join/123456/", "CREWCUE://JOIN/123456"] {
        #expect(InviteLink.match(link) == InviteMatch(code: "123456", source: .link), "\(link)")
    }
}

@Test func inviteLinkParsesThePlayInstallReferrer() {
    let accepted = [
        "crewcue_join=123456",
        "utm_source=google-play&utm_medium=organic&crewcue_join=123456",
        "crewcue_join=123456&utm_source=join-page",
        "crewcue_join%3D123456",
        "utm_source%3Dgoogle-play%26crewcue_join%3D123456",
        "utm_source=a:b&crewcue_join=123456",
        "&&crewcue_join=123456&&"
    ]
    for referrer in accepted {
        #expect(InviteLink.match(referrer) == InviteMatch(code: "123456", source: .referrer), "\(referrer)")
    }
}

@Test func inviteLinkRejectsOtherHostsAndLookalikes() {
    let hostile = [
        "http://collinbrowse.github.io/crewcue/join/?code=123456",
        "https://collinbrowse.github.io.evil.com/crewcue/join/?code=123456",
        "https://evilcollinbrowse.github.io/crewcue/join/?code=123456",
        "https://evil.com/crewcue/join/?code=123456",
        "https://github.io/crewcue/join/?code=123456",
        "https://collinbrowse.github.io./crewcue/join/?code=123456",
        "https://collinbrowse%2Egithub.io/crewcue/join/?code=123456",
        "https://collinbrowse.github.io@evil.com/crewcue/join/?code=123456",
        "https://evil.com@collinbrowse.github.io/crewcue/join/?code=123456",
        "https://user:pass@collinbrowse.github.io/crewcue/join/?code=123456",
        "https://collinbrowse.github.io:8443/crewcue/join/?code=123456",
        "https://evil.com/?next=https://collinbrowse.github.io/crewcue/join/?code=123456",
        "https://evil.com/#https://collinbrowse.github.io/crewcue/join/?code=123456",
        "https://play.google.com/store/apps/details?id=com.crewcue.android&referrer=crewcue_join%3D123456",
        "ftp://collinbrowse.github.io/crewcue/join/?code=123456",
        "file:///crewcue/join/?code=123456",
        "javascript:alert(1)//crewcue_join=123456",
        "crewcuex://join/123456",
        "crewcue://join.evil.com/123456",
        "crewcue://evil.com/join/123456",
        "crewcue://join:80/123456"
    ]
    for input in hostile {
        #expect(InviteLink.parse(input) == nil, "\(input)")
    }
}

@Test func inviteLinkRejectsTheWrongPathOrQuery() {
    let wrong = [
        "https://collinbrowse.github.io/crewcue/joinx/?code=123456",
        "https://collinbrowse.github.io/CrewCue/join/?code=123456",
        "https://collinbrowse.github.io/crewcue//join/?code=123456",
        "https://collinbrowse.github.io/other/crewcue/join/?code=123456",
        "https://collinbrowse.github.io/?code=123456",
        "https://collinbrowse.github.io?code=123456",
        "https://collinbrowse.github.io/crewcue/join/../evil/?code=123456",
        "https://collinbrowse.github.io/crewcue/join/%2e%2e/?code=123456",
        "https://collinbrowse.github.io/crewcue/join/a%2Fb?code=123456",
        "https://collinbrowse.github.io/crewcue/join/123456",
        "https://collinbrowse.github.io/crewcue/join/",
        "https://collinbrowse.github.io/crewcue/join/?code=",
        "https://collinbrowse.github.io/crewcue/join/?code",
        "https://collinbrowse.github.io/crewcue/join/?Code=123456",
        "https://collinbrowse.github.io/crewcue/join/?code=12345",
        "https://collinbrowse.github.io/crewcue/join/?code=1234567",
        "https://collinbrowse.github.io/crewcue/join/?code=+123456",
        "https://collinbrowse.github.io/crewcue/join/?code=%20123456",
        "https://collinbrowse.github.io/crewcue/join/?code=%EF%BC%91%EF%BC%92%EF%BC%93%EF%BC%94%EF%BC%95%EF%BC%96",
        "https://collinbrowse.github.io/crewcue/join/?code=111111&code=222222",
        "https://collinbrowse.github.io/crewcue/join/?code=123456&code=",
        "crewcue://join?code=123456",
        "crewcue:join/123456",
        "crewcue://join/",
        "crewcue://join//123456",
        "crewcue://join/123456/extra",
        "crewcue://join/12345",
        "crewcue://join/12345%36",
        "crewcue://dev/join-crew"
    ]
    for input in wrong {
        #expect(InviteLink.parse(input) == nil, "\(input)")
    }
}

@Test func inviteLinkRejectsBadReferrersAndGarbage() {
    let garbage = [
        "", "   ", "\n", "123456", " 123456 ", "not a link", "://", "https://", "crewcue://", "%", "%%%", "🏃‍♀️",
        "xcrewcue_join=123456", "crewcue_join_x=123456", "CREWCUE_JOIN=123456", "crewcue_join 123456",
        "crewcue_join=", "crewcue_join", "crewcue_join=12345", "crewcue_join=1234567", "crewcue_join=12345a",
        "crewcue_join=123456=", "crewcue_join=123456&crewcue_join=654321", "crewcue_join%253D123456",
        "crewcue_join%zz123456", "utm_source=google-play&utm_medium=organic", "?crewcue_join=123456",
        "crewcue_join=" + String(repeating: "1", count: 3000),
        "https://collinbrowse.github.io/crewcue/join/?pad=" + String(repeating: "a", count: 3000) + "&code=123456"
    ]
    for input in garbage {
        #expect(InviteLink.parse(input) == nil, "\(input)")
    }
}

@Test func inviteShareTextCarriesTheLinkAndTheCode() throws {
    let link = "https://collinbrowse.github.io/crewcue/join/?code=123456"
    #expect(InviteLink.shareText(raceName: "Western States", code: "123456")
        == "Join my crew for Western States on CrewCue: \(link)  Or open CrewCue and enter code 123456.")
    let unnamed = "Join my crew on CrewCue: \(link)  Or open CrewCue and enter code 123456."
    #expect(InviteLink.shareText(raceName: nil, code: "123456") == unnamed)
    #expect(InviteLink.shareText(raceName: "", code: "123456") == unnamed)
    #expect(InviteLink.shareText(raceName: " \n\t ", code: "123456") == unnamed)
    // One line, whatever was typed into the race name.
    #expect(InviteLink.shareText(raceName: "  Western\n  States 100 ", code: " 123456 ")
        == "Join my crew for Western States 100 on CrewCue: \(link)  Or open CrewCue and enter code 123456.")
    #expect(InviteLink.shareText(raceName: "Western States", code: "12345") == nil)
    #expect(InviteLink.shareText(raceName: "Western States", code: "abcdef") == nil)

    // The link in the message parses back to the code.
    let text = try #require(InviteLink.shareText(raceName: "Western States", code: "654321"))
    let shared = try #require(text.split(separator: " ").first { $0.hasPrefix("https://") })
    #expect(InviteLink.parse(String(shared)) == "654321")
}
