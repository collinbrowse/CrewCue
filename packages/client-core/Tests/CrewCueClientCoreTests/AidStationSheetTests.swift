import Foundation
import Testing
@testable import CrewCueClientCore

@Test func aidSheetProjectsTwoStationsFromSchedule() {
    let now = date("2026-08-15T14:00:00.000Z")
    let denver = TimeZone(identifier: "America/Denver")!
    let sheet = CrewScheduleSheet(
        roomId: "room",
        raceStartAt: "2026-08-15T13:00:00.000Z",
        stops: [
            ScheduleStop(
                id: "s1",
                checkpointId: "aid-1",
                clockArrivalAt: "2026-08-15T14:10:00.000Z",
                elapsedSeconds: 4200,
                plannedStoppageSeconds: 300
            ),
            ScheduleStop(
                id: "s2",
                checkpointId: "aid-2",
                clockArrivalAt: "2026-08-15T16:00:00.000Z",
                elapsedSeconds: 10800,
                plannedStoppageSeconds: 600
            )
        ]
    )
    let checkpoints = [
        AidStationCheckpoint(id: "aid-1", title: "Aid 1", latitude: 40, longitude: -105, distanceMetersFromStart: 0),
        AidStationCheckpoint(id: "aid-2", title: "Aid 2", latitude: 40.1, longitude: -105.1, distanceMetersFromStart: 16093.44)
    ]
    let parked = AidStationSheet.project(
        sheet: sheet,
        checkpoints: checkpoints,
        progressMeters: 0,
        now: now,
        paceSecondsPerKm: nil,
        selectedIndex: 0,
        follow: true,
        timeZone: denver
    )
    #expect(parked.phase == .preStart)
    #expect(parked.selectedIndex == 0)
    #expect(parked.pages.count == 2)
    #expect(parked.pages[0].kicker == "START")
    let clock = ScheduleFormat.formatScheduleClock("2026-08-15T14:10:00.000Z", timeZone: denver)
    #expect(parked.pages[0].clockLabel == clock)
    #expect(!parked.pages[0].clockLabel.contains("UTC"))
    #expect(parked.pages[0].remainLabel == "10M")
    #expect(parked.pages[0].scheduleLine == "Aid 1  1:10:00  \(clock)")
    #expect(parked.pages[0].stoppageLabel == "5m")
    #expect(parked.pages[1].kicker == "NEXT")
    #expect(parked.pages[1].distanceLabel == "10.0 mi")

    let moving = AidStationSheet.project(
        sheet: sheet,
        checkpoints: checkpoints,
        progressMeters: 1000,
        now: now,
        paceSecondsPerKm: nil,
        selectedIndex: 0,
        follow: true
    )
    #expect(moving.phase == .race)
    #expect(moving.liveNextIndex == 1)
    #expect(moving.selectedIndex == 1)
    #expect(moving.pages[1].kicker == "NEXT")
}

@Test func aidSheetPaceEtaClockUsesViewerZone() {
    let now = date("2026-08-15T14:00:00.000Z")
    let checkpoints = [
        AidStationCheckpoint(id: "aid-1", title: "Aid 1", latitude: 40.0, longitude: -105.0, distanceMetersFromStart: 10000)
    ]
    func clock(_ zone: String) -> String {
        AidStationSheet.project(
            sheet: nil,
            checkpoints: checkpoints,
            progressMeters: 0,
            now: now,
            paceSecondsPerKm: 360,
            selectedIndex: 0,
            follow: true,
            timeZone: TimeZone(identifier: zone)!
        ).pages[0].clockLabel
    }
    // 10 km at 6:00/km from 14:00Z lands at 15:00Z.
    let utc = TimeZone(identifier: "UTC")!
    let denver = TimeZone(identifier: "America/Denver")!
    #expect(clock("UTC") == ScheduleFormat.formatScheduleClock("2026-08-15T15:00:00.000Z", timeZone: utc))
    #expect(clock("America/Denver") == ScheduleFormat.formatScheduleClock("2026-08-15T15:00:00.000Z", timeZone: denver))
    #expect(clock("UTC") != clock("America/Denver"))
}

private func date(_ iso: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
}

