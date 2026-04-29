import Cocoa

class LoginViewController: NSViewController {
    
    private let emailField = NSTextField()
    private let passwordField = NSSecureTextField()
    private let loginButton = NSButton()
    private let statusLabel = NSTextField()
    private let spinner = NSProgressIndicator()
    
    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 300))
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    private func setupUI() {
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        
        // לוגו / כותרת
        let titleLabel = NSTextField(labelWithString: "🕐 Clockwize")
        titleLabel.font = NSFont.systemFont(ofSize: 28, weight: .bold)
        titleLabel.alignment = .center
        titleLabel.frame = NSRect(x: 50, y: 230, width: 300, height: 40)
        view.addSubview(titleLabel)
        
        let subtitleLabel = NSTextField(labelWithString: "התחבר לחשבון שלך")
        subtitleLabel.font = NSFont.systemFont(ofSize: 14)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.alignment = .center
        subtitleLabel.frame = NSRect(x: 50, y: 205, width: 300, height: 20)
        view.addSubview(subtitleLabel)
        
        // שדה אימייל
        let emailLabel = NSTextField(labelWithString: "אימייל:")
        emailLabel.frame = NSRect(x: 50, y: 165, width: 300, height: 20)
        view.addSubview(emailLabel)
        
        emailField.frame = NSRect(x: 50, y: 140, width: 300, height: 24)
        emailField.placeholderString = "your@email.com"
        view.addSubview(emailField)
        
        // שדה סיסמא
        let passwordLabel = NSTextField(labelWithString: "סיסמא:")
        passwordLabel.frame = NSRect(x: 50, y: 105, width: 300, height: 20)
        view.addSubview(passwordLabel)
        
        passwordField.frame = NSRect(x: 50, y: 80, width: 300, height: 24)
        passwordField.placeholderString = "••••••••"
        view.addSubview(passwordField)
        
        // כפתור התחברות
        loginButton.title = "התחבר"
        loginButton.bezelStyle = .rounded
        loginButton.frame = NSRect(x: 150, y: 35, width: 100, height: 32)
        loginButton.target = self
        loginButton.action = #selector(loginTapped)
        loginButton.keyEquivalent = "\r" // Enter key
        view.addSubview(loginButton)
        
        // ספינר
        spinner.style = .spinning
        spinner.frame = NSRect(x: 260, y: 40, width: 20, height: 20)
        spinner.isHidden = true
        view.addSubview(spinner)
        
        // הודעת סטטוס
        statusLabel.frame = NSRect(x: 50, y: 5, width: 300, height: 20)
        statusLabel.alignment = .center
        statusLabel.textColor = .systemRed
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.isBezeled = false
        statusLabel.drawsBackground = false
        statusLabel.isEditable = false
        statusLabel.isSelectable = false
        statusLabel.stringValue = ""
        view.addSubview(statusLabel)
    }
    
    @objc private func loginTapped() {
        let email = emailField.stringValue.trimmingCharacters(in: .whitespaces)
        let password = passwordField.stringValue
        
        guard !email.isEmpty else {
            statusLabel.stringValue = "נא להזין אימייל"
            return
        }
        
        guard !password.isEmpty else {
            statusLabel.stringValue = "נא להזין סיסמא"
            return
        }
        
        setLoading(true)
        statusLabel.stringValue = ""
        
        TimerAPI.shared.login(email: email, password: password) { [weak self] result in
            DispatchQueue.main.async {
                switch result {
                case .success(let response):
                    // קבלת רשימת workspaces
                    self?.fetchWorkspaces(token: response.token)
                case .failure(let error):
                    self?.setLoading(false)
                    self?.statusLabel.stringValue = error.localizedDescription
                }
            }
        }
    }
    
    private func fetchWorkspaces(token: String) {
        TimerAPI.shared.getWorkspaces(token: token) { [weak self] result in
            DispatchQueue.main.async {
                self?.setLoading(false)
                
                switch result {
                case .success(let workspaces):
                    if let firstWorkspace = workspaces.first {
                        // שמירת ההתחברות
                        AuthManager.shared.login(token: token, workspaceId: firstWorkspace.id)
                        
                        // סגירת החלון
                        self?.view.window?.close()
                        
                        // הצגת הודעה
                        let notification = NSUserNotification()
                        notification.title = "Clockwize"
                        notification.informativeText = "התחברת בהצלחה!"
                        NSUserNotificationCenter.default.deliver(notification)
                    } else {
                        self?.statusLabel.stringValue = "לא נמצאו workspaces"
                    }
                case .failure(let error):
                    self?.statusLabel.stringValue = error.localizedDescription
                }
            }
        }
    }
    
    private func setLoading(_ loading: Bool) {
        loginButton.isEnabled = !loading
        emailField.isEnabled = !loading
        passwordField.isEnabled = !loading
        
        if loading {
            spinner.isHidden = false
            spinner.startAnimation(nil)
        } else {
            spinner.stopAnimation(nil)
            spinner.isHidden = true
        }
    }
}
