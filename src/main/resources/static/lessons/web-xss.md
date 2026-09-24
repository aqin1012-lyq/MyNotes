## 为什么要学

SQL 注入是把用户数据当成 SQL 代码执行，XSS（跨站脚本）则是把用户数据当成 HTML/JavaScript 在**别人的浏览器里**执行。作为后端，你可能觉得“前端渲染是前端的事”，但 XSS 的根因几乎总在服务端：是你的接口把没编码的用户输入吐进了 HTML。汽车 OTA 后台、IoT 设备管理页、电商的商品评论/客服工单——任何“一个用户输入，另一个用户查看”的场景，都是存储型 XSS 的温床。

XSS 的危害常被低估。它能偷 Cookie/Token 冒充受害者、以受害者身份发请求（改密码、下单、转账）、篡改页面钓鱼、做键盘记录，甚至在后台管理页里“蠕虫式”传播。因为脚本运行在受害者已登录的会话里，它能做的事就是受害者能做的一切——包括你的管理员。

学完这一课，你应该能做到：

- 区分反射型、存储型、DOM 型 XSS，并说清各自的数据流。
- 判断一个值要写进 HTML 正文、属性、`<script>`、URL 时分别该怎么编码。
- 用 CSP 做纵深防御，说清 CSP 挡得住什么、`HttpOnly` 又补上哪一块。

> 本课的攻击 payload 只可用于你自己的 Lab（本机 `/vuln/l02`）或已获授权的目标，不要拿去打别人的系统。

## 核心概念

### 三种 XSS：反射型 / 存储型 / DOM 型

区别在于“恶意脚本从哪来、在哪被注入页面”。

| 类型 | payload 存在哪 | 触发方式 | 谁受害 | Lab 对应 |
|---|---|---|---|---|
| 反射型 | 在 URL/请求参数里 | 诱导受害者点一个特制链接 | 点链接的人 | `/vuln/l02/search?q=` |
| 存储型 | 存进服务端数据库 | 受害者打开某个正常页面 | 所有访问该页的人 | `/vuln/l02/notes` + `/review` |
| DOM 型 | 可能不经过服务端 | 前端 JS 把不可信数据写进危险 sink | 受害者 | 见下 |

存储型最危险：一次注入，长期生效，人人中招。看 Lab 02 漏洞版 `VulnXssController`：

```java
// 存储型：任何用户 POST 一条 note，标题原样进库
notes.insert(userId, title, content);
// review 页把每个标题原样拼进 HTML
html.append("<li>").append(note.title()).append("</li>");

// 反射型：搜索页把参数原样回显
return "<p>No results for " + q + "</p>";
```

两处都没有编码，用户输入直达 HTML。

**DOM 型**的区别是：漏洞在前端 JS，服务端返回的 HTML 本身可能是干净的，是浏览器里的脚本把不可信数据（如 `location.hash`）写进了危险位置：

```javascript
// 危险：把 URL 里的 hash 直接塞进 innerHTML
document.getElementById("out").innerHTML = location.hash.slice(1);
// 访问 page#<img src=x onerror=alert(1)> 就触发
```

Lab 02 的修复（服务端输出编码）**防不住 DOM 型**——因为坏事发生在浏览器端、服务端根本没参与。DOM 型要在前端修：用 `textContent` 而非 `innerHTML`，框架里避免 `v-html`/`dangerouslySetInnerHTML`。

### 为什么是“输出时编码”而不是“入库前过滤”

同一份数据可能被用在多个上下文：HTML 正文、HTML 属性、JS 字符串、URL、CSV、日志……**每个上下文的“危险字符”不一样**，需要的编码也不一样。如果你在入库时就编码，就必须赌它未来只会用在一个上下文里——一旦它被用在别处，要么编码不对（仍可 XSS），要么双重编码（显示成乱码 `&lt;`）。

所以正确原则是：**存原始数据，在输出的那一刻、按目标上下文编码**。Lab 修复版正是这么做的——`create` 存原文，`review` 输出时才 `htmlEscape`：

```java
// 存的时候不编码，编码留到输出、上下文已知的时候
notes.insert(userId, title, content);
...
html.append("<li>").append(htmlEscape(note.title())).append("</li>");
```

`htmlEscape`（Spring 的 `HtmlUtils.htmlEscape`）把 `<` `>` `&` `"` `'` 转成 `&lt;` `&gt;` 等实体，浏览器就把它们当文本显示，而不是当标签解析。这就是为什么测试里 `<img ...>` 变成了 `&lt;img ...&gt;`。

