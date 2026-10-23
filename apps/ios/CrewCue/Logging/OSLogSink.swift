import os

enum OSLogSink {
    private static let log = Logger(subsystem: "com.crewcue.ios", category: "client")

    static func write(_ message: String) {
        log.log("\(message, privacy: .public)")
    }
}
