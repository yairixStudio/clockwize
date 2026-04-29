import Cocoa

class StatusBarController {
    
    private var statusItem: NSStatusItem!
    private var timer: Timer?
    private var activeTimers: [ActiveTimer] = []
    private var currentElapsed: Int = 0
    private var displayTimer: Timer?
    
    init() {
        setupStatusBar()
        setupMenu()
        startPolling()
    }
    
    private func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        if let button = statusItem.button {
            updateStatusBarTitle(isRunning: false, elapsed: 0)
        }
    }
    
    private func updateStatusBarTitle(isRunning: Bool, elapsed: Int) {
        guard let button = statusItem.button else { return }
        
        let hours = elapsed / 3600
        let minutes = (elapsed % 3600) / 60
        let seconds = elapsed % 60
        
        if isRunning {
            // שעון ירוק כשהטיימר פועל
            let timeString = String(format: "%d:%02d:%02d", hours, minutes, seconds)
            button.title = "🟢 \(timeString)"
        } else if elapsed > 0 {
            // שעון צהוב כשמושהה
            let timeString = String(format: "%d:%02d:%02d", hours, minutes, seconds)
            button.title = "🟡 \(timeString)"
        } else {
            // שעון רגיל כשאין טיימר
            button.title = "⏱️"
        }
    }
    
    private func setupMenu() {
        let menu = NSMenu()
        
        // כותרת
        let titleItem = NSMenuItem(title: "Clockwize", action: nil, keyEquivalent: "")
        titleItem.isEnabled = false
        menu.addItem(titleItem)
        
        menu.addItem(NSMenuItem.separator())
        
        // סטטוס טיימר (יתעדכן דינמית)
        let statusItem = NSMenuItem(title: "אין טיימר פעיל", action: nil, keyEquivalent: "")
        statusItem.tag = 100
        statusItem.isEnabled = false
        menu.addItem(statusItem)
        
        menu.addItem(NSMenuItem.separator())
        
        // פתיחת האפליקציה
        let openAppItem = NSMenuItem(title: "📱 פתח Clockwize", action: #selector(openApp), keyEquivalent: "o")
        openAppItem.target = self
        menu.addItem(openAppItem)
        
        menu.addItem(NSMenuItem.separator())
        
        // התחברות/התנתקות
        if AuthManager.shared.isLoggedIn {
            let logoutItem = NSMenuItem(title: "🚪 התנתק", action: #selector(logout), keyEquivalent: "")
            logoutItem.target = self
            menu.addItem(logoutItem)
        } else {
            let loginItem = NSMenuItem(title: "🔐 התחבר", action: #selector(showLogin), keyEquivalent: "")
            loginItem.target = self
            menu.addItem(loginItem)
        }
        
        menu.addItem(NSMenuItem.separator())
        
        // יציאה
        let quitItem = NSMenuItem(title: "יציאה", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        
        self.statusItem.menu = menu
    }
    
    private func startPolling() {
        // עדכון מידי
        fetchTimers()
        
        // עדכון כל 10 שניות
        timer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            self?.fetchTimers()
        }
        
        // עדכון התצוגה כל שנייה
        displayTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.updateDisplay()
        }
    }
    
    private func updateDisplay() {
        guard let primaryTimer = activeTimers.first else {
            updateStatusBarTitle(isRunning: false, elapsed: 0)
            return
        }
        
        if primaryTimer.is_running {
            // חישוב זמן שעבר מאז start_time + accumulated_seconds
            let startDate = ISO8601DateFormatter().date(from: primaryTimer.start_time) ?? Date()
            let elapsed = primaryTimer.accumulated_seconds + Int(Date().timeIntervalSince(startDate))
            currentElapsed = elapsed
            updateStatusBarTitle(isRunning: true, elapsed: elapsed)
        } else {
            currentElapsed = primaryTimer.accumulated_seconds
            updateStatusBarTitle(isRunning: false, elapsed: primaryTimer.accumulated_seconds)
        }
    }
    
    private func fetchTimers() {
        guard AuthManager.shared.isLoggedIn else { return }
        
        TimerAPI.shared.getActiveTimers { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let timers):
                    self?.activeTimers = timers
                    self?.updateMenu()
                    self?.updateDisplay()
                case .failure(let error):
                    print("Error fetching timers: \(error)")
                }
            }
        }
    }
    
    private func updateMenu() {
        guard let menu = statusItem.menu else { return }
        
        // מציאת פריט הסטטוס
        guard let statusMenuItem = menu.item(withTag: 100) else { return }
        
        if let primaryTimer = activeTimers.first {
            let projectName = primaryTimer.project_name ?? "פרויקט"
            let taskName = primaryTimer.task_name
            
            var title = "⏱️ \(projectName)"
            if let task = taskName {
                title += " - \(task)"
            }
            
            if primaryTimer.is_running {
                title = "▶️ " + title.dropFirst(2)
            } else {
                title = "⏸️ " + title.dropFirst(2)
            }
            
            statusMenuItem.title = title
            
            // הוספת כפתורי שליטה אם יש טיימר
            addTimerControls(for: primaryTimer)
        } else {
            statusMenuItem.title = "אין טיימר פעיל"
            removeTimerControls()
        }
    }
    
    private func addTimerControls(for timer: ActiveTimer) {
        guard let menu = statusItem.menu else { return }
        
        // הסרת כפתורים קודמים
        removeTimerControls()
        
        // מציאת מיקום להוספה (אחרי הסטטוס)
        guard let statusIndex = menu.items.firstIndex(where: { $0.tag == 100 }) else { return }
        
        if timer.is_running {
            // כפתור השהייה
            let pauseItem = NSMenuItem(title: "⏸️ השהה", action: #selector(pauseTimer), keyEquivalent: "")
            pauseItem.target = self
            pauseItem.tag = 101
            pauseItem.representedObject = timer.id
            menu.insertItem(pauseItem, at: statusIndex + 1)
        } else {
            // כפתור המשך
            let resumeItem = NSMenuItem(title: "▶️ המשך", action: #selector(resumeTimer), keyEquivalent: "")
            resumeItem.target = self
            resumeItem.tag = 101
            resumeItem.representedObject = timer.id
            menu.insertItem(resumeItem, at: statusIndex + 1)
        }
        
        // כפתור עצירה
        let stopItem = NSMenuItem(title: "⏹️ עצור ושמור", action: #selector(stopTimer), keyEquivalent: "")
        stopItem.target = self
        stopItem.tag = 102
        stopItem.representedObject = timer.id
        menu.insertItem(stopItem, at: statusIndex + 2)
    }
    
    private func removeTimerControls() {
        guard let menu = statusItem.menu else { return }
        
        // הסרת פריטים עם tags 101 ו-102
        if let item = menu.item(withTag: 101) {
            menu.removeItem(item)
        }
        if let item = menu.item(withTag: 102) {
            menu.removeItem(item)
        }
    }
    
    // MARK: - Actions
    
    @objc private func openApp() {
        if let url = URL(string: "http://localhost:5173") {
            NSWorkspace.shared.open(url)
        }
    }
    
    @objc private func pauseTimer(_ sender: NSMenuItem) {
        guard let timerId = sender.representedObject as? String else { return }
        
        TimerAPI.shared.pauseTimer(id: timerId) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.fetchTimers()
                case .failure(let error):
                    print("Error pausing timer: \(error)")
                }
            }
        }
    }
    
    @objc private func resumeTimer(_ sender: NSMenuItem) {
        guard let timerId = sender.representedObject as? String else { return }
        
        TimerAPI.shared.resumeTimer(id: timerId) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.fetchTimers()
                case .failure(let error):
                    print("Error resuming timer: \(error)")
                }
            }
        }
    }
    
    @objc private func stopTimer(_ sender: NSMenuItem) {
        guard let timerId = sender.representedObject as? String else { return }
        
        TimerAPI.shared.stopTimer(id: timerId) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    self?.fetchTimers()
                    // הצגת התראה
                    self?.showNotification(title: "Clockwize", body: "הטיימר נשמר בהצלחה")
                case .failure(let error):
                    print("Error stopping timer: \(error)")
                }
            }
        }
    }
    
    @objc private func showLogin() {
        if let appDelegate = NSApp.delegate as? AppDelegate {
            appDelegate.showLoginWindow()
        }
    }
    
    @objc private func logout() {
        AuthManager.shared.logout()
        activeTimers = []
        updateStatusBarTitle(isRunning: false, elapsed: 0)
        setupMenu()
    }
    
    @objc private func quit() {
        NSApp.terminate(nil)
    }
    
    private func showNotification(title: String, body: String) {
        let notification = NSUserNotification()
        notification.title = title
        notification.informativeText = body
        notification.soundName = NSUserNotificationDefaultSoundName
        NSUserNotificationCenter.default.deliver(notification)
    }
}
