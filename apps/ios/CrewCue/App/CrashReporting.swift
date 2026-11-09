import Foundation
import Sentry

/// Sentry crash and error reporting (ADR 0010). Starts only in a Release build whose
/// `CrewCueSentryDSN` (Info.plist ← `CREWCUE_SENTRY_DSN`, set by release.yml) is non-empty.
/// Debug builds never start it. Nothing that identifies the user or their position is sent.
enum CrashReporting {
    static func start(bundle: Bundle = .main) {
        #if DEBUG
        return
        #else
        guard let dsn = dsn(bundle: bundle) else { return }
        SentrySDK.start { options in
            options.dsn = dsn
            options.sendDefaultPii = false
            options.tracesSampleRate = nil
            options.enableAutoPerformanceTracing = false
            options.attachScreenshot = false
            options.attachViewHierarchy = false
            options.beforeSend = { event in scrub(event) }
            options.beforeBreadcrumb = { crumb in scrub(crumb) }
        }
        #endif
    }

    static func dsn(bundle: Bundle) -> String? {
        let raw = (bundle.object(forInfoDictionaryKey: "CrewCueSentryDSN") as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return raw.hasPrefix("https://") ? raw : nil
    }

    private static func scrub(_ event: Event) -> Event {
        event.user = nil
        if let message = event.message?.formatted {
            event.message = SentryMessage(formatted: scrubText(message) ?? "")
        }
        for exception in event.exceptions ?? [] {
            exception.value = scrubText(exception.value)
        }
        event.breadcrumbs = event.breadcrumbs?.map { scrub($0) }
        event.extra = event.extra.map { scrubDictionary($0) }
        return event
    }

    private static func scrub(_ crumb: Breadcrumb) -> Breadcrumb {
        if let message = crumb.message { crumb.message = scrubText(message) }
        if let data = crumb.data { crumb.data = scrubDictionary(data) }
        return crumb
    }

    private static let sensitiveKey = try! NSRegularExpression(
        pattern: "^(?:.*(?:token|secret|password|authorization|cookie|email|session)|lat|lng|lon|latitude|longitude|coords?|coordinates?|location|position|accuracy|altitude)$",
        options: [.caseInsensitive]
    )

    private static func scrubDictionary(_ data: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for (key, value) in data {
            let range = NSRange(key.startIndex..., in: key)
            if sensitiveKey.firstMatch(in: key, range: range) != nil {
                out[key] = "[Filtered]"
            } else if key == "url", let url = value as? String {
                out[key] = url.split(separator: "?", maxSplits: 1).first.map(String.init) ?? url
            } else if let text = value as? String {
                out[key] = scrubText(text)
            } else if let nested = value as? [String: Any] {
                out[key] = scrubDictionary(nested)
            } else {
                out[key] = value
            }
        }
        return out
    }

    private static let textPatterns: [(NSRegularExpression, String)] = [
        ("Bearer\\s+[A-Za-z0-9._~+/=-]+", "Bearer [Filtered]"),
        ("eyJ[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]{5,}\\.[A-Za-z0-9_-]*", "[Filtered]"),
        ("[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}", "[Filtered]"),
        ("-?\\d{1,3}\\.\\d{3,}\\s*,\\s*-?\\d{1,3}\\.\\d{3,}", "[Filtered]"),
        ("(/[^\\s?\"']*)\\?[^\\s\"']*", "$1"),
    ].map { (try! NSRegularExpression(pattern: $0.0, options: [.caseInsensitive]), $0.1) }

    static func scrubText(_ text: String?) -> String? {
        guard var out = text else { return nil }
        for (regex, template) in textPatterns {
            out = regex.stringByReplacingMatches(
                in: out, range: NSRange(out.startIndex..., in: out), withTemplate: template
            )
        }
        return out
    }
}
