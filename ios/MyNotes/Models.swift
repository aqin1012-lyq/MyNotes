import Foundation

// MARK: - Curriculum (from /curriculum.json)

struct Curriculum: Codable {
    var mission: String
    var identity: String
    var stages: [Stage]
    var projects: [Project]
    var checkpoints: [Checkpoint]
    var careers: [String]
    var certs: [Cert]?
    var pitfalls: [String]
}

struct Cert: Codable, Hashable {
    var t: String
    var u: String
    var when: String
}

struct Stage: Codable, Identifiable {
    var id: String
    var title: String
    var from: String
    var to: String
    var goal: String
    var topics: [Topic]
}

struct Topic: Codable, Identifiable {
    var id: String
    var title: String
    var month: String
    var summary: String
    var points: [String]
    var questions: [String]?
    var practice: [String]?
    var resources: [Resource]?
    var lab: String?
}

struct Resource: Codable, Hashable {
    var t: String
    var u: String
    var type: String
}

struct Project: Codable, Identifiable {
    var id: String
    var title: String
    var period: String
    var stack: String
    var link: String?
    var milestones: [String]
}

struct Checkpoint: Codable, Identifiable {
    var date: String
    var title: String
    var note: String
    var detail: String
    var id: String { note }
}

// MARK: - Note templates (from /templates.json, generated out of app.js)

/// Bodies use the placeholders ⟦title⟧ ⟦date⟧ ⟦weekLabel⟧; `suggestedId` uses ⟦isoYear⟧ ⟦isoWeek⟧.
struct NoteTemplate: Codable, Identifiable {
    var key: String
    var label: String
    var body: String
    var suggestedId: String?
    var id: String { key }

    enum CodingKeys: String, CodingKey { case key, label, body, suggestedId = "id" }
}

// MARK: - Algorithm practice (from /algo.json)

struct AlgoData: Codable {
    var sets: [ProblemSet]
    var review: [Int]
    var problems: [Problem]
}

struct ProblemSet: Codable, Identifiable {
    var id: String
    var title: String
    var categories: [Category]
    var desc: String
}

struct Category: Codable, Identifiable {
    var id: String
    var title: String
}

struct Problem: Codable, Identifiable {
    var no: Int?
    var slug: String
    var title: String
    var diff: String
    var cat: String
    var set: String
    var url: String?
    var id: String { slug }
    var label: String { no.map { "\($0). \(title)" } ?? title }
}

// MARK: - User data (from /api/study)

struct NoteSummary: Codable, Identifiable {
    var id: String
    var title: String?
    var updatedAt: String
    var length: Int
    var excerpt: String?
    var snippet: String?
}

struct NoteFile: Codable {
    var id: String
    var updatedAt: String
    var content: String
}

struct Attempt: Codable, Identifiable {
    var index: Int
    var date: String
    var slug: String
    var result: String // "ac" | "fail"
    var id: Int { index }
}

struct LogEntry: Codable, Identifiable {
    var index: Int
    var date: String
    var minutes: Int
    var topicId: String
    var text: String
    var id: Int { index }
}
