import AppIntents

// App Intents run inside the widget extension (no app launch) and post to the
// app's local feed (`/widget-action`). Used by the interactive widget buttons
// and by the Control Center controls.

struct PauseTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "השהיית טיימר"
    static let isDiscoverable = false

    @Parameter(title: "מזהה טיימר")
    var timerId: String

    init() {}
    init(timerId: String) { self.timerId = timerId }

    func perform() async throws -> some IntentResult {
        await TimerActions.run(.pause(timerId: timerId))
        return .result()
    }
}

struct ResumeTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "המשך טיימר"
    static let isDiscoverable = false

    @Parameter(title: "מזהה טיימר")
    var timerId: String

    init() {}
    init(timerId: String) { self.timerId = timerId }

    func perform() async throws -> some IntentResult {
        await TimerActions.run(.resume(timerId: timerId))
        return .result()
    }
}

struct StopTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "עצירה ושמירה"
    static let isDiscoverable = false

    @Parameter(title: "מזהה טיימר")
    var timerId: String

    init() {}
    init(timerId: String) { self.timerId = timerId }

    func perform() async throws -> some IntentResult {
        await TimerActions.run(.stop(timerId: timerId))
        return .result()
    }
}

struct StartRecentIntent: AppIntent {
    static let title: LocalizedStringResource = "הפעלת טיימר"
    static let isDiscoverable = false

    @Parameter(title: "מזהה פרויקט")
    var projectId: String

    @Parameter(title: "מזהה משימה")
    var taskId: String?

    init() {}
    init(projectId: String, taskId: String?) {
        self.projectId = projectId
        self.taskId = taskId
    }

    func perform() async throws -> some IntentResult {
        await TimerActions.run(.start(projectId: projectId, taskId: taskId))
        return .result()
    }
}

/// Control Center toggle action (value = "a timer is running"). The app decides
/// what toggling means (`{"action":"toggle"}`), so `value` is informational.
struct ToggleTimerIntent: SetValueIntent {
    static let title: LocalizedStringResource = "טיימר Clockwize"
    static let isDiscoverable = false

    @Parameter(title: "פועל")
    var value: Bool

    init() {}

    func perform() async throws -> some IntentResult {
        await TimerActions.run(.toggle)
        return .result()
    }
}

/// Control Center button: stop & save the primary timer.
struct StopPrimaryTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "עצור ושמור"
    static let isDiscoverable = false

    init() {}

    func perform() async throws -> some IntentResult {
        await TimerActions.stopPrimary()
        return .result()
    }
}
