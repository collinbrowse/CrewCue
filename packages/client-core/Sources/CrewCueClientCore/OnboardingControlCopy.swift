import Foundation

/// Button, field and row labels for the onboarding chooser and the runner's setup steps, so
/// neither app writes its own. Plain wording, like the rest of `OnboardingCopy`.
extension OnboardingCopy {
    public enum Label: String, CaseIterable, Sendable {
        case chooserTitle
        case createAccount, signIn, displayName
        case chooseCourseFile, chooseAnotherFile
        case raceDate, raceTime, raceTimeZone, done, cancel
        case importHistory, skipHistory
        case finish, locked, elevation, coursePreview
        case continueStep, tryAgain
    }

    public static func label(_ label: Label) -> String {
        switch label {
        case .chooserTitle: "How are you using CrewCue?"
        case .createAccount: "Create account"
        case .signIn: "I already have an account"
        case .displayName: "Your name"
        case .chooseCourseFile: "Choose course file"
        case .chooseAnotherFile: "Choose another file"
        case .raceDate: "Date"
        case .raceTime: "Time"
        case .raceTimeZone: "Time zone"
        case .done: "Done"
        case .cancel: "Cancel"
        case .importHistory: "Import a file"
        case .skipHistory: "Skip"
        case .finish: "Finish"
        case .locked: "Locked"
        case .elevation: "Elevation"
        case .coursePreview: "Course preview"
        case .continueStep: "Continue"
        case .tryAgain: "Try again"
        }
    }

    /// Every label by its case name, for the `onboardingCopy` runtime op (`labels`).
    static var runtimeLabels: [String: String] {
        Dictionary(uniqueKeysWithValues: Label.allCases.map { ($0.rawValue, label($0)) })
    }
}
