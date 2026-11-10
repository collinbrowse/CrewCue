import Foundation
import Testing
@testable import CrewCueClientCore

@Test func chatAuthorsUseThisRoomsNames() {
    let authors = ChatAuthors(
        selfUserId: "u-me",
        members: [
            ChatRoomMember(userId: "u-me", displayName: " Pacer Collin "),
            ChatRoomMember(userId: "u-ada", displayName: "Ada"),
            ChatRoomMember(userId: "u-quiet"),
            ChatRoomMember(userId: "u-blank", displayName: "   ")
        ]
    )
    #expect(authors.label(userId: "u-me") == "Pacer Collin (you)")
    #expect(authors.label(userId: "u-ada") == "Ada")
    #expect(authors.label(userId: "u-quiet") == "Crew member")
    #expect(authors.label(userId: "u-blank") == "Crew member")
    #expect(authors.label(userId: "u-left-the-room") == "Crew member")
    #expect(authors.names == ["u-me": "Pacer Collin", "u-ada": "Ada"])
}

@Test func chatAuthorsNeverFallBackToAnotherRoomsName() {
    // Named "Pacer Collin" in Leadville, unnamed in Western States: the Western States roster has no name for them.
    let westernStates = ChatAuthors(
        selfUserId: "u-me",
        members: [ChatRoomMember(userId: "u-me"), ChatRoomMember(userId: "u-ada", displayName: "Ada")]
    )
    #expect(westernStates.selfLabel == "You")
    #expect(westernStates.label(userId: "u-me") == "You")
    #expect(westernStates.label(userId: "u-ada") == "Ada")
}

@Test func chatAuthorsWithoutRosterShowNoIds() throws {
    let data = Data(#"{"messages":[],"members":[],"selfUserId":"auth0|a28bbc","latestCursor":""}"#.utf8)
    let page = try JSONDecoder().decode(ChatMessagePage.self, from: data)
    let authors = ChatAuthors(selfUserId: page.selfUserId, members: page.members)
    #expect(authors.label(userId: "auth0|a28bbc") == "You")
    #expect(authors.label(userId: "auth0|other") == "Crew member")
}
