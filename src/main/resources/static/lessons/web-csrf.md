## 为什么要学

CSRF（跨站请求伪造）是这几课里最“反直觉”的一个：攻击者不需要偷你的密码、不需要注入任何脚本，只要你还登录着某个网站，他就能借你的身份，让你的浏览器悄悄向那个网站发出你不知情的请求——改邮箱、改密码、转账、下单。根因是浏览器的一个“贴心”设计：只要请求发往某个域名，浏览器就自动带上该域名的 Cookie，不管这个请求是从哪个页面发起的。

作为 Java 后端，你几乎一定用过或将用到 Spring Security，而它**默认开启 CSRF 防护**。很多人第一次写前后端分离项目时，POST 请求莫名其妙 403，然后网上搜到“关掉 CSRF 就好了”——这一课就是要让你搞清楚：CSRF 到底防的是什么、什么时候能关、什么时候关了就出事。这直接关系到你项目的会话安全。

CSRF 与前几课有个重要对照：SQL 注入/XSS 是“数据变代码”，而 CSRF 是**滥用“已认证会话”这个信任**。它只在“用 Cookie 承载会话”时才成立——理解这一点，就理解了它的全部前提和解法。

学完这一课，你应该能做到：

- 说清 CSRF 成立的三个前提，并判断一个接口有没有 CSRF 风险。
- 手写一个自动提交的恶意表单，理解攻击是怎么发生的。
- 用 Synchronizer Token、SameSite Cookie 正确防护，并说清 Spring Security 默认防护的机制和该不该关。

> 本课的攻击示例只可用于你自己的环境或已获授权的目标，不要拿去打别人的系统。

## 核心概念

### CSRF 是什么：一张图看懂

假设银行网站 `bank.com` 用 Cookie 维持登录会话，转账接口是 `POST /transfer`。你已登录 bank.com（浏览器里存着 bank 的会话 Cookie），此时你被诱导访问了攻击者的页面 `evil.com`：

```
You (browser)            evil.com                 bank.com
   |                        |                         |
   |--- GET evil page ----->|                         |   你被诱导打开攻击页
   |<-- HTML with a form ---|                         |   页面里藏了个自动提交的表单
   |                                                  |
   |--- POST /transfer  Cookie: session=... --------->|   表单自动提交, 浏览器自动附上 bank 会话 Cookie
   |<-- 200 OK  transfer done ------------------------|   bank 以为是你本人操作
```

关键点：这个 POST 是**从 evil.com 页面发出、发往 bank.com** 的跨站请求。浏览器看到目标是 bank.com，就自动把 bank.com 的 Cookie 带上了。bank.com 收到一个带着合法会话 Cookie 的转账请求，无法区分它是你在 bank 官网点的、还是被 evil.com 骗着发的——于是照单执行。攻击者全程既没拿到你的 Cookie，也没在 bank.com 注入任何代码。

### CSRF 成立的三个前提

一个接口能被 CSRF，必须同时满足：

- **用 Cookie（或 HTTP Basic/Windows 集成认证等）自动携带的凭证维持会话**。因为攻击的核心就是“浏览器自动带凭证”。如果凭证需要 JS 主动读取并放进请求头（如 `Authorization: Bearer`），攻击者的跨站页面拿不到也放不进，就不成立。
- **请求的所有参数都可被攻击者预测/构造**。转账要填的账号、金额，攻击者都能写死在表单里。如果请求里有一个攻击者无从得知的值（比如一次性 token），他就构造不出有效请求。
- **服务端没有额外校验请求的“来源合法性”**。服务端只认 Cookie、不校验 CSRF token、不看 Origin/Referer、Cookie 也没设 SameSite。

这三条正好对应三类解法：token 破坏第二条（引入不可预测值），SameSite 破坏第一条（不自动带 Cookie），校验 Origin/Referer 补第三条。**只要打破任意一条，CSRF 就防住了。**

### 攻击载荷：自动提交的恶意表单

最经典的 CSRF 载荷就是一个页面加载即自动提交的表单，受害者打开页面的瞬间请求就发出去了：

