import Testing
@testable import CrewCueClientCore

@Test func aReplayIsWatchedUntilItsLastViewGoes() {
    var audience = DemoRaceAudience()
    #expect(!audience.isWatched)
    audience.appeared()
    #expect(audience.isWatched)
    let last = audience.disappeared()
    #expect(last, "the only view went: pause and schedule the cleanup")
    #expect(!audience.isWatched)
}

@Test func anOldViewsLateDisappearanceKeepsTheReplayPlaying() {
    // A display switch rebuilds the window: the new view appears before the old one goes.
    var audience = DemoRaceAudience()
    audience.appeared()
    audience.appeared()
    let oldGone = audience.disappeared()
    #expect(!oldGone, "the new view still shows the replay")
    #expect(audience.isWatched)
    #expect(audience.count == 1)
    let newGone = audience.disappeared()
    #expect(newGone)
    #expect(!audience.isWatched)
}

@Test func aViewComingBackAfterTheLastWentIsWatchedAgain() {
    var audience = DemoRaceAudience()
    audience.appeared()
    let last = audience.disappeared()
    #expect(last)
    audience.appeared()
    #expect(audience.isWatched, "back within the grace period: the cleanup is cancelled")
}

@Test func anExtraDisappearanceNeverGoesBelowZero() {
    var audience = DemoRaceAudience()
    let extra = audience.disappeared()
    #expect(!extra, "nothing was watching: nothing to pause or schedule")
    #expect(audience.count == 0)
    audience.appeared()
    #expect(audience.isWatched)
}
