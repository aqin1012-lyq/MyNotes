import SwiftUI

struct NotesView: View {
    @Environment(Study.self) private var study
    @AppStorage("noteKind") private var kindFilter = ""
    @AppStorage("noteSort") private var sort = "updated"
    @State private var query = ""
    @State private var results: [NoteSummary]?
    @State private var creating = false
    @State private var opening: NewNote?
    @State private var renaming: String?
    @State private var deleting: String?

    struct NewNote: Hashable { var id: String; var template: String? }

    var body: some View {
        NavigationStack {
            Group {
                if study.connected { list } else { NeedsServer() }
            }
            .navigationTitle("笔记")
            .refreshable { await study.refreshNotes() }
            .errorBanner()
        }
    }

    private var shown: [NoteSummary] {
        let all = (results ?? study.notes).filter { kindFilter.isEmpty || study.kind($0.id).rawValue == kindFilter }
        switch sort {
        case "title": return all.sorted { study.noteTitle($0.id).localizedStandardCompare(study.noteTitle($1.id)) == .orderedAscending }
        case "length": return all.sorted { $0.length > $1.length }
        default: return all
        }
    }

    private var list: some View {
        List {
            Section {
                ForEach(shown) { n in
                    NavigationLink(value: NewNote(id: n.id, template: nil)) { NoteRow(note: n) }
                        .swipeActions {
                            Button("删除", role: .destructive) { deleting = n.id }
                            if study.renamable(n.id) {
                                Button("重命名") { renaming = n.id }.tint(Theme.accent)
                            }
                        }
                }
            } header: {
                Text("\(shown.count) 篇")
            }
        }
        .overlay {
            if shown.isEmpty {
                ContentUnavailableView(query.isEmpty && kindFilter.isEmpty ? "还没有笔记" : "没有匹配的笔记", systemImage: "note.text")
            }
        }
        .searchable(text: $query, prompt: "全文搜索：标题、id、正文")
        .task(id: query) {
            guard !query.isEmpty else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
            results = try? await study.searchNotes(query)
        }
        .navigationDestination(for: NewNote.self) { NoteDetail(id: $0.id, template: $0.template) }
        .navigationDestination(item: $opening) { NoteDetail(id: $0.id, template: $0.template) }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { filterMenu }
            ToolbarItem(placement: .primaryAction) {
                Button { creating = true } label: { Label("新建", systemImage: "square.and.pencil") }
            }
        }
        .sheet(isPresented: $creating) {
            NewNoteSheet { id, tpl in
                // an existing id just opens that note; a new one is created from the template right away
                opening = NewNote(id: id, template: study.notes.contains { $0.id == id } ? nil : tpl)
            }
        }
        .sheet(item: Binding(get: { renaming.map { RenameTarget(id: $0) } }, set: { renaming = $0?.id })) { RenameSheet(id: $0.id) }
        .confirmationDialog("删除笔记「\(deleting.map(study.noteTitle) ?? "")」？", isPresented: Binding(
            get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("删除", role: .destructive) { if let id = deleting { Task { await study.deleteNote(id) } } }
        } message: {
            Text("文件会从 study/notes 删除；提交过的话可以从 git 恢复")
        }
    }

    private var filterMenu: some View {
        Menu {
            Picker("类型", selection: $kindFilter) {
                Text("全部类型（\(study.notes.count)）").tag("")
                ForEach(NoteKind.allCases) { k in
                    Text("\(k.label)（\(study.notes.filter { study.kind($0.id) == k }.count)）").tag(k.rawValue)
                }
            }
            Picker("排序", selection: $sort) {
                Text("最近更新").tag("updated")
                Text("按标题").tag("title")
                Text("按字数").tag("length")
            }
        } label: {
            Label("筛选", systemImage: kindFilter.isEmpty ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
        }
    }

    struct RenameTarget: Identifiable { var id: String }
}

struct NoteRow: View {
    @Environment(Study.self) private var study
    let note: NoteSummary

    var body: some View {
        let kind = study.kind(note.id)
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Pill(text: kind.label, color: kind.color)
                Text(study.noteTitle(note.id)).font(.headline).lineLimit(1)
            }
            if let s = note.snippet ?? note.excerpt, !s.isEmpty {
                Text(Inline.render(s.replacing(/\{\{[^}]*…$/, with: "…"), study: study))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            Text("\(note.id) · \(Self.when(note.updatedAt)) · \(note.length) 字")
                .font(.caption2.monospaced()).foregroundStyle(.tertiary)
        }
    }

    static func when(_ iso: String) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return String(iso.prefix(10)) }
        return d.formatted(date: .numeric, time: .shortened)
    }
}

