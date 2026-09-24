## 为什么要学

HTTP 是你每天都在写的协议：`@GetMapping`、`ResponseEntity`、`HttpServletRequest.getHeader()`。但在安全里，HTTP 的每个细节都可能是攻击面：一个 Cookie 少了 `HttpOnly`，XSS 就能直接偷走会话；少了合适的 `SameSite`，CSRF 就能冒用登录态；前置代理和 Tomcat 对请求长度的理解不一致，就可能发生请求走私；缓存键设计不当，一个人的恶意响应会被缓存给所有人。

这一课位于 [[net-trace]] 链路中的“应用请求”一环，是后面整个 Web 安全阶段（[[web-xss]]、[[web-csrf]]、[[web-access]]、[[web-authn]]）和 Spring Security（[[ss-arch]]）的基础。你会学到 HTTP 报文与语义、Cookie 与 Session、连接复用与走私、WebSocket 以及缓存。

学完之后你应该能：读懂任意一段原始 HTTP 报文；为 Spring Boot 的会话 Cookie 选对属性并说清理由；解释 CL/TE 走私、跨站 WebSocket 劫持、Web 缓存投毒的成因。

## 核心概念

### 1. 请求/响应结构，方法语义（安全 / 幂等），常见状态码

HTTP/1.1 是文本协议：起始行、若干头部、一个空行（`\r\n\r\n`），然后是可选的 body。

```
POST /api/orders HTTP/1.1
Host: shop.example.com
Content-Type: application/json
Content-Length: 27
Cookie: JSESSIONID=5F1C...

{"skuId":1001,"quantity":2}
```

```
HTTP/1.1 201 Created
Location: /api/orders/42
Content-Type: application/json
Set-Cookie: JSESSIONID=9A7B...; Path=/; Secure; HttpOnly; SameSite=Lax

{"id":42}
```

所有部分（方法、路径、每个头、body）都由客户端决定，Spring 只是帮你解析。

**方法语义**（RFC 9110）：

| 方法 | 安全（不改变服务端状态） | 幂等（执行多次效果同一次） | 典型用途 |
|---|---|---|---|
| GET / HEAD | 是 | 是 | 查询 |
| OPTIONS | 是 | 是 | CORS 预检、查询能力 |
| PUT | 否 | 是 | 整体替换资源 |
| DELETE | 否 | 是 | 删除 |
| POST | 否 | 否 | 创建、提交动作（下单、支付） |
| PATCH | 否 | 不保证 | 部分修改 |

“幂等”决定了网络超时后能不能自动重试：GET/PUT 重试无害，POST 下单重试可能下两单（所以电商下单接口要用幂等键/订单号去重）。

**常见状态码**：`200` 成功，`201` 已创建，`204` 无内容；`301/302` 重定向（`307/308` 要求保持原方法和 body）、`304` 未修改（缓存命中）；`400` 请求错误，`401` 未认证（“你是谁？”），`403` 已认证但无权限，`404` 不存在，`405` 方法不允许，`429` 请求过多；`500` 服务端错误，`502` 网关收到上游的无效响应，`503` 暂不可用，`504` 网关等上游超时。安全上注意：越权时返回 403 还是 404 会泄露“资源是否存在”，500 页面不应带堆栈。

**问题：为什么 GET 请求不应该修改数据？** 第一，语义上 GET 是“安全方法”，整个生态都据此行事：浏览器会预取链接、爬虫会顺着链接访问、代理和 CDN 会缓存 GET 响应、客户端超时会自动重试，这些都可能在用户不知情时触发修改。第二，GET 最容易被跨站触发：一个 `<img src="https://shop.example.com/api/order/cancel?id=42">` 就能让浏览器带着 Cookie 发出请求，而且 `SameSite=Lax` 对顶级导航的 GET 是放行的，所以对 GET 做修改会绕开这层 CSRF 防护。第三，参数在 URL 中，会被记录到访问日志、浏览器历史和 `Referer` 里。Spring Security 的 CSRF 防护默认也只校验 POST/PUT/PATCH/DELETE 等方法，对 GET 不校验。

