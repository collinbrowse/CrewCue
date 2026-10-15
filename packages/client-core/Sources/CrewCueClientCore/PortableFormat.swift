/// Text helpers that stay off `String(format:)`, which traps in the Swift Android runtime.
enum PortableFormat: Sendable {
    private static let hexDigits: [Character] = Array("0123456789abcdef")

    static func zeroPadded(_ value: Int, width: Int) -> String {
        if value == Int.min {
            return String(value)
        }
        let negative = value < 0
        let digits = String(negative ? -value : value)
        let core = digits.count >= width ? digits : String(repeating: "0", count: width - digits.count) + digits
        return negative ? "-" + core : core
    }

    static func hex<Bytes: Sequence>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        var output = ""
        for byte in bytes {
            output.append(hexDigits[Int(byte >> 4)])
            output.append(hexDigits[Int(byte & 0x0F)])
        }
        return output
    }

    static func hex4(_ value: UInt32) -> String {
        let masked = value & 0xFFFF
        return String([
            hexDigits[Int((masked >> 12) & 0xF)],
            hexDigits[Int((masked >> 8) & 0xF)],
            hexDigits[Int((masked >> 4) & 0xF)],
            hexDigits[Int(masked & 0xF)]
        ])
    }

    static func oneDecimal(_ value: Double) -> String {
        guard value.isFinite else {
            if value.isNaN { return "nan" }
            return value > 0 ? "inf" : "-inf"
        }
        let negative = value < 0
        let magnitude = abs(value)
        let scaled = (magnitude * 10).rounded(.toNearestOrEven)
        guard scaled.isFinite, scaled <= Double(Int.max) else {
            return negative ? "-inf" : "inf"
        }
        let tenths = Int(scaled)
        let text = "\(tenths / 10).\(tenths % 10)"
        if negative, tenths != 0 {
            return "-" + text
        }
        return text
    }
}