```html
<!-- 挂在 evil.com 上的攻击页 -->
<body onload="document.forms[0].submit()">
  <form action="https://bank.com/transfer" method="POST">
    <input type="hidden" name="to" value="attacker-account">
    <input type="hidden" name="amount" value="10000">
  </form>
</body>
```

注意它用的是普通 HTML 表单。表单 POST 属于浏览器“天然会跨站发起”的请求，不受同源策略阻拦（同源策略限制的是 JS **读取**跨站响应，而不是**发起**请求）。GET 型 CSRF 更简单，一个 `<img src="https://bank.com/transfer?to=x&amount=10000">` 就够了——这也是为什么“用 GET 修改状态”特别危险。

为什么 `fetch()` 发 JSON 反而不好使？因为 `fetch` 发 `application/json` 会触发 CORS 预检（preflight），且默认不带跨站 Cookie（除非 `credentials: 'include'` 且服务端 CORS 放行）。所以传统 CSRF 主要利用表单能发的那几种简单 Content-Type（`application/x-www-form-urlencoded`、`multipart/form-data`、`text/plain`）。这也提示了一个防御副作用：只接受 `application/json` 的接口天然更难被经典 CSRF 打中。

### 防御一：Synchronizer Token（同步器令牌）

服务端为每个会话生成一个不可预测的随机 token，放进页面（表单隐藏域或自定义响应），要求每个改状态的请求都带上它；服务端校验请求里的 token 与会话里存的是否一致。

```
render : hidden field _csrf=abc123, same value stored in session   服务端渲染表单
submit : POST /transfer  body: to=..&amount=..&_csrf=abc123        浏览器提交
check  : body._csrf == session token ?  no -> 403                  服务端校验
```

为什么有效：token 存在服务端会话里，攻击者的 evil.com 页面**读不到**它（跨站不能读你在 bank.com 页面里的内容，同源策略挡住了读取），所以他构造不出带正确 token 的表单——打破了“参数可预测”这一前提。这是最强、最主流的方案，Spring Security 默认用的就是它。

### 防御二：Double Submit Cookie（双重提交 Cookie）

服务端不在会话里存 token，而是把随机 token 同时放进一个 Cookie 和请求参数/头里，服务端只校验“Cookie 里的值”和“请求参数里的值”是否相等。适合无状态、不想在服务端存会话的场景。

它有效的前提是攻击者虽然能让浏览器带上那个 Cookie，却**无法读取它的值**来填进请求参数（跨站读不到 Cookie 内容）。但要小心两个坑：一是若攻击者能通过子域或 XSS 写入/覆盖这个 Cookie，防护会被削弱，所以常用签名或 `__Host-` 前缀 Cookie 加固；二是 XSS 面前所有 CSRF 防护都失效（脚本能直接读 token）。所以它通常比 Synchronizer Token 略弱，需要仔细实现。

### 防御三：SameSite Cookie

`SameSite` 是 Cookie 的一个属性，直接从“浏览器要不要自动带这个 Cookie 跨站发送”这一层切断攻击，打破第一个前提。三种取值：

| 取值 | 跨站请求带 Cookie 吗 | 说明 |
|---|---|---|
| `Strict` | 一律不带 | 最安全，但从外部链接点进来也不带，会掉登录态，体验差 |
| `Lax` | 仅顶级导航的 GET 带；跨站 POST/子资源不带 | 现代浏览器多数默认值，挡住表单 POST 型 CSRF |
| `None` | 都带（必须同时 `Secure`） | 显式允许跨站，用于第三方嵌入等场景 |

`Lax` 是很好的默认：它允许你从别的网站点链接（GET 顶级导航）过来还保持登录，但阻止 evil.com 的自动提交表单（跨站 POST）带上 Cookie。

SameSite 的局限，务必记住：