### 2. Cookie 属性：Secure、HttpOnly、SameSite、Domain、Path、Max-Age

服务端用 `Set-Cookie` 设置，浏览器之后在符合条件的请求中用 `Cookie` 头自动带回。**自动带回**是 CSRF 的根源，而属性决定了“什么时候带、谁能读”：

| 属性 | 作用 | 安全意义 |
|---|---|---|
| `Secure` | 只在 HTTPS 请求中发送 | 防止明文链路上被窃听 |
| `HttpOnly` | JavaScript（`document.cookie`）读不到 | XSS 无法直接窃取会话 ID（但仍能在页面内以用户身份发请求） |
| `SameSite` | 跨站请求时是否携带：`Strict` / `Lax` / `None` | 缓解 CSRF；`None` 必须配合 `Secure` |
| `Domain` | 不设置时只发给设置它的主机（host-only）；设 `Domain=example.com` 则所有子域都能收到 | 设得越宽越危险：任何一个子域被接管或有 XSS，都能拿到或覆盖 Cookie |
| `Path` | 只对该路径前缀发送 | 只是组织手段，**不是**安全边界（同源页面可绕过） |
| `Max-Age` / `Expires` | 存活时间；都不设就是会话 Cookie，关闭浏览器即失效 | 会话 ID 不应长期有效 |

另外 `__Host-` 前缀的 Cookie 要求必须 `Secure`、`Path=/`、且不能设置 `Domain`，可以防止被子域覆盖。

**“同站”（site）与“同源”（origin）不同**：同源要求协议、主机、端口完全相同；同站大致是“协议 + 可注册域名”相同，例如 `a.example.com` 和 `b.example.com` 是同站但不同源。SameSite 看的是“站”。

**问题：SameSite=Lax 能挡住哪些 CSRF，挡不住哪些？**

- **能挡住**：跨站发起的 POST 表单提交、跨站的 `fetch`/XHR 请求、`<img>`/`<iframe>`/`<script>` 等子资源请求，这些都不会带上 Lax Cookie。这覆盖了最经典的“恶意页面自动提交表单”攻击。
- **挡不住**：**顶级导航的 GET**（点击链接、`window.location` 跳转）仍会携带 Cookie，所以用 GET 修改数据的接口依然会被 CSRF；**同站**的请求不受限制，某个子域（比如 `blog.example.com`）存在 XSS 或被接管，就可以对 `shop.example.com` 发起请求；另外还有应用把 POST 当 GET 处理（或支持 `_method` 参数覆盖方法）的情况。部分浏览器对**未显式设置** SameSite、刚创建不久的 Cookie 在跨站顶级 POST 上有短暂放宽，具体行为依浏览器版本而定，所以应**显式设置** SameSite。结论：SameSite 是纵深防御，不能替代 CSRF Token（详见 [[web-csrf]]）。

### 3. Session 机制：服务端存状态，Cookie 只放 Session ID

HTTP 本身无状态。Session 机制是：登录成功后服务端创建一个会话对象（存用户 ID、权限等），生成一个**足够随机、不可预测**的 Session ID，通过 `Set-Cookie: JSESSIONID=...` 交给浏览器；之后每次请求带回这个 ID，服务端据此查出会话。Tomcat 默认把会话存在内存里，集群部署时常用 Spring Session + Redis 共享。

安全要点：

- Cookie 里**只放 ID**，不放用户名、角色这类数据（放了就能被篡改）。
- **登录成功后必须更换 Session ID**，否则攻击者可以先拿到一个 ID 塞给受害者，等受害者登录后共享这个会话（会话固定攻击）。Spring Security 默认会在认证后更换 ID。
- 注销时让服务端会话失效，而不仅仅是删除浏览器 Cookie；设置空闲超时（Spring Boot 的 `server.servlet.session.timeout`）。
- 不要把 Session ID 放进 URL（`;jsessionid=...` URL 重写），它会进入日志和 Referer。