### 输出上下文：四种位置四种编码

“按上下文编码”具体是：

| 输出位置 | 例子 | 该做的编码 | 关键危险字符 |
|---|---|---|---|
| HTML 正文 | `<li>这里</li>` | HTML 实体编码 | `< > & " '` |
| HTML 属性 | `<input value="这里">` | HTML 属性编码 + 属性必须加引号 | `" ' < >` 空格 |
| `<script>` 里 | `var x = "这里";` | JS 字符串编码（`\xHH`/`\uHHHH`）+ 转义 `</` | `" ' \ </ 换行` |
| URL 参数 | `<a href="/x?q=这里">` | URL 编码（percent-encoding） | `& = # ? 空格` |

一个反例说明为什么不能只做 HTML 编码：如果你把数据放进未加引号的属性 `<img src=这里>`，HTML 实体编码根本挡不住 `x onerror=alert(1)`，因为攻击者不需要 `<`，一个空格就能加新属性。所以“放属性里就必须加引号 + 属性编码”，“放 JS 里就得 JS 编码”。工程上别手写这些编码规则，用成熟模板引擎替你按上下文处理。

### 危险 sink：innerHTML、v-html、dangerouslySetInnerHTML

“sink”指数据最终汇入、可能被当代码执行的那个 API。常见危险 sink：

- 原生 JS：`element.innerHTML`、`outerHTML`、`document.write`、`insertAdjacentHTML`、`eval`、`setTimeout("字符串")`、`location`/`href` 赋值（`javascript:` 伪协议）。
- Vue：`v-html`（等于 innerHTML）。
- React：`dangerouslySetInnerHTML`（名字就在警告你）。
- Angular：`bypassSecurityTrust*` 系列（绕过了框架自带的净化）。
- 服务端模板：Thymeleaf 的 `th:utext`（unescaped）对比安全的 `th:text`；JSP 的 `<c:out>` 默认转义、`${}` EL 直出不转义。

安全默认：用 `textContent`（不是 innerHTML）、`th:text`（不是 `th:utext`）、React 的 `{value}`（自动转义，不是 dangerouslySetInnerHTML）。确实要渲染富文本 HTML 时，先用净化库（如 DOMPurify）过一遍白名单，再塞进 sink，绝不直接放原始输入。

### CSP：script-src、nonce、strict-dynamic

内容安全策略（CSP）是一个响应头，告诉浏览器“这个页面只允许从哪些来源加载/执行脚本”。它是**纵深防御**：万一你漏了一处编码，CSP 还能拦住脚本执行。看 Lab 修复版设的头：

```java
static final String CSP = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'";
response.setHeader("Content-Security-Policy", CSP);
response.setHeader("X-Content-Type-Options", "nosniff");
```

`script-src 'self'` 表示只执行同源的 `.js` 文件。这就挡住了两类最常见的 XSS：**内联脚本**（`<script>alert(1)</script>`）和**内联事件处理器**（`onerror=alert(1)`、`onclick=...`），因为它们都不是“同源的外部 js 文件”。这正是为什么 CSP 挡得住 Lab 里的 `<img src=x onerror=...>`——即便编码漏了，`onerror` 里的 JS 也不被允许运行。

更精细的做法：

- `nonce`：给每个页面生成一个随机数，`<script nonce="随机值">` 且 CSP 写 `script-src 'nonce-随机值'`，只有带对 nonce 的内联脚本才执行。适合确实需要内联脚本的页面。
- `strict-dynamic`：让被信任脚本动态创建的脚本也被信任，从而摆脱对域名白名单的依赖，配合 nonce 使用。
- `object-src 'none'`（禁 Flash/插件等老 sink）、`base-uri 'none'`（防止改 `<base>` 劫持相对 URL）都是常见加固项。

CSP 会被绕过的情形：配了 `'unsafe-inline'`（等于没防内联）、`'unsafe-eval'`、白名单里有可被滥用的 CDN/JSONP 端点、或存在可控的同源 JS 文件。所以 CSP 是补强，不是替代输出编码。

### HttpOnly Cookie：作用与局限

