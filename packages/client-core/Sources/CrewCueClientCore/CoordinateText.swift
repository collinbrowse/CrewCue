import Foundation

/// One "latitude, longitude" field, so a position copied from a maps app or a message pastes in
/// whole. Reads `40.0150, -105.2705`, `40.0150 -105.2705`, `(40.0150, -105.2705)`, and
/// hemisphere forms like `40.0150° N, 105.2705° W`.
public enum CoordinateText {
    public struct Coordinate: Equatable, Sendable {
        public var latitude: Double
        public var longitude: Double

        public init(latitude: Double, longitude: Double) {
            self.latitude = latitude
            self.longitude = longitude
        }
    }

    /// The field's text for a position: six decimals (about 10 cm), latitude first.
    public static func format(latitude: Double, longitude: Double) -> String {
        String(format: "%.6f, %.6f", latitude, longitude)
    }

    /// The position in `text`, or nil when it isn't two numbers in range.
    public static func parse(_ text: String) -> Coordinate? {
        let upper = text.uppercased()
        // Split into number tokens, each with the hemisphere letter that follows it (if any).
        var values: [(value: Double, hemisphere: Character?)] = []
        var current = ""
        func flush() {
            guard !current.isEmpty else { return }
            if let value = Double(current) { values.append((value, nil)) }
            current = ""
        }
        for character in upper {
            if character.isNumber || character == "." || ((character == "-" || character == "+") && current.isEmpty) {
                current.append(character)
            } else if "NSEW".contains(character) {
                flush()
                guard let last = values.last, last.hemisphere == nil else { return nil }
                values[values.count - 1].hemisphere = character
            } else if character == "," || character == " " || character == "°" || character == "(" || character == ")"
                        || character == "\t" || character == "\n" || character == ";" {
                flush()
            } else {
                return nil
            }
        }
        flush()
        guard values.count == 2 else { return nil }
        var first = values[0]
        var second = values[1]
        // "105.27 W, 40.01 N": longitude given first.
        if first.hemisphere == "E" || first.hemisphere == "W" || second.hemisphere == "N" || second.hemisphere == "S" {
            swap(&first, &second)
        }
        guard first.hemisphere == nil || first.hemisphere == "N" || first.hemisphere == "S",
              second.hemisphere == nil || second.hemisphere == "E" || second.hemisphere == "W" else {
            return nil
        }
        var latitude = first.value
        var longitude = second.value
        if first.hemisphere == "S" { latitude = -abs(latitude) }
        if second.hemisphere == "W" { longitude = -abs(longitude) }
        guard latitude.isFinite, longitude.isFinite, (-90...90).contains(latitude), (-180...180).contains(longitude) else {
            return nil
        }
        return Coordinate(latitude: latitude, longitude: longitude)
    }
}