与 JWT 这类“无状态令牌”的对比放在 [[net-token]]。

### 4. keep-alive、HTTP/2 多路复用；HTTP 请求走私（CL/TE 不一致）

**HTTP/1.1 keep-alive**：默认持久连接，一个 TCP 连接上可以依次发多个请求（响应必须按顺序返回，前一个慢会阻塞后面的，即队头阻塞）。既然请求首尾相接，接收方必须能准确判断**一个请求在哪里结束**，有两种方式：

- `Content-Length: 27`：body 正好 27 字节。
- `Transfer-Encoding: chunked`：body 分块发送，每块以十六进制长度开头，以长度为 `0` 的块结束。

RFC 规定两者同时出现时应以 `Transfer-Encoding` 为准，并建议把这种请求视为可疑。**请求走私**就发生在“前端代理（Nginx、CDN、负载均衡）和后端（Tomcat 等）对边界判断不一致”时：

```
POST / HTTP/1.1
Host: shop.example.com
Content-Length: 6
Transfer-Encoding: chunked

0

G
```

如果前端按 `Content-Length: 6` 把 `0\r\n\r\nG` 都当作这个请求的 body 转发，而后端按 `chunked` 在 `0` 块处结束，那么剩下的 `G` 会留在后端的连接缓冲区里，**被拼接到下一个请求（可能是其他用户的请求）开头**，变成 `GPOST / ...`。这就是 CL.TE 型；反过来是 TE.CL 型，也有利用 `Transfer-Encoding` 头的畸形写法（多余空格、大小写、重复头）让一方识别、另一方忽略的 TE.TE 型。后果包括绕过前端的访问控制、劫持其他用户的请求、配合缓存投毒等。

**HTTP/2** 是二进制分帧，一个连接上的多个请求以**流（stream）**交错传输（多路复用），解决了 HTTP/1.1 应用层的队头阻塞，并用 HPACK 压缩头部。HTTP/2 帧自带长度，本身没有 CL/TE 的歧义；但如果前端用 HTTP/2 接收、再**降级为 HTTP/1.1** 转发给后端，转换过程中仍可能产生走私（H2.CL、H2.TE 等变体）。防御思路：前后端尽量使用同一种、严格的解析实现，代理拒绝同时含 CL 和 TE 或格式异常的请求，代理到后端的连接可以考虑也使用 HTTP/2。

### 5. WebSocket 握手（Upgrade）及跨站 WebSocket 劫持

WebSocket 从一个普通的 HTTP/1.1 GET 请求“升级”而来：

```
GET /ws/notifications HTTP/1.1
Host: shop.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://shop.example.com
Cookie: JSESSIONID=5F1C...

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

`101` 之后，这个 TCP 连接就变成双向的消息通道（`ws://` 明文，`wss://` 走 TLS）。`Sec-WebSocket-Key/Accept` 只是用来确认对方确实支持 WebSocket 协议，**不是认证手段**。浏览器里 MQTT over WebSocket（EMQX 的 8083/8084 端口）也是这样建立的。

**跨站 WebSocket 劫持（CSWSH）**：WebSocket 不受同源策略限制，浏览器也会在握手请求里带上 Cookie。如果服务端只靠 Cookie 认证、又不检查 `Origin`，那么恶意网站的脚本 `new WebSocket("wss://shop.example.com/ws/notifications")` 就能以受害者身份建立连接，并且**能读到**推送的数据（这比 CSRF 更严重，CSRF 通常读不到响应）。防御：握手时校验 `Origin` 在白名单内（Spring 中 `registry.addHandler(...).setAllowedOrigins("https://shop.example.com")`，不要写 `"*"`）；或者使用握手后单独下发的 Token 认证；并设置合适的 SameSite。

