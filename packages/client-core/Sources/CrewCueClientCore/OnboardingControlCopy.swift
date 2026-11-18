import Foundation

/// The control labels Android's onboarding screens read by key (the `labels` map of the
/// `onboardingCopy` op). One set of strings: every key reads the `OnboardingCopy` property iOS
/// shows, so neither app writes its own.
extension OnboardingCopy {
    // MARK: Android's start-time pickers

    /// Android picks the start's date and time in two fields, each opening its own picker.
    public static let raceDateLabel = "Date"
    public static let raceTimeLabel = "Time"
    public static let pickerDone = "Done"
    public static let pickerCancel = "Cancel"

    public enum Label: String, CaseIterable, Sendable {
        case chooserTitle, chooserSignIn
        case createAccount, signIn, displayName
        case chooseCourseFile, chooseAnotherFile
        case raceDate, raceTime, raceTimeZone, done, cancel
        case importHistory, skipHistory
        case finish, locked, elevation, coursePreview
        case continueStep, tryAgain
    }

    public static func label(_ label: Label) -> String {
        switch label {
        case .chooserTitle: chooserTitle
        case .chooserSignIn: chooserSignIn
        case .createAccount: createAccount
        case .signIn: signIn
        case .displayName: displayName
        case .chooseCourseFile: chooseCourseFile
        case .chooseAnotherFile: chooseAnotherCourseFile
        case .raceDate: raceDateLabel
        case .raceTime: raceTimeLabel
        case .raceTimeZone: timeZoneLabel
        case .done: pickerDone
        case .cancel: pickerCancel
        case .importHistory: importPastRun
        case .skipHistory: skipHistory
        case .finish: finishLabel
        case .locked: lockedAidRow
        case .elevation: elevationProfileLabel
        case .coursePreview: coursePreviewLabel
        case .continueStep: continueLabel
        case .tryAgain: tryAgain
        }
    }

    /// Every label by its case name, for the `onboardingCopy` runtime op (`labels`).
    static var runtimeLabels: [String: String] {
        Dictionary(uniqueKeysWithValues: Label.allCases.map { ($0.rawValue, label($0)) })
    }
}
