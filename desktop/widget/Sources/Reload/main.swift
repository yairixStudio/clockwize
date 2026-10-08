// clockwize-widget-reload: asks WidgetKit to refresh Clockwize's widgets and
// controls, then exits. The Electron app runs it from Clockwize.app/Contents/MacOS/
// whenever widget-state.json changes.
import Foundation
import WidgetKit

WidgetCenter.shared.reloadAllTimelines()
if #available(macOS 26.0, *) {
    ControlCenter.shared.reloadAllControls()
}

// Both calls are fire-and-forget XPC messages; let them leave the process before exiting.
RunLoop.main.run(until: Date().addingTimeInterval(0.3))
exit(0)