`Set-Cookie: session=...; HttpOnly` 让 JS 读不到这个 Cookie（`document.cookie` 拿不到它）。这挡住了最经典的 XSS 危害：**偷会话 Cookie**。但它管不了别的——见下节，XSS 有了 HttpOnly 依然能干很多坏事。所以 HttpOnly 是必备的减害措施，不是 XSS 的解药。

## 动手实践

### 实践 1：完成 Lab 02

启动应用：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw spring-boot:run
```

**存储型**：bob 写一条“笔记”，标题就是 payload；谁打开审核页谁中招。

```bash
curl -X POST -H 'X-User-Id: 2' 'localhost:8080/vuln/l02/notes' \
  --data-urlencode 'title=<img src=x onerror=alert(document.cookie)>'
```

然后在浏览器打开漏洞页和安全页对比：

```bash
open 'http://localhost:8080/vuln/l02/review'      # 弹窗，脚本执行了
open 'http://localhost:8080/secure/l02/review'    # 只显示文本，不执行
```

怎么读：漏洞页返回的 HTML 里是原样的 `<img src=x onerror=...>`，浏览器把它当成真的 `<img>` 标签，图片加载失败触发 `onerror`，脚本运行。安全页返回的是 `&lt;img src=x onerror=...&gt;`，浏览器当文本显示。用 `curl` 直接看返回体更清楚：

```bash
curl -s localhost:8080/vuln/l02/review | grep -o '<li>.*</li>'
# <li><img src=x onerror=alert(document.cookie)></li>   <- 活的标签
curl -s localhost:8080/secure/l02/review | grep -o '<li>.*</li>'
# <li>&lt;img src=x onerror=alert(document.cookie)&gt;</li>   <- 死的文本
```

**反射型**：把链接发给受害者，参数被回显进 HTML。

```bash
open 'http://localhost:8080/vuln/l02/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'
```

（`%3C`=`<`、`%3E`=`>`、`%20`=空格。）漏洞页弹窗，安全页只显示文本。

**看 CSP 头**，验证纵深防御那一层：

```bash
curl -sI 'localhost:8080/secure/l02/search?q=x' | grep -i 'content-security\|x-content-type'
```

期望输出：

```
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
```

怎么读：安全接口带 CSP，漏洞接口没有。即便安全页某天漏了一处编码，`script-src 'self'` 也会拦下内联脚本和 `onerror`。`nosniff` 则阻止浏览器把响应“猜”成别的类型执行。

**跑测试**：

```bash
./mvnw test -Dtest=XssTests
```

期望 `Tests run: 3, Failures: 0`。三个用例覆盖存储型、反射型、CSP 头存在性；每个攻击断言 vuln 出现活 payload、secure 出现的是被转义的 `&lt;img...&gt;`。

### 实践 2：PortSwigger XSS（Apprentice）

在 Web Security Academy 的 Cross-site scripting 分类做 Apprentice 级：

- “Reflected XSS into HTML context with nothing encoded”：搜索框回显参数，直接提交 `<script>alert(1)</script>` 即可，和 Lab 的反射型一模一样。
- “Stored XSS into HTML context with nothing encoded”：在评论区提交 `<script>alert(1)</script>`，之后任何人打开该文章页都会触发，对应 Lab 的存储型。

怎么读结果：实验横幅变绿 “Solved” 即通过。做的时候留意题目名字里的 “context”（HTML context / attribute / JavaScript string），提前对照上面那张“四种上下文四种编码”的表，训练“先判断上下文，再选 payload/编码”的习惯。

## 攻击者视角

攻击者找 XSS 的套路：

1. **找回显点**：在每个输入（搜索/评论/昵称/UA/Referer）填一个唯一标记，全站搜它在哪被吐回。
2. **判断上下文**：标记落在 HTML 正文？属性内？`<script>` 里？决定用什么 payload 逃逸。
3. **试探编码**：看 `< > " '` 是否被转义、过滤、替换，逐步绕过。
4. **落地利用**：偷 token、发请求、种键盘记录、后台蠕虫。

要点：

