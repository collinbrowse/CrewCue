import Foundation
import Testing
@testable import CrewCueClientCore

private func state(_ flow: OnboardingState.Flow, phase: OnboardingState.Phase? = nil, roomId: String?, reason: String? = nil) -> OnboardingState {
    OnboardingState(
        flow: flow, role: nil, roomId: roomId, phase: phase, step: nil,
        steps: [], checklist: [], inviteConfirmed: false, showsTabBar: true, reason: reason
    )
}

private let preview = state(.runner, phase: .preview, roomId: "r1")
private let locked = state(.raceLocked, roomId: "r2", reason: OnboardingState.raceLockedReason)
private let done = state(.done, roomId: "r1")

@Test func anUnpaidRunnerRaceLoadsItsTeaserGatesActionsAndNeverSamplesLocation() {
    let access = RaceAccess.resolve(roomId: "r1", role: "athlete", billing: nil, onboarding: preview)
    #expect(access.unpaid)
    #expect(access.gatesActions)
    #expect(access.loadsRace)
    #expect(!access.samplesLocation)
    #expect(access.lockedReason == nil)

    // Billing alone gates too, whatever race the onboarding state is for.
    let billing = RaceAccess.resolve(roomId: "r1", role: "athlete", billing: .unpaid, onboarding: state(.done, roomId: "r9"))
    #expect(billing.gatesActions)
    #expect(!billing.samplesLocation)
}

@Test func aPaidBillingReadWinsOverAnOldPreviewState() {
    // The purchase went through but the race list read after it failed: the saved state still
    // says preview. The paid race loses its banner and sends pings again.
    let access = RaceAccess.resolve(roomId: "r1", role: "athlete", billing: .paid, onboarding: preview)
    #expect(!access.unpaid)
    #expect(!access.gatesActions)
    #expect(access.samplesLocation)
    #expect(access.loadsRace)

    let crew = RaceAccess.resolve(roomId: "r2", role: "crew_member", billing: .paid, onboarding: locked)
    #expect(!crew.unpaid)
    #expect(crew.loadsRace)
    #expect(crew.lockedReason == nil)
}

@Test func aCrewMembersLockedRaceCarriesTheReasonAndLoadsNothing() {
    let access = RaceAccess.resolve(roomId: "r2", role: "crew_member", billing: nil, onboarding: locked)
    #expect(access.unpaid)
    #expect(access.lockedReason == OnboardingState.raceLockedReason)
    #expect(!access.loadsRace)
    #expect(!access.gatesActions)
    #expect(!access.samplesLocation)

    // Billing says unpaid before the state names a reason: still locked, no reason yet.
    let billing = RaceAccess.resolve(roomId: "r2", role: "crew_member", billing: .unpaid, onboarding: nil)
    #expect(billing.unpaid)
    #expect(billing.lockedReason == nil)
    #expect(!billing.loadsRace)
}

@Test func aPaidRaceOrNoRaceIsNotGated() {
    let paid = RaceAccess.resolve(roomId: "r1", role: "athlete", billing: nil, onboarding: done)
    #expect(paid == RaceAccess(unpaid: false, loadsRace: true, samplesLocation: true, gatesActions: false, lockedReason: nil))
    #expect(RaceAccess.resolve(roomId: nil, role: "athlete", billing: .unpaid, onboarding: preview) == .noRace)
    #expect(RaceAccess.resolve(roomId: "  ", role: "athlete", billing: .unpaid, onboarding: preview) == .noRace)
    // A preview state for another race says nothing about this one.
    #expect(!RaceAccess.resolve(roomId: "r3", role: "athlete", billing: nil, onboarding: preview).unpaid)
}

@Test func raceAccessOpAnswersTheAccessForTheSentState() async throws {
    let request: [String: Any] = [
        "op": "raceAccess", "roomId": "r1", "role": "athlete",
        "onboarding": ["flow": "runner", "phase": "preview", "roomId": "r1", "step": "preview", "showsTabBar": true]
    ]
    let raw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: request), as: UTF8.self))
    let root = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
    let access = try #require(root["result"] as? [String: Any], "\(root)")
    #expect(access["unpaid"] as? Bool == true)
    #expect(access["gatesActions"] as? Bool == true)
    #expect(access["samplesLocation"] as? Bool == false)
    #expect(access["loadsRace"] as? Bool == true)
    #expect(access["lockedReason"] is NSNull)

    var paid = request
    paid["billing"] = "paid"
    let paidRaw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: paid), as: UTF8.self))
    let paidRoot = try #require(try JSONSerialization.jsonObject(with: Data(paidRaw.utf8)) as? [String: Any])
    let paidAccess = try #require(paidRoot["result"] as? [String: Any])
    #expect(paidAccess["unpaid"] as? Bool == false)
    #expect(paidAccess["samplesLocation"] as? Bool == true)

    let crew: [String: Any] = [
        "op": "raceAccess", "roomId": "r2", "role": "crew_member",
        "onboarding": ["flow": "raceLocked", "roomId": "r2", "reason": OnboardingState.raceLockedReason]
    ]
    let crewRaw = await RuntimeCall.perform(String(decoding: try JSONSerialization.data(withJSONObject: crew), as: UTF8.self))
    let crewRoot = try #require(try JSONSerialization.jsonObject(with: Data(crewRaw.utf8)) as? [String: Any])
    let crewAccess = try #require(crewRoot["result"] as? [String: Any])
    #expect(crewAccess["lockedReason"] as? String == OnboardingState.raceLockedReason)
    #expect(crewAccess["loadsRace"] as? Bool == false)
}
