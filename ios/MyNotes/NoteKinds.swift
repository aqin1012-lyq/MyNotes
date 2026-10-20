import SwiftUI

/// Where a note belongs decides its title, its starter template and whether it may be renamed (same rules as app.js).
enum NoteKind: String, CaseIterable, Identifiable {
    case free, topic, project, algo, review
    var id: String { rawValue }

    var label: String {
        switch self {
        case .free: return "自由笔记"
        case .topic: return "主题笔记"
        case .project: return "项目笔记"
        case .algo: return "刷题笔记"
        case .review: return "复盘"
        }
    }

    var color: Color {
        switch self {
        case .topic: return Theme.lime.opacity(0.5)
        case .review: return Theme.pinkSoft
        default: return Theme.accentSoft
        }
    }
}

enum Note {
    static func validId(_ id: String) -> Bool {
        id.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil
    }
}

extension Study {
    func kind(_ id: String) -> NoteKind {
        if topic(id) != nil { return .topic }
        if id.hasPrefix("algo-"), problem(String(id.dropFirst(5))) != nil { return .algo }
        if id.hasPrefix("project-"), project(String(id.dropFirst(8))) != nil { return .project }
        if curriculum?.checkpoints.contains(where: { $0.note == id }) == true || id.hasPrefix("weekly-") { return .review }
        return .free
    }

    func noteTitle(_ id: String) -> String {
        if let t = topic(id) { return t.title }
        if id.hasPrefix("algo-"), let p = problem(String(id.dropFirst(5))) { return "刷题：\(p.label)" }
        if id.hasPrefix("project-"), let p = project(String(id.dropFirst(8))) { return p.title }
        if let cp = curriculum?.checkpoints.first(where: { $0.note == id }) { return cp.title }
        return notes.first { $0.id == id }?.title ?? id
    }

    /// Topic, problem and project notes are tied to their id; only free-standing notes can be renamed.
    func renamable(_ id: String) -> Bool {
        [.free, .review].contains(kind(id)) && curriculum?.checkpoints.contains(where: { $0.note == id }) != true
    }

    /// What an empty note starts with, before anything is saved.
    func starter(for id: String, template key: String? = nil) -> String {
        switch kind(id) {
        case .topic:
            let t = topic(id)!
            let qs = (t.questions ?? []).map { "- \($0)\n  - " }.joined(separator: "\n")
            return "# \(t.title)\n\n## 用自己的话讲清楚\n\n\n## 在请求链路 / 系统里的位置\n\n\n## 攻击者会怎么想\n\n\(qs)\n\n## 在 Java / Spring 里怎么防\n\n\n## 实验记录\n\n\n## 还没搞懂的\n\n"
        case .project:
            let p = project(String(id.dropFirst(8)))!
            return "# \(p.title)\n\n## 架构图\n\n\n## 设计决策\n\n\n## 踩坑记录\n\n\n## 简历描述（STAR）\n\n"
        case .algo:
            let p = problem(String(id.dropFirst(5)))!
            return "# \(p.label)\n\n## 我的第一反应\n\n\n## 卡在哪里\n\n\n## 关键点\n\n"
        case .free, .review:
            guard let tpl = templates.first(where: { $0.key == (key ?? "study") }) ?? templates.first else { return "# \(noteTitle(id))\n\n" }
            let w = Day.isoWeek
            return tpl.body
                .replacingOccurrences(of: "⟦title⟧", with: noteTitle(id))
                .replacingOccurrences(of: "⟦date⟧", with: Day.today)
                .replacingOccurrences(of: "⟦weekLabel⟧", with: "\(w.year) 年第 \(w.week) 周")
        }
    }

    func suggestedId(_ tpl: NoteTemplate) -> String? {
        let w = Day.isoWeek
        return tpl.suggestedId?
            .replacingOccurrences(of: "⟦isoYear⟧", with: "\(w.year)")
            .replacingOccurrences(of: "⟦isoWeek⟧", with: String(format: "%02d", w.week))
    }
}
