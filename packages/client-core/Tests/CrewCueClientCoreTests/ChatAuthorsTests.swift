import Foundation
import Testing
@testable import CrewCueClientCore

@Test func chatAuthorsUseThisRoomsNames() {
    let authors = ChatAuthors(
        selfStreamUserId: "u-me",
        members: [
            ChatStreamMember(streamUserId: "u-me", displayName: " Pacer Collin "),
            ChatStreamMember(streamUserId: "u-ada", displayName: "Ada"),
            ChatStreamMember(streamUserId: "u-quiet"),
            ChatStreamMember(streamUserId: "u-blank", displayName: "   ")
        ]
    )
    #expect(authors.label(streamUserId: "u-me") == "Pacer Collin (you)")
    #expect(authors.label(streamUserId: "u-ada") == "Ada")
    #expect(authors.label(streamUserId: "u-quiet") == "Crew member")
    #expect(authors.label(streamUserId: "u-blank") == "Crew member")
    #expect(authors.label(streamUserId: "u-left-the-room") == "Crew member")
    #expect(authors.names == ["u-me": "Pacer Collin", "u-ada": "Ada"])
}

@Test func chatAuthorsNeverFallBackToAnotherRoomsName() {
    // Named "Pacer Collin" in Leadville, unnamed in Western States: the Western States roster has no name for them.
    let westernStates = ChatAuthors(
        token: ChatStreamTokenResponse(
            token: "t",
            streamUserId: "u-me",
            streamApiKey: "k",
            members: [ChatStreamMember(streamUserId: "u-me"), ChatStreamMember(streamUserId: "u-ada", displayName: "Ada")]
        )
    )
    #expect(westernStates.selfLabel == "You")
    #expect(westernStates.label(streamUserId: "u-me") == "You")
    #expect(westernStates.label(streamUserId: "u-ada") == "Ada")
}

@Test func chatAuthorsWithoutRosterShowNoIds() throws {
    let data = Data(#"{"token":"t","streamUserId":"u-a28bbc","streamApiKey":"k"}"#.utf8)
    let token = try JSONDecoder().decode(ChatStreamTokenResponse.self, from: data)
    let authors = ChatAuthors(token: token)
    #expect(authors.label(streamUserId: "u-a28bbc") == "You")
    #expect(authors.label(streamUserId: "u-other") == "Crew member")
}
