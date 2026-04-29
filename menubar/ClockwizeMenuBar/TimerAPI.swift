import Foundation

class TimerAPI {
    
    static let shared = TimerAPI()
    
    private let baseURL = "http://localhost:3001/api"
    
    private init() {}
    
    // MARK: - Get Active Timers
    
    func getActiveTimers(completion: @escaping (Result<[ActiveTimer], Error>) -> Void) {
        guard let token = AuthManager.shared.token,
              let workspaceId = AuthManager.shared.workspaceId else {
            completion(.failure(APIError.notAuthenticated))
            return
        }
        
        guard let url = URL(string: "\(baseURL)/timer/active") else {
            completion(.failure(APIError.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(workspaceId, forHTTPHeaderField: "X-Workspace-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(APIError.noData))
                return
            }
            
            do {
                let timers = try JSONDecoder().decode([ActiveTimer].self, from: data)
                completion(.success(timers))
            } catch {
                print("Decode error: \(error)")
                completion(.failure(error))
            }
        }.resume()
    }
    
    // MARK: - Pause Timer
    
    func pauseTimer(id: String, completion: @escaping (Result<ActiveTimer, Error>) -> Void) {
        guard let token = AuthManager.shared.token,
              let workspaceId = AuthManager.shared.workspaceId else {
            completion(.failure(APIError.notAuthenticated))
            return
        }
        
        guard let url = URL(string: "\(baseURL)/timer/pause/\(id)") else {
            completion(.failure(APIError.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(workspaceId, forHTTPHeaderField: "X-Workspace-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(APIError.noData))
                return
            }
            
            do {
                let timer = try JSONDecoder().decode(ActiveTimer.self, from: data)
                completion(.success(timer))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }
    
    // MARK: - Resume Timer
    
    func resumeTimer(id: String, completion: @escaping (Result<ActiveTimer, Error>) -> Void) {
        guard let token = AuthManager.shared.token,
              let workspaceId = AuthManager.shared.workspaceId else {
            completion(.failure(APIError.notAuthenticated))
            return
        }
        
        guard let url = URL(string: "\(baseURL)/timer/resume/\(id)") else {
            completion(.failure(APIError.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(workspaceId, forHTTPHeaderField: "X-Workspace-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(APIError.noData))
                return
            }
            
            do {
                let timer = try JSONDecoder().decode(ActiveTimer.self, from: data)
                completion(.success(timer))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }
    
    // MARK: - Stop Timer
    
    func stopTimer(id: String, notes: String? = nil, completion: @escaping (Result<TimeEntry, Error>) -> Void) {
        guard let token = AuthManager.shared.token,
              let workspaceId = AuthManager.shared.workspaceId else {
            completion(.failure(APIError.notAuthenticated))
            return
        }
        
        guard let url = URL(string: "\(baseURL)/timer/stop/\(id)") else {
            completion(.failure(APIError.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(workspaceId, forHTTPHeaderField: "X-Workspace-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["notes": notes ?? ""]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(APIError.noData))
                return
            }
            
            do {
                let entry = try JSONDecoder().decode(TimeEntry.self, from: data)
                completion(.success(entry))
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }
    
    // MARK: - Login
    
    func login(email: String, password: String, completion: @escaping (Result<LoginResponse, Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/auth/login") else {
            completion(.failure(APIError.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = ["email": email, "password": password]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(APIError.noData))
                return
            }
            
            // בדיקת תגובת שגיאה
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
                if let errorResponse = try? JSONDecoder().decode(ErrorResponse.self, from: data) {
                    completion(.failure(APIError.serverError(errorResponse.error)))
                } else {
                    completion(.failure(APIError.serverError("שגיאה בהתחברות")))
                }
                return
            }
            
            do {
                let loginResponse = try JSONDecoder().decode(LoginResponse.self, from: data)
                completion(.success(loginResponse))
            } catch {
                print("Login decode error: \(error)")
                completion(.failure(error))
            }
        }.resume()
    }
    
    // MARK: - Get Workspaces
    
    func getWorkspaces(token: String, completion: @escaping (Result<[Workspace], Error>) -> Void) {
        guard let url = URL(string: "\(baseURL)/workspaces") else {
            completion(.failure(APIError.invalidURL))
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            
            guard let data = data else {
                completion(.failure(APIError.noData))
                return
            }
            
            do {
                let workspaces = try JSONDecoder().decode([Workspace].self, from: data)
                completion(.success(workspaces))
            } catch {
                print("Workspaces decode error: \(error)")
                completion(.failure(error))
            }
        }.resume()
    }
}

// MARK: - API Errors

enum APIError: LocalizedError {
    case notAuthenticated
    case invalidURL
    case noData
    case serverError(String)
    
    var errorDescription: String? {
        switch self {
        case .notAuthenticated:
            return "לא מחובר"
        case .invalidURL:
            return "כתובת לא תקינה"
        case .noData:
            return "לא התקבל מידע"
        case .serverError(let message):
            return message
        }
    }
}