### 6. 缓存相关头：Cache-Control、ETag；Web 缓存投毒

- `Cache-Control: no-store`：任何地方都不许保存（含个人数据的接口应该这样）。
- `Cache-Control: no-cache`：可以存，但每次使用前必须向服务器验证（本项目 `spring.web.resources.cache.cachecontrol.no-cache=true` 就是这么做的）。
- `private` 只允许浏览器缓存，`public` 允许 CDN/代理等共享缓存，`max-age=3600` 表示新鲜期（秒）。
- `ETag: "abc"`：资源版本标识。浏览器下次带 `If-None-Match: "abc"`，未变化时服务器返回 `304 Not Modified` 且不带 body。
- `Vary: Accept-Encoding`：告诉缓存“响应因这些请求头而不同”，这些头要一起纳入缓存键。

**Web 缓存投毒**：共享缓存（CDN、Nginx `proxy_cache`）根据**缓存键**（通常是方法 + Host + 路径 + 查询参数）判断“是不是同一个请求”。如果响应内容还受到某个**不在缓存键里的输入**影响（称为 unkeyed input，例如 `X-Forwarded-Host` 被应用用来拼接脚本地址），攻击者就可以带上恶意值请求一次，让含恶意内容的响应被缓存，之后所有普通用户访问同一 URL 都会拿到它。另一个相近的问题是**缓存欺骗**：把个人数据页面诱导成“看起来像静态资源”的 URL（如 `/account/profile.css`），使其被 CDN 缓存。防御：不信任、不反射非必要的请求头；个人数据响应加 `Cache-Control: no-store, private`；CDN 只缓存明确的静态资源路径。

## 动手实践

:::warn 授权
请求走私、缓存投毒等攻击只能在自己的环境或获得授权的目标上测试。
:::

### 实践 1：用浏览器 DevTools 观察一次登录的 Set-Cookie

1. 打开任意一个你有账号的网站（公司内部系统或你常用的网站），先按 F12 打开 DevTools，切到 **Network** 面板，勾选 **Preserve log**（登录后页面会跳转，不勾选日志会被清空）。
2. 正常登录。在请求列表里找到登录请求（通常是 POST 到 `/login`、`/api/auth/...` 之类），点开看 **Headers → Response Headers**。
3. 切到 **Application → Storage → Cookies**，选中当前站点，查看每个 Cookie 的属性列。

你可能看到类似这样的响应头：

```
HTTP/1.1 302 Found
Location: /home
Set-Cookie: SESSION=YzQ1ZjM...; Path=/; Secure; HttpOnly; SameSite=Lax
```

怎么读：

- 登录成功后是否**下发了新的**会话 Cookie？比较登录前后的值，如果不变，就可能存在会话固定风险。
- 会话 Cookie 是否同时有 `Secure`、`HttpOnly`、`SameSite`？Application 面板里对应列打钩即表示已设置。
- `Domain` 列：显示为当前主机名（如 `www.example.com`）表示 host-only；显示为 `.example.com` 表示所有子域都会收到。
- `Expires / Max-Age` 列：显示 `Session` 表示会话 Cookie；如果是很久以后的日期，说明是“记住我”一类的长期 Cookie，要特别关注它的保护。
- 在 Console 中执行 `document.cookie`：`HttpOnly` 的 Cookie 不会出现在结果里。

### 实践 2：在 Spring Boot 中设置 Session Cookie 的 SameSite / Secure

在 `application.properties` 里配置（Spring Boot 2.6 起支持 `same-site`，本项目是 Spring Boot 4.1）：

```
server.servlet.session.cookie.http-only=true
server.servlet.session.cookie.secure=true
server.servlet.session.cookie.same-site=lax
server.servlet.session.cookie.name=__Host-SESSION
server.servlet.session.timeout=30m
```

