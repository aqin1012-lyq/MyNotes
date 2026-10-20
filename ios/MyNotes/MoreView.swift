import SwiftUI

/// 更多: the web pages that don't get their own tab, plus settings.
struct MoreView: View {
    @Environment(Study.self) private var study
    @State private var path: [Route] = []

    enum Route: Hashable { case journal, resources, principles, settings }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NavigationLink(value: Route.journal) { Label("学习日志", systemImage: "flame") }
                    NavigationLink(value: Route.resources) { Label("资料库", systemImage: "books.vertical") }
                    NavigationLink(value: Route.principles) { Label("原则与复盘", systemImage: "heart") }
                }
                Section {
                    NavigationLink(value: Route.settings) {
                        Label {
                            HStack {
                                Text("设置")
                                Spacer()
                                Text(study.connected ? "已连接" : "未连接").font(.caption)
                                    .foregroundStyle(study.connected ? Theme.limeLine : Theme.pink)
                            }
                        } icon: { Image(systemName: "gearshape") }
                    }
                }
            }
            .navigationTitle("更多")
            .navigationDestination(for: Route.self) { r in
                switch r {
                case .journal: study.connected ? AnyView(JournalView()) : AnyView(NeedsServer())
                case .resources: study.connected ? AnyView(ResourcesView()) : AnyView(NeedsServer())
                case .principles: study.connected ? AnyView(PrinciplesView()) : AnyView(NeedsServer())
                case .settings: SettingsView()
                }
            }
            .navigationDestination(for: String.self) { id in
                if let t = study.topic(id) { TopicDetail(topic: t) }
            }
            .onAppear { if study.server.isEmpty, path.isEmpty { path = [.settings] } }
        }
    }
}

/// Mirrors the web 学习日志: check in, heatmap, minutes per topic, every entry.
struct JournalView: View {
    @Environment(Study.self) private var study
    @State private var logging = false
    @State private var deleting: LogEntry?

    var body: some View {
        List {
            Section {
                Button { logging = true } label: { Label("打卡", systemImage: "plus.circle.fill") }
            } footer: {
                Text("每天花了多少时间、学了什么。保存在 study/log.tsv。")
            }
            Section("学习热力图") { Heatmap().padding(.vertical, 4) }
            Section("按主题累计") {
                let byTopic = study.log.reduce(into: [String: Int]()) { $0[$1.topicId, default: 0] += $1.minutes }
                    .sorted { $0.value > $1.value }
                if byTopic.isEmpty { Text("暂无记录").foregroundStyle(.secondary) }
                ForEach(byTopic, id: \.key) { id, min in
                    HStack {
                        if let t = study.topic(id) {
                            NavigationLink(value: id) { Text(t.title) }
                        } else {
                            Text("未关联").foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("\(hours(min)) h").monospacedDigit().foregroundStyle(.secondary)
                    }
                }
            }
            Section("记录") {
                if study.log.isEmpty { Text("还没有记录，今天就开始吧。").foregroundStyle(.secondary) }
                ForEach(study.log.reversed()) { e in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack {
                            Text(e.date).font(.caption.monospacedDigit())
                            Pill(text: "\(e.minutes) 分钟")
                            if let t = study.topic(e.topicId) { Pill(text: t.title, color: Theme.lime.opacity(0.5)) }
                        }
                        if !e.text.isEmpty { Text(e.text).font(.subheadline) }
                    }
                    .swipeActions { Button("删除", role: .destructive) { deleting = e } }
                }
            }
        }
        .navigationTitle("学习日志")
        .sheet(isPresented: $logging) { LogSheet() }
        .confirmationDialog("删除这条记录？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("删除", role: .destructive) { if let e = deleting { Task { await study.deleteLog(e) } } }
        }
        .refreshable { await study.reload() }
        .errorBanner()
    }
}

/// Mirrors the web 资料库: every topic's resources, filterable by text, type, stage and read state.
struct ResourcesView: View {
    @Environment(Study.self) private var study
    @State private var query = ""
    @State private var type = ""
    @State private var stage = ""
    @State private var done = ""

    struct Row: Identifiable { var id: String; var r: Resource; var topic: Topic; var stage: Stage }

    private var all: [Row] {
        (study.curriculum?.stages ?? []).flatMap { s in
            s.topics.flatMap { t in (t.resources ?? []).enumerated().map { Row(id: "\(t.id):r\($0)", r: $1, topic: t, stage: s) } }
        }
    }