- **它只是纵深防御，不能替代 token**。原因见下：不同浏览器/版本对 SameSite 默认值和实现有差异，老浏览器可能不支持；不能假设所有用户都受保护。
- **子域不算跨站**。SameSite 判断的是 site（eTLD+1），`a.example.com` 和 `b.example.com` 属同站；若你有被攻陷的子域，它发往主站的请求仍会带 Cookie。
- **`Lax` 挡不住用 GET 改状态**。顶级导航的 GET（包括 `<img>` 在部分情形、以及直接跳转）在 Lax 下仍可能带 Cookie，所以“GET 只读、绝不用 GET 改状态”这条铁律必须遵守。

结论：SameSite（尤其 Lax/Strict）+ token 一起用，才是稳妥组合。

### Spring Security 默认的 CSRF 防护

Spring Security 6+（Spring Boot 3/4）**默认对所有改状态的请求（POST/PUT/PATCH/DELETE）开启 CSRF 防护**，用的是 Synchronizer Token 模式。它对 GET/HEAD/OPTIONS/TRACE 这些“安全方法”不校验（前提是你没用 GET 改状态）。默认行为：

- 生成一个 CSRF token，通过 `CsrfToken` 提供给页面；服务端用 `HttpSessionCsrfTokenRepository`（存会话）或 `CookieCsrfTokenRepository`（存 Cookie，供前后端分离读取）。
- 服务端从请求参数 `_csrf` 或请求头 `X-CSRF-TOKEN`/`X-XSRF-TOKEN` 里取 token 校验，不匹配就 403。

一个典型的显式配置（Spring Security 6 lambda DSL，无 `WebSecurityConfigurerAdapter`、无 `antMatchers`）：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated())
            .formLogin(Customizer.withDefaults())
            // CSRF 默认就是开的；这里演示让前端 JS 能读到 token 的常见配置：
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()));
        return http.build();
    }
}
```

`CookieCsrfTokenRepository.withHttpOnlyFalse()` 会把 token 放进一个名为 `XSRF-TOKEN` 的非 HttpOnly Cookie，前端 JS（如 Axios、Angular）读它、在请求头 `X-XSRF-TOKEN` 里回传——这就是 Double Submit 的变体，适合前后端分离。传统服务端渲染（Thymeleaf）则用默认的会话仓库，模板里 `<form>` 会自动带上隐藏的 `_csrf` 字段（Thymeleaf + Spring Security 集成会自动注入）。

给 Cookie 加 SameSite：Spring Boot 里对 session Cookie 用 `server.servlet.session.cookie.same-site=lax`，对自定义 Cookie 用 `ResponseCookie.from(...).sameSite("Lax").secure(true).build()`。

### 何时可以关掉 CSRF 防护

只有当“CSRF 的第一个前提根本不成立”时，关掉才是安全的。最典型的情形：

- **纯无状态、用 Bearer Token 的 API**。会话不靠 Cookie，而是客户端每次把 `Authorization: Bearer <JWT>` 放进请求头。攻击者的跨站页面无法读取也无法设置这个头（它不是浏览器自动携带的），所以 CSRF 不成立，可以关：

```java
http.csrf(csrf -> csrf.disable())
    .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
```

但注意两个陷阱：一是如果你的“无状态 API”其实把 JWT 存在了 Cookie 里让浏览器自动带，那它又变回了有 CSRF 风险，不能关；二是同一个应用里既有 Cookie 会话页面、又有 Bearer API 时，别一刀切全关，应按路径分别配置。判断标准始终是那句话：**凭证是不是浏览器自动携带的？** 是（Cookie/Basic）就要防 CSRF，不是（手动放头的 Bearer）就不必。

## 动手实践

本项目的 Lab 03（CSRF 攻防）要等做完 Lab 10（Spring Security 登录、真正的 Cookie 会话）之后才能做——因为没有 Cookie 会话就没有 CSRF。所以这里用一个**独立的、可自己复现的小实验**理解攻击原理，等 Lab 10 到位后再回到本项目实战。

### 实践 1：亲手做一个 CSRF 攻击页

找任意一个用 Cookie 会话、且**没做 CSRF 防护**的测试站点（比如你本地起的一个 demo，或 PortSwigger 的靶场，切勿对真实网站操作）。假设它的改邮箱接口是 `POST /my-account/change-email`，参数 `email`。

第一步，写一个恶意页面 `csrf.html`：

```html
<html>
  <body onload="document.forms[0].submit()">
    <form action="https://TARGET/my-account/change-email" method="POST">
      <input type="hidden" name="email" value="attacker@evil.com">
    </form>
  </body>
