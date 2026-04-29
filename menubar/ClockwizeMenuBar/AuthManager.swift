import Foundation
import Security

class AuthManager {
    
    static let shared = AuthManager()
    
    private let tokenKey = "com.clockwize.menubar.token"
    private let workspaceKey = "com.clockwize.menubar.workspace"
    private let userDefaults = UserDefaults.standard
    
    private init() {}
    
    // MARK: - Token
    
    var token: String? {
        get {
            return userDefaults.string(forKey: tokenKey)
        }
        set {
            if let value = newValue {
                userDefaults.set(value, forKey: tokenKey)
            } else {
                userDefaults.removeObject(forKey: tokenKey)
            }
        }
    }
    
    // MARK: - Workspace ID
    
    var workspaceId: String? {
        get {
            return userDefaults.string(forKey: workspaceKey)
        }
        set {
            if let value = newValue {
                userDefaults.set(value, forKey: workspaceKey)
            } else {
                userDefaults.removeObject(forKey: workspaceKey)
            }
        }
    }
    
    // MARK: - Auth Status
    
    var isLoggedIn: Bool {
        return token != nil && workspaceId != nil
    }
    
    // MARK: - Login
    
    func login(token: String, workspaceId: String) {
        self.token = token
        self.workspaceId = workspaceId
    }
    
    // MARK: - Logout
    
    func logout() {
        token = nil
        workspaceId = nil
    }
}
