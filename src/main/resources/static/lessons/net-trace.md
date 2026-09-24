## 为什么要学

你写了 6 年 Java 后端，对 `@RestController` 里发生的事情了如指掌，但一个请求在到达 `DispatcherServlet` 之前走过了哪些路，很多人其实说不清：域名怎么变成 IP？TCP 连接由谁发起？TLS 证书校验在哪一步？Nginx 给你加了什么请求头？这些“框架之外”的环节，恰恰是攻击者最喜欢的地方。

这一课是整个第一年的**主线图**：浏览器 → DNS → TCP → TLS → HTTP → Nginx → Spring Boot → MySQL。后面学到的每一个漏洞，都可以挂在这条链的某一环上：DNS 劫持在第 2 环，中间人在 TLS 那一环，HTTP 请求走私在 Nginx 与应用之间，SQL 注入在应用与数据库之间，SSRF 则是让你的服务器反过来当“浏览器”，把整条链再走一遍。

学完这一课，你应该能做到三件事：

- 看到任何一个请求，能在白板上画出它的完整时序图。
- 对每一跳说出：用什么协议、什么端口、谁是客户端谁是服务端、哪些数据是不可信的。
- 对每一跳至少说出一种攻击，以及 Java/Spring/Nginx 这边该怎么防。

:::tip 学习方法
这一课是“地图”，不求每个协议讲透。每个环节的细节分别在 [[net-dns]]、[[net-tcp]]、[[net-tls]]、[[net-http]]、[[net-infra]] 里展开。先建立全局观，再逐个深入。
:::

## 核心概念

### 1. 全链路时序图

假设你在浏览器输入 `https://shop.example.com/api/orders?id=42`，后端是 Nginx 反向代理 + Spring Boot + MySQL。一次“冷启动”（没有任何缓存、没有复用连接）的访问大致如下：

```
Browser       DNS resolver     Nginx(443)      Spring Boot(8080)   MySQL(3306)
  |               |                |                  |                 |
  |-- A? shop --->|                |                  |                 |   DNS 查询（UDP 53，解析器可能再递归问根/顶级域/权威）
  |<- 203.0.113.10|                |                  |                 |
  |                                |                  |                 |
  |------ SYN -------------------->|                  |                 |   TCP 三次握手
  |<----- SYN-ACK -----------------|                  |                 |
  |------ ACK -------------------->|                  |                 |
  |                                |                  |                 |
  |-- ClientHello (SNI=shop...) -->|                  |                 |   TLS 握手
  |<- ServerHello + Certificate ---|                  |                 |   浏览器校验证书链和域名
  |-- Finished ------------------->|                  |                 |
  |                                |                  |                 |
  |== GET /api/orders?id=42 ======>|                  |                 |   HTTP，在 TLS 里加密
  |                                |-- GET + XFF ---->|                 |   Nginx -> 应用，加上 X-Forwarded-For (XFF) 头，通常是明文 HTTP
  |                                |                  |-- SELECT ... -->|   JDBC / MySQL 协议
  |                                |                  |<-- rows --------|
  |                                |<-- 200 JSON -----|                 |
  |<== 200 JSON ===================|                  |                 |
```

几个要点：

- DNS 在最前面，它决定了“你连的是谁”。浏览器、操作系统、本地 hosts 文件、路由器、运营商解析器都可能有缓存。
- TCP 握手是 1 个往返（RTT），TLS 1.3 完整握手再加 1 个 RTT，TLS 1.2 需要 2 个 RTT。之后才轮到 HTTP 请求。
- Nginx 是 TLS 的终点（TLS 终止）。Nginx 到 Spring Boot 是一条**新的** TCP 连接，内网里常常是明文 HTTP。
- Spring Boot 到 MySQL 又是一条独立连接，一般由连接池（如 HikariCP）预先建好并复用，走 MySQL 自己的协议。
- 所以“一个请求”其实跨了至少三段独立的连接，每一段都有自己的客户端和服务端。

### 2. 每一跳的协议、端口、客户端与服务端

