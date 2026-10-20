import SwiftUI

/// Renders the notes' / lessons' markdown with the same rules as app.js `markdown()` and `inline()`:
/// ``` fences, :::tip/warn/note/card/details/fold boxes (nested markdown), headings (h2 get "sec-N" anchors),
/// rules, > quotes, | tables |, lists and task lists, and inline `code`, **bold**, *em*, ~~del~~, ==mark==,
/// {{pill}} {{+lime}} {{!pink}} {{~gray}}, [[progress:N]], [[topic-id]], [[algo:slug]], [links](https://…).
struct MarkdownView: View {
    @Environment(Study.self) private var study
    private let blocks: [MDBlock]
    private let lazy: Bool
    @State private var target: LinkTarget?

    init(text: String, lazy: Bool = false) {
        blocks = MDBlock.parse(text)
        self.lazy = lazy
    }

    /// The h2 headings, for a table of contents: (anchor, title).
    static func toc(_ text: String) -> [(String, String)] {
        MDBlock.parse(text).compactMap {
            if case .heading(2, let s, let n?) = $0 { return ("sec-\(n)", s.replacing(/[*=`{}~+!]/, with: "")) }
            return nil
        }
    }

    var body: some View {
        Group {
            if lazy {
                LazyVStack(alignment: .leading, spacing: 10) { content }
            } else {
                VStack(alignment: .leading, spacing: 10) { content }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "mynotes", let host = url.host() else { return .systemAction }
            let arg = url.lastPathComponent
            target = host == "algo" ? .problem(arg) : .topic(arg)
            return .handled
        })
        .sheet(item: $target) { t in
            NavigationStack {
                Group {
                    switch t {
                    case .topic(let id): if let topic = study.topic(id) { TopicDetail(topic: topic) }
                    case .problem(let slug): if let p = study.problem(slug) { ProblemDetail(problem: p) }
                    }
                }
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { target = nil } } }
            }
        }
    }

    private var content: some View {
        ForEach(Array(blocks.enumerated()), id: \.offset) { _, b in BlockView(block: b) }
    }

    enum LinkTarget: Identifiable, Hashable {
        case topic(String), problem(String)
        var id: Self { self }
    }
}

private struct BlockView: View {
    @Environment(Study.self) private var study
    let block: MDBlock

    var body: some View {
        switch block {
        case .heading(let level, let s, let anchor):
            Text(inline(s))
                .font(level == 1 ? .title2.bold() : level == 2 ? .title3.bold() : level == 3 ? .headline : .subheadline.bold())
                .padding(.top, level <= 2 ? 8 : 2)
                .id(anchor.map { "sec-\($0)" } ?? "")
        case .paragraph(let lines):
            Text(lines.map(inline).reduce(into: AttributedString()) { acc, l in
                if !acc.characters.isEmpty { acc.append(AttributedString("\n")) }
                acc.append(l)
            })
        case .list(let items, let ordered):
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, item in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        switch item.checked {
                        case .some(true): Image(systemName: "checkmark.square.fill").foregroundStyle(Theme.limeLine)
                        case .some(false): Image(systemName: "square").foregroundStyle(.secondary)
                        case .none: Text(ordered ? "\(i + 1)." : "•").foregroundStyle(Theme.accent).monospacedDigit()
                        }
                        Text(inline(item.text))
                    }
                }
            }
        case .code(let s):
            ScrollView(.horizontal) {
                Text(s).font(.system(.caption, design: .monospaced)).padding(10).textSelection(.enabled)
            }
            .background(Color.secondary.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        case .table(let head, let rows):
            ScrollView(.horizontal) {
                Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 6) {
                    GridRow { ForEach(Array(head.enumerated()), id: \.offset) { _, c in cell(c, bold: true) } }
                    Divider()
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                        GridRow { ForEach(Array(r.enumerated()), id: \.offset) { _, c in cell(c, bold: false) } }
                        Divider()
                    }
                }
                .padding(10)
            }
            .background(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.25)))
        case .box(let kind, let title, let children):
            box(kind, title, children)
        case .quote(let children):
            VStack(alignment: .leading, spacing: 8) { children.view }
                .foregroundStyle(.secondary)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(Color.secondary.opacity(0.35)).frame(width: 3) }
        case .rule:
            Divider()
        }
    }

    private func cell(_ s: String, bold: Bool) -> some View {
        Text(inline(s)).font(bold ? .caption.bold() : .caption).frame(minWidth: 60, maxWidth: 240, alignment: .leading)
    }

    @ViewBuilder
    private func box(_ kind: String, _ title: String, _ children: [MDBlock]) -> some View {
        switch kind {
        case "details", "fold":
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) { children.view }
                    .padding(.top, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } label: {
                HStack {
                    Text(inline(title)).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                    if kind == "fold" { Spacer(); Text("点击展开").font(.caption).foregroundStyle(.secondary) }
                }
            }
            .padding(10)
            .background(Theme.accentSoft.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
        case "card":
            VStack(alignment: .leading, spacing: 8) {
                if !title.isEmpty { Text(inline(title)).font(.subheadline.weight(.semibold)) }
                children.view
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.3)))
        default: // tip / warn / note callouts
            let (fill, line): (Color, Color) = kind == "tip" ? (Theme.lime.opacity(0.22), Theme.limeLine)
                : kind == "warn" ? (Theme.pinkSoft, Theme.pink) : (Theme.accentSoft.opacity(0.6), Theme.accent)
            VStack(alignment: .leading, spacing: 8) {
                if !title.isEmpty { Text(inline(title)).font(.subheadline.weight(.semibold)) }
                children.view
            }
            .padding(10)
            .padding(.leading, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .leading) { UnevenRoundedRectangle(topLeadingRadius: 8, bottomLeadingRadius: 8).fill(line).frame(width: 4) }
        }
    }

    private func inline(_ s: String) -> AttributedString { Inline.render(s, study: study) }
}

private extension [MDBlock] {
    var view: some View { ForEach(indices, id: \.self) { BlockView(block: self[$0]) } }
}

// MARK: - block parsing (mirrors app.js markdown())

indirect enum MDBlock {
    case heading(Int, String, anchor: Int?)
    case paragraph([String])
    case list([(checked: Bool?, text: String)], ordered: Bool)
    case code(String)
    case table([String], [[String]])
    case box(kind: String, title: String, [MDBlock])
    case quote([MDBlock])
    case rule

    static func parse(_ src: String, anchors: Bool = true) -> [MDBlock] {
        let lines = src.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var out: [MDBlock] = []
        var i = 0, h2 = 0

        func isTableSep(_ l: String) -> Bool {
            l.wholeMatch(of: /\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*/) != nil
        }
        func cells(_ l: String) -> [String] {
            var t = l.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("|") { t.removeFirst() }
            if t.hasSuffix("|") { t.removeLast() }
            return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        let listItem = /^\s*([-*+]|\d+\.)\s+/
        let blank = { (l: String) in l.trimmingCharacters(in: .whitespaces).isEmpty }

        while i < lines.count {
            let line = lines[i]
            if line.hasPrefix("```") {
                var buf: [String] = []
                i += 1
                while i < lines.count, !lines[i].hasPrefix("```") { buf.append(lines[i]); i += 1 }
                i += 1
                out.append(.code(buf.joined(separator: "\n")))
            } else if let m = line.firstMatch(of: /^:::(tip|warn|note|details|card|fold)\s*(.*)$/) {
                var buf: [String] = []
                i += 1
                while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces) != ":::" { buf.append(lines[i]); i += 1 }
                i += 1
                out.append(.box(kind: String(m.1), title: String(m.2), parse(buf.joined(separator: "\n"), anchors: false)))
            } else if let m = line.firstMatch(of: /^(#{1,6})\s+(.*)$/) {
                let level = m.1.count
                if level == 2, anchors { h2 += 1 }
                out.append(.heading(level, String(m.2), anchor: level == 2 && anchors ? h2 : nil))
                i += 1
            } else if line.wholeMatch(of: /\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})/) != nil {
                out.append(.rule)
                i += 1
            } else if line.hasPrefix(">") {
                var buf: [String] = []
                while i < lines.count, lines[i].hasPrefix(">") { buf.append(lines[i].replacing(/^>\s?/, with: "")); i += 1 }
                out.append(.quote(parse(buf.joined(separator: "\n"), anchors: false)))
            } else if line.contains("|"), i + 1 < lines.count, isTableSep(lines[i + 1]) {
                let head = cells(line)
                i += 2
                var rows: [[String]] = []
                while i < lines.count, lines[i].contains("|"), !blank(lines[i]) { rows.append(cells(lines[i])); i += 1 }
                out.append(.table(head, rows))
            } else if line.firstMatch(of: listItem) != nil {
                let ordered = line.firstMatch(of: /^\s*\d+\./) != nil
                var items: [(Bool?, String)] = []
                while i < lines.count, lines[i].firstMatch(of: listItem) != nil {
                    let it = lines[i].replacing(listItem, with: "", maxReplacements: 1)
                    if let t = it.wholeMatch(of: /\[([ xX])\]\s(.*)/) { items.append((t.1 != " ", String(t.2))) }
                    else { items.append((nil, it)) }
                    i += 1
                }
                out.append(.list(items.map { (checked: $0.0, text: $0.1) }, ordered: ordered))
            } else if blank(line) {
                i += 1
            } else {
                var buf: [String] = []
                while i < lines.count, !blank(lines[i]),
                      lines[i].firstMatch(of: /^(```|:::|#{1,6}\s|>|\s*([-*+]|\d+\.)\s)/) == nil {
                    buf.append(lines[i]); i += 1
                }
                out.append(.paragraph(buf))
            }
        }
        return out
    }
}

// MARK: - inline (mirrors app.js inline())

enum Inline {
    private static let token = try! Regex(
        #"`([^`]+)`|\[\[progress:(\d{1,3})\]\]|\[\[algo:([a-z0-9-]+)\]\]|\[\[([a-z0-9-]+)\]\]"#
        + #"|\[([^\]]+)\]\(((?:https?://|#|/)[^)\s]*)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|~~([^~]+)~~|==([^=]+)=="#
        + #"|\{\{([+!~]?)([^{}]+)\}\}"#)

    @MainActor
    static func render(_ s: String, study: Study) -> AttributedString {
        var out = AttributedString()
        var rest = s[...]
        while let m = try? token.firstMatch(in: rest) {
            out.append(AttributedString(String(rest[..<m.range.lowerBound])))
            let g = { (n: Int) in m.output[n].substring.map(String.init) }
            if let code = g(1) {
                var a = AttributedString(code)
                a.font = .system(.callout, design: .monospaced)
                a.backgroundColor = Color.secondary.opacity(0.14)
                out.append(a)
            } else if let n = g(2) {
                let v = min(100, Int(n) ?? 0)
                var a = AttributedString(String(repeating: "▰", count: v / 10) + String(repeating: "▱", count: 10 - v / 10) + " \(v)%")
                a.foregroundColor = Theme.accent
                out.append(a)
            } else if let slug = g(3) {
                out.append(link(study.problem(slug)?.label ?? slug, "mynotes://algo/\(slug)"))
            } else if let id = g(4) {
                out.append(link(study.topic(id)?.title ?? id, "mynotes://topic/\(id)"))
            } else if let text = g(5), let href = g(6) {
                let url = href.hasPrefix("#/topic/") ? "mynotes://topic/\(href.dropFirst(8))"
                    : href.hasPrefix("#/algo/") ? "mynotes://algo/\(href.dropFirst(7))" : href
                if href.hasPrefix("/") { out.append(render(text, study: study)) } else { out.append(link(text, url)) }
            } else if let b = g(7) {
                out.append(styled(render(b, study: study)) { $0.inlinePresentationIntent = .stronglyEmphasized })
            } else if let e = g(8) {
                out.append(styled(render(e, study: study)) { $0.inlinePresentationIntent = .emphasized })
            } else if let d = g(9) {
                out.append(styled(render(d, study: study)) { $0.strikethroughStyle = .single })
            } else if let mk = g(10) {
                out.append(styled(render(mk, study: study)) { $0.backgroundColor = Theme.lime.opacity(0.55) })
            } else if let text = g(12) {
                let bg: Color = switch g(11) {
                case "+": Theme.lime.opacity(0.45)
                case "!": Theme.pinkSoft
                case "~": Color.secondary.opacity(0.16)
                default: Theme.accentSoft
                }
                var pill = AttributedString("\u{2009}")
                pill.append(render(text, study: study))
                pill.append(AttributedString("\u{2009}"))
                pill.backgroundColor = bg
                pill.font = .footnote
                out.append(pill)
                out.append(AttributedString(" "))
            }
            rest = rest[m.range.upperBound...]
        }
        out.append(AttributedString(String(rest)))
        return out
    }

    private static func link(_ text: String, _ url: String) -> AttributedString {
        var a = AttributedString(text)
        a.link = URL(string: url)
        a.foregroundColor = Theme.accent
        return a
    }

    private static func styled(_ a: AttributedString, _ apply: (inout AttributeContainer) -> Void) -> AttributedString {
        var c = AttributeContainer()
        apply(&c)
        return a.mergingAttributes(c, mergePolicy: .keepCurrent)
    }
}
