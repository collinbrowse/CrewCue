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