| 每一跳 | 协议 | 端口 | 客户端→服务端 | 信任边界 | 典型攻击 | 对应主题 |
|---|---|---|---|---|---|---|
| 域名解析 | DNS | UDP 53（大响应或区域传送用 TCP 53；DoH 用 443） | 浏览器/OS → 递归解析器 → 权威服务器 | 解析结果来自网络，可被伪造或篡改 | DNS 劫持、缓存投毒、DNS 重绑定 | [[net-dns]] |
| 建立连接 | TCP | 目标 443（客户端用随机高位端口） | 浏览器 → Nginx | 源 IP 可能被伪造（仅限不需要握手完成的攻击） | SYN Flood、端口扫描 | [[net-tcp]] |
| 加密通道 | TLS | 443 | 浏览器 → Nginx | 证书是否可信、域名是否匹配 | 中间人、降级、伪造证书 | [[net-tls]] |
| 应用请求 | HTTP/1.1 或 HTTP/2 | 443（在 TLS 内） | 浏览器 → Nginx | URL、头、Cookie、Body 全部由客户端控制 | XSS、CSRF、参数篡改、越权 | [[net-http]] [[web-xss]] [[web-access]] |
| 反向代理 | HTTP（常为明文） | 例如 8080 | Nginx → Spring Boot | 应用收到的头有一部分由代理添加，一部分是客户端原样透传 | HTTP 请求走私、伪造 X-Forwarded-For、Host 头攻击 | [[net-infra]] |
| 业务处理 | Java 代码 | 进程内 | Spring Boot 内部 | 参数、Token、上传内容都不可信 | SSRF、反序列化、Token 伪造 | [[web-ssrf]] [[net-token]] |
| 数据访问 | MySQL 协议 | 3306 | Spring Boot → MySQL | SQL 中拼接的用户输入 | SQL 注入 | [[web-sqli]] |

注意“客户端/服务端”是相对的：Nginx 对浏览器是服务端，对 Spring Boot 是客户端；Spring Boot 对 Nginx 是服务端，对 MySQL 是客户端。做 SSRF 时，Spring Boot 又会变成去访问别人的“客户端”。

### 3. 信任边界：哪些数据来自不可信的一方

**信任边界**就是“数据从我控制不了的一方进入我控制的一方”的那条线。判断原则很简单：**凡是经过客户端之手的数据，都不可信**，不论它看起来多“底层”。

- DNS 响应：来自网络，除非有 DNSSEC 校验或走加密 DNS，否则路径上的人可以改。
- TCP 源 IP：完成三次握手的连接，源 IP 基本可信（伪造的 IP 收不到 SYN-ACK）；但经过代理后，你看到的是代理的 IP。
- TLS：证书校验通过，才能相信“对面确实是这个域名的持有者”，但它**不能**证明请求内容是善意的。
- HTTP：请求行、所有请求头（包括 `Host`、`Referer`、`User-Agent`、`X-Forwarded-For`）、Cookie、Body 全部由客户端决定。前端校验只是体验，不是安全。
- Nginx → Spring Boot：只有**你的 Nginx 明确设置/覆盖**的头才可信；Nginx 默认会把客户端发来的其他头原样转发。
- Spring Boot → MySQL：数据库本身在你的信任域内，但 SQL 语句里的用户输入仍是外部数据。
- 反方向也有边界：数据库里存的内容，可能是某个用户之前提交的（存储型 XSS 的来源）。

### 4. 每一跳至少一种攻击