`__Host-` 前缀是可选加分项：它要求 `Secure`、`Path=/` 且不设 `Domain`，上面的配置正好满足；如果设置了 `server.servlet.session.cookie.domain`，就不能用这个前缀。

写一个会创建会话的练习接口（练习用，自己新建文件，练完删掉）：

```java
package com.aqin.mynotes.demo;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class SessionDemoController {
    @GetMapping("/demo/session")
    String session(HttpServletRequest request) {
        return "session id = " + request.getSession(true).getId();
    }
}
```

启动后用 curl 查看响应头：

```
$ curl -si http://127.0.0.1:8080/demo/session | head -5
HTTP/1.1 200
Set-Cookie: __Host-SESSION=3C8F0A6D2B...; Path=/; Secure; HttpOnly; SameSite=Lax
Content-Type: text/plain;charset=UTF-8
Content-Length: 45
```

怎么读：`Secure`、`HttpOnly`、`SameSite=Lax` 都已出现在 `Set-Cookie` 中。注意这里是通过明文 HTTP 访问的：`Secure` 属性只影响浏览器**是否在之后的请求中发回**这个 Cookie，服务端照样会下发；浏览器通常把 `localhost` 视为安全上下文，所以本地开发一般不受影响，但通过局域网 IP 用 HTTP 访问时，浏览器会拒绝接收或发送 Secure Cookie，登录就会“丢失”。生产环境应在 HTTPS 下使用（本地配置 HTTPS 见 [[net-tls]]）。如果应用在 Nginx 之后、由 Nginx 终止 TLS，还需要 `server.forward-headers-strategy=native` 或 `framework` 让应用识别原始协议，并确保这些转发头只由可信代理设置（见 [[net-trace]]）。

如果用了 Spring Session（例如 Redis 存储会话），Cookie 由 Spring Session 的 `CookieSerializer` 写出。Spring Boot 的自动配置通常会把 `server.servlet.session.cookie.*` 应用到它上面；但如果你自己定义了 `DefaultCookieSerializer` Bean，就要在里面自己调用 `setSameSite`、`setUseSecureCookie`、`setUseHttpOnlyCookie`。以所用版本文档为准，并始终用 curl 或 DevTools 验证最终的 `Set-Cookie`。

## 攻击者视角

- **一切皆可改**：用 Burp Suite 或 curl 直接构造请求，修改方法、路径、任意头、Cookie、body，前端限制形同虚设。本仓库 Lab 04 里伪造 `X-User-Id` 就是最直接的例子。
- **偷会话**：寻找缺少 `HttpOnly` 的会话 Cookie 配合 XSS（[[web-xss]]）；寻找缺少 `Secure` 的 Cookie 在 HTTP 链路上窃听；寻找 URL 中的 Session ID。
- **冒用会话**：检查是否存在可以用 GET 或跨站 POST 触发的状态修改接口（CSRF），检查 WebSocket 握手是否校验 `Origin`（CSWSH）。
- **打代理与后端的差异**：构造同时带 CL 和 TE、或 TE 格式畸形的请求，探测请求走私；寻找会被反射进响应、却不在缓存键里的请求头（`X-Forwarded-Host`、`X-Original-URL` 等），尝试缓存投毒。
- **信息泄露**：状态码差异（403 与 404）判断资源是否存在；错误页中的堆栈、`Server` 头中的版本号。

## 防御与最佳实践

