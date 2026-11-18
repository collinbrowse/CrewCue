import Foundation

/// Where a pending invite came from: a link (the https join page or `crewcue://join/<code>`), the
/// Play install referrer (installed from the join page's Google Play link), or a code typed in.
public enum InviteSource: String, CaseIterable, Codable, Sendable {
    case link
    case referrer
    case typed
}

/// A code read from an invite, and where it came from (`link` or `referrer`).
public struct InviteMatch: Equatable, Sendable {
    public var code: String
    public var source: InviteSource

    public init(code: String, source: InviteSource) {
        self.code = code
        self.source = source
    }
}

/// Crew invite links. The join page is self-hosted on GitHub Pages; it carries the race's 6-digit
/// join code and opens the app (Universal Links, Android App Links, or `crewcue://join/<code>`).
/// The site's `apple-app-site-association` and `assetlinks.json` are described in
/// `docs/runbooks/launch-owner-setup.md` (Invite links).
public enum InviteLink {
    /// The join page. The one place its host and path live, so moving the page is this line.
    public static let joinPage = "https://collinbrowse.github.io/crewcue/join/"
    /// The page's query item holding the code: `<joinPage>?code=123456`.
    public static let codeQueryItem = "code"
    /// `crewcue://join/<code>`, what the page's Open CrewCue button opens.
    public static let appScheme = "crewcue"
    public static let appHost = "join"
    /// The Play install referrer's key: the store link carries `&referrer=crewcue_join%3D<code>`.
    public static let referrerKey = "crewcue_join"
    public static let codeLength = 6

    /// The join page's host, lowercased: `collinbrowse.github.io`.
    public static var host: String { page.host }
    /// The join page's path, with its trailing slash: `/crewcue/join/`.
    public static var path: String { page.path }

    /// Exactly six ASCII digits (never other scripts' digits, signs or spaces).
    public static func isCode(_ value: String) -> Bool {
        value.utf8.count == codeLength && value.utf8.allSatisfy { (0x30...0x39).contains($0) }
    }

    /// `https://collinbrowse.github.io/crewcue/join/?code=123456`. Nil unless `code` is a code;
    /// surrounding whitespace is ignored.
    public static func build(code: String) -> URL? {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isCode(code), var components = URLComponents(string: joinPage) else { return nil }
        components.queryItems = [URLQueryItem(name: codeQueryItem, value: code)]
        return components.url
    }

    /// The code from the join page's https link, `crewcue://join/<code>`, or a Play
    /// install-referrer string (`crewcue_join=<code>`, raw or URL-encoded). Nil for anything else,
    /// a bare code included (that is `typed`, saved as it is).
    public static func parse(_ input: String) -> String? {
        match(input)?.code
    }

