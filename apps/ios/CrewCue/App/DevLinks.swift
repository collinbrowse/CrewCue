/// Dev fixture links (`crewcue://dev/*`, `?state=`) and dev launch arguments are Debug-only.
/// A Release build opens product routes only, so no link can show fixture copy or seed a session.
enum DevLinks {
    #if DEBUG
    static let enabled = true
    #else
    static let enabled = false
    #endif
}
