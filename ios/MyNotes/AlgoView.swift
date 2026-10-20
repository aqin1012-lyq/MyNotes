import SwiftUI

struct AlgoView: View {
    @Environment(Study.self) private var study
    @AppStorage("algoSet") private var setId = ""
    @State private var query = ""

    var body: some View {
        NavigationStack {
            Group {
                if let algo = study.algo {
                    let set = algo.sets.first { $0.id == setId } ?? algo.sets[0]
                    let problems = algo.problems.filter { $0.set == set.id && matches($0) }
                    let solved = problems.filter { study.status($0.slug).solved }.count
                    List {
                        Section {
                            Picker("题单", selection: Binding(get: { set.id }, set: { setId = $0 })) {
                                ForEach(algo.sets) { Text($0.title).tag($0.id) }
                            }
                            Text(set.desc).font(.caption).foregroundStyle(.secondary)
                            HStack {
                                Text("已做出 \(solved)/\(problems.count)").font(.caption)
                                Bar(value: problems.isEmpty ? 0 : Double(solved) / Double(problems.count))
                            }
                        }
                        if query.isEmpty, !study.dueProblems.isEmpty {
                            Section("今日待复习（全部题单）") {
                                ForEach(study.dueProblems) { ProblemRow(problem: $0) }
                            }
                        }
                        ForEach(set.categories) { cat in
                            let items = problems.filter { $0.cat == cat.id }
                            if !items.isEmpty {
                                Section(cat.title) {
                                    ForEach(items) { ProblemRow(problem: $0) }
                                }
                            }
                        }
                    }
                    .searchable(text: $query, prompt: "题号或题名")
                } else {
                    NeedsServer()
                }
            }
            .navigationTitle("刷题")
            .refreshable { await study.reload() }
            .errorBanner()
        }
    }

    private func matches(_ p: Problem) -> Bool {
        query.isEmpty || p.label.localizedCaseInsensitiveContains(query) || p.slug.contains(query.lowercased())
    }
}

struct ProblemRow: View {
    @Environment(Study.self) private var study
    let problem: Problem

    var body: some View {
        let st = study.status(problem.slug)
        let (color, diff) = Theme.difficulty(problem.diff)
        NavigationLink { ProblemDetail(problem: problem) } label: {
            HStack {
                Text(problem.label).lineLimit(1)
                Spacer()
                Text(diff).font(.caption2).foregroundStyle(color)
                StatusPill(status: st)
            }
        }
        .swipeActions(edge: .leading) {
            Button("做对了") { Task { await study.addAttempt(slug: problem.slug, ac: true) } }.tint(Theme.limeLine)
        }
        .swipeActions(edge: .trailing) {
            Button("没做出") { Task { await study.addAttempt(slug: problem.slug, ac: false) } }.tint(Theme.pink)
        }
    }
}

struct StatusPill: View {
    let status: Study.AlgoStatus

    var body: some View {
        switch status.state {
        case .new: EmptyView()
        case .due: Pill(text: status.label, color: Theme.pinkSoft)
        case .retry: Pill(text: status.label, color: Theme.pinkSoft.opacity(0.6))
        case .learning: Pill(text: status.label)
        case .mastered: Pill(text: status.label, color: Theme.lime.opacity(0.6))
        }
    }
}

struct ProblemDetail: View {
    @Environment(Study.self) private var study
    let problem: Problem

    var body: some View {
        let st = study.status(problem.slug)
        List {
            Section {
                LabeledContent("难度", value: Theme.difficulty(problem.diff).1)
                LabeledContent("状态") { StatusPill(status: st); if st.state == .new { Text("未做") } }
                if let due = st.due { LabeledContent("下次复习", value: due) }
                if let s = problem.url, let url = URL(string: s) {
                    Link(destination: url) { Label("在力扣打开", systemImage: "safari") }
                }
            }
            Section {
                HStack {
                    Button { Task { await study.addAttempt(slug: problem.slug, ac: true) } } label: {
                        Label("做对了", systemImage: "checkmark").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.limeLine)
                    Button { Task { await study.addAttempt(slug: problem.slug, ac: false) } } label: {
                        Label("没做出", systemImage: "xmark").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(Theme.pink)
                }
            } footer: {
                Text("做错的次日重做；做对的按 \((study.algo?.review ?? []).map(String.init).joined(separator: "/")) 天复习，全部通过即掌握。")
            }
            Section("做题记录") {
                if st.tries.isEmpty { Text("还没做过").foregroundStyle(.secondary) }
                ForEach(st.tries.reversed()) { a in
                    HStack {
                        Text(a.date).font(.callout.monospacedDigit())
                        Spacer()
                        Text(a.result == "ac" ? "✓ 通过" : "✗ 未通过").foregroundStyle(a.result == "ac" ? Theme.limeLine : Theme.pink)
                    }
                    .swipeActions { Button("删除", role: .destructive) { Task { await study.deleteAttempt(a) } } }
                }
            }
            Section {
                NavigationLink { NoteDetail(id: "algo-\(problem.slug)", title: "刷题：\(problem.label)") } label: {
                    Label("刷题笔记", systemImage: "note.text")
                }
            }
        }
        .navigationTitle(problem.label)
        .navigationBarTitleDisplayMode(.inline)
        .errorBanner()
    }
}
