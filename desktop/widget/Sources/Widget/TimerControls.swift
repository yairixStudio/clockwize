import AppIntents
import SwiftUI
import WidgetKit

// Menu bar / Control Center controls (macOS 26+).

struct TimerControlValue: Sendable {
    var isRunning: Bool
    var title: String
}

@available(macOS 26.0, *)
struct TimerControlValueProvider: ControlValueProvider {
    var previewValue: TimerControlValue {
        TimerControlValue(isRunning: false, title: "טיימר Clockwize")
    }

    func currentValue() async throws -> TimerControlValue {
        let state = await WidgetFeed.snapshot().state
        if let timer = state?.timer {
            return TimerControlValue(isRunning: timer.isRunning, title: timer.title)
        }
        return TimerControlValue(isRunning: false, title: state?.recentItems.first?.projectName?.nonEmpty ?? "טיימר Clockwize")
    }
}

/// On = a timer is running. Toggling sends `{"action":"toggle"}`: the app
/// pauses/resumes the primary timer, or starts the first recent item when none.
@available(macOS 26.0, *)
struct TimerToggleControl: ControlWidget {
    static let kind = "com.yairix.clockwize.control.timer"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind, provider: TimerControlValueProvider()) { value in
            ControlWidgetToggle(isOn: value.isRunning, action: ToggleTimerIntent()) {
                Label(value.title, systemImage: "timer")
            } valueLabel: { isOn in
                Label(isOn ? "פועל" : "מושהה", systemImage: isOn ? "pause.fill" : "play.fill")
            }
            .tint(Color.clockwize)
        }
        .displayName("טיימר Clockwize")
        .description("השהיה והמשך של הטיימר הפעיל.")
    }
}

@available(macOS 26.0, *)
struct StopTimerControl: ControlWidget {
    static let kind = "com.yairix.clockwize.control.stop"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: StopPrimaryTimerIntent()) {
                Label("עצור ושמור", systemImage: "stop.fill")
            }
            .tint(Color.clockwize)
        }
        .displayName("עצור ושמור")
        .description("עצירת הטיימר הפעיל ושמירת הזמן.")
    }
}
