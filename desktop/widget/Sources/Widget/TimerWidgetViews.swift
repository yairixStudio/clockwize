import SwiftUI
import WidgetKit

extension Color {
    /// Indigo #6366F1, lighter in dark mode (asset catalog).
    static let clockwize = Color("AccentColor")
}

// MARK: - Root

struct TimerWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TimerEntry

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .environment(\.layoutDirection, .rightToLeft)
            .containerBackground(for: .widget) { Color("WidgetBackground") }
    }

    @ViewBuilder private var content: some View {
        if let state = entry.snapshot.state {
            if state.isSignedIn {
                let model = TimerModel(state: state, now: entry.date, isLive: entry.snapshot.isLive)
                if family == .systemMedium {
                    MediumTimerView(model: model)
                } else {
                    SmallTimerView(model: model)
                }
            } else {
                MessageView(symbol: "person.crop.circle", title: "התחברו ל-Clockwize", subtitle: "כדי לנהל טיימרים מהווידג׳ט")
            }
        } else {
            // The app has never answered (not running, or never launched).
            MessageView(symbol: "timer", title: "פתחו את Clockwize", subtitle: "כדי לראות כאן את הטיימר שלכם")
        }
    }
}

// MARK: - Model

/// Everything the views need, derived from the JSON at the entry date.
struct TimerModel {
    let state: WidgetState
    let now: Date
    /// false = the app did not answer; rendering the cached state, actions hidden.
    let isLive: Bool

    var timer: WidgetState.Timer? { state.timer }
    var isRunning: Bool { timer?.isRunning == true }
    var otherTimers: Int { state.otherTimerCount }
    var recent: [WidgetState.Recent] { Array(state.recentItems.prefix(2)) }

    /// A clock showing `logged` plus the active timer: ticking while the timer
    /// runs, frozen otherwise. The totals in the JSON exclude the active timer.
    func clock(adding logged: TimeInterval = 0) -> ClockValue {
        guard let timer else { return ClockValue(start: now.addingTimeInterval(-logged), pausedAt: now) }
        let start = timer.virtualStart(updatedAt: state.updatedDate, now: now).addingTimeInterval(-logged)
        return ClockValue(start: start, pausedAt: timer.isRunning ? nil : now)
    }

    var subtitle: String? {
        guard let timer else { return nil }
        return timer.taskName?.nonEmpty ?? timer.clientName?.nonEmpty
    }
}

struct ClockValue {
    let start: Date
    let pausedAt: Date?
}

/// Live (or frozen) H:MM:SS without per-second timeline reloads.
struct ClockText: View {
    let value: ClockValue

    var body: some View {
        Text(timerInterval: value.start...Date.distantFuture, pauseTime: value.pausedAt, countsDown: false, showsHours: true)
            .monospacedDigit()
    }
}

// MARK: - Small

struct SmallTimerView: View {
    let model: TimerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            StatusHeader(model: model)
            Spacer(minLength: 4)
            if let timer = model.timer {
                Text(timer.title)
                    .font(.headline)
                    .lineLimit(1)
                if let subtitle = model.subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                ClockText(value: model.clock())
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundStyle(model.isRunning ? Color.primary : Color.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .widgetAccentable()
            } else {
                IdleText(model: model)
            }
            Spacer(minLength: 4)
            TotalRow(label: "היום", value: model.clock(adding: model.state.todayLogged))
        }
    }
}

// MARK: - Medium

