import Foundation
import os

/// What the widgets render: the latest known state and whether it came live
/// from the running app or from the cache.
struct FeedSnapshot: Sendable, Equatable {
    /// nil when the app has never been reached (nothing cached yet).
    var state: WidgetState?
    /// false when the feed was unreachable and `state` is the cached copy.
    var isLive: Bool
}

/// A widget action, sent as `POST {ClockwizeFeedURL}/widget-action`.
enum FeedAction: Sendable {
    case pause(timerId: String)
    case resume(timerId: String)
    case stop(timerId: String)
    case start(projectId: String, taskId: String?)
    /// Pause/resume the primary timer, or start the first recent item when there is none.
    case toggle

    var body: [String: Any] {
        switch self {
        case .pause(let id): return ["action": "pause", "timerId": id]
        case .resume(let id): return ["action": "resume", "timerId": id]
        case .stop(let id): return ["action": "stop", "timerId": id]
        case .start(let projectId, let taskId): return ["action": "start", "projectId": projectId, "taskId": taskId ?? NSNull()]
        case .toggle: return ["action": "toggle"]
        }
    }
}

/// Local HTTP feed served by the Electron app on 127.0.0.1. The URL and the
/// shared secret are baked into Info.plist by build.sh. The last good state is
/// cached in the extension's own (sandboxed) UserDefaults so the widget still
/// renders while the app is not running.
enum WidgetFeed {
    private static let log = Logger(subsystem: "com.yairix.clockwize.widget", category: "feed")
    private static let cacheKey = "lastWidgetState"
    private static let cacheDateKey = "lastWidgetStateDate"
    private static let session = URLSession(configuration: .ephemeral)

    private struct Config {
        let baseURL: URL
        let secret: String
    }

    private static var config: Config? {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let urlString = info["ClockwizeFeedURL"] as? String, !urlString.contains("$("),
              let url = URL(string: urlString), url.scheme != nil,
              let secret = info["ClockwizeFeedSecret"] as? String, !secret.isEmpty, !secret.contains("$(")
        else {
            log.error("ClockwizeFeedURL / ClockwizeFeedSecret missing from Info.plist")
            return nil
        }
        return Config(baseURL: url, secret: secret)
    }

    /// Live state when the app answers, otherwise the cached copy.
    static func snapshot(timeout: TimeInterval = 3) async -> FeedSnapshot {
        if let state = await fetchState(timeout: timeout) {
            return FeedSnapshot(state: state, isLive: true)
        }
        return cachedSnapshot()
    }

    static func cachedSnapshot() -> FeedSnapshot {
        let data = UserDefaults.standard.data(forKey: cacheKey)
        let state = data.flatMap { try? JSONDecoder().decode(WidgetState.self, from: $0) }
        return FeedSnapshot(state: state, isLive: false)
    }

    /// `GET /widget-state`. nil when the app is not running or answers non-200.
    static func fetchState(timeout: TimeInterval = 3) async -> WidgetState? {
        guard let config else { return nil }
        var request = URLRequest(url: config.baseURL.appending(path: "widget-state"),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.setValue("Bearer \(config.secret)", forHTTPHeaderField: "Authorization")
        return await load(request)
    }

    /// `POST /widget-action`. Returns (and caches) the new state on 200, nil otherwise.
    @discardableResult
    static func perform(_ action: FeedAction, timeout: TimeInterval = 8) async -> WidgetState? {
        guard let config, let json = try? JSONSerialization.data(withJSONObject: action.body) else { return nil }
        var request = URLRequest(url: config.baseURL.appending(path: "widget-action"),
                                 cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("Bearer \(config.secret)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = json
        return await load(request)
    }

    private static func load(_ request: URLRequest) async -> WidgetState? {
        let path = request.url?.path ?? ""
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard status == 200 else {
                log.error("\(path, privacy: .public): HTTP \(status) \(errorMessage(in: data), privacy: .public)")
                return nil
            }
            guard let state = try? JSONDecoder().decode(WidgetState.self, from: data) else {
                log.error("\(path, privacy: .public): response is not a widget state")
                return nil
            }
            UserDefaults.standard.set(data, forKey: cacheKey)
            UserDefaults.standard.set(Date(), forKey: cacheDateKey)
            return state
        } catch {
            log.info("\(path, privacy: .public): app not reachable (\(error.localizedDescription, privacy: .public))")
            return nil
        }
    }

    private static func errorMessage(in data: Data) -> String {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let message = object["error"] as? String else { return "" }
        return message
    }
}