</html>
```

第二步，在浏览器里**先登录目标站点**（让浏览器存下会话 Cookie），保持标签页开着。

第三步，在同一浏览器里用 `file://` 或另一个域名打开 `csrf.html`。

期望现象：页面一加载，表单自动提交，你回到目标站点会发现邮箱已被改成 `attacker@evil.com`。

怎么读：你全程没有点“提交”，也没输入密码；仅仅因为浏览器在发往目标站的请求里自动带了会话 Cookie，服务端就当成了你本人的操作。这就是 CSRF 的全部——把它和“三个前提”对上：Cookie 会话（前提一）、参数可写死（前提二）、服务端无 token 校验（前提三）。

### 实践 2：验证防护生效

在同样的目标上，换成**开启了 CSRF 防护**的版本（如 Spring Security 默认配置）再打一次同一个 `csrf.html`。

期望现象：服务端返回 **403 Forbidden**，邮箱未被修改。

怎么读：请求里带了会话 Cookie，但没有带正确的 `_csrf` token（攻击页读不到它），服务端校验失败拒绝。你可以用浏览器开发者工具的 Network 面板看到这个 403 和响应里的 CSRF 报错信息。这直接印证了“打破前提二（引入不可预测参数）即可防住”。

### 实践 3：观察 SameSite 的效果

用开发者工具看目标站点的会话 Cookie（Application → Cookies），观察它的 `SameSite` 属性。如果是 `Lax` 或 `Strict`，再从跨站页面发一次自动提交表单：

怎么读：在 `Lax`/`Strict` 下，跨站 POST 时浏览器**根本不带**会话 Cookie，服务端把你当未登录用户处理（通常 401/重定向登录），攻击同样失败——但这次是栽在“前提一”上。对比 `SameSite=None` 的 Cookie 则会照常携带。这让你直观看到两条不同的防线是怎么各自起作用的。

### 实践 4：PortSwigger CSRF（Apprentice）

在 Web Security Academy 的 CSRF 分类做 Apprentice 级 “CSRF vulnerability with no defenses”。它给你一个改邮箱功能，你需要用它自带的 “exploit server” 托管上面那种自动提交表单，投递给受害者。做的时候对照本课：确认它是 Cookie 会话、参数可预测、无 token——三个前提齐全。横幅变绿即通过。

## 攻击者视角

攻击者盯上 CSRF 时的判断链：

1. **目标是 Cookie 会话吗？** 看登录后凭证在 Cookie 还是在 `Authorization` 头，Cookie 才有戏。
2. **改状态接口的参数可预测吗？** 账号、金额、邮箱能写死，就能构造表单。
3. **有 token / SameSite 吗？** 抓包看请求里有没有 `_csrf`、Cookie 有没有 SameSite，都没有就能打。
4. **投递**：用 `<img>`（GET）或自动提交的 form（POST）挂在自己页面，诱导受害者打开。

要点：

- **不需要窃取任何东西**。CSRF 不偷 Cookie、不注入脚本，它利用的是浏览器“自动带 Cookie”的正常机制，所以 HttpOnly、加密传输都挡不住它——防线得在“请求真实性”这一层。
- **GET 改状态是送分题**。只要有 `GET /delete?id=5` 这种能改数据的接口，一个 `<img src>` 就能打，连表单都省了，且 SameSite=Lax 也可能挡不住。所以“安全方法只读”不只是 REST 规范，更是安全底线。
- **CSRF 常和其他漏洞组合**。比如先用存储型 XSS 拿到页面里的 CSRF token（脚本能读同源页面），再发带正确 token 的请求——这时 CSRF 防护形同虚设。所以 XSS 一旦存在，CSRF 防线就崩了，两者要一起治。
- **登录 CSRF**：攻击者也可能反向操作，用 CSRF 让受害者“登录到攻击者的账号”，从而窃取受害者后续在该账号下留下的数据。所以登录、登出这类接口同样要防 CSRF。

