## 为什么要学

DNS 是 [[net-trace]] 全链路的第一环：浏览器、你的 Spring Boot、IoT 设备，在连接任何域名前都要先问 DNS“这个名字对应哪个 IP”。它看起来只是个“查电话簿”的服务，但安全方向里 DNS 出现的频率非常高：SSRF 绕过（DNS rebinding）、子域名接管、钓鱼域名、DNS 劫持、邮件伪造（SPF/DMARC 都放在 DNS 里）、以及恶意软件用 DNS 做数据外带。

对 Java 后端来说，DNS 也是很多“玄学问题”的根源：JVM 会缓存解析结果，切换 IP 后服务迟迟连不上新地址；K8s 里 Service 名称解析慢；车联网设备在运营商网络下解析到奇怪的 IP。理解 DNS 能让你把这些问题说清楚。

学完这一课，你应该能用 `dig` 追踪任意域名的解析路径，看懂常见记录类型，并解释 DNS 投毒、DNS rebinding、子域名接管的原理和防御。

## 核心概念

### 1. 递归解析器 vs 权威服务器，根 → TLD → 权威

DNS 里有两种角色：

- **递归解析器**（recursive resolver）：替客户端“跑腿”，一路问到答案并缓存。比如运营商 DNS、公司内网 DNS、`8.8.8.8`、`1.1.1.1`、K8s 里的 CoreDNS。你的电脑和 JVM 只问它（这一步叫“递归查询”）。
- **权威服务器**（authoritative server）：真正持有某个区域（zone）记录的服务器，比如你在云厂商 DNS 控制台里配置的记录就放在权威服务器上。它只回答自己负责的域，不替别人查。

递归解析器没有缓存时，按层级**迭代**查询：

```
stub(Java/OS) --> resolver : www.shop.example.com A ?
resolver --> root(.)       : ask me about .com -> NS a.gtld-servers.net
resolver --> TLD(.com)     : ask example.com   -> NS ns1.example-dns.net
resolver --> auth(example) : www.shop... A     -> 203.0.113.10, TTL 300
resolver --> stub          : 203.0.113.10       <- 结果缓存 300 秒
```

根服务器地址是内置在解析器里的（root hints）。每一层都只告诉你“下一层该问谁”（referral），直到权威服务器给出最终答案。

### 2. 常见记录：A / AAAA / CNAME / MX / TXT / NS

| 记录 | 作用 | 示例 | 安全关注点 |
|---|---|---|---|
| `A` | 域名 → IPv4 | `api.example.com. 300 IN A 203.0.113.10` | 被篡改即流量被劫持 |
| `AAAA` | 域名 → IPv6 | `api.example.com. IN AAAA 2001:db8::10` | SSRF 过滤只考虑 IPv4 会被 `::1` 等绕过 |
| `CNAME` | 别名，指向另一个域名 | `static.example.com. IN CNAME xxx.cdn-provider.net.` | 目标资源被删除后形成悬空 CNAME（子域名接管） |
| `MX` | 该域的邮件服务器 | `example.com. IN MX 10 mail.example.com.` | 钓鱼、邮件伪造 |
| `TXT` | 任意文本 | `v=spf1 include:_spf.example.net -all` | SPF、DMARC、域名所有权验证都放这里 |
| `NS` | 该区域由哪些权威服务器负责 | `example.com. IN NS ns1.example-dns.net.` | NS 被改等于整个域被接管 |

几个细节：CNAME 不能和同名的其他记录共存（所以根域 `example.com` 一般不能直接设 CNAME，云厂商用各自的“别名/ALIAS”功能解决）。另有 `CAA` 记录可指定哪些 CA 可以为本域签发证书，`PTR` 用于反向解析（IP → 域名）。

**SPF**（TXT，`v=spf1 ...`）声明哪些服务器可以代表本域发信；**DMARC**（TXT，放在 `_dmarc.example.com`）告诉收件方 SPF/DKIM 校验失败时怎么处理（`p=none` 只报告，`quarantine` 进垃圾箱，`reject` 拒收）。没有配置时，别人更容易冒充你的域名发钓鱼邮件。

### 3. TTL 与缓存；DNS 投毒、DNS 劫持

每条记录都带 **TTL**（秒），表示解析器可以缓存多久。缓存分布在多层：浏览器、操作系统、**JVM**、递归解析器。TTL 越长，查询越少、越快，但改 IP 后生效越慢。

JVM 有自己的缓存，由 `java.security` 里的 `networkaddress.cache.ttl` 控制（JDK 17 在未设置且没有安全管理器时，默认缓存成功结果 30 秒；失败结果由 `networkaddress.cache.negative.ttl` 控制，默认 10 秒）。可以在启动时用 `-Dsun.net.inetaddr.ttl=60` 或在代码最早处 `java.security.Security.setProperty("networkaddress.cache.ttl", "60")` 调整。**注意 JVM 的缓存不遵从 DNS 记录本身的 TTL**，这正是 DNS rebinding 需要考虑的细节。

