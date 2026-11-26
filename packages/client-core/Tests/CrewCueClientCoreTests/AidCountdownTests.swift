import Foundation
import Testing
@testable import CrewCueClientCore

private func at(_ iso: String) -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 0)
}

private let raceSheet = CrewScheduleSheet(
    roomId: "room",
    raceStartAt: "2026-08-15T13:00:00.000Z",
    stops: [
        ScheduleStop(id: "s0", checkpointId: "start", clockArrivalAt: "2026-08-15T13:00:00.000Z", elapsedSeconds: 0, plannedStoppageSeconds: 0),
        ScheduleStop(id: "s1", checkpointId: "aid-1", clockArrivalAt: "2026-08-15T14:00:00.000Z", elapsedSeconds: 3600, plannedStoppageSeconds: 120),
        ScheduleStop(id: "s2", checkpointId: "aid-2", clockArrivalAt: "2026-08-15T15:05:00.000Z", elapsedSeconds: 7500, plannedStoppageSeconds: 300),
        ScheduleStop(id: "s3", checkpointId: "finish", clockArrivalAt: "2026-08-15T16:35:00.000Z", elapsedSeconds: 12_900, plannedStoppageSeconds: 0)
    ]
)

private let raceCourse = [
    AidStationCheckpoint(id: "start", title: "Start", latitude: 40.00, longitude: -105, distanceMetersFromStart: 0),
    AidStationCheckpoint(id: "aid-1", title: "Aid 1", latitude: 40.09, longitude: -105, distanceMetersFromStart: 10_000),
    AidStationCheckpoint(id: "aid-2", title: "Aid 2", latitude: 40.18, longitude: -105, distanceMetersFromStart: 20_000),
    AidStationCheckpoint(id: "finish", title: "Finish", latitude: 40.27, longitude: -105, distanceMetersFromStart: 30_000)
]

/// The runner is well behind: every plan time from Aid 1 on has gone by. Only the next aid says
/// DUE NOW; the ones after it count down from now plus the planned legs.
@Test func onlyTheNextOverdueAidIsDueNow() {
    let now = at("2026-08-15T17:00:00.000Z")
    let projection = AidStationSheet.project(
        sheet: raceSheet, checkpoints: raceCourse, progressMeters: 5_000, now: now,
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true, timeZone: TimeZone(identifier: "UTC")!
    )
    #expect(projection.liveNextIndex == 1)
    let next = projection.pages[1]
    #expect(next.kicker == "NEXT")
    #expect(next.countdownLabel == "DUE NOW")
    let later = projection.pages[2]
    #expect(later.kicker == "AHEAD")
    // Aid 1 → Aid 2 is planned at 1H 5M.
    #expect(later.countdownLabel == "IN 1H 5M")
    #expect(later.arrivalAt == "2026-08-15T18:05:00.000Z")
    #expect(later.arrivalCaption == "EST. ARRIVAL")
    #expect(projection.pages[3].countdownLabel == "IN 2H 35M")
    #expect(projection.pages.filter { $0.countdownLabel == "DUE NOW" }.count == 1)
}

/// The next aid has a live ETA ahead: later overdue aids count from that ETA.
@Test func laterAidsCountFromTheNextAidsLiveEta() {
    let now = at("2026-08-15T17:00:00.000Z")
    let projection = AidStationSheet.project(
        sheet: raceSheet, checkpoints: raceCourse, progressMeters: 5_000, now: now,
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true, timeZone: TimeZone(identifier: "UTC")!,
        liveArrivals: ["aid-1": at("2026-08-15T17:20:00.000Z")]
    )
    #expect(projection.pages[1].countdownLabel == "IN 20M")
    #expect(projection.pages[2].countdownLabel == "IN 1H 25M")
}