- 严格遵守方法语义：GET 只读；修改用 POST/PUT/PATCH/DELETE，并启用 CSRF 防护（Spring Security 默认启用）。
- 会话 Cookie：`Secure` + `HttpOnly` + 显式 `SameSite`（一般用 `Lax`，后台管理系统可用 `Strict`），不设或尽量窄地设 `Domain`，可用 `__Host-` 前缀；登录后更换 Session ID，注销时让服务端会话失效。
- 请求边界：前端代理使用维护良好的版本，拒绝歧义请求；不要自己手写 HTTP 解析。
- WebSocket：校验 `Origin` 白名单，握手阶段完成认证和授权，并对每条消息做权限检查。
- 缓存：含用户数据的响应一律 `Cache-Control: no-store`；CDN 只缓存静态资源；应用不要把 `X-Forwarded-Host` 之类的头当可信输入来拼接 URL。
- 统一错误处理，不向客户端暴露堆栈；视情况隐藏 `Server` 版本号。

## 常见误区

- “POST 请求就不会被 CSRF”：跨站表单可以直接提交 POST。
- “HttpOnly 能防 XSS”：它只能防 XSS 读取 Cookie，XSS 仍然能在页面中以用户身份发请求。
- “Path=/admin 能隔离 Cookie”：Path 不是安全边界。
- “设了 SameSite 就不需要 CSRF Token”：Lax 挡不住 GET 修改和同站攻击。
- “WebSocket 握手有 Key/Accept，所以是安全的”：那只是协议确认，不是认证，也不校验来源。
- “CDN 缓存只影响性能”：缓存键设计错误会把恶意或私人响应分发给所有人。

## 自测

:::details 1. 哪些 HTTP 方法是安全的？哪些是幂等的？POST 和 PUT 在幂等性上有什么区别？
GET、HEAD、OPTIONS 是安全方法；安全方法加上 PUT、DELETE 是幂等方法。POST 不幂等，重复提交可能创建多份资源；PUT 是整体替换，执行多次与执行一次效果相同。
:::

:::details 2. 为什么 GET 请求不应该修改数据？
GET 被定义为安全方法，浏览器预取、爬虫、缓存、自动重试都会假设它无副作用；它还最容易被跨站触发（img 标签、链接），SameSite=Lax 也对顶级导航 GET 放行；参数会进入日志和 Referer。
:::

:::details 3. SameSite=Lax 能挡住哪些 CSRF，挡不住哪些？
能挡住跨站 POST 表单、跨站 fetch/XHR、子资源请求携带 Cookie；挡不住顶级导航的 GET 请求（所以 GET 不能改数据），也挡不住来自同站子域的请求。它是纵深防御，仍需 CSRF Token。
:::

:::details 4. HttpOnly、Secure、Domain 分别防什么？
HttpOnly 防 JavaScript 读取 Cookie；Secure 防止 Cookie 通过明文 HTTP 发送；Domain 控制 Cookie 发往哪些主机，不设置时只发给当前主机，设成父域后所有子域都能收到，范围越大风险越大。
:::

:::details 5. 什么是 CL.TE 请求走私？
前端代理按 Content-Length 判断请求边界，后端按 Transfer-Encoding: chunked 判断，两者不一致，导致请求的一部分残留在后端连接中，被拼接到下一个请求前面，可用于绕过前端控制或影响其他用户。
:::

:::details 6. 跨站 WebSocket 劫持的成因和防御是什么？
WebSocket 握手会携带 Cookie 且不受同源策略限制，服务端若只靠 Cookie 认证且不校验 Origin，恶意页面就能以受害者身份建立连接并读取数据。防御是校验 Origin 白名单，或使用握手 Token 认证。
:::

:::details 7. 什么是 Web 缓存投毒？如何避免个人数据被 CDN 缓存？
攻击者利用不在缓存键中、却影响响应内容的输入（如某个请求头），让恶意响应被共享缓存保存并分发给其他用户。个人数据响应应设置 `Cache-Control: no-store`，CDN 只缓存明确的静态资源。
:::

## 一句话总结

HTTP 报文里的一切都由客户端掌控：用正确的方法语义和 Cookie 属性（Secure、HttpOnly、SameSite）约束浏览器的自动行为，服务端存状态、Cookie 只放 ID，并警惕代理与后端、缓存与应用之间的“理解不一致”。
