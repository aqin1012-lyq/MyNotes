import SwiftUI

/// lessons/<topic>.md with a table of contents, reading time, and the "已读完" checkbox at the end.
struct LessonView: View {
    @Environment(Study.self) private var study
    let topic: Topic

    @State private var text: String?
    @State private var missing = false
    @State private var failure: String?

    var body: some View {
        Group {
            if let text {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            Text(meta(text)).font(.caption).foregroundStyle(.secondary)
                            MarkdownView(text: text, lazy: true)
                            Divider()
                            CheckRow(id: Study.lessonItem(topic), text: "我已读完这篇讲义，并能用自己的话讲出来")
                                .padding(.vertical, 8)
                        }
                        .padding()
                    }
                    .toolbar {
                        let toc = MarkdownView.toc(text)
                        if !toc.isEmpty {
                            Menu {
                                ForEach(toc, id: \.0) { anchor, title in
                                    Button(title) { withAnimation { proxy.scrollTo(anchor, anchor: .top) } }
                                }
                            } label: { Label("目录", systemImage: "list.bullet") }
                        }
                    }
                }
            } else if missing {
                ContentUnavailableView("这篇讲义还在编写中", systemImage: "book.closed",
                                       description: Text("先看知识点、实践和权威资料吧。"))
            } else if let failure {
                ContentUnavailableView {
                    Label("讲义加载失败", systemImage: "exclamationmark.triangle")
                } description: { Text(failure) } actions: {
                    Button("重试") { Task { await load() } }
                }
            } else {
                ProgressView("加载中…")
            }
        }
        .navigationTitle("讲义 · \(topic.title)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        failure = nil
        do {
            text = try await study.lesson(topic.id)
            missing = text == nil
        } catch {
            failure = error.localizedDescription
        }
    }

    /// Same estimate as the web: non-blank chars, 400 a minute.
    private func meta(_ s: String) -> String {
        let chars = s.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) }.count
        return String(format: "约 %.1f 千字 · 阅读约 %d 分钟", (Double(chars) / 100).rounded() / 10, max(1, Int((Double(chars) / 400).rounded())))
    }
}
