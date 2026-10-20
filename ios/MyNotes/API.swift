import Foundation

/// Talks to the MyNotes Spring Boot server on the LAN (static JSON + /api/study).
struct API {
    let base: URL

    enum Failure: LocalizedError {
        case badServer(String)
        case status(Int, String)
        case network(URLError)
        case notMyNotes(String)

        var errorDescription: String? {
            switch self {
            case .badServer(let s): return "服务器地址无效：\(s)"
            case .network(let e):
                switch e.code {
                case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost:
                    return "连不上服务器：确认电脑上的 MyNotes 正在运行、手机和电脑在同一个 WiFi、地址和端口填对了"
                case .notConnectedToInternet:
                    return "手机没有联网，或者还没允许 MyNotes 访问本地网络（设置 → 隐私与安全性 → 本地网络）"
                default:
                    return "网络错误：\(e.localizedDescription)"
                }
            case .notMyNotes(let path):
                return "\(path) 返回的数据格式不对：这个地址上运行的可能不是 MyNotes，检查端口是否被别的服务占用了"
            case .status(401, _), .status(403, _):
                return "这个地址上运行的不是 MyNotes（它要求登录）。检查端口是否被别的服务占用了"
            case .status(let code, let what): return "\(what) → HTTP \(code)"
            }
        }
    }

    /// Accepts "192.168.1.5:8080", "http://host:8080/" … and normalises it.
    init(server: String) throws {
        var s = server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.contains("://") { s = "http://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host() != nil else { throw Failure.badServer(server) }
        base = url
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, method: "GET")
    }

    /// GET that maps 404 to nil (e.g. a note that doesn't exist yet).
    func find<T: Decodable>(_ path: String) async throws -> T? {
        do {
            return try await get(path) as T
        } catch Failure.status(404, _) {
            return nil
        }
    }

    /// Plain-text GET (lessons are markdown files); nil on 404.
    func text(_ path: String) async throws -> String? {
        do {
            return String(decoding: try await raw(path, method: "GET", body: nil), as: UTF8.self)
        } catch Failure.status(404, _) {
            return nil
        }
    }

    @discardableResult
    func send<T: Decodable>(_ path: String, method: String, body: (any Encodable)? = nil) async throws -> T {
        let data = try await raw(path, method: method, body: body)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch is DecodingError {
            throw Failure.notMyNotes(path)
        }
    }

    func call(_ path: String, method: String, body: (any Encodable)? = nil) async throws {
        _ = try await raw(path, method: method, body: body)
    }

    private func raw(_ path: String, method: String, body: (any Encodable)?) async throws -> Data {
        guard let url = URL(string: base.absoluteString + path) else { throw Failure.badServer(path) }
        var req = URLRequest(url: url, timeoutInterval: 10)
        req.httpMethod = method
        req.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        let data: Data, res: URLResponse
        do {
            (data, res) = try await URLSession.shared.data(for: req)
        } catch let e as URLError {
            throw Failure.network(e)
        }
        let code = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw Failure.status(code, "\(method) \(path)") }
        return data
    }

    /// Escapes one path segment (progress ids contain ":").
    static func seg(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
    }
}