**DNS 投毒（缓存投毒）**：攻击者向递归解析器注入伪造的响应，让它缓存错误的记录，所有使用这个解析器的用户都会被导向攻击者的 IP。经典做法是在权威服务器的真实响应到达之前，抢先发送大量伪造的 UDP 响应并猜中 16 位的事务 ID；Kaminsky 在 2008 年公开的手法让这种攻击变得实用，之后解析器普遍引入**源端口随机化**，把需要猜的空间扩大。根本解决方案是 DNSSEC。

**DNS 劫持**是更宽泛的说法：只要解析结果被人为改掉都算，例如改本机 `hosts`、入侵家用路由器改 DNS 设置、恶意 Wi-Fi 下发假 DNS、运营商在 NXDOMAIN 时返回广告页、盗取域名注册商账号改 NS 记录。其中注册商账号被盗的危害最大，因为攻击者控制了权威数据，还能借此申请合法证书（见 [[net-trace]] 中“攻击者控制了 DNS，TLS 还能保护你吗”）。

### 4. DNS rebinding 与子域名接管（悬空 CNAME）

**DNS rebinding** 的本质：**同一个域名，第一次解析和第二次解析得到不同的 IP**，而攻击者控制着这个域名的权威服务器，可以随意返回、并把 TTL 设为 0。它有两种典型用法：

- **绕过浏览器同源策略**：受害者访问 `evil.example`（公网 IP），页面脚本稍后再请求同一个域名，此时解析成 `192.168.1.1`，浏览器认为是“同源”，脚本就能读受害者内网设备（路由器、IoT 网关、本机 `127.0.0.1` 上的开发服务）的响应。防御是内网服务**校验 Host 头**并要求认证。
- **绕过 SSRF 防护**：见下面的问题。

**问题：为什么 SSRF 防护“先解析域名再判断 IP”仍然可能被绕过？**

因为“检查”和“使用”是**两次独立的解析**（TOCTOU，检查时刻与使用时刻不一致）：

```
guard : resolve rebind.evil.test -> 93.184.216.34   (public, OK)   <- 校验通过
client: resolve rebind.evil.test -> 127.0.0.1       (TTL=0)        <- 真正发请求时
client: GET http://127.0.0.1/admin ...                              <- SSRF 成功
```

本仓库 Lab 05 的 `SecurePreviewController` 注释里就明确写了这个“故意保留的缺口”：`SsrfGuard` 用 `InetAddress.getAllByName()` 解析并检查，之后 `HttpClient` 又解析一次。JVM 默认缓存 30 秒会让两次解析大概率命中缓存、得到同一个结果，但这是巧合而不是保证（缓存可能恰好过期，或者有人把 TTL 设成 0），不能当作防御。正确思路是**把校验过的 IP 固定下来，用这个 IP 去连接**（同时用原域名做 Host 头和 TLS 的 SNI/证书校验），或者在出口代理/网络层统一拦截内网地址。另外，重定向也要逐跳重新校验。

**子域名接管**：你给 `promo.example.com` 配了 `CNAME promo-bucket.some-cloud.net`，活动结束后删除了云上的 bucket / 站点，却忘了删 CNAME。只要该云平台允许任何人注册同名资源，攻击者注册 `promo-bucket` 就能在 `promo.example.com` 下发布任意内容：钓鱼页面、窃取作用域为 `.example.com` 的 Cookie、借你的域名信誉绕过白名单。防御：**先删 DNS 记录，再删云资源**；定期盘点所有 CNAME 指向的目标是否仍然存在。

### 5. DoH / DoT / DNSSEC 分别解决什么问题

传统 DNS 是明文 UDP：路径上的人**能看到**你查了什么，也**能改**响应。这三个技术针对不同问题：

| 技术 | 做法 | 解决 | 不解决 |
|---|---|---|---|
| DoT（DNS over TLS） | 客户端到解析器走 TLS，TCP 853 端口 | 最后一公里的窃听和篡改 | 解析器本身撒谎；端口独特，易被识别和封锁 |
| DoH（DNS over HTTPS） | DNS 报文放在 HTTPS 里，443 端口 | 同上，且与普通 HTTPS 流量混在一起 | 同上；企业安全设备也更难监控 |
| DNSSEC | 权威数据用签名保护，从根逐级建立信任链 | 数据**真实性和完整性**：伪造或投毒的记录验签失败 | 不加密，别人仍能看到你查了什么 |

