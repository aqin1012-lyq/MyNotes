# Lab 06 - 文件上传与路径穿越

代码：`src/main/java/com/aqin/mynotes/lab/l06upload/`

功能背景：给笔记上传附件（`/upload`），再按文件名下载回来（`/files`）。
两个危险的用户输入：文件**名**（上传和下载都可能被 `../` 穿越）和文件**内容**（伪装成图片的脚本）。

## 1. 攻击复现

上传和下载都用临时目录：漏洞版 `${TMPDIR}/mynotes-vuln-uploads`，修复版 `${TMPDIR}/mynotes-secure-uploads`。

```bash
# ① 路径穿越读任意文件：先建一个“机密”，再从上传目录往上跳读它
echo 'db.password=hunter2' > "${TMPDIR:-/tmp}/secret.txt"
curl -F 'file=@pom.xml;filename=seed.txt' localhost:8080/vuln/l06/upload   # 先建出上传目录
curl 'localhost:8080/vuln/l06/files?name=../secret.txt'                    # 读到 hunter2
curl 'localhost:8080/secure/l06/files?name=../secret.txt'                  # 400

# ② 上传时穿越，把文件写到上传目录之外
curl -F 'file=@pom.xml;filename=../pwned.txt' localhost:8080/vuln/l06/upload   # 落到上一级目录
curl -F 'file=@pom.xml;filename=../pwned.txt' localhost:8080/secure/l06/upload # 用随机名保存，穿越无效

# ③ 把脚本伪装成图片上传
printf '<%% Runtime.getRuntime().exec("id"); %%>' > avatar.png
curl -F 'file=@avatar.png' localhost:8080/vuln/l06/upload     # 原样存下
curl -F 'file=@avatar.png' localhost:8080/secure/l06/upload   # 400：magic 不是 PNG
```

> `-F 'file=@本地文件;filename=想伪造的名字'` 让 curl 用你指定的名字上传，这就是攻击者改文件名的方式。

## 2. 修复做了什么（`UploadGuard` + `SecureUploadController`）

| 防线 | 挡住了什么 |
|------|-----------|
| 扩展名**白名单**（不是黑名单） | `.jsp` / `.jspx` / `.phtml` / `.svg` 等一串写不完的可执行/可渲染类型 |
| 校验 **magic bytes** 与扩展名一致 | 把脚本改名成 `.png` 上传 |
| 存成**自己的随机 UUID 文件名** | 上传时文件名里的 `../`（名字根本不落地） |
| 存在 **Web 根目录之外**，只经下载接口读 | 直接用 URL 访问上传的 WebShell |
| 下载用 `normalize()` + `startsWith()` 校验 | 下载时 `../../../../etc/passwd` |
| 下载响应加 `Content-Disposition: attachment` + `nosniff` | 浏览器把 `.html`/`.svg` 当页面渲染，在本站源里执行脚本 |
| 解压用同一套 `resolveInside` + 条目数/总大小上限 | Zip Slip（压缩包里 `../` 条目）、zip bomb |

**核心那一行**：路径穿越的根治不是“检查文件名里有没有 `..`”（编码、绝对路径、`a/../../` 都能绕过），而是
`base.resolve(name).normalize()` 之后判断 `startsWith(base)`——把用户输入解析成真实路径，再确认它没跳出去。

## 3. 问题

- [ ] 只校验 `Content-Type`（请求头里的 MIME）为什么不够？它由谁提供？
- [ ] 为什么扩展名要用白名单而不是黑名单？黑名单会漏掉哪些？
- [ ] `normalize()` 之前和之后 `../` 有什么区别？为什么必须先 normalize 再 startsWith？
- [ ] 校验了扩展名和 magic，为什么还要用随机文件名 + 存到 Web 根之外？（提示：解析漏洞、覆盖已有文件、软链接）
- [ ] 下载接口为什么要强制 `attachment` 下载而不是内联？`.svg` 为什么危险？
- [ ] Zip Slip 和普通路径穿越是同一个根因吗？为什么解压要单独防？
- [ ] 对象存储（OBS/S3）直传时，预签名 URL 的有效期、方法（PUT）、路径前缀该怎么限制？
- [ ] 回到 [[net-trace]] 全链路：这个漏洞发生在哪一环？和 [[web-ssrf]]、[[web-access]] 有什么关系？

## 4. 心得

