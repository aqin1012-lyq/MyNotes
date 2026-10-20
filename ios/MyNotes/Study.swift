import Foundation
import Observation

/// App state: mirrors what static/app.js keeps in `state`, plus the same derived stats.
@MainActor @Observable
final class Study {
    var server: String = UserDefaults.standard.string(forKey: "server") ?? "" {
        didSet { UserDefaults.standard.set(server, forKey: "server") }
    }

    var curriculum: Curriculum?
    var algo: AlgoData?
    var progress: [String: String] = [:]
    var log: [LogEntry] = []
    var attempts: [Attempt] = []
    var notes: [NoteSummary] = []
    var templates: [NoteTemplate] = []
    private var lessons: [String: String?] = [:]

    var loading = false
    var error: String?

    var connected: Bool { curriculum != nil }

    func api() throws -> API { try API(server: server) }

    // MARK: loading

    func reload() async {
        guard !server.isEmpty else { return }
        loading = true
        defer { loading = false }
        do {
            let api = try api()
            async let c: Curriculum = api.get("/curriculum.json")
            async let a: AlgoData = api.get("/algo.json")
            async let p: [String: String] = api.get("/api/study/progress")
            async let l: [LogEntry] = api.get("/api/study/log")
            async let t: [Attempt] = api.get("/api/study/algo")
            async let n: [NoteSummary] = api.get("/api/study/notes")
            async let tpl: [NoteTemplate]? = api.find("/templates.json")
            (curriculum, algo, progress, log, attempts, notes) = try await (c, a, p, l, t, n)
            templates = try await tpl ?? []
            lessons = [:]
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Runs a mutation and surfaces any failure in `error`.
    private func run(_ work: (API) async throws -> Void) async {
        do {
            try await work(api())
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: progress

    func isDone(_ id: String) -> Bool { progress[id] != nil }

    func setDone(_ id: String, _ done: Bool) async {
        struct Body: Encodable { let done: Bool }
        await run { progress = try await $0.send("/api/study/progress/\(API.seg(id))", method: "PUT", body: Body(done: done)) }
    }

    // MARK: study log

    func addLog(date: String = Day.today, minutes: Int, topicId: String?, text: String) async {
        struct Body: Encodable { let date: String; let minutes: Int; let topicId: String?; let text: String }
        await run {
            let entry: LogEntry = try await $0.send("/api/study/log", method: "POST",
                                                     body: Body(date: date, minutes: minutes, topicId: topicId, text: text))
            log.append(entry)
        }
    }

    /// Consecutive days with a log entry, ending today (or yesterday if today has none yet) — like app.js studyStreak.
    var streak: Int {
        let days = Set(log.map(\.date))
        var d = days.contains(Day.today) ? Day.today : Day.add(Day.today, -1)
        var n = 0
        while days.contains(d) { n += 1; d = Day.add(d, -1) }
        return n
    }

    var minutesByDay: [String: Int] { log.reduce(into: [:]) { $0[$1.date, default: 0] += $1.minutes } }

    func deleteLog(_ entry: LogEntry) async {
        await run {
            try await $0.call("/api/study/log/\(entry.index)", method: "DELETE")
            log = try await $0.get("/api/study/log") // indices shift after a delete
        }
    }

    // MARK: algorithm attempts

    func addAttempt(slug: String, ac: Bool) async {
        struct Body: Encodable { let slug: String; let result: String }
        await run {
            let a: Attempt = try await $0.send("/api/study/algo", method: "POST", body: Body(slug: slug, result: ac ? "ac" : "fail"))
            attempts.append(a)
        }
    }

    func deleteAttempt(_ attempt: Attempt) async {
        await run {
            try await $0.call("/api/study/algo/\(attempt.index)", method: "DELETE")
            attempts = try await $0.get("/api/study/algo")
        }
    }

    // MARK: notes

    func searchNotes(_ q: String) async throws -> [NoteSummary] {
        let query = q.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
        return try await api().get("/api/study/notes" + (q.isEmpty ? "" : "?q=\(query)"))
    }

    func refreshNotes() async {
        await run { notes = try await $0.get("/api/study/notes") }
    }

    func note(_ id: String) async throws -> NoteFile? {
        try await api().find("/api/study/notes/\(API.seg(id))")
    }

    func saveNote(_ id: String, content: String) async throws -> NoteFile {
        struct Body: Encodable { let content: String }
        let file: NoteFile = try await api().send("/api/study/notes/\(API.seg(id))", method: "PUT", body: Body(content: content))
        await refreshNotes()
        return file
    }

    enum RenameError: LocalizedError {
        case invalid, taken
        var errorDescription: String? { self == .invalid ? "只能用小写字母、数字和 -" : "这个 id 已经被占用了" }
    }

    func renameNote(_ id: String, to newId: String) async throws {
        struct Body: Encodable { let newId: String }
        guard Note.validId(newId) else { throw RenameError.invalid }
        do {
            try await api().call("/api/study/notes/\(API.seg(id))/rename", method: "POST", body: Body(newId: newId))
        } catch API.Failure.status(409, _) {
            throw RenameError.taken
        }
        await refreshNotes()
    }

    /// lessons/<topic>.md, nil if that lesson isn't written yet. Cached until the next reload.
    func lesson(_ topicId: String) async throws -> String? {
        if let cached = lessons[topicId] { return cached }
        let text = try await api().text("/lessons/\(API.seg(topicId)).md")
        lessons[topicId] = .some(text)
        return text
    }

    func deleteNote(_ id: String) async {
        await run {
            try await $0.call("/api/study/notes/\(API.seg(id))", method: "DELETE")
            notes = try await $0.get("/api/study/notes")
        }
    }

    // MARK: curriculum stats (same item ids as app.js: l 讲义, k 知识点, p 实践, r 资料, m 里程碑)

    var topics: [Topic] { curriculum?.stages.flatMap(\.topics) ?? [] }

    func topic(_ id: String) -> Topic? { topics.first { $0.id == id } }

    static func lessonItem(_ t: Topic) -> String { "\(t.id):l0" }

    static func topicItems(_ t: Topic) -> [String] {
        [lessonItem(t)]
            + t.points.indices.map { "\(t.id):k\($0)" }
            + (t.practice ?? []).indices.map { "\(t.id):p\($0)" }
            + (t.resources ?? []).indices.map { "\(t.id):r\($0)" }
    }

    static func projectItems(_ p: Project) -> [String] { p.milestones.indices.map { "\(p.id):m\($0)" } }

    struct Stats { var done: Int; var total: Int; var ratio: Double { total == 0 ? 0 : Double(done) / Double(total) } }

    func stats(_ ids: [String]) -> Stats { Stats(done: ids.filter(isDone).count, total: ids.count) }
    func stats(_ t: Topic) -> Stats { stats(Self.topicItems(t)) }
    func stats(_ s: Stage) -> Stats { stats(s.topics.flatMap(Self.topicItems)) }

    func stage(of t: Topic) -> Stage? { curriculum?.stages.first { $0.topics.contains { $0.id == t.id } } }

    var nextTopic: Topic? { topics.first { stats($0).ratio < 1 } }

    var nextCheckpoint: Checkpoint? { curriculum?.checkpoints.first { $0.date >= Day.today } }

    func problem(_ slug: String) -> Problem? { algo?.problems.first { $0.slug == slug } }

    func project(_ id: String) -> Project? { curriculum?.projects.first { $0.id == id } }

    var currentStage: Stage? {
        guard let stages = curriculum?.stages, let first = stages.first else { return nil }
        let m = Day.thisMonth
        return stages.first { $0.from <= m && m <= $0.to }
            ?? (m < first.from ? first : stages.first { stats($0).ratio < 1 } ?? stages.last)
    }

    // MARK: algorithm spaced repetition (same rules as app.js algoStatus)

    enum AlgoState { case new, retry, due, learning, mastered }

    struct AlgoStatus {
        var state: AlgoState
        var label: String
        var due: String?
        var tries: [Attempt]
        var solved: Bool { tries.contains { $0.result == "ac" } }
    }

    func status(_ slug: String) -> AlgoStatus {
        let tries = attempts.filter { $0.slug == slug }
        guard let last = tries.last else { return AlgoStatus(state: .new, label: "未做", tries: []) }
        let today = Day.today
        if last.result == "fail" {
            let due = Day.add(last.date, 1)
            return AlgoStatus(state: due <= today ? .due : .retry, label: "待重做", due: due, tries: tries)
        }
        let review = algo?.review ?? []
        let streak = tries.reversed().prefix { $0.result == "ac" }.count
        if streak > review.count { return AlgoStatus(state: .mastered, label: "已掌握", tries: tries) }
        let due = Day.add(last.date, review[streak - 1])
        return due <= today
            ? AlgoStatus(state: .due, label: "该复习了", due: due, tries: tries)
            : AlgoStatus(state: .learning, label: "复习中", due: due, tries: tries)
    }

    var dueProblems: [Problem] { (algo?.problems ?? []).filter { status($0.slug).state == .due } }
}

/// yyyy-MM-dd strings in the local calendar, matching LocalDate on the server.
enum Day {
    private static let fmt: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static var today: String { fmt.string(from: .now) }

    static func date(_ day: String) -> Date? { fmt.date(from: day) }
    static func string(_ date: Date) -> String { fmt.string(from: date) }

    /// Whole days from today until `day` (negative once it's past).
    static func until(_ day: String) -> Int {
        guard let d = fmt.date(from: day), let t = fmt.date(from: today) else { return 0 }
        return Calendar(identifier: .gregorian).dateComponents([.day], from: t, to: d).day ?? 0
    }

    /// ISO-8601 week of today, like app.js isoWeek.
    static var isoWeek: (year: Int, week: Int) {
        let c = Calendar(identifier: .iso8601).dateComponents([.yearForWeekOfYear, .weekOfYear], from: .now)
        return (c.yearForWeekOfYear ?? 0, c.weekOfYear ?? 0)
    }
    static var thisMonth: String { String(today.prefix(7)) }

    static func add(_ day: String, _ n: Int) -> String {
        guard let d = fmt.date(from: day), let r = Calendar.current.date(byAdding: .day, value: n, to: d) else { return day }
        return fmt.string(from: r)
    }

    /// Monday of the current week.
    static var weekStart: String {
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 2
        let start = cal.dateInterval(of: .weekOfYear, for: .now)?.start ?? .now
        return fmt.string(from: start)
    }
}