一句话：**DoT/DoH 保护“传输通道”（隐私 + 防路径篡改），DNSSEC 保护“数据本身”（防伪造）**，两者互补。DNSSEC 需要域名所有者签名、解析器验证才有效，部署并不普遍。另外，DoH 对防守方有两面性：恶意软件也可以用 DoH 绕过企业 DNS 监控。

## 动手实践

:::warn 授权
DNS 投毒、rebinding 之类的攻击只能在自己的环境或获得授权的目标上实验；查询公开记录本身没有问题。
:::

### 实践 1：用 dig +trace 追踪完整解析路径

macOS 自带 `dig`。`+trace` 会让 dig 自己扮演递归解析器，从根开始逐级迭代：

```
dig +trace www.example.com
```

示例输出（节选；签名记录已省略，权威服务器名称、IP、耗时仅作示意，每个域名都不同）：

```
.                  518400  IN  NS  a.root-servers.net.
.                  518400  IN  NS  b.root-servers.net.
;; Received 525 bytes from 192.168.1.1#53(192.168.1.1) in 12 ms

com.               172800  IN  NS  a.gtld-servers.net.
com.               172800  IN  NS  b.gtld-servers.net.
;; Received 1170 bytes from 198.41.0.4#53(a.root-servers.net) in 180 ms

example.com.       172800  IN  NS  ns1.example-dns.net.
example.com.       172800  IN  NS  ns2.example-dns.net.
;; Received 330 bytes from 192.5.6.30#53(a.gtld-servers.net) in 200 ms

www.example.com.   300     IN  A   203.0.113.10
;; Received 60 bytes from 198.51.100.53#53(ns1.example-dns.net) in 35 ms
```

怎么读：

- 每一段对应一层：第 1 段从本机配置的解析器拿到根服务器列表；第 2 段根服务器说“`.com` 去问 gtld-servers”；第 3 段 `.com` 的 TLD 服务器说“`example.com` 去问它的 NS”；最后一段权威服务器给出 A 记录。
- `;; Received ... from X` 告诉你这一段的答案是**谁**给的，这是排查“NS 配置错误”“解析结果被篡改”时最有用的一行。
- 每行的第二列是 TTL。NS 记录 TTL 通常较长，业务 A 记录常设几分钟。
- 如果最后是 `CNAME`，继续看它指向的域名是否还能解析，这正是检查悬空 CNAME 的方法（例如结果为 `NXDOMAIN`，就要警惕）。
- 对比不加 `+trace` 的 `dig www.example.com`：它问的是你的递归解析器，响应头里的 `flags: qr rd ra` 中 `ra` 表示解析器支持递归，而 `ANSWER SECTION` 里的 TTL 会随缓存时间减少。加 `@8.8.8.8` 可以指定解析器，对比不同解析器的结果能发现劫持。

### 实践 2：用 dig 查询 TXT 记录，找 SPF / DMARC

选一个你熟悉的、有企业邮箱的域名（比如你公司的域名），依次查询：

```
dig +short TXT example.com
dig +short TXT _dmarc.example.com
dig +short MX example.com
```

示例输出（内容仅作示意）：

```
"v=spf1 include:_spf.mail-provider.example ip4:203.0.113.0/24 -all"
"google-site-verification=..."
"v=DMARC1; p=reject; rua=mailto:dmarc-reports@example.com"
10 mx1.mail-provider.example.
```

怎么读：

- SPF 以 `v=spf1` 开头。`include:` 引用邮件服务商的 SPF，`ip4:` 列出允许发信的网段。结尾的 `-all` 表示“其他来源一律失败”（严格），`~all` 是软失败，`?all` 等于没声明，`+all` 表示允许任何人发信，是严重错误。
- 一个域名应该只有**一条** SPF 记录，多条会导致校验出错。
- DMARC 在 `_dmarc` 子域上。`p=none` 只收报告不拦截，适合刚上线时观察；稳定后应逐步改为 `quarantine` / `reject`。`rua` 是汇总报告的接收地址。
- 其他 TXT 记录往往是各种平台的域名所有权验证，能从中推断这家公司用了哪些 SaaS。这也是攻击者做信息收集时会看的内容。

## 攻击者视角