/// A plan time that has gone by is not "done": only the runner's pings pass an aid. A passed aid
/// shows when the runner's track reached and left it; an aid still ahead shows the live ETA.
@Test func aidSheetPassesAidsFromPingsAndShowsTheRealVisit() {
    let now = date("2026-08-15T16:30:00.000Z")
    let utc = TimeZone(identifier: "UTC")!
    let sheet = CrewScheduleSheet(
        roomId: "room",
        raceStartAt: "2026-08-15T13:00:00.000Z",
        stops: [
            ScheduleStop(id: "s0", checkpointId: "start", clockArrivalAt: "2026-08-15T13:00:00.000Z", elapsedSeconds: 0, plannedStoppageSeconds: 0),
            ScheduleStop(id: "s1", checkpointId: "aid-1", clockArrivalAt: "2026-08-15T14:00:00.000Z", elapsedSeconds: 3600, plannedStoppageSeconds: 120),
            ScheduleStop(id: "s2", checkpointId: "aid-2", clockArrivalAt: "2026-08-15T15:00:00.000Z", elapsedSeconds: 7200, plannedStoppageSeconds: 300),
            ScheduleStop(id: "s3", checkpointId: "finish", clockArrivalAt: "2026-08-15T17:00:00.000Z", elapsedSeconds: 14400, plannedStoppageSeconds: 0)
        ]
    )
    let checkpoints = [
        AidStationCheckpoint(id: "start", title: "Start", latitude: 40.00, longitude: -105, distanceMetersFromStart: 0),
        AidStationCheckpoint(id: "aid-1", title: "Aid 1", latitude: 40.09, longitude: -105, distanceMetersFromStart: 10_000),
        AidStationCheckpoint(id: "aid-2", title: "Aid 2", latitude: 40.18, longitude: -105, distanceMetersFromStart: 20_000),
        AidStationCheckpoint(id: "finish", title: "Finish", latitude: 40.27, longitude: -105, distanceMetersFromStart: 30_000)
    ]
    let track = [
        RunnerTrackPoint(recordedAt: date("2026-08-15T14:20:00.000Z"), latitude: 40.085, longitude: -105),
        RunnerTrackPoint(recordedAt: date("2026-08-15T14:25:00.000Z"), latitude: 40.0901, longitude: -105),
        RunnerTrackPoint(recordedAt: date("2026-08-15T14:31:00.000Z"), latitude: 40.0899, longitude: -105),
        RunnerTrackPoint(recordedAt: date("2026-08-15T14:40:00.000Z"), latitude: 40.10, longitude: -105)
    ]
    let projection = AidStationSheet.project(
        sheet: sheet,
        checkpoints: checkpoints,
        progressMeters: 12_000,
        now: now,
        paceSecondsPerKm: nil,
        selectedIndex: 0,
        follow: true,
        timeZone: utc,
        liveArrivals: ["aid-2": date("2026-08-15T17:05:00.000Z")],
        track: track
    )
    let aid1 = projection.pages[1]
    #expect(aid1.passed)
    #expect(aid1.kicker == "PASSED")
    #expect(aid1.arrivalCaption == "ARRIVED")
    #expect(aid1.actualArrivalAt == "2026-08-15T14:25:00.000Z")
    #expect(aid1.actualDepartureAt == "2026-08-15T14:31:00.000Z")
    #expect(aid1.actualStopLabel == "6 min")
    #expect(aid1.plannedStopLabel == "2 min")

    // Aid 2's plan time (15:00) has gone by, but the runner hasn't reached it.
    let aid2 = projection.pages[2]
    #expect(!aid2.passed)
    #expect(aid2.kicker == "NEXT")
    #expect(aid2.arrivalCaption == "LIVE ETA")
    #expect(aid2.arrivalAt == "2026-08-15T17:05:00.000Z")
    #expect(aid2.remainLabel == "35M")
    #expect(aid2.remainLabel != "DONE")
    #expect(projection.pages[3].kicker == "FINISH")

    // Without a live ETA, an aid whose plan time has gone by is due now, not done.
    let planOnly = AidStationSheet.project(
        sheet: sheet, checkpoints: checkpoints, progressMeters: 12_000, now: now,
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true, timeZone: utc
    )
    #expect(planOnly.pages[2].remainLabel == "DUE NOW")
    #expect(planOnly.pages[2].arrivalCaption == "EST. ARRIVAL")
    // Passed with no ping near the aid: no made-up time.
    #expect(planOnly.pages[1].passed)
    #expect(planOnly.pages[1].arrivalCaption == "PASSED")
    #expect(planOnly.pages[1].actualArrivalAt == nil)
}

@Test func aidVisitIsStillOpenWhileTheNewestPingIsAtTheAid() {
    let track = [
        RunnerTrackPoint(recordedAt: date("2026-08-15T14:00:00.000Z"), latitude: 39.99, longitude: -105),
        RunnerTrackPoint(recordedAt: date("2026-08-15T14:05:00.000Z"), latitude: 40.0, longitude: -105)
    ]
    let visit = AidVisit.find(track: track, latitude: 40, longitude: -105)
    #expect(visit?.arrivedAt == date("2026-08-15T14:05:00.000Z"))
    #expect(visit?.departedAt == nil)
    #expect(AidVisit.find(track: track, latitude: 41, longitude: -105) == nil)
}
