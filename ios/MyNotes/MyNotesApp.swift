import SwiftUI

@main
struct MyNotesApp: App {
    @State private var study = Study()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(study)
                .tint(Theme.accent)
        }
    }
}

struct RootView: View {
    @Environment(Study.self) private var study
    @Environment(\.scenePhase) private var phase
    @State private var tab = 0

    var body: some View {
        TabView(selection: $tab) {
            HomeView().tabItem { Label("今天", systemImage: "sun.max") }.tag(0)
            RoadmapView().tabItem { Label("路线", systemImage: "map") }.tag(1)
            AlgoView().tabItem { Label("刷题", systemImage: "chevron.left.forwardslash.chevron.right") }.tag(2)
            NotesView().tabItem { Label("笔记", systemImage: "note.text") }.tag(3)
            MoreView().tabItem { Label("更多", systemImage: "ellipsis.circle") }.tag(4)
        }
        .task {
            if study.server.isEmpty { tab = 4 } else { await study.reload() }
        }
        .onChange(of: phase) { _, now in
            if now == .active, study.connected { Task { await study.reload() } }
        }
    }
}

/// Shown by data tabs until the first successful load.
struct NeedsServer: View {
    @Environment(Study.self) private var study

    var body: some View {
        if study.loading {
            ProgressView("连接中…")
        } else {
            ContentUnavailableView {
                Label("还没连上 MyNotes", systemImage: "wifi.exclamationmark")
            } description: {
                Text(study.error ?? "在「设置」里填写电脑上 MyNotes 服务的地址，例如 192.168.1.5:8080")
            } actions: {
                if !study.server.isEmpty {
                    Button("重试") { Task { await study.reload() } }
                }
            }
        }
    }
}

/// Inline error banner for failed mutations.
struct ErrorBanner: ViewModifier {
    @Environment(Study.self) private var study

    func body(content: Content) -> some View {
        content.safeAreaInset(edge: .top) {
            if let e = study.error, study.connected {
                Text(e)
                    .font(.footnote)
                    .frame(maxWidth: .infinity)
                    .padding(8)
                    .background(Theme.pinkSoft)
                    .onTapGesture { study.error = nil }
            }
        }
    }
}

extension View {
    func errorBanner() -> some View { modifier(ErrorBanner()) }
}