- **DNS 劫持 / 缓存投毒**：让 `shop.example.com` 解析到攻击者的 IP。可能发生在本机 hosts、被入侵的家用路由器、恶意 Wi-Fi、或被投毒的递归解析器。
- **DNS 重绑定**：同一个域名先解析到公网 IP 通过校验，再解析到 `127.0.0.1` 或内网地址，常用来绕过 SSRF 的域名/IP 白名单（见 [[web-ssrf]]）。
- **SYN Flood**：大量只发 SYN 不回 ACK，耗尽服务端半连接队列。Linux 的 SYN Cookie 是经典缓解手段（见 [[net-tcp]]）。
- **中间人（MITM）**：在明文 HTTP 下可以直接读写流量；在 HTTPS 下，需要让受害者接受一张伪造证书，或者在用户首次以 `http://` 访问时拦截（SSL Stripping，HSTS 就是为此设计的）。
- **HTTP 请求走私**：前端代理和后端服务器对 `Content-Length` 与 `Transfer-Encoding` 的解析不一致，导致一个请求被“切”成两个，后一个混进别人的请求里。
- **头部伪造**：伪造 `X-Forwarded-For` 绕过 IP 限流或白名单，伪造 `Host` 投毒密码重置链接。
- **应用层漏洞**：越权（[[web-access]]，本仓库 Lab 04 IDOR）、SSRF（Lab 05）、XSS（Lab 02）。
- **SQL 注入**：用户输入被拼进 SQL（[[web-sqli]]，本仓库 Lab 01）。

### 5. 问题一：攻击者控制了 DNS，TLS 还能保护你吗？

**大多数情况下能，前提是证书校验没被破坏。** DNS 只决定“连到哪个 IP”，而 TLS 握手时服务器必须出示一张由受信任 CA 签发、且域名与浏览器请求的域名匹配的证书，还要证明自己持有对应私钥。攻击者把你指到他的服务器上，但他拿不出 `shop.example.com` 的合法证书和私钥，浏览器就会报证书错误并阻止访问。

但保护有几个前提，任何一个失效就不行了：

- 用户不能无视证书警告点“继续访问”；启用了 HSTS 的站点，浏览器会直接不给“继续”的选项。
- 必须一开始就是 HTTPS。若用户输入的是 `http://`，攻击者可以在明文阶段就截住（SSL Stripping）。HSTS（及 HSTS 预加载）用来堵这个口。
- 客户端代码不能关闭校验。Java 里自定义一个“信任所有证书”的 `TrustManager` 或关闭主机名校验，等于把 TLS 的这层保护扔掉。
- 攻击者不能拿到合法证书。如果攻击者控制了 DNS，而某家 CA 用基于 DNS 的方式（如 ACME 的 DNS-01 挑战）或 HTTP-01 挑战（请求会被解析到攻击者的服务器）验证域名所有权，攻击者就**可能为该域名申请到真证书**。这也是 CAA 记录、证书透明度（CT）日志监控存在的原因。
- 设备里没有被装入恶意根证书（企业代理、恶意软件常这么做）。

另外，TLS 保护不了“连不上”：DNS 被控制后，攻击者至少可以让你的服务不可用。

### 6. 问题二：Nginx 传给 Spring Boot 的 X-Forwarded-For 能信吗？