struct MediumTimerView: View {
    let model: TimerModel

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                StatusHeader(model: model)
                Spacer(minLength: 2)
                if let timer = model.timer {
                    Text(timer.title)
                        .font(.headline)
                        .lineLimit(1)
                    if let subtitle = model.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    ClockText(value: model.clock())
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .foregroundStyle(model.isRunning ? Color.primary : Color.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .widgetAccentable()
                } else {
                    IdleText(model: model)
                }
                Spacer(minLength: 2)
                TotalRow(label: "היום", value: model.clock(adding: model.state.todayLogged))
                TotalRow(label: "השבוע", value: model.clock(adding: model.state.weekLogged))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 8) {
                if let timer = model.timer, model.isLive {
                    TimerButtons(timer: timer)
                }
                if model.recent.isEmpty {
                    if model.timer == nil {
                        Spacer(minLength: 0)
                        Text("אין פרויקטים אחרונים")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer(minLength: 0)
                    }
                } else {
                    Text("התחלה מהירה")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(model.recent) { item in
                        RecentRow(item: item, showsButton: model.isLive)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(width: 136, alignment: .leading)
        }
    }
}

// MARK: - Pieces

struct StatusHeader: View {
    let model: TimerModel

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "timer")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.clockwize)
                .widgetAccentable()
            if let statusText {
                Text(statusText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(model.isRunning ? Color.clockwize : Color.secondary)
                    .widgetAccentable(model.isRunning)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if !model.isLive {
                Text("Clockwize לא פועל")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            } else if model.timer != nil, model.otherTimers > 0 {
                Text("+\(model.otherTimers)")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("\(model.otherTimers) טיימרים נוספים")
            }
        }
    }

    private var statusText: String? {
        guard let timer = model.timer else { return model.isLive ? "Clockwize" : nil }
        return timer.isRunning ? "פועל" : "מושהה"
    }
}

struct IdleText: View {
    let model: TimerModel

    var body: some View {
        Text("אין טיימר פעיל")
            .font(.headline)
            .lineLimit(1)
        if model.otherTimers > 0 {
            Text("\(model.otherTimers) טיימרים פעילים באפליקציה")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        } else if let last = model.recent.first, let name = last.projectName?.nonEmpty {
            Text("אחרון: \(name)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

struct TotalRow: View {
    let label: String
    let value: ClockValue

    var body: some View {
        HStack(spacing: 4) {
            Text(label)
            Spacer(minLength: 4)
            ClockText(value: value)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 90, alignment: .trailing)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
}

struct TimerButtons: View {
    let timer: WidgetState.Timer

    var body: some View {
        HStack(spacing: 8) {
            if timer.isRunning {
                Button(intent: PauseTimerIntent(timerId: timer.id)) {
                    CircleIcon(symbol: "pause.fill", prominent: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("השהיה")
            } else {
                Button(intent: ResumeTimerIntent(timerId: timer.id)) {
                    CircleIcon(symbol: "play.fill", prominent: true)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("המשך")
            }
            Button(intent: StopTimerIntent(timerId: timer.id)) {
                CircleIcon(symbol: "stop.fill", prominent: false)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("עצירה ושמירה")
        }
    }
}

struct RecentRow: View {
    let item: WidgetState.Recent
    var showsButton = true

    var body: some View {
        HStack(spacing: 6) {
            VStack(alignment: .leading, spacing: 0) {
                Text(item.projectName?.nonEmpty ?? "פרויקט")
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
                if let detail = item.taskName?.nonEmpty ?? item.clientName?.nonEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if showsButton {
                Button(intent: StartRecentIntent(projectId: item.projectId, taskId: item.taskId)) {
                    CircleIcon(symbol: "play.fill", prominent: false, size: 24)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("הפעלת טיימר")
            }
        }
    }
}

struct CircleIcon: View {
    let symbol: String
    let prominent: Bool
    var size: CGFloat = 30

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(prominent ? Color.white : Color.clockwize)
            .frame(width: size, height: size)
            .background(Circle().fill(prominent ? Color.clockwize : Color.clockwize.opacity(0.15)))
            .widgetAccentable()
    }
}

struct MessageView: View {
    let symbol: String
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: symbol)
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color.clockwize)
                .widgetAccentable()
            Spacer(minLength: 0)
            Text(title)
                .font(.headline)
                .lineLimit(2)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
    }
}
