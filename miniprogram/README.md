# MyNotes · 微信小程序版

和网页版（`http://localhost:8080/`）内容一模一样：同一套路线图、讲义、题解、笔记模板和可爱图标。
小程序**不需要后端**：内容打包在代码里，每个用户的进度 / 笔记 / 日志 / 刷题记录只存在自己手机上（`wx.setStorage`），
和网页版的 `study/` 目录是两份互不相干的数据。线上 AppID：`wx54df40db10f89c35`。

## 运行

微信开发者工具 → 导入项目 → 选择本目录 `miniprogram/`。不需要启动 Spring Boot，也不用关域名校验。

## 内容从哪里来

内容在构建时从网页版生成，**改了内容要重新生成再上传**：

```sh
node tools/gen-app-json.mjs            # curriculum.js / algo.js → static/*.json
node tools/gen-miniprogram-content.mjs # static/ → 小程序里的 content/、pkg-lessons/、pkg-algo/
```

| 内容 | 生成到 | 所在包 |
|------|------|------|
| 路线、主题、项目、资料 | `content/curriculum.js` | 主包 |
| 题单 | `content/algo.js` | 主包 |
| 讲义 `lessons/*.md` | `pkg-lessons/lessons.js` | 分包，进「路线图」时预下载 |
| 题解 `algo/*.md` | `pkg-algo/solutions.js` | 分包，进「刷题」时预下载 |

每个包最多 2 MB，脚本快到上限时会报错。分包里的 `index` 页只是占位（分包必须至少有一个页面），讲义和题解通过 `require.async` 加载。

## 数据存在哪里

`utils/api.js` 在本机存储上实现了网页版 `/api/study` 的同一套接口（逻辑对照 `StudyStore.java`），页面代码不用关心数据在哪：

| key | 内容 |
|------|------|
| `progress` | `{ itemId: 完成日期 }` |
| `log` | `[{ date, minutes, topicId, text }]` |
| `algo` | `[{ date, slug, result }]` |
| `notes` | `{ id: updatedAt }`，笔记索引 |
| `note:<id>` | 笔记正文（单个 key 最多 1 MB，所以每篇单独存） |

每个用户共 10 MB。「更多 → 我的数据」显示用量，并可以导出全部笔记（复制成 Markdown，或存成 `.md` 文件发到聊天）。

## 和网页版的对应关系

| 网页版 `app.js` | 小程序 |
|------|------|
| `markdown()` / `inline()` | `utils/markdown.js`，解析成块和行内 token，交给 `components/md` 渲染 |
| `ICONS` / `EMOJI_ICONS` | `utils/icons.js`，原样复制，渲染成 SVG data URI |
| `NOTE_TEMPLATES` | `utils/templates.js`，原样复制 |
| 进度、刷题复习、笔记分类 | `utils/store.js` |
| `#/topic/...` 等链接 | `utils/nav.js` 映射到页面 |

手机上的几处不同：
- 外部链接（力扣、资料）点击后复制到剪贴板，因为小程序不能直接打开网页
- 笔记编辑器用「编辑 / 预览」切换，代替网页版的分栏
- 底部 5 个标签：仪表盘 / 路线图 / 刷题 / 笔记 / 更多（项目、资料库、学习日志、原则与复盘、我的数据）

底部标签栏的图标由 `node tools/gen-miniprogram-tabbar.mjs` 从同一套可爱图标生成（需要 macOS 的 `sips`）。
