import Foundation
#if canImport(Android)
import Android
#endif

/// The viewer's device time zone as an IANA region.
///
/// On Android the Swift runtime does not resolve `TimeZone.current` to the device's IANA zone: it yields an
/// abbreviation such as `GMT`, `MST` or `PST` (fixed offsets, no DST), which would print wrong clocks and
/// convert race starts by the wrong offset. There the zone is read from the `persist.sys.timezone` system
/// property, which holds the IANA id. Elsewhere `TimeZone.current` is already correct.
public enum DeviceTimeZone {
    public static var current: TimeZone {
        #if os(Android)
        if let zone = resolve(androidSystemTimeZoneIdentifier()) {
            return zone
        }
        #endif
        return TimeZone.current
    }

    /// A zone for an IANA region id (`America/Denver`, `Etc/UTC`) or `UTC`/`GMT`. Nil for abbreviations
    /// such as `MST` or `PST`, and for unknown ids.
    public static func resolve(_ identifier: String?) -> TimeZone? {
        guard let identifier, !identifier.isEmpty else { return nil }
        guard identifier.contains("/") || identifier == "UTC" || identifier == "GMT" else { return nil }
        return TimeZone(identifier: identifier)
    }

    #if os(Android)
    private static func androidSystemTimeZoneIdentifier() -> String? {
        var buffer = [CChar](repeating: 0, count: 128)
        let length = __system_property_get("persist.sys.timezone", &buffer)
        guard length > 0 else { return nil }
        return String(cString: buffer)
    }
    #endif
}