/// Pick a template and an id — same as the web's 新建笔记 form.
struct NewNoteSheet: View {
    @Environment(Study.self) private var study
    @Environment(\.dismiss) private var dismiss
    let create: (String, String) -> Void
    @State private var template = "study"
    @State private var id = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("模板") {
                    Picker("模板", selection: $template) {
                        ForEach(study.templates) { Text($0.label).tag($0.key) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                    .onChange(of: template) { _, key in
                        if id.isEmpty, let t = study.templates.first(where: { $0.key == key }), let s = study.suggestedId(t) { id = s }
                    }
                }
                Section {
                    TextField("笔记 id，如 spring-security-filter", text: $id)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: {
                    Text(study.notes.contains { $0.id == id } ? "这个 id 已经有笔记了，会直接打开" : "只能用小写字母、数字和 -")
                }
            }
            .navigationTitle("新建笔记")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("新建并编辑") { create(id, template); dismiss() }.disabled(!Note.validId(id))
                }
            }
        }
    }
}

struct RenameSheet: View {
    @Environment(Study.self) private var study
    @Environment(\.dismiss) private var dismiss
    let id: String
    var onRenamed: (String) -> Void = { _ in }
    @State private var newId = ""
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("新 id", text: $newId).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: {
                    Text("把笔记「\(study.noteTitle(id))」的 id 改成")
                } footer: {
                    Text(failure ?? "只能用小写字母、数字和 -").foregroundStyle(failure == nil ? Color.secondary : Theme.pink)
                }
            }
            .navigationTitle("重命名")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("确定") {
                        Task {
                            do {
                                try await study.renameNote(id, to: newId.lowercased())
                                onRenamed(newId.lowercased())
                                dismiss()
                            } catch {
                                failure = error.localizedDescription
                            }
                        }
                    }
                    .disabled(newId.isEmpty || newId == id)
                }
            }
            .onAppear { newId = id }
        }
        .presentationDetents([.medium])
    }
}

/// View / edit one markdown note. Saves 0.8 s after typing stops and when leaving, like the web editor.
/// A missing note opens with its starter template, which is only written once you edit it —
/// or right away when `template` is set (the note was explicitly created via 新建).
struct NoteDetail: View {
    @Environment(Study.self) private var study
    @Environment(\.scenePhase) private var phase
    @Environment(\.dismiss) private var dismiss
    let id: String
    var title: String?
    var template: String?

    @State private var saved: String?
    @State private var text = ""
    @State private var editing = false
    @State private var loaded = false
    @State private var status = ""
    @State private var failure: String?
    @State private var currentId = ""
    @State private var renaming = false
    @State private var deleting = false
    @State private var userEdited = false

    private var dirty: Bool { userEdited && text != (saved ?? "") }

    var body: some View {
        Group {
            if !loaded {
                ProgressView()
            } else if editing {
                TextEditor(text: $text)
                    .font(.system(.body, design: .monospaced))
                    .padding(.horizontal, 8)
                    .onChange(of: text) { userEdited = true; status = "编辑中…" }
            } else {
                ScrollView { MarkdownView(text: text, lazy: true).padding() }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if loaded, !status.isEmpty {
                Text(status).font(.caption2).foregroundStyle(failure == nil ? Color.secondary : Theme.pink)
                    .frame(maxWidth: .infinity).padding(4).background(.bar)
            }
        }
        .navigationTitle(title ?? study.noteTitle(currentId))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if loaded {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button(editing ? "预览" : "编辑") { editing.toggle() }
                    Menu {
                        if study.renamable(currentId) {
                            // flush pending edits before the file moves
                            Button { Task { if dirty { await save() }; renaming = true } } label: { Label("重命名", systemImage: "pencil") }
                        }
                        Button(role: .destructive) { deleting = true } label: { Label("删除笔记", systemImage: "trash") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
        }
        .sheet(isPresented: $renaming) {
            RenameSheet(id: currentId) { currentId = $0 }
        }
        .confirmationDialog("删除这篇笔记？", isPresented: $deleting, titleVisibility: .visible) {
            Button("删除", role: .destructive) {
                Task {
                    await study.deleteNote(currentId)
                    userEdited = false
                    dismiss()
                }
            }
        } message: { Text("文件会从 study/notes 删除；提交过的话可以从 git 恢复") }
        .task { await load() }
        .task(id: text) {
            // debounce: a new keystroke cancels this task before it saves
            guard dirty else { return }
            try? await Task.sleep(for: .milliseconds(800))
            if !Task.isCancelled { await save() }
        }
        .onChange(of: phase) { _, now in if now != .active, dirty { Task { await save() } } }
        .onDisappear { if dirty { Task { await save() } } }
    }

    private func load() async {
        guard !loaded else { return }
        currentId = id
        do {
            if let file = try await study.note(id) {
                saved = file.content
                text = file.content
                status = "上次保存 \(NoteRow.when(file.updatedAt))"
                editing = template != nil
            } else {
                text = study.starter(for: id, template: template)
                editing = true
                status = "尚未保存"
            }
        } catch {
            failure = error.localizedDescription
            status = "加载失败：\(error.localizedDescription)"
        }
        loaded = true
        if saved == nil, template != nil, failure == nil {
            userEdited = true // explicitly created: write the template now
            await save()
        }
    }

    private func save() async {
        let content = text
        do {
            saved = try await study.saveNote(currentId, content: content).content
            failure = nil
            status = "已保存 \(Date.now.formatted(date: .omitted, time: .standard))"
        } catch {
            failure = error.localizedDescription
            status = "保存失败：\(error.localizedDescription)"
        }
    }
}
