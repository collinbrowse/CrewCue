import XCTest
@testable import CrewCueClientCore

final class SuggestedDisplayNameTests: XCTestCase {
    func testAnEmailSignUpSuggestsNothing() {
        // Auth0 database users: name is the email.
        XCTAssertNil(SuggestedDisplayName.from(name: "pat.runner@example.com", email: "pat.runner@example.com"))
    }

    func testTheEmailsLocalPartIsNotAName() {
        XCTAssertNil(SuggestedDisplayName.from(name: "Pat.Runner", email: "pat.runner@example.com"))
    }

    func testAnythingWithAnAtSignIsNotAName() {
        XCTAssertNil(SuggestedDisplayName.from(name: "pat@work", email: nil))
    }

    func testARealNameIsSuggestedTrimmed() {
        XCTAssertEqual(SuggestedDisplayName.from(name: "  Pat Runner ", email: "pat.runner@example.com"), "Pat Runner")
        XCTAssertEqual(SuggestedDisplayName.from(name: "Pat Runner", email: nil), "Pat Runner")
    }

    func testNoNameSuggestsNothing() {
        XCTAssertNil(SuggestedDisplayName.from(name: nil, email: "pat@example.com"))
        XCTAssertNil(SuggestedDisplayName.from(name: "   ", email: nil))
    }
}