- **输入点远不止表单**。URL 参数、Cookie、`User-Agent`、`Referer`、上传文件名、JSON 字段、甚至从其他系统同步来的数据，只要最终被吐进页面且没编码，都可能是 XSS 入口。这也是二次注入式的存储型 XSS 的来源。
- **`alert(1)` 只是证明能执行**，真实利用要严重得多。有了 HttpOnly 偷不到 Cookie，攻击者就改用脚本**以受害者身份直接发请求**：读取页面上的 CSRF token 后调用改密码/转账/下单接口、把管理员后台的数据打包外带、注入一个假登录框钓密码。脚本运行在受害者会话里，能做受害者能做的一切。
- **管理后台是重灾区**。存储型 XSS 若打进了只有管理员会看的审核页/日志页（正如 Lab 的 `/review`），一个低权限用户就能用它拿下管理员会话，完成垂直越权。“谁能看这个页面”是 Lab 04 的问题，但它决定了 XSS 的杀伤力。
- **会绕过弱防御**。大小写混淆 `<ScRiPt>`、事件属性 `onerror/onload/onfocus`、`javascript:` 伪协议、SVG/MathML 里的脚本、编码变体——黑名单过滤几乎总能被绕，这也是为什么正解是“输出编码 + CSP”而非“过滤标签”。

## 防御与最佳实践

按优先级：

- **输出时按上下文编码（主防线）**。让模板引擎替你做：Thymeleaf 用 `th:text`、React 用 `{value}`、Vue 用 `{{value}}`（都默认转义）。手写拼 HTML 时用 `HtmlUtils.htmlEscape`，并想清楚是 HTML 正文/属性/JS/URL 哪种上下文。
- **富文本走净化白名单**。确实要让用户输入 HTML（富文本编辑器）时，服务端/前端用 OWASP Java HTML Sanitizer 或 DOMPurify 按白名单净化，只保留安全标签属性，绝不原样渲染。
- **CSP 做纵深**。至少 `script-src 'self'; object-src 'none'; base-uri 'none'`，不要用 `'unsafe-inline'`；需要内联脚本就上 `nonce`。它是“编码漏了”的最后一道网。
- **Cookie 加 `HttpOnly`、`Secure`、`SameSite`**。`HttpOnly` 断掉偷 Cookie 这条路，`Secure` 只走 HTTPS，`SameSite` 顺带缓解 CSRF。
- **前端避开危险 sink**。默认 `textContent`，禁用/审查 `innerHTML`、`v-html`、`dangerouslySetInnerHTML`、`eval`。用 ESLint 安全插件在 CI 里卡。
- **`X-Content-Type-Options: nosniff` + 正确的 Content-Type**。防止浏览器把文本/JSON 当 HTML 执行。API 返回 JSON 时用 `application/json`，别用 `text/html`。
- **框架自带防护别关**。Spring Security 会默认帮你设一批安全响应头，保持开启。

记忆链：**输出编码根治 → 富文本净化 → CSP + HttpOnly 兜底 → 避开危险 sink**。

## 常见误区

- **“XSS 是前端的锅，后端不用管。”** 反射型和存储型 XSS 的根因是服务端把没编码的数据吐进了 HTML。后端不做输出编码、不设 CSP，前端再小心也难兜住。
- **“入库前用富文本过滤器清洗一遍就一劳永逸。”** 入库编码/清洗会绑定单一上下文，数据换个地方用（属性、JS、URL）就要么失效要么乱码。正解是存原文、输出时按上下文编码；富文本才用净化白名单。
- **“设了 HttpOnly 就不怕 XSS 了。”** HttpOnly 只挡偷 Cookie。脚本仍能以受害者身份发请求、读页面数据、钓鱼、种键盘记录。它是减害，不是解药。
- **“API 返回 JSON 不会有 XSS。”** 如果 Content-Type 错写成 `text/html`、或没有 `nosniff`，浏览器可能把 JSON 当 HTML 解析执行。返回 JSON 要用 `application/json` + `nosniff`。
- **“有 CSP 就不用编码了。”** CSP 是纵深防御，会被 `'unsafe-inline'`、可滥用的 CDN、同源 JS 绕过。主防线永远是输出编码。
- **“过滤掉 `<script>` 标签就行。”** 事件属性（`onerror`）、`javascript:` 伪协议、SVG、大小写/编码变体都不需要 `<script>`。黑名单过滤几乎总能绕。

## 自测

:::details 1. 有了 HttpOnly，XSS 还能造成哪些危害？
HttpOnly 只让 JS 读不到会话 Cookie，挡住“偷 Cookie 冒充会话”这一条。但脚本仍运行在受害者已登录的会话里，能以受害者身份做很多事：读取页面上的 CSRF token 后调用改密码/转账/下单等接口、把管理后台的数据打包外带、注入假登录框钓取密码、记录键盘、篡改页面内容做钓鱼、在后台页面里蠕虫式传播。所以 HttpOnly 是必备的减害措施，不是 XSS 的解药，主防线依然是输出编码。
:::