/// No leg time to project with (a pin the schedule has no row for): "AFTER" the next aid.
@Test func laterAidWithNoBasisReadsAfterTheNextAid() {
    let now = at("2026-08-15T17:00:00.000Z")
    var sheet = raceSheet
    sheet.stops[1].elapsedSeconds = .nan
    sheet.stops[1].clockArrivalAt = "2026-08-15T14:00:00.000Z"
    sheet.stops[2].elapsedSeconds = .nan
    sheet.stops[2].clockArrivalAt = "2026-08-15T13:30:00.000Z"
    let projection = AidStationSheet.project(
        sheet: sheet, checkpoints: raceCourse, progressMeters: 5_000, now: now,
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true, timeZone: TimeZone(identifier: "UTC")!
    )
    #expect(projection.pages[1].countdownLabel == "DUE NOW")
    #expect(projection.pages[2].countdownLabel == "AFTER AID 1")
    #expect(projection.pages[2].kicker == "AHEAD")
    #expect(projection.pages[2].remainLabel == "—")
}

@Test func onTimeAidsKeepTheirOwnCountdown() {
    let now = at("2026-08-15T13:30:00.000Z")
    let projection = AidStationSheet.project(
        sheet: raceSheet, checkpoints: raceCourse, progressMeters: 5_000, now: now,
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true, timeZone: TimeZone(identifier: "UTC")!
    )
    #expect(projection.pages[1].countdownLabel == "IN 30M")
    #expect(projection.pages[2].countdownLabel == "IN 1H 35M")
    #expect(projection.pages[0].countdownLabel == "")
    #expect(projection.pages[1].raceTimeCaption == "RACE 1:00:00")
    let clock = ScheduleFormat.formatScheduleClock("2026-08-15T14:00:00.000Z", timeZone: TimeZone(identifier: "UTC")!)
    #expect(projection.pages[1].plannedArrivalSpoken == "Planned arrival \(clock), 1 hour into the race")
}

/// A pin dropped along the course is a page like any other: away from it, Back to next aid shows.
@Test func backToNextShowsForADroppedPin() {
    var course = raceCourse
    course.insert(AidStationCheckpoint(id: "cp-1", title: "Checkpoint", latitude: 40.135, longitude: -105, distanceMetersFromStart: 15_000), at: 2)
    let following = AidStationSheet.project(
        sheet: nil, checkpoints: course, progressMeters: 12_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true
    )
    #expect(following.liveNextIndex == 2)
    #expect(following.pages[2].kicker == "NEXT")
    #expect(!following.showsBackToNext)
    let away = AidStationSheet.project(
        sheet: nil, checkpoints: course, progressMeters: 12_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 4, follow: false
    )
    #expect(away.showsBackToNext)
    // The runner is past the pin: viewing it offers the way back to the next aid.
    let past = AidStationSheet.project(
        sheet: nil, checkpoints: course, progressMeters: 16_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 2, follow: false
    )
    #expect(past.pages[2].passed)
    #expect(past.liveNextIndex == 3)
    #expect(past.showsBackToNext)
}

/// A pin the course gives no distance yet still takes its place between its neighbours.
@Test func droppedPinWithoutADistanceCanBeTheNextAid() {
    var course = raceCourse
    course.insert(AidStationCheckpoint(id: "cp-1", title: "Checkpoint", latitude: 40.135, longitude: -105), at: 2)
    let projection = AidStationSheet.project(
        sheet: nil, checkpoints: course, progressMeters: 12_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true
    )
    #expect(projection.liveNextIndex == 2)
    #expect(projection.pages[2].distanceLabel != "—")
    let past = AidStationSheet.project(
        sheet: nil, checkpoints: course, progressMeters: 16_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 2, follow: false
    )
    #expect(past.pages[2].passed)
    #expect(past.showsBackToNext)
}

@Test func pinsFarOffTheRouteAreRejected() {
    let route = [
        CourseRoutePoint(latitude: 39.15, longitude: -120.25),
        CourseRoutePoint(latitude: 39.60, longitude: -120.25)
    ]
    // On the line, and 100 m east of it: both fine.
    #expect(CheckpointPlacement.rejection(latitude: 39.30, longitude: -120.25, route: route) == nil)
    let hundredEast = -120.25 + 100 / (111_320 * cos(39.3 * .pi / 180))
    #expect(CheckpointPlacement.rejection(latitude: 39.30, longitude: hundredEast, route: route) == nil)
    // 300 m east, and 500 m past the end of the line: too far.
    let threeHundredEast = -120.25 + 300 / (111_320 * cos(39.3 * .pi / 180))
    #expect(CheckpointPlacement.rejection(latitude: 39.30, longitude: threeHundredEast, route: route) == CheckpointPlacement.tooFarMessage)
    #expect(CheckpointPlacement.rejection(latitude: 39.6045, longitude: -120.25, route: route) == CheckpointPlacement.tooFarMessage)
    let meters = CheckpointPlacement.offCourseMeters(latitude: 39.30, longitude: threeHundredEast, route: route) ?? 0
    #expect(abs(meters - 300) < 2)
    // No line to check against: the server decides.
    #expect(CheckpointPlacement.rejection(latitude: 0, longitude: 0, route: []) == nil)
    #expect(CheckpointPlacement.maxOffCourseMeters == 155)
}

