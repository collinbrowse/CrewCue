import Foundation
import CrewCueClientCore

/// What the runner typed or picked during setup, kept on this phone so a relaunch or an offline
/// step resumes with it. Per user, inside the user's directory, so sign-out wipes it. The course
/// file sits beside it, written only when a file is picked.
struct RunnerSetupDraft: Codable, Equatable {
    // Fields added after the first release are optional, so a draft saved by an older build
    // still decodes.
    var displayName = ""
    /// The race's name as typed on the course step. The race is created with it; it can't be
    /// renamed after that.
    var raceName: String?
    /// The race the course belongs to.
    var roomId: String?
    var courseFileName: String?
    var coursePreview: CoursePreview?
    /// The runner pressed Continue on the previewed course; the course is saved with the start time.
    var courseConfirmed = false
    /// A file was picked that the race hasn't saved yet (`PUT /race-rooms/:roomId/course` with the
    /// start). Nil in older drafts, read as saved.
    var courseUnsaved: Bool?
    /// The start the race saved, as this phone last knew it: set by a save from here, or taken from
    /// the race list (a phone that never held the draft, or a draft from before this field). A
    /// Continue on a start time the runner went back to saves only when the start differs.
    var savedRaceStartAt: String?
    /// The fingerprint (`RunnerSetupSteps.courseFingerprint`) of the file this phone holds.
    var courseFingerprint: String?
    /// The fingerprint of the file the race saved from this phone, so the same file picked again
    /// after Back isn't uploaded twice.
    var savedCourseFingerprint: String?
    /// The course was saved again (`PUT /course`), which drops the estimate the history step
    /// attached: the history step runs again, a relaunch included.
    var historyRedo: Bool?
    /// The start's wall-clock fields, read in UTC (see `RunnerSetupModel.startInput`).
    var startWallClock: Date?
    var timeZoneIdentifier: String?
    var historyLine: String?

    /// Forgets the race's name, its course and everything after it, for another race.
    mutating func resetRace(_ roomId: String?) {
        self.roomId = roomId
        raceName = nil
        courseFileName = nil
        coursePreview = nil
        courseConfirmed = false
        courseUnsaved = nil
        savedRaceStartAt = nil
        courseFingerprint = nil
        savedCourseFingerprint = nil
        historyRedo = nil
        startWallClock = nil
        timeZoneIdentifier = nil
        historyLine = nil
    }
}

@MainActor
struct RunnerSetupDraftStore {
    let directory: URL

    static func forUser(_ userId: String) -> RunnerSetupDraftStore? {
        guard let directory = try? AppDirectories.userDirectory(userId: userId) else { return nil }
        return RunnerSetupDraftStore(directory: directory)
    }

    private var draftURL: URL { directory.appendingPathComponent("onboarding-setup.json") }
    private var courseURL: URL { directory.appendingPathComponent("onboarding-course.gpx") }

    func load() -> RunnerSetupDraft {
        guard let data = try? Data(contentsOf: draftURL),
              let draft = try? JSONDecoder().decode(RunnerSetupDraft.self, from: data) else {
            return RunnerSetupDraft()
        }
        return draft
    }

    func save(_ draft: RunnerSetupDraft) {
        guard let data = try? JSONEncoder().encode(draft) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: draftURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func loadCourse() -> String? {
        guard let data = try? Data(contentsOf: courseURL) else { return nil }
        let xml = String(decoding: data, as: UTF8.self)
        return xml.isEmpty ? nil : xml
    }

    func saveCourse(_ xml: String?) {
        guard let xml else {
            try? FileManager.default.removeItem(at: courseURL)
            return
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? Data(xml.utf8).write(to: courseURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Setup finished: nothing left to resume.
    func clear() {
        try? FileManager.default.removeItem(at: draftURL)
        try? FileManager.default.removeItem(at: courseURL)
    }
}
