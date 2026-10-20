# MyNotes · iOS 版

SwiftUI 写的 iPhone / iPad App（iOS 17+），**连接电脑上运行的 MyNotes 服务**，读写的就是 `study/` 下那份数据：
在手机上勾的进度、记的日志、写的笔记，和网页版完全同步，提交到 git 一样是备份。

> 和[微信小程序版](../miniprogram/README.md)的区别：小程序不需要后端，数据各存各的；iOS 版必须连到你的 MyNotes 服务，数据和网页版共用一份。

## 功能

和网页版一一对应，用同一套接口（`/api/study/**`）、同一套进度 id 和刷题复习规则：

| 页签 | 内容 |
|------|------|
| 今天 | 网页「仪表盘」：总进度、知识点、里程碑、累计学习、刷题、连续打卡；下一个主题和节点；26 周学习热力图；各阶段进度；最近笔记 |
| 路线 | 路线图 → 主题：**讲义**（带目录、阅读时长）、知识点 / 实践 / 资料勾选、思考题、主题笔记、上一个 / 下一个；项目里程碑；检查点 |
| 刷题 | 题单切换、搜索、右滑「做对了」/ 左滑「没做出」，按 1/3/7/14/30/60 天间隔复习，做题记录与刷题笔记 |
| 笔记 | 全文搜索、按类型筛选和排序、7 种模板新建、重命名、删除；编辑时停止输入 0.8 秒**自动保存** |
| 更多 | 学习日志（打卡、热力图、按主题累计）、资料库（按类型 / 阶段 / 已读筛选）、原则与复盘、设置 |

笔记和讲义用的是网页版同一套 Markdown 规则：`:::tip` / `:::warn` / `:::note` / `:::card` / `:::details` / `:::fold` 容器、
`{{标签}}`、`==高亮==`、`[[progress:N]]`，`[[topic-id]]` 和 `[[algo:slug]]` 可以点开。

## 代码结构

| 文件 | 作用 |
|------|------|
| `API.swift` | 请求服务器、中文错误提示（连不上 / 端口被别的服务占用 / 没给本地网络权限） |
| `Study.swift` | 全部状态和派生数据：进度统计、当前阶段、刷题复习、连续打卡 |
| `NoteKinds.swift` | 笔记类型、标题、能否重命名、空笔记的起始模板（规则同 `app.js`） |
| `MarkdownView.swift` | Markdown 渲染，对应 `app.js` 的 `markdown()` / `inline()` |
| `*View.swift` | 各个页面 |

内容（`curriculum.json`、`algo.json`、`templates.json`、`lessons/*.md`）都是运行时从服务器读的，App 里不存副本。
改了 `curriculum.js` / `algo.js` / `app.js` 里的笔记模板之后，运行一次 `node tools/gen-app-json.mjs` 重新生成 JSON 即可，不用重新安装 App。

## 安装到 iPhone

### 1. 启动服务，让手机能访问

`application.properties` 里默认只监听 `127.0.0.1`。手机要连，就在启动时临时放开（`/vuln/**` 实验接口由 `LocalOnlyLabsFilter` 挡住，局域网访问一律 404）：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw spring-boot:run "-Dspring-boot.run.arguments=--server.port=8090 --server.address=0.0.0.0"
```

> 注意：学习数据接口**没有登录验证**，服务开着时，同一网络里的任何设备都能读写你的笔记。用完就关掉。

### 2. 签名并安装

1. 用 Xcode 打开 `ios/MyNotes.xcodeproj` → Settings → Accounts 登录 Apple ID（免费账号即可）。
2. TARGETS → MyNotes → Signing & Capabilities → Team 选你的 Personal Team。
3. 数据线连上 iPhone，在 Xcode 里选它，按 ⌘R。
4. 手机上：打开「设置 → 隐私与安全性 → 开发者模式」；首次打开 App 时在「设置 → 通用 → VPN 与设备管理」里信任开发者。

**没装 iOS 模拟器时**，Xcode 会提示「iOS xx is not installed」，不让在界面里运行。可以改用命令行编译和安装，不需要下载平台组件：

```bash
xcodebuild -project ios/MyNotes.xcodeproj -target MyNotes -sdk iphoneos \
  -allowProvisioningUpdates SYMROOT=/tmp/mynotes-build build
xcrun devicectl list devices                     # 找到手机的 Identifier
xcrun devicectl device install app --device <Identifier> /tmp/mynotes-build/Debug-iphoneos/MyNotes.app
```

免费账号签名的 App **7 天后失效**，到期重新执行一遍即可。

### 3. 连接

打开 App → 「更多 → 设置」，填电脑的局域网地址和端口，如 `192.168.1.5:8090`（查地址：`ipconfig getifaddr en0`；
用 iPhone 热点或数据线共享网络时，用 `route -n get default` 看当前网卡）。弹出「允许访问本地网络」时点允许。

## 关于图标

工程里的素材目录在没有 iOS 模拟器运行时的机器上无法编译（连真机编译也不行），所以图标目前用 `Info.plist` 直接声明
`MyNotes/AppIcon*.png`；原素材目录放在 `ios/Assets.xcassets`，不参与编译。
装好模拟器运行时、或者要提交 TestFlight / App Store 时，把它挪回 `ios/MyNotes/`，
并在 Build Settings 里恢复 `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon`。
