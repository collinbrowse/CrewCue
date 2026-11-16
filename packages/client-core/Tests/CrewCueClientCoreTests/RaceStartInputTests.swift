import Foundation
import Testing
@testable import CrewCueClientCore

@Test func raceStartConvertsLocalToUtcZ() {
    let denver = RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(denver.raceStartAt == "2026-08-15T12:30:00.000Z")
    let tokyo = RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 30, timeZoneIdentifier: "Asia/Tokyo")
    #expect(tokyo.raceStartAt == "2026-08-14T21:30:00.000Z")
    let utc = RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 30, timeZoneIdentifier: "UTC")
    #expect(utc.raceStartAt == "2026-08-15T06:30:00.000Z")
}

@Test func raceStartAlwaysEndsInZNeverAnOffset() throws {
    let value = try #require(
        RaceStartInput(year: 2026, month: 1, day: 10, hour: 7, minute: 0, timeZoneIdentifier: "Asia/Kolkata").raceStartAt
    )
    #expect(value.hasSuffix("Z"))
    #expect(!value.contains("+"))
    #expect(value == "2026-01-10T01:30:00.000Z")
}

@Test func raceStartDefaultsToDeviceZone() {
    let input = RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 30)
    #expect(input.timeZoneIdentifier == DeviceTimeZone.current.identifier)
    #expect(DeviceTimeZone.resolve(input.timeZoneIdentifier) != nil)
}

@Test func raceStartAcrossDaylightSavingTransition() {
    // US spring forward 2026-03-08: Denver is UTC-7 before 02:00 and UTC-6 after.
    let before = RaceStartInput(year: 2026, month: 3, day: 8, hour: 1, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(before.raceStartAt == "2026-03-08T08:30:00.000Z")
    let after = RaceStartInput(year: 2026, month: 3, day: 8, hour: 3, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(after.raceStartAt == "2026-03-08T09:30:00.000Z")
    // The skipped hour does not exist, so it is rejected, not shifted.
    let gap = RaceStartInput(year: 2026, month: 3, day: 8, hour: 2, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(gap.raceStartAt == nil)
    // Fall back 2026-11-01: 01:30 happens twice; the first (still daylight time, UTC-6) is used.
    let repeated = RaceStartInput(year: 2026, month: 11, day: 1, hour: 1, minute: 30, timeZoneIdentifier: "America/Denver")
    #expect(repeated.raceStartAt == "2026-11-01T07:30:00.000Z")
    // Same wall clock on either side of the change maps to different UTC offsets.
    let winter = RaceStartInput(year: 2026, month: 11, day: 2, hour: 8, minute: 0, timeZoneIdentifier: "America/Denver")
    let summer = RaceStartInput(year: 2026, month: 10, day: 31, hour: 8, minute: 0, timeZoneIdentifier: "America/Denver")
    #expect(winter.raceStartAt == "2026-11-02T15:00:00.000Z")
    #expect(summer.raceStartAt == "2026-10-31T14:00:00.000Z")
}

@Test func raceStartCrossingMidnightInUtc() throws {
    // 8 PM in Los Angeles on Aug 15 is already Aug 16 in UTC.
    let la = RaceStartInput(year: 2026, month: 8, day: 15, hour: 20, minute: 0, timeZoneIdentifier: "America/Los_Angeles")
    #expect(la.raceStartAt == "2026-08-16T03:00:00.000Z")
    // And 1 AM in Tokyo on Aug 16 is still Aug 15 in UTC.
    let tokyo = RaceStartInput(year: 2026, month: 8, day: 16, hour: 1, minute: 0, timeZoneIdentifier: "Asia/Tokyo")
    #expect(tokyo.raceStartAt == "2026-08-15T16:00:00.000Z")
    // Reading the UTC instant back in the local zone restores the local date.
    let back = try #require(RaceStartInput(raceStartAt: "2026-08-16T03:00:00.000Z", timeZoneIdentifier: "America/Los_Angeles"))
    #expect(back == la)
}

@Test func raceStartRoundTrip() throws {
    for zone in ["America/Denver", "Asia/Kolkata", "Pacific/Auckland", "UTC"] {
        let input = RaceStartInput(year: 2026, month: 9, day: 12, hour: 5, minute: 45, timeZoneIdentifier: zone)
        let iso = try #require(input.raceStartAt)
        let parsed = try #require(RaceStartInput(raceStartAt: iso, timeZoneIdentifier: zone))
        #expect(parsed == input)
        #expect(parsed.raceStartAt == iso)
    }
}

@Test func raceStartDisplaysExistingValueInGivenZone() throws {
    let denver = try #require(RaceStartInput(raceStartAt: "2026-08-15T13:00:00.000Z", timeZoneIdentifier: "America/Denver"))
    #expect(denver == RaceStartInput(year: 2026, month: 8, day: 15, hour: 7, minute: 0, timeZoneIdentifier: "America/Denver"))
    // Without fractional seconds also parses.
    #expect(RaceStartInput(raceStartAt: "2026-08-15T13:00:00Z", timeZoneIdentifier: "UTC")?.hour == 13)
}

@Test func raceStartRejectsBadInput() {
    #expect(RaceStartInput(raceStartAt: "not-a-date", timeZoneIdentifier: "UTC") == nil)
    #expect(RaceStartInput(raceStartAt: "2026-08-15T13:00:00.000Z", timeZoneIdentifier: "Mars/Olympus") == nil)
    #expect(RaceStartInput(year: 2026, month: 2, day: 30, hour: 6, minute: 0, timeZoneIdentifier: "UTC").raceStartAt == nil)
    #expect(RaceStartInput(year: 2026, month: 8, day: 15, hour: 25, minute: 0, timeZoneIdentifier: "UTC").raceStartAt == nil)
    #expect(RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 0, timeZoneIdentifier: "Mars/Olympus").raceStartAt == nil)
}

@Test func raceStartRejectsZoneAbbreviations() {
    // Abbreviations are fixed offsets without DST; Android's runtime reports them for TimeZone.current.
    #expect(RaceStartInput(year: 2026, month: 8, day: 15, hour: 6, minute: 30, timeZoneIdentifier: "MST").raceStartAt == nil)
    #expect(RaceStartInput(raceStartAt: "2026-08-15T13:00:00.000Z", timeZoneIdentifier: "GMT0BST") == nil)
}

@Test func untouchedFormKeepsRepeatedHourAndSeconds() throws {
    // 2026-11-01 08:30Z is the second 01:30 in Denver (MST); fields alone would map back to 07:30Z.
    let second = try #require(RaceStartInput(raceStartAt: "2026-11-01T08:30:00.000Z", timeZoneIdentifier: "America/Denver"))
    #expect(second.raceStartAt == "2026-11-01T08:30:00.000Z")
    let seconds = try #require(RaceStartInput(raceStartAt: "2026-08-15T13:00:30.000Z", timeZoneIdentifier: "America/Denver"))
    #expect(seconds.raceStartAt == "2026-08-15T13:00:30.000Z")
    // Editing a field drops the pinned instant and converts the typed wall-clock time.
    var edited = second
    edited.minute = 45
    #expect(edited.raceStartAt == "2026-11-01T07:45:00.000Z")
}
