# Lab 05 - SSRF

代码：`src/main/java/com/aqin/mynotes/lab/l05ssrf/`

功能背景：笔记里贴一个图片 URL，服务端去抓取并生成预览。
靶子：`FakeMetadataController` 模拟云厂商的元数据服务（真实地址是 `169.254.169.254`），只有本机能访问，返回一组“临时密钥”。

## 1. 攻击复现

```bash
# ① 拿云元数据里的密钥：服务器替你访问了它自己才能访问的地址
curl 'localhost:8080/vuln/l05/preview?url=http://127.0.0.1:8080/internal/l05/latest/meta-data/iam/security-credentials/mynotes-role'
curl 'localhost:8080/secure/l05/preview?url=http://127.0.0.1:8080/internal/l05/latest/meta-data/iam/security-credentials/mynotes-role'   # 400

# ② 绕过“字符串黑名单”：2130706433 就是 127.0.0.1
curl 'localhost:8080/vuln/l05/preview?url=http://2130706433:8080/internal/l05/latest/meta-data/iam/security-credentials/mynotes-role'

# ③ 换协议读本地文件
curl 'localhost:8080/vuln/l05/preview?url=file:///etc/hosts'
curl 'localhost:8080/secure/l05/preview?url=file:///etc/hosts'   # 400
```

> 本机开了系统代理（Clash 等）时，② 可能返回 502：请求被 Java 交给了代理，而不是直接连本机。`SsrfTests` 里临时关掉了代理，原因见测试注释。
> 这个现象本身也值得想一想：服务端出网流量经过谁，SSRF 就能打到谁。

## 2. 修复做了什么（`SsrfGuard` + `SecurePreviewController`）

| 防线 | 挡住了什么 |
|------|-----------|
| 只允许 `http` / `https` | `file:`、`jar:`、`ftp:`、`gopher:` |
| 只允许 80 / 443 端口 | 把预览功能当成内网端口扫描器 |
| 禁止 userinfo（`http://a@b/`） | 人眼与解析器对“主机是谁”理解不一致 |
| **解析域名后**校验每个 IP 是否属于内网段 | `localhost`、`2130706433`、`[::ffff:127.0.0.1]`、指向 127.0.0.1 的域名 |
| 不跟随重定向 | 外部 URL 302 到 `169.254.169.254` |
| 校验 `Content-Type: image/*`，限制大小，超时 | 把功能拿来当通用代理、拖慢服务 |
| 只返回元数据，不回显内容 | 把“盲 SSRF”变成“数据泄露” |

**故意留下的缺口：DNS rebinding。** `SsrfGuard` 解析一次域名，`HttpClient` 连接时又解析一次。攻击者的 DNS 可以第一次答公网 IP、第二次答 `127.0.0.1`。
应用层很难彻底解决，真正的解法在网络层：

- 出网统一走代理（如 Smokescreen），由代理在**连接时**校验目标 IP
- 容器 / K8s 的 NetworkPolicy、安全组禁止访问内网与元数据地址
- 云上开启 IMDSv2（需要先 PUT 拿 token，简单的 GET 型 SSRF 拿不到密钥）

## 3. 问题

- [ ] 为什么 SSRF 在云上的危害远大于在机房里？IMDSv2 具体挡住了哪一步？
- [ ] 为什么“检查 URL 字符串里有没有 127.0.0.1”一定会被绕过？列出至少 5 种写法
- [ ] 解析后校验 IP 为什么还会被 DNS rebinding 绕过？怎么在连接时校验？
- [ ] 为什么要禁止重定向，而不是“重定向后再校验一次”？（提示：`HttpURLConnection` 默认会跟随同协议重定向）
- [ ] 白名单（只允许自家 CDN 域名）和黑名单（禁止内网段）各适合什么场景？
- [ ] Webhook、PDF 生成、Office 文档解析、XXE、AI Agent 的 fetch 工具——这些地方的 SSRF 入口分别在哪？
- [ ] 回到 `net-trace` 全链路图：SSRF 发生在哪一环？

## 4. 心得

