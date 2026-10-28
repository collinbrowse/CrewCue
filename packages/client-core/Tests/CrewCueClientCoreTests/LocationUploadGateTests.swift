import Testing
@testable import CrewCueClientCore

@Test func switchingRoomReleasesLocationUploadGate() {
    var gate = LocationUploadGate()
    let first = gate.acquire()
    #expect(first == 0)
    #expect(gate.acquire() == nil)

    gate.advance()
    #expect(!gate.held)

    let second = gate.acquire()
    #expect(second == 1)
    gate.release(ticket: first ?? -1)
    #expect(gate.held)

    gate.release(ticket: second ?? -1)
    #expect(!gate.held)
    #expect(gate.acquire() == 1)
}