**要看 Nginx 怎么配，默认心态是“不能直接信”。** `X-Forwarded-For`（XFF）是一个普通请求头，客户端可以随意发送。常见配置 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` 的含义是：**在客户端发来的 XFF 后面追加**真实的连接 IP（`$remote_addr`）。所以攻击者发送 `X-Forwarded-For: 1.1.1.1`，Spring Boot 收到的就是 `1.1.1.1, <攻击者真实IP>`。

- 如果代码取的是**第一个**值，就被伪造了。
- 可信的只有**最右边由你自己的代理追加的那部分**：从右往左数，跳过你信任的代理 IP，第一个不属于可信代理的地址才是客户端 IP。
- 如果 Nginx 是最外层入口，更简单的做法是直接覆盖：`proxy_set_header X-Forwarded-For $remote_addr;` 或另设 `X-Real-IP $remote_addr`。
- 如果 Spring Boot 端口能被绕过 Nginx 直接访问，那么任何头都不可信——所以应用端口应只监听内网或 `127.0.0.1`。

## 动手实践

### 实践 1：用 curl -v 逐行解读一次 HTTPS 访问

在终端执行（`-o /dev/null` 丢掉响应体，只看过程）：

```
curl -v -o /dev/null https://example.com/
```

下面是一段**示意输出**（不同 curl 版本、TLS 库、网络环境下细节会不同，IP 已替换为文档保留地址）：

```
* Host example.com:443 was resolved.
* IPv6: (none)
* IPv4: 203.0.113.10
*   Trying 203.0.113.10:443...
* Connected to example.com (203.0.113.10) port 443
* ALPN: curl offers h2,http/1.1
* (304) (OUT), TLS handshake, Client hello (1):
* (304) (IN), TLS handshake, Server hello (2):
* (304) (IN), TLS handshake, Unknown (8):
* (304) (IN), TLS handshake, Certificate (11):
* (304) (IN), TLS handshake, CERT verify (15):
* (304) (IN), TLS handshake, Finished (20):
* (304) (OUT), TLS handshake, Finished (20):
* SSL connection using TLSv1.3 / AEAD-CHACHA20-POLY1305-SHA256
* ALPN: server accepted h2
* Server certificate:
*  subject: CN=example.com
*  start date: ...
*  expire date: ...
*  subjectAltName: host "example.com" matched cert's "example.com"
*  issuer: C=US; O=...; CN=...
*  SSL certificate verify ok.
* using HTTP/2
> GET / HTTP/2
> Host: example.com
> User-Agent: curl/8.7.1
> Accept: */*
>
< HTTP/2 200
< content-type: text/html
< content-length: 1256
<
* Connection #0 to host example.com left intact
```

逐段解读：

| 输出 | 对应链路环节 | 怎么读 |
|---|---|---|
| `Host ... was resolved` / `IPv4: ...` | DNS | 域名解析得到的 IP。若这里的 IP 和你预期不符，先怀疑 DNS/hosts |
| `Trying ...:443` / `Connected to` | TCP | 三次握手完成。卡在 Trying 通常是网络不通或被防火墙丢包 |
| `ALPN: curl offers h2,http/1.1` | TLS | 客户端在 ClientHello 里声明支持的应用层协议 |
| `Client hello` → `Finished` | TLS 握手 | `(OUT)` 是 curl 发出，`(IN)` 是服务器发来。`Unknown (8)` 是 TLS 1.3 的 EncryptedExtensions，部分 TLS 库打印成 Unknown |
| `SSL connection using TLSv1.3 / ...` | TLS | 协商出的协议版本和加密套件 |
| `Server certificate` 段 | TLS 身份校验 | `subject`/`subjectAltName` 必须匹配你访问的域名，`issuer` 是签发 CA，`verify ok` 表示证书链校验通过 |
| `> ` 开头的行 | HTTP 请求 | curl 发出的请求行和请求头，这里全部可以被客户端任意修改 |
| `< ` 开头的行 | HTTP 响应 | 状态码和响应头 |
| `left intact` | TCP | 连接保持，可以被复用 |

几个值得一试的变体：

- `curl -v http://example.com/`：没有 TLS 段，请求在网络上是明文。
- `curl -v --resolve example.com:443:127.0.0.1 https://example.com/`：跳过 DNS，强行指定 IP，模拟“DNS 被劫持”。如果本地 443 没有服务会连接失败；若有服务，你会看到证书域名不匹配的报错——这正是问题一的答案在实践中的样子。
- `curl -v -H 'X-Forwarded-For: 1.1.1.1' http://127.0.0.1:8080/`：给本地 Spring Boot 发伪造头，体会“头部由客户端决定”。
- `curl -v -k https://...`：`-k` 会跳过证书校验，只能用于本地调试，它和 Java 里的“信任所有证书”是同一个坑。

### 实践 2：用 Wireshark 抓一次完整访问并标注阶段

步骤：

1. 安装并打开 Wireshark，选择当前上网的网卡（macOS 上 Wi-Fi 一般是 `en0`）开始抓包。
2. 为了能抓到 DNS，先清掉本机 DNS 缓存。macOS 上可执行 `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`。
3. 用 curl 而不是浏览器发请求，干扰更少：`curl -s -o /dev/null https://example.com/`。
4. 停止抓包，依次使用下面的显示过滤器（在顶部过滤栏输入，回车生效）。

| 显示过滤器 | 看什么 | 标注为 |
|---|---|---|
| `dns` | 查询 `example.com` 的 A/AAAA 记录与响应 | 阶段 1：DNS |
| `dns.qry.name == "example.com"` | 只看这个域名的查询 | 阶段 1：DNS |
| `tcp.flags.syn==1` | SYN 与 SYN-ACK 两个包（ACK 包本身不带 SYN 标志） | 阶段 2：TCP 握手 |
| `ip.addr == 203.0.113.10 && tcp.port == 443` | 与目标服务器的全部流量（IP 换成你 DNS 阶段看到的） | 阶段 2–4 全过程 |
| `tls.handshake` | ClientHello、ServerHello 等握手消息 | 阶段 3：TLS |
| `tls.handshake.type == 1` | 只看 ClientHello | 阶段 3：TLS |
| `tls.handshake.extensions_server_name` | ClientHello 中的 SNI 字段 | 阶段 3：TLS |
| `tls.app_data` | 握手后的加密应用数据（HTTP 就在里面） | 阶段 4：HTTP |

怎么读：

- DNS 包里能看到查询的域名和返回的 IP，且是**明文**（普通 UDP 53 情况下）。这说明网络上的人能知道你访问了哪个域名。
- 在 ClientHello 里展开 `Extension: server_name`，能看到明文的 SNI，也就是域名。
- TLS 1.3 下，ServerHello 之后的证书是加密传输的，所以你在 Wireshark 里看不到证书内容；TLS 1.2 下证书是明文可见的。
- 之后的 `Application Data` 无法直接解读，这正是 TLS 的作用。
- 右键某个 TCP 包 → 追踪流（Follow → TCP Stream）可以把整个连接串起来看。
- 如果浏览器或 curl 走了 DoH（DNS over HTTPS），`dns` 过滤器会看不到查询，这不是抓包失败。

:::tip 想看 HTTP 明文？
可以设置环境变量 `SSLKEYLOGFILE=/tmp/keys.log` 再运行 curl（需 curl 所用 TLS 库支持），然后在 Wireshark 的 TLS 协议设置里填入这个文件（(Pre)-Master-Secret log filename），就能解密看到 HTTP 内容。这个文件等于会话密钥，用完删除。另一个简单做法：直接抓本地 `http://127.0.0.1:8080`，选 Loopback 网卡（macOS 上是 `lo0`），过滤 `http`。
:::

### 实践 3：把全链路图写进笔记，并持续回填

1. 把上面的时序图和“每一跳”表格复制到你本主题的笔记中。
2. 在表格后加一列“我学过的漏洞”，先填上本仓库已有的 Lab：Lab 01 SQLi 挂在“应用→MySQL”，Lab 02 XSS 挂在“HTTP 响应→浏览器渲染”，Lab 04 IDOR 挂在“业务处理”，Lab 05 SSRF 挂在“业务处理”，并注明 SSRF 会让 Spring Boot 作为客户端重新走一遍 DNS→TCP→HTTP。
3. 以后每学一个新主题（如 [[net-token]]、[[web-access]]），回到这张图，标出它在哪一环、利用的是哪条信任边界。
4. 每次标注时问自己三个问题：数据从哪里来？谁能控制它？我在哪里校验它？

## 攻击者视角

攻击者拿到这张图，思路通常是“找最弱的一环，而不是最硬的一环”。TLS 很难正面攻破，那就绕过它：

- **侦察**：DNS 记录会暴露子域名和基础设施（如 `admin.`、`test.`、云厂商 CNAME）；证书透明度日志会公开所有签发过的证书域名；响应头 `Server`、错误页面会暴露 Nginx/Tomcat 版本；Spring Boot 默认错误页（Whitelabel Error Page）会暴露技术栈。
- **绕过入口**：如果 Spring Boot 的 8080 端口直接暴露在公网，攻击者就能绕过 Nginx 上的所有限流、WAF 和访问控制，还能随意伪造 `X-Forwarded-For`。
- **利用解析差异**：Nginx 和 Spring Boot（Tomcat）对 URL 路径、编码、请求头的理解如果不一致，就可能出现“Nginx 以为访问的是 A，Spring 实际处理的是 B”，例如 Nginx 只拦截 `/admin` 前缀，却放过了后端会规范化成同一路径的其他写法。请求走私也是同类问题。
- **拿头部做文章**：伪造 `X-Forwarded-For` 绕过按 IP 的限流或登录失败锁定；伪造 `Host` 让应用生成指向攻击者域名的密码重置链接。
- **把服务器当跳板**：SSRF 让攻击者借你的 Spring Boot 访问内网 Redis、MySQL 或云厂商元数据地址 `169.254.169.254`，此时整条链从你的服务器重新出发（见 Lab 05 和 [[web-ssrf]]）。
- **直捣数据层**：SQL 注入让攻击者越过所有业务逻辑，直接以应用的数据库账号读写数据（见 Lab 01 和 [[web-sqli]]）。

:::warn 授权原则
抓包、改请求、扫描端口只能针对自己的机器、本仓库的 Lab 或明确授权的目标。对他人系统做这些操作可能违法。
:::

## 防御与最佳实践

按链路逐跳加固，每一跳都假设上一跳可能已经失守（纵深防御）。

**DNS 层**

- 为域名设置 CAA 记录，限定允许签发证书的 CA；关注证书透明度日志中的异常签发。
- 应用内部做 SSRF 防护时，要校验**解析后的 IP**，并在实际连接时使用同一次解析结果，防止 DNS 重绑定。

**TLS 层**

- 全站 HTTPS，并在 Nginx 上开启 HSTS，例如 `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`。
- 只启用 TLS 1.2 和 1.3：`ssl_protocols TLSv1.2 TLSv1.3;`。
- Java 作为客户端（`RestTemplate`、`WebClient`、`HttpClient`）时，**永远不要**写信任所有证书的 `TrustManager` 或关闭主机名校验；需要信任内部 CA 时，把该 CA 加入专用的 truststore。

**Nginx 层**

- 覆盖而不是透传关键头：

```
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

- 上面把 XFF 直接覆盖为 `$remote_addr`，适用于 Nginx 是最外层入口的情况。若前面还有 CDN/负载均衡，应使用 Nginx 的 `real_ip` 模块（`set_real_ip_from` 列出可信代理网段，配合 `real_ip_header X-Forwarded-For;` 和 `real_ip_recursive on;`），从右往左剥掉可信代理。
- `server_tokens off;` 隐藏版本号；为未知 `Host` 配一个默认 `server` 直接拒绝（如 `return 444;`）。

**Spring Boot 层**

- 端口只绑定内网或本机：`server.address=127.0.0.1`，或用防火墙/安全组限制只有 Nginx 能访问。
- 让 Spring 正确处理代理头：`server.forward-headers-strategy=native`（由内嵌 Tomcat 的 `RemoteIpValve` 处理）或 `framework`（使用 `ForwardedHeaderFilter`）。Tomcat 的 `RemoteIpValve` 只信任来自内部代理地址的头，可通过 `server.tomcat.remoteip.internal-proxies` 配置可信代理的正则。
- 不要自己写 `request.getHeader("X-Forwarded-For").split(",")[0]` 来取客户端 IP 做安全决策。
- 所有入参做服务端校验，鉴权放在服务端（[[web-access]]）；对外发请求的功能做目标白名单（[[web-ssrf]]）。
- 生产环境关闭详细错误信息，例如 `server.error.include-stacktrace=never`。

**数据库层**

- 一律使用参数化查询：`PreparedStatement`、MyBatis 的 `#{}`（而非 `${}`）、JPA 的参数绑定。
- 应用使用最小权限的数据库账号；MySQL 3306 不暴露公网。

## 常见误区

- **“用了 HTTPS 就安全了。”** HTTPS 只保护传输过程中的机密性、完整性和服务器身份。请求内容仍由攻击者决定，SQL 注入、XSS、越权照样发生。
- **“请求头是浏览器发的，没法改。”** curl、Burp 或任何脚本都能任意构造请求头，`Referer`、`Origin`、`X-Forwarded-For` 都一样。
- **“内网是可信的。”** Nginx 到 Spring Boot 常是明文；一旦出现 SSRF 或某台机器被攻破，内网服务就直接暴露。
- **“DNS 被劫持了，HTTPS 也就没用了。”** 相反，正确校验证书的 TLS 正是为防这种情况设计的；真正的风险来自用户点“继续访问”、首次访问是明文 HTTP、客户端关闭校验，或攻击者借此申请到了证书。
- **“`request.getRemoteAddr()` 就是用户 IP。”** 在反向代理后面，它通常是 Nginx 的 IP；而直接读 XFF 的第一个值又会被伪造。要靠正确配置代理和 Spring 的转发头处理。
- **“TLS 加密了，别人就不知道我访问了哪个网站。”** DNS 查询（未加密时）和 ClientHello 中的 SNI 都会暴露域名。
- **“一个请求就是一条连接。”** 实际上至少有浏览器→Nginx、Nginx→应用、应用→数据库三段独立连接，每段的客户端和服务端不同。

## 自测

:::details 1. 按顺序写出一次冷启动 HTTPS 请求经历的环节，并指出 TLS 在哪一段终止。
DNS 解析 → TCP 三次握手 → TLS 握手 → HTTP 请求 → Nginx 反向代理 → Spring Boot → MySQL。在本课的架构里，TLS 在 Nginx 终止，Nginx 到 Spring Boot 是新的连接，通常是明文 HTTP。
:::

:::details 2. 攻击者控制了 DNS，TLS 还能保护你吗？
在证书被正确校验的前提下能：攻击者没有该域名受信任的证书和私钥，浏览器会报错。但如果用户无视警告、首次访问走 http 被 SSL Stripping、客户端关闭了证书校验、设备装了恶意根证书，或攻击者利用对 DNS 的控制申请到了真证书，保护就会失效。DNS 被控制后，服务不可用这一点 TLS 也挡不住。
:::

:::details 3. Nginx 配置了 $proxy_add_x_forwarded_for，客户端发送 X-Forwarded-For: 1.1.1.1，应用收到什么？应该取哪个值？
收到 `1.1.1.1, <客户端真实连接IP>`。第一个值是客户端伪造的。应从右往左跳过可信代理，取第一个不可信地址；Nginx 是最外层时，直接用 `$remote_addr` 覆盖更简单。
:::

:::details 4. Nginx 在 Nginx→Spring Boot 这一跳中扮演什么角色？Spring Boot 在 Spring Boot→MySQL 这一跳中呢？
Nginx 是客户端，Spring Boot 是服务端；在 Spring Boot→MySQL 这一跳中，Spring Boot 是客户端，MySQL 是服务端。
:::

:::details 5. Wireshark 中用什么过滤器分别查看 DNS、TCP 握手、TLS 握手？TLS 1.3 下能看到证书吗？
`dns`、`tcp.flags.syn==1`、`tls.handshake`。TLS 1.3 中证书消息是加密的，看不到；TLS 1.2 中证书是明文可见的。
:::

:::details 6. curl -v 输出中，哪几行能说明证书与域名匹配？
`Server certificate` 段中的 `subjectAltName: host "..." matched cert's "..."` 以及 `SSL certificate verify ok`。
:::

:::details 7. 为什么 Spring Boot 的 8080 端口不应该对公网开放？
攻击者可以绕过 Nginx 上的 TLS、限流、访问控制和头部覆盖规则，直接伪造 `X-Forwarded-For` 等头。应绑定 `127.0.0.1`/内网地址或用防火墙限制只允许 Nginx 访问。
:::

:::details 8. 把 SQL 注入、XSS、SSRF、IDOR 分别挂到全链路的哪一环？
SQL 注入：Spring Boot→MySQL；XSS：HTTP 响应回到浏览器渲染时；SSRF：Spring Boot 作为客户端向外发请求；IDOR：Spring Boot 内部的业务鉴权。
:::

## 一句话总结

一个请求要走过 DNS、TCP、TLS、HTTP、代理、应用、数据库七个环节，每一跳都有自己的客户端、服务端和信任边界；安全的核心是看清每条边界上“哪些数据由对方控制”，并在自己控制的那一侧做校验。