- **信息收集**：子域名枚举（证书透明度日志、字典爆破、搜索引擎），查 TXT/MX 推断技术栈，尝试区域传送 `dig AXFR example.com @ns1...`（配置错误的权威服务器会把整个 zone 交出来）。
- **子域名接管**：批量找 CNAME 指向已失效云资源的子域名，注册同名资源后挂钓鱼页或窃取父域 Cookie。
- **SSRF 绕过**：用 DNS rebinding 服务或“解析到内网 IP 的域名”绕过只检查字符串的黑名单；还有 `127.0.0.1` 的各种写法（十进制 `2130706433`、IPv6 `::ffff:127.0.0.1`）。
- **劫持与钓鱼**：盗取注册商账号改 NS；注册形近域名（`examp1e.com`）配合钓鱼邮件，目标域名没有 DMARC 时还可以直接冒充发件人。
- **DNS 隧道/外带**：在被控机器上把数据编码进子域名（`<data>.attacker.test`），即便出站只放行 DNS，查询也会被递归解析器转发到攻击者的权威服务器。盲注和无回显的 RCE 常用这种方式确认漏洞。

## 防御与最佳实践

- 域名注册商、云 DNS 控制台账号开启 MFA，开启注册商锁；设置 `CAA` 记录限制可签发证书的 CA，并监控证书透明度日志。
- 资源下线顺序：**先删 DNS 记录，再释放云资源**；定期扫描所有 CNAME 目标。
- 权威服务器禁止对外区域传送；不对公网开放递归解析（防反射放大）。
- 邮件域配置 SPF（`-all`）、DKIM、DMARC，逐步收紧到 `p=reject`。
- SSRF 防护：解析一次、校验所有返回的 IP（含 IPv6），**用校验过的 IP 建立连接**，禁止或逐跳校验重定向；更稳妥的是让服务端出站流量走统一代理，由网络层阻断内网网段。
- 内网服务防 rebinding：校验 `Host` 头只接受预期的域名，并且一律要求认证，不要因为“只在内网”就不设防。
- JVM 按需设置 `networkaddress.cache.ttl`：太长会导致故障切换慢，设为 0 则每次都查询、增加延迟。
- 监控 DNS 日志：异常长的随机子域名、对新注册域名的大量查询，往往是隧道或恶意软件的迹象。

## 常见误区

- “DNSSEC 会加密 DNS”：不会，它只负责签名。加密靠 DoT/DoH。
- “用了 HTTPS 就不用管 DNS”：DNS 被控制后攻击者可能申请到合法证书，至少也能让你的服务不可用。
- “删掉云资源就算下线完成”：留下的 CNAME 就是子域名接管的入口。
- “SSRF 校验了域名解析结果就安全”：检查和使用是两次解析，存在 rebinding 窗口。
- “改完 DNS 马上生效”：要等各层缓存过期，其中包括 JVM 自己的缓存。

## 自测

:::details 1. 递归解析器和权威服务器有什么区别？
递归解析器替客户端逐级查询并缓存结果，客户端只和它交互；权威服务器持有某个区域的原始记录，只回答自己负责的域名。
:::

:::details 2. 没有缓存时，解析 www.example.com 要经过哪几层？
本机 → 递归解析器 → 根服务器（告知 .com 的 NS）→ .com TLD 服务器（告知 example.com 的 NS）→ example.com 权威服务器（给出 A 记录）→ 递归解析器缓存并返回。
:::

:::details 3. 为什么 SSRF 防护“先解析域名再判断 IP”仍然可能被绕过？
因为校验时的解析和真正发请求时的解析是两次独立操作。攻击者控制的权威服务器可以设 TTL=0，第一次返回公网 IP 通过校验，第二次返回 127.0.0.1 或内网 IP（DNS rebinding）。应把校验过的 IP 固定用于连接，或在网络层/出口代理拦截内网地址。
:::

:::details 4. 什么是悬空 CNAME？怎么防？
子域名的 CNAME 指向的云资源已被删除，但 DNS 记录还在，攻击者注册同名资源即可接管该子域名。防御是下线时先删 DNS 记录，并定期检查 CNAME 目标是否存在。
:::

:::details 5. DoH、DoT、DNSSEC 各解决什么问题？
DoT/DoH 加密客户端到解析器的通道，防窃听和路径篡改；DNSSEC 给记录签名，防伪造和投毒，但不加密。
:::

:::details 6. SPF 记录结尾的 -all 和 ~all 有什么区别？DMARC 放在哪里？
`-all` 表示未列出的来源一律失败，`~all` 是软失败。DMARC 是 `_dmarc.<域名>` 上的 TXT 记录，`p=` 指定校验失败时的处理策略。
:::

:::details 7. 改了 A 记录，为什么 Java 服务还连着旧 IP？
除了递归解析器和操作系统的缓存，JVM 还会按 `networkaddress.cache.ttl` 缓存解析结果；此外，已建立的长连接（连接池）也不会因为 DNS 变化而重连。
:::

## 一句话总结

DNS 把名字变成 IP，但它的答案来自网络、会被缓存、可能被篡改或被“换绑”：用 DNSSEC/DoH 保护数据和通道，管好注册商账号和 CNAME，SSRF 防护要固定已校验的 IP，而不是信任第二次解析。
