import Foundation
import WidgetKit

/// Runs widget/control actions through the app's local feed. A failure (app not
/// running, non-200) leaves everything as it was; the widgets just re-read.
enum TimerActions {
    static func run(_ action: FeedAction) async {
        await WidgetFeed.perform(action)
        await reloadEverything()
    }

    /// Control Center "stop & save": stops whatever the primary timer is now.
    static func stopPrimary() async {
        let snapshot = await WidgetFeed.snapshot()
        guard let timer = snapshot.state?.timer else { return await reloadEverything() }
        await run(.stop(timerId: timer.id))
    }

    @MainActor
    static func reloadEverything() {
        WidgetCenter.shared.reloadAllTimelines()
        if #available(macOS 26.0, *) {
            ControlCenter.shared.reloadAllControls()
        }
    }
}