## 防御与最佳实践

- **改状态的操作一律用 POST/PUT/PATCH/DELETE，GET 只读**。这是所有其他防护的前提，也是 SameSite=Lax 能生效的基础。
- **对 Cookie 会话开启 CSRF token**（Synchronizer Token 优先）。用 Spring Security 就保持默认开启，别无脑 `csrf().disable()`；服务端渲染让模板自动注入 `_csrf`，前后端分离用 `CookieCsrfTokenRepository` 让前端读 `XSRF-TOKEN`、回传 `X-XSRF-TOKEN`。
- **会话 Cookie 加 `SameSite=Lax`（或 Strict）+ `Secure` + `HttpOnly`**，作为纵深防御。`HttpOnly` 防 XSS 偷 Cookie，`Secure` 只走 HTTPS，`SameSite` 从源头减少跨站携带。
- **对敏感操作做二次校验**：改密码、转账、删除账号等要求重新输入密码或二次确认，即使 CSRF token 泄露也多一道关卡。
- **可校验 Origin/Referer 头**作为补充：拒绝来源不是本站的改状态请求。它是辅助，不能作为唯一防护（个别场景 Referer 会缺失）。
- **纯 Bearer Token API 可关 CSRF，但要确认凭证真的不在 Cookie 里**，并配 `SessionCreationPolicy.STATELESS`，同时按路径区分 Cookie 页面与 Bearer API。
- **和 XSS 一起治**。任何 XSS 都能绕过 CSRF 防护，所以输出编码、CSP 同样是 CSRF 防线的一部分。

## 常见误区

- **“HTTPS/HttpOnly 能防 CSRF。”** 不能。CSRF 不偷 Cookie，它利用浏览器自动携带 Cookie 的正常行为，加密和 HttpOnly 都不影响这个行为。防 CSRF 靠 token/SameSite/来源校验。
- **“POST 请求就天生安全，CSRF 只能打 GET。”** 错。自动提交的 HTML 表单能发跨站 POST，同源策略不阻止“发起”请求。POST 一样要防。
- **“前后端分离 + JSON 就不用管 CSRF。”** 要看凭证放哪。若会话仍在 Cookie 里（浏览器自动带），即便是 JSON API 也有 CSRF 面（尤其若服务端不严格校验 Content-Type）。只有凭证在 `Authorization` 头、不走 Cookie 时才真正免疫。
- **“Spring Security 的 CSRF 老让我 403，关掉最省事。”** 关之前先问：会话是不是 Cookie 承载的？是就不能关，正确做法是让前端正确携带 token。无脑 disable 会直接把整站暴露给 CSRF。
- **“设了 SameSite 就够了，不用 token。”** SameSite 有子域、老浏览器、GET 顶级导航等局限，只是纵深防御。token 才是主防线，两者叠加。
- **“CSRF token 放哪都行。”** 别把 token 放进 URL（会经 Referer、日志泄露）。放表单隐藏域或自定义请求头。

## 自测

:::details 1. 纯 Bearer Token（放在 Authorization 头）的 API 需要防 CSRF 吗？
通常不需要。CSRF 的核心前提是“凭证由浏览器自动携带”，而 Bearer Token 是客户端每次手动放进 `Authorization` 请求头的，攻击者的跨站页面既读不到也无法让浏览器自动带上这个头，所以构造不出带有效凭证的跨站请求，CSRF 不成立。前提是必须确认凭证真的只在头里、没有同时存进 Cookie 让浏览器自动携带；如果 JWT 被放进了 Cookie，那 CSRF 风险又回来了。这也是为什么无状态 Bearer API 通常配 `csrf().disable()` + `SessionCreationPolicy.STATELESS`。
:::

:::details 2. CSRF 成立需要哪三个前提？分别对应什么解法？
一，用 Cookie（或 Basic 等浏览器自动携带的凭证）维持会话；二，改状态请求的所有参数都可被攻击者预测/构造；三，服务端没有额外的来源合法性校验。对应解法：SameSite Cookie 打破前提一（跨站不自动带 Cookie）；CSRF token 打破前提二（引入攻击者读不到的不可预测值）；校验 Origin/Referer 补前提三。打破任意一条即可防住，实践中 token + SameSite 叠加最稳。
:::

