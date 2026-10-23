import CrewCueClientCore

struct OSLogLogger: Logger {
    func log(_ message: String) {
        OSLogSink.write(message)
    }
}