:::details 2. 反射型、存储型、DOM 型有什么区别？Lab 02 的修复能防 DOM 型吗？
反射型：payload 在 URL/参数里，诱导受害者点特制链接，参数被回显进 HTML。存储型：payload 存进服务端数据库，任何打开相关页面的人都中招，危害最大。DOM 型：漏洞在前端 JS，服务端返回的 HTML 可能是干净的，是浏览器里的脚本把不可信数据（如 `location.hash`）写进 `innerHTML` 等危险 sink。Lab 02 的修复是服务端输出编码，能防反射型和存储型，但**防不住 DOM 型**——DOM 型的坏事发生在浏览器端、服务端没参与。DOM 型要在前端修：用 `textContent` 代替 `innerHTML`，避免 `v-html`/`dangerouslySetInnerHTML`。
:::

:::details 3. 为什么是“输出时编码”而不是“入库前过滤”？
因为同一份数据可能被用在多个上下文（HTML 正文、属性、`<script>`、URL），每个上下文的危险字符和编码方式都不同。入库时编码等于赌它未来只用在一个上下文里：一旦用在别处，要么编码不对仍可 XSS，要么双重编码显示成乱码。正确做法是存原始数据，在输出那一刻、按已知的目标上下文编码。Lab 修复版正是 `create` 存原文、`review` 输出时才 `htmlEscape`。
:::

:::details 4. 同一个值写进 HTML 正文、属性、`<script>`、URL，编码为什么不一样？
因为解析器不同、危险字符不同。HTML 正文里危险的是 `< > & " '`，做 HTML 实体编码即可。属性里除了实体编码，属性本身必须加引号，否则一个空格就能加 `onerror` 新属性。`<script>` 里是 JS 解析，要做 JS 字符串编码（`\xHH`/`\uHHHH`）并转义 `</` 防止提前闭合脚本。URL 参数里要做 percent-encoding，防止 `&`/`#` 改变参数结构或 `javascript:` 伪协议。用错上下文的编码等于没编码。
:::

:::details 5. CSP 为什么挡得住 `onerror=`？什么情况下会被绕过？
`script-src 'self'` 只允许执行同源的外部 `.js` 文件，而 `onerror=alert(1)` 是内联事件处理器、`<script>alert(1)</script>` 是内联脚本，都不是“同源外部文件”，所以被拒绝执行。即便你漏了一处输出编码，CSP 仍能拦下脚本。绕过情形：配了 `'unsafe-inline'`（等于放行内联）、`'unsafe-eval'`、白名单里有可被滥用的 CDN/JSONP 端点、或页面里有可被利用的同源 JS。所以 CSP 是纵深防御，不能替代输出编码。
:::

:::details 6. Thymeleaf 的 th:text 和 th:utext、Vue 的 v-html 各是什么风险？
`th:text` 会对内容做 HTML 转义，安全，是默认选择；`th:utext`（unescaped text）直接输出原始 HTML，等同把用户输入当代码，会导致 XSS，只能用于你完全可信或已净化的内容。Vue 的 `v-html` 等价于 `innerHTML`，同样会执行其中的 HTML/脚本，是危险 sink；正常文本用 `{{ }}` 插值（自动转义）。要渲染用户提供的富文本，先经 DOMPurify 等按白名单净化再交给 `v-html`。
:::

:::details 7. 存储型 XSS 打进只有管理员能看的审核页，意味着什么？
意味着一个低权限用户（如 Lab 里的 bob）可以用一条“笔记”把脚本注入到只有管理员会打开的 `/review` 页，从而在管理员的会话里执行代码，窃取管理员权限，完成垂直越权——攻击者借管理员的浏览器做管理员能做的一切。这说明 XSS 的杀伤力和“谁能看这个页面”强相关（那是 Lab 04 访问控制的问题），也说明输出编码这类看似不起眼的疏忽可能直接导致最高权限失守。
:::

## 一句话总结

XSS 是把用户数据当脚本在受害者浏览器里执行，主防线是“存原文、输出时按上下文（HTML 正文/属性/JS/URL）编码”，CSP、HttpOnly、避开 innerHTML 等危险 sink 是纵深防御；HttpOnly 只挡偷 Cookie，绝不能当作解药。
