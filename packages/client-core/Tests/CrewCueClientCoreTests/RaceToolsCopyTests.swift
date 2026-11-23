import Testing
@testable import CrewCueClientCore

@Test func stopSummaryCollapsesMatchingAidStops() {
    let summary = RaceToolsCopy.stopSummary([
        ("Start", 120), ("Aid 1", 120), ("Aid 2", 120), ("Aid 3", 120), ("Finish", 120)
    ])
    #expect(summary.rows.isEmpty)
    #expect(summary.summary == "2 min planned at each of the 3 aid stations. Use Edit planned stops on Pace to change it.")
}

@Test func stopSummaryListsDifferentAidStopsAndSkipsStartAndFinish() {
    let summary = RaceToolsCopy.stopSummary([
        ("Start", 120), ("Aid 1", 120), ("Aid 2", 600), ("Finish", 120)
    ])
    #expect(summary.rows == [
        CourseStopRow(title: "Aid 1", duration: "2 min"),
        CourseStopRow(title: "Aid 2", duration: "10 min")
    ])
}

@Test func stopSummaryWithNoPlannedStops() {
    let summary = RaceToolsCopy.stopSummary([("Start", nil), ("Aid 1", 0), ("Finish", nil)])
    #expect(summary.rows.isEmpty)
    #expect(summary.summary.hasPrefix("No aid station stops planned."))
}

@Test func cutoffLinesSayHowFarAhead() {
    #expect(RaceToolsCopy.cutoffLine(title: "Aid 2", status: "ok", marginSeconds: 5000) == "Aid 2: 1 h 23 min ahead of the cutoff")
    #expect(RaceToolsCopy.cutoffLine(title: "Aid 2", status: "warn", marginSeconds: 600) == "Aid 2: only 10 min ahead of the cutoff")
    #expect(RaceToolsCopy.cutoffLine(title: "Aid 2", status: "breach", marginSeconds: -300) == "Aid 2: due 5 min after the cutoff")
}

@Test func outboxLabelsAreReadable() {
    #expect(RaceToolsCopy.outboxLabel(type: "check-in") == "Check-in")
    #expect(RaceToolsCopy.outboxLabel(type: "gpx") == "Course file")
    #expect(RaceToolsCopy.outboxLabel(type: "some-new-op") == "Some New Op")
}
