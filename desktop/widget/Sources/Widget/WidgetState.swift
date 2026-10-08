import Foundation

/// The widget state served by the Electron app at `GET {ClockwizeFeedURL}/widget-state`
/// (and returned by `POST /widget-action`). Every field is optional/lenient so an
/// older or partial payload still renders something sensible. `api` is always
/// null in the feed and is ignored here.
struct WidgetState: Codable, Sendable, Equatable {
    struct Timer: Codable, Sendable, Equatable {
        var id: String
        var projectName: String?
        var taskName: String?
        var clientName: String?
        var isRunning: Bool
        var elapsedSeconds: Double
        var runningSince: String?

        init(id: String, projectName: String?, taskName: String?, clientName: String?,
             isRunning: Bool, elapsedSeconds: Double, runningSince: String?) {
            self.id = id
            self.projectName = projectName
            self.taskName = taskName
            self.clientName = clientName
            self.isRunning = isRunning
            self.elapsedSeconds = elapsedSeconds
            self.runningSince = runningSince
        }

        // Lenient: `isRunning` may arrive as a Bool or as SQLite's 0/1.
        init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            projectName = try c.decodeIfPresent(String.self, forKey: .projectName)
            taskName = try c.decodeIfPresent(String.self, forKey: .taskName)
            clientName = try c.decodeIfPresent(String.self, forKey: .clientName)
            if let flag = try? c.decode(Bool.self, forKey: .isRunning) {
                isRunning = flag
            } else {
                isRunning = (try c.decodeIfPresent(Double.self, forKey: .isRunning) ?? 0) != 0
            }
            elapsedSeconds = try c.decodeIfPresent(Double.self, forKey: .elapsedSeconds) ?? 0
            runningSince = try c.decodeIfPresent(String.self, forKey: .runningSince)
        }
    }

    struct Total: Codable, Sendable, Equatable {
        var loggedSeconds: Double
    }

    struct Recent: Codable, Sendable, Equatable, Identifiable {
        var projectId: String
        var taskId: String?
        var projectName: String?
        var taskName: String?
        var clientName: String?

        var id: String { projectId + "|" + (taskId ?? "") }
    }

    var version: Int?
    var updatedAt: String?
    /// Optional: `false` shows the "sign in" state. Absent means signed in.
    var signedIn: Bool?
    var timer: Timer?
    var otherTimers: Int?
    var today: Total?
    var week: Total?
    var recent: [Recent]?
}

// MARK: - Derived values

extension WidgetState {
    var updatedDate: Date? { updatedAt.flatMap(ISODate.parse) }
    var isSignedIn: Bool { signedIn != false }
    var todayLogged: TimeInterval { today?.loggedSeconds ?? 0 }
    var weekLogged: TimeInterval { week?.loggedSeconds ?? 0 }
    var recentItems: [Recent] { recent ?? [] }
    var otherTimerCount: Int { max(0, otherTimers ?? 0) }
}

extension WidgetState.Timer {
    /// The moment the timer would have started had it never been paused.
    /// While running: `runningSince` (fallback `updatedAt - elapsedSeconds`).
    /// While paused: `now - elapsedSeconds`, so a paused timer renders frozen.
    func virtualStart(updatedAt: Date?, now: Date) -> Date {
        if isRunning {
            if let since = runningSince.flatMap(ISODate.parse) { return since }
            if let updatedAt { return updatedAt.addingTimeInterval(-elapsedSeconds) }
        }
        return now.addingTimeInterval(-elapsedSeconds)
    }

    func elapsed(updatedAt: Date?, now: Date) -> TimeInterval {
        guard isRunning else { return elapsedSeconds }
        return max(0, now.timeIntervalSince(virtualStart(updatedAt: updatedAt, now: now)))
    }

    var title: String { projectName?.nonEmpty ?? "טיימר" }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}

// MARK: - ISO-8601 (matches JavaScript's Date.toISOString())

enum ISODate {
    static func parse(_ string: String) -> Date? {
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return date }
        return try? Date.ISO8601FormatStyle().parse(string)
    }

    static func format(_ date: Date) -> String {
        Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date)
    }
}
