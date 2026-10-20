import SwiftUI

struct SettingsView: View {
    @Environment(Study.self) private var study
    @State private var draft = ""

    var body: some View {
        Form {
                Section {
                    TextField("192.168.1.5:8080", text: $draft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(connect)
                    Button(study.loading ? "连接中…" : "保存并连接", action: connect)
                        .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || study.loading)
                } header: {
                    Text("MyNotes 服务器")
                } footer: {
                    Text("在电脑上运行 MyNotes（./mvnw spring-boot:run），手机和电脑连同一个 WiFi，填电脑的局域网 IP 和端口。电脑的 IP 可以在「系统设置 → Wi-Fi → 详细信息」里看到。")
                }

                Section("状态") {
                    if study.connected {
                        Label("已连接", systemImage: "checkmark.circle.fill").foregroundStyle(Theme.limeLine)
                        LabeledContent("主题", value: "\(study.topics.count)")
                        LabeledContent("已完成项", value: "\(study.progress.count)")
                        LabeledContent("学习记录", value: "\(study.log.count)")
                        LabeledContent("笔记", value: "\(study.notes.count)")
                    } else if let e = study.error {
                        Label(e, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.pink)
                    } else {
                        Text("未连接").foregroundStyle(.secondary)
                    }
                }

                if study.connected, let base = try? study.api().base {
                    Section("导出") {
                        Link("Markdown 打包（ZIP）", destination: base.appending(path: "api/export/markdown"))
                        Link("JSON 全量数据", destination: base.appending(path: "api/export/json"))
                    }
                }

                if let c = study.curriculum {
                    Section("关于") {
                        Text(c.identity).font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        .navigationTitle("设置")
        .onAppear { draft = study.server }
    }

    private func connect() {
        study.server = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { await study.reload() }
    }
}
