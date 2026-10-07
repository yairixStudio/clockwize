import SwiftUI
import WidgetKit

@main
struct ClockwizeWidgetBundle: WidgetBundle {
    var body: some Widget {
        ClockwizeTimerWidget()
        if #available(macOS 26.0, *) {
            TimerToggleControl()
            StopTimerControl()
        }
    }
}

struct TimerEntry: TimelineEntry, Sendable {
    let date: Date
    let snapshot: FeedSnapshot
}

struct TimerProvider: TimelineProvider {
    /// The widget is refreshed by the app (via `clockwize-widget-reload`) whenever
    /// the timer changes; this is only a safety net. The elapsed time ticks on
    /// its own (`Text(timerInterval:)`), so one entry is enough.
    static let refreshInterval: TimeInterval = 5 * 60

    func placeholder(in context: Context) -> TimerEntry {
        TimerEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping @Sendable (TimerEntry) -> Void) {
        if context.isPreview {
            // The widget gallery: no network, sample data until the app has been seen.
            let cached = WidgetFeed.cachedSnapshot()
            completion(TimerEntry(date: Date(), snapshot: cached.state == nil ? .sample : cached))
            return
        }
        Task {
            let snapshot = await WidgetFeed.snapshot()
            completion(TimerEntry(date: Date(), snapshot: snapshot))
        }
    }

    func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<TimerEntry>) -> Void) {
        Task {
            let snapshot = await WidgetFeed.snapshot()
            let now = Date()
            let entry = TimerEntry(date: now, snapshot: snapshot)
            completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(Self.refreshInterval))))
        }
    }
}

struct ClockwizeTimerWidget: Widget {
    static let kind = "ClockwizeTimerWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: TimerProvider()) { entry in
            TimerWidgetView(entry: entry)
        }
        .configurationDisplayName("טיימר Clockwize")
        .description("הטיימר הפעיל והזמן שנרשם היום והשבוע, עם השהיה, עצירה והפעלה מהירה.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

extension FeedSnapshot {
    static let sample = FeedSnapshot(state: .sample, isLive: true)
}

extension WidgetState {
    /// Sample data for the widget gallery and placeholders.
    static let sample = WidgetState(
        version: 1,
        updatedAt: ISODate.format(Date()),
        signedIn: true,
        timer: Timer(
            id: "sample",
            projectName: "אתר תדמית",
            taskName: "עיצוב דף בית",
            clientName: "סטודיו אורנים",
            isRunning: true,
            elapsedSeconds: 1234,
            runningSince: ISODate.format(Date().addingTimeInterval(-1234))
        ),
        otherTimers: 0,
        today: Total(loggedSeconds: 12600),
        week: Total(loggedSeconds: 77400),
        recent: [
            Recent(projectId: "p1", taskId: "t1", projectName: "אפליקציה", taskName: "אפיון", clientName: "גלבוע בע״מ"),
            Recent(projectId: "p2", taskId: nil, projectName: "מיתוג", taskName: nil, clientName: "קפה נחת"),
        ]
    )
}

#if DEBUG
#Preview("Small", as: .systemSmall) {
    ClockwizeTimerWidget()
} timeline: {
    TimerEntry(date: .now, snapshot: .sample)
    TimerEntry(date: .now, snapshot: FeedSnapshot(state: .sample, isLive: false))
    TimerEntry(date: .now, snapshot: FeedSnapshot(state: nil, isLive: false))
}

#Preview("Medium", as: .systemMedium) {
    ClockwizeTimerWidget()
} timeline: {
    TimerEntry(date: .now, snapshot: .sample)
}
#endif
