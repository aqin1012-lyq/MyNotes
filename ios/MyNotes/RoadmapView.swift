import SwiftUI

struct RoadmapView: View {
    @Environment(Study.self) private var study

    var body: some View {
        NavigationStack {
            Group {
                if let c = study.curriculum {
                    List {
                        Section { Text(c.mission).font(.subheadline) }
                        ForEach(c.stages) { stage in
                            let s = study.stats(stage)
                            Section {
                                ForEach(stage.topics) { t in
                                    NavigationLink(value: t.id) { TopicRow(topic: t) }
                                }
                            } header: {
                                HStack {
                                    Text(stage.title)
                                    Spacer()
                                    Text("\(stage.from) – \(stage.to) · \(Int(s.ratio * 100))%")
                                }
                            }
                        }
                        Section("项目") {
                            ForEach(c.projects) { p in
                                NavigationLink { ProjectDetail(project: p) } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(p.title)
                                        Text(p.period).font(.caption).foregroundStyle(.secondary)
                                        Bar(value: study.stats(Study.projectItems(p)).ratio)
                                    }
                                }
                            }
                        }
                        Section("检查点") {
                            ForEach(c.checkpoints) { cp in
                                NavigationLink { NoteDetail(id: cp.note, title: cp.title) } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        HStack { Text(cp.title); Spacer(); Text(cp.date).font(.caption.monospacedDigit()) }
                                        Text(cp.detail).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    .navigationDestination(for: String.self) { id in
                        if let t = study.topic(id) { TopicDetail(topic: t) }
                    }
                } else {
                    NeedsServer()
                }
            }
            .navigationTitle("学习路线")
            .refreshable { await study.reload() }
            .errorBanner()
        }
    }
}

struct TopicRow: View {
    @Environment(Study.self) private var study
    let topic: Topic

    var body: some View {
        let s = study.stats(topic)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(topic.title)
                Spacer()
                Text(topic.month).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Bar(value: s.ratio)
        }
        .padding(.vertical, 2)
    }
}

/// A checkbox row bound to one progress item id.
struct CheckRow: View {
    @Environment(Study.self) private var study
    let id: String
    let text: String

    var body: some View {
        let done = study.isDone(id)
        Button {
            Task { await study.setDone(id, !done) }
        } label: {
            HStack(alignment: .firstTextBaseline) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? Theme.limeLine : .secondary)
                Text(text).foregroundStyle(.primary).strikethrough(done, color: .secondary)
                Spacer()
                if let d = study.progress[id] { Text(d).font(.caption2.monospacedDigit()).foregroundStyle(.secondary) }
            }
        }
        .buttonStyle(.plain)
    }
}

struct TopicDetail: View {
    @Environment(Study.self) private var study
    let topic: Topic
    @State private var logging = false

    var body: some View {
        List {
            Section {
                if let stage = study.stage(of: topic) {
                    Text("\(stage.title) · 计划 \(topic.month)").font(.caption).foregroundStyle(.secondary)
                }
                Text(topic.summary)
                let s = study.stats(topic)
                HStack {
                    Bar(value: s.ratio)
                    Text("\(s.done)/\(s.total)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                if let lab = topic.lab {
                    LabeledContent("对应实验笔记", value: "docs/labs/\(lab)").font(.caption)
                }
            }
            Section {
                NavigationLink { LessonView(topic: topic) } label: {
                    Label("讲义", systemImage: "book")
                }
                CheckRow(id: Study.lessonItem(topic), text: "我已读完这篇讲义，并能用自己的话讲出来")
            }
            Section("知识点") {
                ForEach(Array(topic.points.enumerated()), id: \.offset) { i, p in CheckRow(id: "\(topic.id):k\(i)", text: p) }
            }
            if let practice = topic.practice, !practice.isEmpty {
                Section("动手实践") {
                    ForEach(Array(practice.enumerated()), id: \.offset) { i, p in CheckRow(id: "\(topic.id):p\(i)", text: p) }
                }
            }
            if let qs = topic.questions, !qs.isEmpty {
                Section("思考题") {
                    ForEach(qs, id: \.self) { Text($0) }
                }
            }
            if let res = topic.resources, !res.isEmpty {
                Section("资料") {
                    ForEach(Array(res.enumerated()), id: \.offset) { i, r in
                        HStack {
                            CheckRow(id: "\(topic.id):r\(i)", text: r.t)
                            if let url = URL(string: r.u) {
                                Link(destination: url) { Image(systemName: "arrow.up.right.square") }
                                    .buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
            Section {
                NavigationLink { NoteDetail(id: topic.id, title: topic.title) } label: {
                    Label("主题笔记", systemImage: "note.text")
                }
                Button { logging = true } label: { Label("记录一次学习", systemImage: "clock.badge.checkmark") }
            }
            pager
        }
        .navigationTitle(topic.title)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $logging) { LogSheet(topicId: topic.id) }
        .errorBanner()
    }

    /// Previous / next topic across all stages, like the web pager.
    @ViewBuilder
    private var pager: some View {
        let all = study.topics
        if let i = all.firstIndex(where: { $0.id == topic.id }) {
            Section {
                if i > 0 {
                    NavigationLink { TopicDetail(topic: all[i - 1]) } label: { Label("上一个：\(all[i - 1].title)", systemImage: "chevron.backward") }
                }
                if i + 1 < all.count {
                    NavigationLink { TopicDetail(topic: all[i + 1]) } label: { Label("下一个：\(all[i + 1].title)", systemImage: "chevron.forward") }
                }
            }
        }
    }
}

struct ProjectDetail: View {
    @Environment(Study.self) private var study
    let project: Project

    var body: some View {
        List {
            Section {
                LabeledContent("周期", value: project.period)
                LabeledContent("技术栈", value: project.stack)
                if let link = project.link { LabeledContent("位置", value: link) }
                Bar(value: study.stats(Study.projectItems(project)).ratio)
            }
            Section("里程碑") {
                ForEach(Array(project.milestones.enumerated()), id: \.offset) { i, m in
                    CheckRow(id: "\(project.id):m\(i)", text: m)
                }
            }
            Section {
                NavigationLink { NoteDetail(id: "project-\(project.id)", title: project.title) } label: {
                    Label("项目笔记", systemImage: "note.text")
                }
            }
        }
        .navigationTitle(project.title)
        .navigationBarTitleDisplayMode(.inline)
        .errorBanner()
    }
}
