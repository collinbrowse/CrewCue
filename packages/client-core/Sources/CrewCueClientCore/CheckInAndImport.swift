import Foundation

public enum CheckInValidation: Equatable, Sendable {
    case ok(arrivalAt: String, departureAt: String)
    case invalid(message: String)
}

public enum CheckIn {
    public static func validate(arrivalAt: String, departureAt: String) -> CheckInValidation {
        let arrival = arrivalAt.trimmingCharacters(in: .whitespacesAndNewlines)
        let departure = departureAt.trimmingCharacters(in: .whitespacesAndNewlines)
        if arrival.isEmpty || departure.isEmpty {
            return .invalid(message: "Arrival and departure are required.")
        }
        guard let arrivalDate = ScheduleFormat.parseISO8601(arrival), let departureDate = ScheduleFormat.parseISO8601(departure) else {
            return .invalid(message: "Couldn't validate check-in times.")
        }
        if departureDate <= arrivalDate {
            return .invalid(message: "Departure must be after arrival.")
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return .ok(arrivalAt: formatter.string(from: arrivalDate), departureAt: formatter.string(from: departureDate))
    }
}

public enum CourseImportStage: String, Sendable {
    case reading
    case parsing
    case calculating

    public var ratio: Double {
        switch self {
        case .reading: 0.2
        case .parsing: 0.55
        case .calculating: 0.85
        }
    }

    public var message: String {
        switch self {
        case .reading: "Reading route file…"
        case .parsing: "Parsing course track…"
        case .calculating: "Calculating race splits…"
        }
    }
}

public struct MentionMember: Equatable, Sendable {
    public var userId: String
    public var displayName: String

    public init(userId: String, displayName: String) {
        self.userId = userId
        self.displayName = displayName
    }
}

public enum MentionToken: Equatable, Sendable {
    case text(String)
    case mention(displayName: String, userId: String)
}

public enum Mentions {
    public static func parse(_ body: String, members: [MentionMember]) -> [MentionToken] {
        let named = members
            .map { (userId: $0.userId, name: $0.displayName.trimmingCharacters(in: .whitespacesAndNewlines)) }
            .filter { !$0.name.isEmpty }
            .sorted { $0.name.count > $1.name.count }
        guard !named.isEmpty else {
            return body.isEmpty ? [] : [.text(body)]
        }
        var tokens: [MentionToken] = []
        var buffer = ""
        var index = body.startIndex
        while index < body.endIndex {
            if body[index] == "@",
               let match = named.first(where: { member in
                   let after = body.index(after: index)
                   guard body[after...].lowercased().hasPrefix(member.name.lowercased()) else { return false }
                   let end = body.index(after, offsetBy: member.name.count, limitedBy: body.endIndex) ?? body.endIndex
                   return boundary(body, after: end)
               }) {
                if !buffer.isEmpty {
                    tokens.append(.text(buffer))
                    buffer = ""
                }
                tokens.append(.mention(displayName: match.name, userId: match.userId))
                index = body.index(index, offsetBy: 1 + match.name.count)
                continue
            }
            buffer.append(body[index])
            index = body.index(after: index)
        }
        if !buffer.isEmpty {
            tokens.append(.text(buffer))
        }
        return tokens
    }

    private static func boundary(_ body: String, after index: String.Index) -> Bool {
        if index >= body.endIndex { return true }
        let scalar = body[index]
        return !scalar.isLetter && !scalar.isNumber && scalar != "_"
    }
}
