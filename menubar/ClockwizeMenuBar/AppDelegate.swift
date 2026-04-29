import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    
    var statusBarController: StatusBarController?
    var preferencesWindow: NSWindow?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Hide dock icon (we're a menu bar only app)
        NSApp.setActivationPolicy(.accessory)
        
        // Initialize status bar
        statusBarController = StatusBarController()
        
        // Check if we have saved credentials
        if !AuthManager.shared.isLoggedIn {
            showLoginWindow()
        }
    }
    
    func showLoginWindow() {
        let loginVC = LoginViewController()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "Clockwize - התחברות"
        window.contentViewController = loginVC
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        
        preferencesWindow = window
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        // Cleanup
    }
}
