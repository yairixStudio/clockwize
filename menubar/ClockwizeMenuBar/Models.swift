import Foundation

// MARK: - Active Timer

struct ActiveTimer: Codable {
    let id: String
    let user_id: String
    let workspace_id: String
    let project_id: String
    let task_id: String?
    let start_time: String
    let accumulated_seconds: Int
    let is_running: Bool
    let project_name: String?
    let task_name: String?
    let client_name: String?
    
    // Handle different formats from server
    enum CodingKeys: String, CodingKey {
        case id
        case user_id
        case workspace_id
        case project_id
        case task_id
        case start_time
        case accumulated_seconds
        case is_running
        case project_name
        case task_name
        case client_name
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        user_id = try container.decode(String.self, forKey: .user_id)
        workspace_id = try container.decode(String.self, forKey: .workspace_id)
        project_id = try container.decode(String.self, forKey: .project_id)
        task_id = try container.decodeIfPresent(String.self, forKey: .task_id)
        start_time = try container.decode(String.self, forKey: .start_time)
        accumulated_seconds = try container.decode(Int.self, forKey: .accumulated_seconds)
        
        // Handle both Int and Bool for is_running
        if let boolValue = try? container.decode(Bool.self, forKey: .is_running) {
            is_running = boolValue
        } else if let intValue = try? container.decode(Int.self, forKey: .is_running) {
            is_running = intValue != 0
        } else {
            is_running = false
        }
        
        project_name = try container.decodeIfPresent(String.self, forKey: .project_name)
        task_name = try container.decodeIfPresent(String.self, forKey: .task_name)
        client_name = try container.decodeIfPresent(String.self, forKey: .client_name)
    }
}

// MARK: - Time Entry

struct TimeEntry: Codable {
    let id: String
    let user_id: String
    let workspace_id: String
    let project_id: String
    let task_id: String?
    let start_time: String
    let end_time: String
    let duration: Int
    let notes: String?
}

// MARK: - Login Response

struct LoginResponse: Codable {
    let token: String
    let user: User
}

struct User: Codable {
    let id: String
    let email: String
    let name: String
}

// MARK: - Workspace

struct Workspace: Codable {
    let id: String
    let name: String
    let owner_id: String
    let role: String?
}

// MARK: - Error Response

struct ErrorResponse: Codable {
    let error: String
}
