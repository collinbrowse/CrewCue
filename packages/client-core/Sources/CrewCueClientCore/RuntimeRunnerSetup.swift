import Foundation

/// Android's runner-setup ops (clients/behavior/onboarding-runner-setup.md). The conversion, the
/// daylight-saving check and the GPX parse happen here or on the server, never in the app.
///
/// - `raceStartInput`: the start-time step. Send the typed fields `year`, `month`, `day`, `hour`,
///   `minute` and `timeZone` (an IANA id; Android sends its device zone, which the Swift runtime
///   there cannot read), or `raceStartAt` + `timeZone` to read a saved start back into fields.
///   Answers `raceStartAt` (UTC, `Z`) or null, `problem` (`unknownZone`, `invalidDate`,
///   `daylightSavingGap`) or null, `message` (the shared copy, only for `daylightSavingGap`), and
///   the fields.
/// - `gpxPreview`: `roomId`, `fileName`, `gpxXml` → the server's parse (`POST
///   …/course/gpx-preview`) as `line`, `checkpoints`, `elevation`, `plannedPaceSecondsPerKm` and
///   `courseFileName`, the shape `loadRoom` answers. Saves nothing. A blank file answers
///   `status: empty` without a request.
extension RuntimeCall {
    static func raceStartInput(_ object: [String: Any]) -> Any {
        let zone = text(object, "timeZone") ?? DeviceTimeZone.current.identifier
        let input: RaceStartInput?
        if let saved = text(object, "raceStartAt"), object["year"] == nil {
            input = RaceStartInput(raceStartAt: saved, timeZoneIdentifier: zone)
        } else if let year = intValue(object["year"]), let month = intValue(object["month"]),
                  let day = intValue(object["day"]), let hour = intValue(object["hour"]),
                  let minute = intValue(object["minute"]) {
            input = RaceStartInput(year: year, month: month, day: day, hour: hour, minute: minute, timeZoneIdentifier: zone)
        } else {
            input = nil
        }
        guard let input else {
            let problem: RaceStartInput.Problem = DeviceTimeZone.resolve(zone) == nil ? .unknownZone : .invalidDate
            return ["raceStartAt": NSNull(), "problem": problemName(problem), "message": NSNull(), "timeZone": zone] as [String: Any]
        }
        let problem = input.problem
        return [
            "raceStartAt": input.raceStartAt ?? NSNull(),
            "problem": problem.map(problemName) ?? NSNull(),
            // Only the spring-forward gap has copy; the pickers can't produce the other problems.
            "message": problem == .daylightSavingGap ? OnboardingCopy.startTimeDstGap : NSNull(),
            "year": input.year,
            "month": input.month,
            "day": input.day,
            "hour": input.hour,
            "minute": input.minute,
            "timeZone": input.timeZoneIdentifier
        ] as [String: Any]
    }

    private static func problemName(_ problem: RaceStartInput.Problem) -> String {
        switch problem {
        case .unknownZone: "unknownZone"
        case .invalidDate: "invalidDate"
        case .daylightSavingGap: "daylightSavingGap"
        }
    }

    /// How long a preview may take before the app is told it is offline. The request is
    /// abandoned, never cancelled (`Deadline`).
    static let gpxPreviewDeadlineSeconds = 45.0

    static func gpxPreview(_ object: [String: Any]) async throws -> Any {
        let gpxXml = object["gpxXml"] as? String ?? ""
        guard !gpxXml.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return ["status": "empty"]
        }
        guard let roomId = text(object, "roomId") else {
            throw ClientHTTPError(status: 400, message: "roomId is required.")
        }
        let graph = try graph(object)
        let fileName = text(object, "fileName") ?? "route.gpx"
        let data = try await Deadline.run(seconds: gpxPreviewDeadlineSeconds) {
            try await RaceDayAPI.previewCourse(graph: graph, roomId: roomId, fileName: fileName, gpxXml: gpxXml)
        }
        var payload = CoursePayload.preview(from: data)
        payload["status"] = "previewed"
        return payload
    }
}
