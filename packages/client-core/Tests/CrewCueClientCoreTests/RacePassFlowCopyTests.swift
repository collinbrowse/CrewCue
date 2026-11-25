import Foundation
import Testing
@testable import CrewCueClientCore

// The Race Pass page and the onboarding flow around it (clients/behavior/billing-purchase.md,
// onboarding-runner-setup.md, onboarding-race-preview.md, join-crew.md, room-members.md).

// MARK: Course upload failures

@Test func aCourseFileWithNoRouteAsksForAnotherFile() {
    // gpx-preview's 400 for a KML, a TCX, an empty or broken GPX.
    let noRoute = APIClient.failure(status: 400, data: Data(#"{"error":"GPX must include at least two track points."}"#.utf8))
    let kind = OnboardingSetupFailure.classify(noRoute, courseSave: true)
    #expect(kind == .courseUnreadable)
    #expect(kind.needsAnotherFile)
    #expect(kind.message == OnboardingCopy.courseUnreadable)
    // Never the server's own words.
    #expect(!kind.message.contains("track points"))
    // A preview that answered without a course reads the same.
    let empty = ClientHTTPError(status: 0, message: CoursePreview.unreadableMessage)
    #expect(OnboardingSetupFailure.classify(empty, courseSave: true) == .courseUnreadable)
    #expect(throws: ClientHTTPError.self) {
        try CoursePreview(previewData: Data(#"{"course":{"checkpoints":[]}}"#.utf8), fileName: "x.gpx")
    }
}

@Test func anyOtherCourseUploadFailureOffersTryAgainOrAnotherFile() {
    for status in [500, 502, 404, 403] {
        let kind = OnboardingSetupFailure.classify(ClientHTTPError(status: status, message: "x"), courseSave: true)
        #expect(kind == .courseUploadFailed, "\(status)")
        #expect(!kind.needsAnotherFile)
    }
    // A body the app can't read is the upload's failure too, not "Couldn't save this step."
    #expect(OnboardingSetupFailure.classify(CocoaError(.coderReadCorrupt), courseSave: true) == .courseUploadFailed)
    #expect(OnboardingSetupFailure.courseUploadFailed.message == OnboardingCopy.courseUploadFailed)
    // The kinds that already had their own copy keep it on a course save.
    #expect(OnboardingSetupFailure.classify(URLError(.notConnectedToInternet), courseSave: true) == .offline)
    #expect(OnboardingSetupFailure.classify(ClientHTTPError(status: 429, message: "Too many requests"), courseSave: true) == .courseSaveLimit)
    // Other steps keep the plain failure.
    #expect(OnboardingSetupFailure.classify(ClientHTTPError(status: 400, message: "x")) == .failed)
    #expect(OnboardingSetupFailure.classify(CocoaError(.coderReadCorrupt)) == .failed)
}

@Test func courseUploadCopyIsPlainAndReachesAndroid() {
    let strings = [
        OnboardingCopy.courseUnreadable, OnboardingCopy.courseUploadFailed, OnboardingCopy.courseUploaded,
        OnboardingCopy.courseNoElevation, OnboardingCopy.close, OnboardingCopy.racePassTitle,
        OnboardingCopy.racePassSubtitle, OnboardingCopy.finishSetupTitle, OnboardingCopy.finishSetupDetail
    ]
    for text in strings {
        #expect(!text.isEmpty)
        #expect(!text.contains("!"), "\(text)")
    }
    let copy = OnboardingCopy.runtimeCopy
    #expect(copy["courseUnreadable"] as? String == OnboardingCopy.courseUnreadable)
    #expect(copy["courseUploadFailed"] as? String == OnboardingCopy.courseUploadFailed)
    #expect(copy["racePassTitle"] as? String == OnboardingCopy.racePassTitle)
    #expect(copy["racePassSubtitle"] as? String == OnboardingCopy.racePassSubtitle)
    let labels = copy["labels"] as? [String: String]
    #expect(labels?["courseUploaded"] == OnboardingCopy.courseUploaded)
    #expect(labels?["courseNoElevation"] == OnboardingCopy.courseNoElevation)
    #expect(labels?["close"] == OnboardingCopy.close)
    #expect(labels?["back"] == OnboardingCopy.back)
}

// MARK: Paywall copy

@Test func theUnlockPageHasOneSubtitle() {
    #expect(OnboardingCopy.explanation(for: .paywall) == "Unlock your race for a fine-tuned projection and so your crew can follow you.")
    #expect(OnboardingCopy.runtimeCopy["paywallPitch"] == nil)
}

@Test func theRacePassPageShowsNoStatusLineWhileUnpaid() throws {
    let unpaid = RoomBillingState(roomId: "r1", isPaid: false, isUnlimited: false, crewCount: 0, crewLimit: 1, offers: [.racePass, .racePassFullCrew])
    #expect(unpaid.paywallStatus == "")
    // The room screen keeps its line.
    #expect(unpaid.summary == "No Race Pass yet. Buy one to open this race.")
    let paid = RoomBillingState(roomId: "r1", isPaid: true, isUnlimited: false, crewCount: 0, crewLimit: 1, offers: [.crewUpgrade])
    #expect(paid.paywallStatus == PurchasePhase.unlocked(paid).message)
    #expect(BillingBridge.json(unpaid)["paywallStatus"] as? String == "")
    #expect(BillingBridge.json(paid)["paywallStatus"] as? String == paid.paywallStatus)
}

// MARK: Replay focus

@Test func everyReplayBeatSaysWhereToLook() {
    var seen = Set<String>()
    let focus = OnboardingCopy.runtimeCopy["beatFocus"] as? [String: String]
    for beat in DemoRaceBeat.allCases {
        let text = OnboardingCopy.replayFocus(beat)
        #expect(text.hasPrefix("Look at"), "\(beat)")
        #expect(!text.contains("!"))
        #expect(seen.insert(text).inserted, "\(beat) repeats another beat")
        #expect(focus?[beat.rawValue] == text)
    }
}

// MARK: Crew waiting for the unlock, and the Invite pill

@Test func crewWhoJoinAnUnpaidRaceWaitForTheRunner() {
    let unpaid = APIClient.failure(status: 402, data: Data(#"{"error":"Race not unlocked","code":"room_unpaid"}"#.utf8))
    let outcome = PendingJoinOutcome.outcome(for: unpaid)
    #expect(outcome == .raceLocked)
    #expect(outcome.message == "Waiting for the runner to unlock this race.")
    #expect(!outcome.clearsCode)
    let copy = RuntimeCall.inviteCopyJSON()
    #expect(copy["raceLockedReason"] == OnboardingState.raceLockedReason)
    #expect(copy["invitePill"] == InviteCopy.invitePill)
    #expect(InviteCopy.invitePill == "Invite")
}