    var body: some View {
        let rows = all
        let types = rows.map(\.r.type).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        let shown = rows.filter { row in
            (query.isEmpty || "\(row.r.t) \(row.topic.title)".localizedCaseInsensitiveContains(query))
                && (type.isEmpty || row.r.type == type) && (stage.isEmpty || row.stage.id == stage)
                && (done.isEmpty || study.isDone(row.id) == (done == "1"))
        }
        List {
            Section {
                ForEach(shown) { row in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            CheckRow(id: row.id, text: row.r.t)
                            if let url = URL(string: row.r.u) {
                                Link(destination: url) { Image(systemName: "arrow.up.right.square") }.buttonStyle(.borderless)
                            }
                        }
                        HStack(spacing: 6) {
                            Pill(text: row.r.type, color: Color.secondary.opacity(0.15))
                            NavigationLink(value: row.topic.id) { Text("\(row.topic.title) · \(row.stage.title)") }
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: {
                Text("\(shown.count) 条 · 全部 \(rows.count) 条，已读 \(rows.filter { study.isDone($0.id) }.count) 条")
            } footer: {
                Text("优先级：规范 / 官方文档 / 权威标准（OWASP、NIST、RFC）> 靶场 > 教程。")
            }
        }
        .searchable(text: $query, prompt: "搜索标题或主题")
        .navigationTitle("资料库")
        .toolbar {
            Menu {
                Picker("类型", selection: $type) {
                    Text("全部类型").tag("")
                    ForEach(types, id: \.self) { Text($0).tag($0) }
                }
                Picker("阶段", selection: $stage) {
                    Text("全部阶段").tag("")
                    ForEach(study.curriculum?.stages ?? []) { Text($0.title).tag($0.id) }
                }
                Picker("状态", selection: $done) {
                    Text("全部").tag("")
                    Text("未读").tag("0")
                    Text("已读").tag("1")
                }
            } label: {
                Label("筛选", systemImage: type.isEmpty && stage.isEmpty && done.isEmpty
                      ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
        }
        .errorBanner()
    }
}

/// Mirrors the web 原则与复盘.
struct PrinciplesView: View {
    @Environment(Study.self) private var study

    var body: some View {
        if let c = study.curriculum {
            List {
                Section("主线") {
                    Text(c.mission)
                    Text("目标身份：\(c.identity)").font(.caption).foregroundStyle(.secondary)
                    Text("要解决的不是“AI 更新这么快我该学什么”，而是“我要建立什么样的底层能力，让 AI 每一次进步都能帮我，而不是让我重新学一遍”。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("关键节点") {
                    ForEach(c.checkpoints) { cp in
                        NavigationLink { NoteDetail(id: cp.note, title: cp.title) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(cp.title).font(.headline)
                                let days = Day.until(cp.date)
                                Text("\(cp.date) · \(days >= 0 ? "还有 \(days) 天" : "已到期")").font(.caption).foregroundStyle(.secondary)
                                Text(cp.detail).font(.caption)
                                Text("写复盘笔记 →").font(.caption).foregroundStyle(Theme.accent)
                            }
                        }
                    }
                }
                Section("容易犯的错误") {
                    ForEach(c.pitfalls, id: \.self) { p in
                        Label { Text(p) } icon: { Image(systemName: "exclamationmark.bubble").foregroundStyle(Theme.pink) }
                    }
                }
                Section {
                    FlowPills(items: c.careers)
                } header: {
                    Text("可以关注的岗位")
                } footer: {
                    Text("路径：在职学习 → 公司内部找安全相关的活 → 做安全项目 → 把 Java + 安全写进简历 → 尝试安全相关岗位。不要裸辞。")
                }
                if let certs = c.certs, !certs.isEmpty {
                    Section("证书（不是主线，按目标岗位再决定）") {
                        ForEach(certs, id: \.self) { cert in
                            VStack(alignment: .leading, spacing: 2) {
                                if let url = URL(string: cert.u) { Link(cert.t, destination: url) } else { Text(cert.t) }
                                Text(cert.when).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("原则与复盘")
            .errorBanner()
        }
    }
}

/// Pills that wrap onto as many lines as needed.
struct FlowPills: View {
    let items: [String]

    var body: some View {
        FlowLayout(spacing: 6) {
            ForEach(items, id: \.self) { Pill(text: $0, color: Color.secondary.opacity(0.15)) }
        }
        .padding(.vertical, 4)
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews) {
            var x = bounds.minX
            for i in row.items {
                let s = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: .unspecified)
                x += s.width + spacing
            }
        }
    }

    private struct Row { var items: [Int] = []; var y: CGFloat; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows = [Row(y: 0)]
        for i in subviews.indices {
            let s = subviews[i].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty, rows[rows.count - 1].width + spacing + s.width > width {
                let last = rows[rows.count - 1]
                rows.append(Row(y: last.y + last.height + spacing))
            }
            rows[rows.count - 1].width += (rows[rows.count - 1].items.isEmpty ? 0 : spacing) + s.width
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, s.height)
            rows[rows.count - 1].items.append(i)
        }
        return rows
    }
}
