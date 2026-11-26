import SwiftUI
import CrewCueClientCore

/// The top bar's slim course strip on Map and Pace: a thin bar and "12.4 of 31.0 mi". It reads
/// the runner's progress (their pings, via `RaceDayReadout`), the same on every crew phone.
struct CourseProgressStrip: View {
    let fraction: Double
    let label: String
    let spoken: String
    @Environment(\.crew) private var theme

    /// Nil when the race has no course length to measure against.
    init?(readout: RaceDayReadout) {
        guard let label = readout.courseStripLabel, let spoken = readout.courseStripSpoken else { return nil }
        self.fraction = readout.progressFraction
        self.label = label
        self.spoken = spoken
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            // One line while the text fits beside a usable bar; large text sizes stack it under.
            HStack(spacing: CrewSpace.stackSm) {
                CrewProgressBar(fraction: fraction, height: 4)
                    .frame(minWidth: 80)
                text.fixedSize()
            }
            VStack(alignment: .leading, spacing: 4) {
                CrewProgressBar(fraction: fraction, height: 4)
                text
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(spoken)
        .accessibilityIdentifier("crewcue.course-strip")
    }

    private var text: some View {
        Text(verbatim: label)
            .font(CrewFont.label.monospacedDigit())
            .foregroundStyle(theme.body)
            .fixedSize(horizontal: false, vertical: true)
    }
}
