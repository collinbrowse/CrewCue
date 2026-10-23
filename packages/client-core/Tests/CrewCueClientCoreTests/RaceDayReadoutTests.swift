import Foundation
import Testing
@testable import CrewCueClientCore

private let mile = 1609.344

private let course = [
    AidStationCheckpoint(id: "start", title: "Start", distanceMetersFromStart: 0),
    AidStationCheckpoint(id: "ridge", title: "Ridge", distanceMetersFromStart: 10 * mile),
    AidStationCheckpoint(id: "finish", title: "Finish", distanceMetersFromStart: 20 * mile)
]

private let sheet = CrewScheduleSheet(
    roomId: "room",
    raceStartAt: "2026-08-15T12:00:00.000Z",
    stops: [
        ScheduleStop(id: "s0", checkpointId: "start", clockArrivalAt: "2026-08-15T12:00:00.000Z", elapsedSeconds: 0, plannedStoppageSeconds: 0),
        ScheduleStop(
            id: "s1",
            checkpointId: "ridge",
            clockArrivalAt: "2026-08-15T14:00:00.000Z",
            elapsedSeconds: 7200,
            plannedStoppageSeconds: 300,
            cutoffStatus: "ok",
            cutoffMarginSeconds: 3600
        ),
        ScheduleStop(id: "s2", checkpointId: "finish", clockArrivalAt: "2026-08-15T16:00:00.000Z", elapsedSeconds: 14400, plannedStoppageSeconds: 0)
    ]
)

@Test func readoutReportsProgressPaceAndElapsed() {
    let readout = RaceDayReadouts.make(
        sheet: sheet,
        checkpoints: course,
        progressMeters: 5 * mile,
        now: date("2026-08-15T13:00:00.000Z"),
        lastPingAt: date("2026-08-15T12:58:00.000Z")
    )
    #expect(readout.status == .onTrack)
    #expect(readout.statusLabel == "ON TRACK")
    #expect(readout.progressLabel == "MILE 5 / 20")
    #expect(readout.percentLabel == "25%")
    #expect(readout.totalMilesLabel == "20.0")
    #expect(readout.elapsedLabel == "1:00:00")
    // Progress is as of the 12:58 ping: 5 miles in 58 minutes.
    #expect(readout.averagePaceLabel == "11'36\" / MI")
    #expect(readout.lastPingLabel == "2 MIN AGO")
}

@Test func readoutFlagsBehindWhenNextArrivalHasPassed() {
    let readout = RaceDayReadouts.make(
        sheet: sheet,
        checkpoints: course,
        progressMeters: 8 * mile,
        now: date("2026-08-15T14:30:00.000Z"),
        lastPingAt: nil
    )
    #expect(readout.status == .behind)
    #expect(readout.statusLabel == "BEHIND 30M")
    #expect(readout.lastPingLabel == nil)
}

@Test func readoutFlagsAheadWhenStopPassedEarly() {
    let readout = RaceDayReadouts.make(
        sheet: sheet,
        checkpoints: course,
        progressMeters: 11 * mile,
        now: date("2026-08-15T13:30:00.000Z"),
        lastPingAt: nil
    )
    #expect(readout.status == .ahead)
    #expect(readout.statusLabel == "AHEAD 30M")
}

@Test func readoutWithoutScheduleIsUnknown() {
    let readout = RaceDayReadouts.make(sheet: nil, checkpoints: [], progressMeters: 0, now: Date(), lastPingAt: nil)
    #expect(readout.status == .unknown)
    #expect(readout.statusLabel == "")
    #expect(readout.progressLabel == "—")
    #expect(readout.averagePaceLabel == "—")
}

@Test func timelineMarksDoneCurrentAndProjected() {
    let rows = RaceDayReadouts.timeline(sheet: sheet, checkpoints: course, progressMeters: 5 * mile)
    #expect(rows.map(\.state) == [.done, .current, .projected])
    #expect(rows[0].kicker == "CP1 — START")
    #expect(rows[1].kicker == "CP2 — 10.0 MI")
    #expect(rows[1].title == "RIDGE")
    #expect(rows[1].distanceToLabel == "5.0 MI")
    #expect(rows[1].cutoffAt == "2026-08-15T15:00:00.000Z")
    #expect(rows[2].isFinish)
}

@Test func timelineBeforeStartHasFirstStopCurrent() {
    let rows = RaceDayReadouts.timeline(sheet: sheet, checkpoints: course, progressMeters: 0)
    #expect(rows.map(\.state) == [.current, .projected, .projected])
}

@Test func elevationGainSumsClimbsOnly() {
    let profile = ElevationProfile(samples: [(0, 100), (1000, 150), (2000, 120), (3000, 200), (4000, 50)])
    #expect(profile.gainMeters(from: 0, to: 3000) == 130)
    #expect(profile.gainMeters(from: 3500, to: 3600) == nil)
    #expect(RaceDayReadouts.elevationLabel(meters: 256) == "+840 FT")
}

@Test func aidPageCarriesElevationAndArrivalInstant() {
    let projection = AidStationSheet.project(
        sheet: sheet,
        checkpoints: course,
        progressMeters: 5 * mile,
        now: date("2026-08-15T13:00:00.000Z"),
        paceSecondsPerKm: nil,
        selectedIndex: 0,
        follow: true,
        elevation: ElevationProfile(samples: [(5 * mile, 1000), (10 * mile, 1256)])
    )
    let next = projection.pages[projection.selectedIndex]
    #expect(next.checkpointId == "ridge")
    #expect(next.elevationLabel == "+840 FT")
    #expect(next.arrivalAt == "2026-08-15T14:00:00.000Z")
}

private func date(_ iso: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
}
