import Foundation

/// The name onboarding suggests for "the name your crew sees", from the sign-in identity.
///
/// For an email sign-up Auth0 sets `name` to the email and `nickname` to the part before the @,
/// so neither is a name. Only a real name (from Google or Apple) is suggested; nil leaves the
/// field empty for the runner to fill in.
public enum SuggestedDisplayName {
    public static func from(name: String?, email: String?) -> String? {
        guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return nil
        }
        if name.contains("@") { return nil }
        if let email = email?.trimmingCharacters(in: .whitespacesAndNewlines),
           let at = email.firstIndex(of: "@"),
           name.caseInsensitiveCompare(String(email[..<at])) == .orderedSame {
            return nil
        }
        return name
    }
}