/// The server's baseline track has no elevation, so the climb comes from the route line; a GPX
/// with no `<ele>` has no profile at all (no climb shown, not "+0 FT").
@Test func climbComesFromTheRouteWhenTheBaselineHasNoElevation() {
    let baseline = [
        RaceCourseBaselinePoint(distanceMetersFromStart: 0, referenceElapsedSeconds: 0),
        RaceCourseBaselinePoint(distanceMetersFromStart: 30_000, referenceElapsedSeconds: 12_000)
    ]
    let route = [
        CourseRoutePoint(latitude: 40.00, longitude: -105, elevationMeters: 400),
        CourseRoutePoint(latitude: 40.09, longitude: -105, elevationMeters: 586.9),
        CourseRoutePoint(latitude: 40.18, longitude: -105, elevationMeters: 717.8),
        CourseRoutePoint(latitude: 40.27, longitude: -105, elevationMeters: 600)
    ]
    let profile = ElevationProfile.course(baseline: baseline, route: route)
    #expect(profile != nil)
    let projection = AidStationSheet.project(
        sheet: nil, checkpoints: raceCourse, progressMeters: 2_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true, elevation: profile
    )
    let aid1 = projection.pages[1]
    #expect(aid1.elevationLabel != nil)
    #expect(aid1.elevationLabel != "+0 FT")
    #expect(projection.pages[2].elevationLabel != nil)

    let flatFile = route.map { CourseRoutePoint(latitude: $0.latitude, longitude: $0.longitude) }
    #expect(ElevationProfile.course(baseline: baseline, route: flatFile) == nil)
    let blank = AidStationSheet.project(
        sheet: nil, checkpoints: raceCourse, progressMeters: 2_000, now: at("2026-08-15T14:00:00.000Z"),
        paceSecondsPerKm: nil, selectedIndex: 0, follow: true,
        elevation: ElevationProfile.course(baseline: baseline, route: flatFile)
    )
    #expect(blank.pages.allSatisfy { $0.elevationLabel == nil })
}

@Test func courseStripReadsMilesOfTheCourse() {
    let readout = RaceDayReadouts.make(
        sheet: nil, checkpoints: raceCourse,
        runner: RunnerProgress(ping: RunnerPing(pingId: "p", latitude: 40.1, longitude: -105, recordedAt: at("2026-08-15T14:00:00.000Z"), progressMeters: 20_000)),
        now: at("2026-08-15T14:00:00.000Z")
    )
    #expect(readout.courseStripLabel == "12.4 of 18.6 mi")
    #expect(readout.courseStripSpoken == "Course progress, 12.4 of 18.6 miles")
    let none = RaceDayReadouts.make(sheet: nil, checkpoints: [], runner: .none, now: Date())
    #expect(none.courseStripLabel == nil)
}

@Test func raceTimeCopyIsSpokenInWords() {
    #expect(RaceTimeCopy.caption(elapsedSeconds: 4200) == "RACE 1:10:00")
    #expect(RaceTimeCopy.spoken(elapsedSeconds: 4200) == "1 hour 10 minutes into the race")
    #expect(RaceTimeCopy.spoken(elapsedSeconds: 2700) == "45 minutes into the race")
    #expect(RaceTimeCopy.spoken(elapsedSeconds: 0) == "At the start")
    #expect(RaceTimeCopy.spokenArrival(clock: "2:10 PM", elapsedSeconds: 7200) == "Planned arrival 2:10 PM, 2 hours into the race")
}