    /// `parse`, with where the code came from.
    public static func match(_ input: String) -> InviteMatch? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= maxInputLength else { return nil }
        guard hasScheme(trimmed) else {
            return referrerCode(trimmed).map { InviteMatch(code: $0, source: .referrer) }
        }
        guard let components = URLComponents(string: trimmed),
              components.user == nil, components.password == nil,
              let scheme = components.scheme?.lowercased() else { return nil }
        let code: String?
        switch scheme {
        case "https":
            code = authority(trimmed, is: "https://" + page.host) ? joinPageCode(components) : nil
        case appScheme:
            code = authority(trimmed, is: "\(appScheme)://\(appHost)") ? appLinkCode(components) : nil
        default:
            code = nil
        }
        return code.map { InviteMatch(code: $0, source: .link) }
    }

    /// `Join my crew for <race> on CrewCue: <link>  Or open CrewCue and enter code <code>.` A blank
    /// race name leaves `for <race>` out. Nil unless `code` is a code.
    public static func shareText(raceName: String?, code: String) -> String? {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let link = build(code: code) else { return nil }
        // One line: a name typed with line breaks or runs of spaces reads with single spaces.
        let name = (raceName ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let race = name.isEmpty ? "" : " for \(name)"
        return "Join my crew\(race) on CrewCue: \(link.absoluteString)  Or open CrewCue and enter code \(code)."
    }

    /// Links and referrers are short; anything longer is not one of ours.
    static let maxInputLength = 2048

    private static let page: (host: String, path: String, segments: [String]) = {
        let components = URLComponents(string: joinPage)
        let path = components?.percentEncodedPath ?? "/"
        return (components?.host?.lowercased() ?? "", path, path.split(separator: "/").map(String.init))
    }()

    /// The raw text starts with exactly this scheme and host (any case), then a port, path, query,
    /// fragment or the end. Catches what a parser would decode into the same host, such as `%2E`.
    private static func authority(_ raw: String, is expected: String) -> Bool {
        let lower = raw.lowercased()
        guard lower.hasPrefix(expected) else { return false }
        guard let next = lower.dropFirst(expected.count).first else { return true }
        return "/?#:".contains(next)
    }

    /// `https://<host><path>?code=<code>`: the default port, the page's path or one below it (no
    /// `.` or `..` segments), and one `code` value.
    private static func joinPageCode(_ components: URLComponents) -> String? {
        guard components.host?.lowercased() == page.host, components.port == nil || components.port == 443 else { return nil }
        let raw = components.percentEncodedPath
        guard raw.hasPrefix("/") else { return nil }
        let segments = raw.split(separator: "/", omittingEmptySubsequences: false).dropFirst().map(String.init)
        guard Array(segments.prefix(page.segments.count)) == page.segments else { return nil }
        let below = segments.dropFirst(page.segments.count).map { $0.removingPercentEncoding ?? $0 }
        guard !below.contains(where: { $0 == "." || $0 == ".." || $0.contains("/") }) else { return nil }
        return single((components.queryItems ?? []).filter { $0.name == codeQueryItem }.map { $0.value ?? "" })
    }

    /// `crewcue://join/<code>`, with an optional trailing slash.
    private static func appLinkCode(_ components: URLComponents) -> String? {
        guard components.host?.lowercased() == appHost, components.port == nil else { return nil }
        var path = components.percentEncodedPath
        if path.hasSuffix("/") { path.removeLast() }
        guard path.hasPrefix("/") else { return nil }
        let code = String(path.dropFirst())
        return isCode(code) ? code : nil
    }

    /// `crewcue_join=<code>` among `&`-separated pairs. A string with no raw pair is tried once
    /// more percent-decoded (`crewcue_join%3D123456`), as the store link carries it.
    private static func referrerCode(_ raw: String) -> String? {
        if let code = referrerValue(raw) { return code }
        guard raw.contains("%"), let decoded = raw.removingPercentEncoding, decoded != raw else { return nil }
        return referrerValue(decoded)
    }

    private static func referrerValue(_ query: String) -> String? {
        let values = query.split(separator: "&").compactMap { pair -> String? in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            guard parts.count == 2, parts[0] == referrerKey else { return nil }
            let value = String(parts[1])
            return value.removingPercentEncoding ?? value
        }
        return single(values)
    }

    /// The one code the values agree on; nil for none, a non-code, or two different values.
    private static func single(_ values: [String]) -> String? {
        guard let first = values.first, isCode(first), values.allSatisfy({ $0 == first }) else { return nil }
        return first
    }

    /// RFC 3986: `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":"`. A referrer never starts with one.
    private static func hasScheme(_ value: String) -> Bool {
        guard let colon = value.firstIndex(of: ":") else { return false }
        let scheme = Array(value[..<colon].utf8)
        guard let first = scheme.first, isASCIILetter(first) else { return false }
        return scheme.allSatisfy { isASCIILetter($0) || (0x30...0x39).contains($0) || $0 == 0x2B || $0 == 0x2D || $0 == 0x2E }
    }

    private static func isASCIILetter(_ byte: UInt8) -> Bool {
        (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte)
    }
}