:::details 3. 为什么自动提交的 POST 表单能打 CSRF，同源策略不管吗？
同源策略限制的是 JS **读取**跨站响应的内容，而不是**发起**跨站请求。HTML 表单提交（GET/POST）本就是浏览器允许的跨站行为，攻击者不需要读响应，他只要让请求发出去、被服务端执行即可。而且发往目标域的请求会自动带上目标域的 Cookie。所以一个 `onload` 自动提交的表单就能完成攻击，POST 并不天生安全。用 `fetch` 发 JSON 反而受 CORS 预检和默认不带跨站 Cookie 的限制，所以经典 CSRF 主要用表单。
:::

:::details 4. SameSite 的三种取值有什么区别？它有哪些局限？
`Strict`：任何跨站请求都不带 Cookie，最安全但从外链点进来也会掉登录态。`Lax`：仅顶级导航的 GET 携带，跨站 POST 和子资源不带，是现代浏览器常见默认值，能挡表单 POST 型 CSRF。`None`：跨站也带，但必须同时 `Secure`。局限：只是纵深防御，不能替代 token；老浏览器/不同实现有差异；子域属同站（SameSite 按 eTLD+1 判定），被攻陷的子域发往主站仍带 Cookie；`Lax` 下顶级导航 GET 仍可能带 Cookie，所以绝不能用 GET 改状态。
:::

:::details 5. Spring Security 默认怎么防 CSRF？什么时候可以关？
Spring Security 6+ 默认对 POST/PUT/PATCH/DELETE 开启 CSRF 防护，用 Synchronizer Token 模式：为会话生成随机 token，从请求参数 `_csrf` 或头 `X-CSRF-TOKEN`/`X-XSRF-TOKEN` 校验，不匹配返回 403；GET 等安全方法不校验。服务端渲染时模板自动注入 `_csrf`，前后端分离可用 `CookieCsrfTokenRepository.withHttpOnlyFalse()` 让前端读 `XSRF-TOKEN` 回传。只有当会话不靠 Cookie（纯 Bearer Token、STATELESS）时才可以安全关闭；只要是 Cookie 会话就不能关，403 的正解是让前端正确携带 token，而不是 disable。
:::

:::details 6. XSS 存在时 CSRF 防护还有用吗？
基本没用。CSRF token 之所以有效，是因为攻击者的跨站页面读不到你在目标站页面里的 token（同源策略挡住跨站读取）。但 XSS 让攻击者的脚本运行在目标站**同源**环境里，它能直接读到页面/Cookie 里的 CSRF token，再带着正确 token 发请求，防护形同虚设。所以 XSS 会击穿 CSRF 防线，两者必须一起治理——输出编码、CSP 也是保护 CSRF 的一部分。
:::

:::details 7. 为什么“GET 用来修改状态”特别危险？
因为 GET 请求太容易被跨站发起：一个 `<img src="https://site/delete?id=5">` 就能在受害者浏览器里发出并自动带 Cookie，连表单和 JS 都不需要；而且 SameSite=Lax 对顶级导航的 GET 仍可能放行 Cookie，SameSite 也保护不全。此外 GET 的参数会出现在 URL 里，容易经浏览器历史、Referer、日志、CDN 缓存泄露。所以规范和安全都要求：GET/HEAD 等安全方法只读、绝不修改状态，改状态一律用 POST/PUT/PATCH/DELETE。
:::

## 一句话总结

CSRF 是攻击者借你已登录的 Cookie 会话，诱导你的浏览器发出你不知情的改状态请求；它成立于“Cookie 自动携带 + 参数可预测 + 无来源校验”三前提，主防线是 CSRF token（Spring Security 默认开启）、纵深是 SameSite Cookie 和“GET 只读”，而纯 Bearer Token 的 API 因凭证不自动携带通常无需防护。
