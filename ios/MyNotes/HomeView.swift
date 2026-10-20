import SwiftUI

/// Mirrors the web 仪表盘.
struct HomeView: View {
    @Environment(Study.self) private var study
    @State private var logging = false

    var body: some View {
        NavigationStack {
            Group {
                if study.connected { content } else { NeedsServer() }
            }
            .navigationTitle("今天")
            .toolbar {
                if study.connected {
                    Button { logging = true } label: { Label("打卡", systemImage: "plus.circle") }
                }
            }
            .sheet(isPresented: $logging) { LogSheet() }
            .refreshable { await study.reload() }
            .errorBanner()
        }
    }

    private var content: some View {
        List {
            if let c = study.curriculum {
                Section { Text(c.mission).font(.subheadline).foregroundStyle(.secondary) }
                Section { tiles(c) }
            }

            if let stage = study.currentStage {
                Section("当前阶段：\(stage.title)") {
                    VStack(alignment: .leading, spacing: 6) {
                        Pill(text: "\(stage.from) ~ \(stage.to)")
                        Text(stage.goal).font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let next = study.nextTopic {
                        NavigationLink(value: next.id) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("下一个未完成主题").font(.caption).foregroundStyle(.secondary)
                                Text(next.title).font(.headline)
                                Text("\(study.stage(of: next)?.title ?? "") · 计划 \(next.month) · \(Int(study.stats(next).ratio * 100))%")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Text("🎉 全部主题已完成")
                    }
                    if let cp = study.nextCheckpoint {
                        NavigationLink { NoteDetail(id: cp.note, title: cp.title) } label: {
                            Text("下一个节点：\(cp.title)（\(cp.date)，还有 \(Day.until(cp.date)) 天）").font(.caption)
                        }
                    }
                }
            }

            Section("过去 26 周学习热力图") { Heatmap().padding(.vertical, 4) }

            if !study.dueProblems.isEmpty {
                Section("今日待复习") {
                    ForEach(study.dueProblems) { p in ProblemRow(problem: p) }
                }
            }

            Section("各阶段进度") {
                ForEach(study.curriculum?.stages ?? []) { s in
                    let st = study.stats(s)
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(s.title)
                            if s.id == study.currentStage?.id { Pill(text: "当前", color: Theme.lime.opacity(0.6)) }
                            Spacer()
                            Text("\(Int(st.ratio * 100))% · \(st.done)/\(st.total)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        Bar(value: st.ratio)
                    }
                }
            }

            Section("最近的笔记") {
                if study.notes.isEmpty { Text("还没有笔记。打开任意一个主题开始写吧。").foregroundStyle(.secondary) }
                ForEach(study.notes.prefix(6)) { n in
                    NavigationLink { NoteDetail(id: n.id) } label: { NoteRow(note: n) }
                }
            }
        }
        .navigationDestination(for: String.self) { id in
            if let t = study.topic(id) { TopicDetail(topic: t) }
        }
    }

    private func tiles(_ c: Curriculum) -> some View {
        let all = study.stats(study.topics.flatMap(Study.topicItems))
        let knowledge = study.stats(study.topics.flatMap { t in t.points.indices.map { "\(t.id):k\($0)" } })
        let projects = study.stats(c.projects.flatMap(Study.projectItems))
        let total = study.log.reduce(0) { $0 + $1.minutes }
        let weekAgo = Day.add(Day.today, -6)
        let week = study.log.filter { $0.date >= weekAgo }.reduce(0) { $0 + $1.minutes }
        let problems = study.algo?.problems ?? []
        let solved = problems.filter { study.status($0.slug).solved }.count
        return LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 14) {
            Tile(label: "总进度", value: "\(Int(all.ratio * 100))%", sub: "\(all.done) / \(all.total) 项")
            Tile(label: "知识点", value: "\(knowledge.done)", sub: "共 \(knowledge.total) 个")
            Tile(label: "项目里程碑", value: "\(projects.done)", sub: "共 \(projects.total) 个")
            Tile(label: "累计学习", value: hours(total), sub: "小时 · 近 7 天 \(week) 分钟")
            Tile(label: "刷题", value: "\(solved)/\(problems.count)", sub: study.dueProblems.isEmpty ? "去刷题" : "今日待复习 \(study.dueProblems.count) 题")
            Tile(label: "连续打卡", value: "\(study.streak)", sub: "天")
        }
        .padding(.vertical, 4)
    }
}

func hours(_ min: Int) -> String { String(format: min >= 600 ? "%.0f" : "%.1f", Double(min) / 60) }

struct Tile: View {
    let label: String
    let value: String
    let sub: String

    var body: some View {
        VStack(spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.bold().monospacedDigit()).lineLimit(1).minimumScaleFactor(0.6)
            Text(sub).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center).lineLimit(2)
        }
        .frame(maxWidth: .infinity)
    }
}

struct LogSheet: View {
    @Environment(Study.self) private var study
    @Environment(\.dismiss) private var dismiss
    var topicId: String?
    @State private var date = Date.now
    @State private var minutes = 60
    @State private var topic = ""
    @State private var text = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                DatePicker("日期", selection: $date, in: ...Date.now, displayedComponents: .date)
                Stepper("时长：\(minutes) 分钟", value: $minutes, in: 5...1440, step: 5)
                Picker("主题", selection: $topic) {
                    Text("（不关联主题）").tag("")
                    ForEach(study.curriculum?.stages ?? []) { s in
                        Section(s.title) {
                            ForEach(s.topics) { t in Text(t.title).tag(t.id) }
                        }
                    }
                }
                TextField("今天学了什么 / 做了哪个实验", text: $text, axis: .vertical).lineLimit(3...6)
            }
            .navigationTitle("打卡")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("打卡") {
                        saving = true
                        Task {
                            await study.addLog(date: Day.string(date), minutes: minutes, topicId: topic.isEmpty ? nil : topic, text: text)
                            dismiss()
                        }
                    }
                    .disabled(saving)
                }
            }
            .onAppear { topic = topicId ?? study.nextTopic?.id ?? "" }
        }
        .presentationDetents([.medium, .large])
    }
}
