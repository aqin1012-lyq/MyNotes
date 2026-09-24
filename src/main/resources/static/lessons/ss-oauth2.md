## 为什么要学

[[ss-arch]] 让你在自己的系统里完成“登录”，[[ss-authz]] 让你决定“登录后能做什么”。但真实系统很少只有一个应用：车联网平台有 App、Web 控制台、第三方充电桩运营商；电商有商家后台、开放平台、“微信登录”。这时需要一个统一的授权服务器来发令牌，各个应用只认令牌、不碰密码，这就是 OAuth 2.0；在它之上再加一层“告诉客户端用户是谁”，就是 OpenID Connect（OIDC）。

OAuth2 本身是“授权”协议：用户授权某个客户端代表自己访问某些资源。它不规定客户端怎么知道用户是谁，所以很多年里大家用它“凑合着做登录”，漏洞频出。OIDC 补上了认证这一块（ID Token、UserInfo、Discovery）。今天的 Keycloak、Auth0、Okta、Azure AD（Entra ID）、各类“统一身份认证平台”都是 OAuth2 + OIDC。

学完之后你能：画出授权码 + PKCE 的每一个 HTTP 请求；说清楚为什么隐式模式和密码模式被 RFC 9700 淘汰；区分 ID Token 和 Access Token；用 Keycloak + Spring Boot 搭出“登录客户端 + JWT 资源服务器”两件套；在渗透测试里检查 redirect_uri、state、令牌泄露三类高频问题。令牌的有效期、刷新、撤销、SSO 登出放在 [[ss-token]]，JWT 本身的攻击（alg=none、密钥混淆）放在 [[web-authn]]，本课不重复。

:::tip 版本约定
沿用 [[ss-arch]] 的环境：Spring Boot 4.1（Spring Security 7.x）、Java 17、lambda DSL；授权服务器用 Keycloak 26.0（容器镜像 `quay.io/keycloak/keycloak:26.0`）。涉及版本差异的地方会标出。
:::

> 本课中的攻击手法只用于你自己的实验环境或获得授权的目标。

## 核心概念

### 1. 四个角色

以“充电桩运营商 App 想读取你在车企平台上的车辆电量”为例：

| 角色 | 含义 | 例子 |
|---|---|---|
| Resource Owner（资源所有者） | 能授权访问资源的人，通常就是终端用户 | 车主 alice |
| Client（客户端） | 想代表用户访问资源的应用 | 充电桩运营商 App / 网站 |
| Authorization Server（授权服务器） | 认证用户、征得同意、签发令牌 | 车企的 Keycloak |
| Resource Server（资源服务器） | 保存资源、校验令牌后提供 API | 车企的 `vehicle-api` 服务 |

```
+-------------+                                +----------------------+
| Resource    |  1. login + consent            | Authorization Server |  认证用户、签发令牌
| Owner       |------------------------------->| (Keycloak)           |
+-------------+                                +----------------------+
       ^                                          ^            |
       | uses                   3. code -> token  |            | 2. code via redirect
       |                                          |            v
+-------------+  4. GET /vehicles  Bearer AT   +----------------------+
| Resource    |<-------------------------------| Client               |  代表用户调用 API
| Server (API)|                                | (web app / mobile)   |
+-------------+                                +----------------------+
```

关键点：客户端从头到尾拿不到用户的密码，只拿到一个**有范围（scope）、有期限**的 Access Token。资源服务器只认令牌，不关心用户是在哪个页面登录的。

### 2. 授权码模式 + PKCE：完整的 HTTP 交换

授权码模式（Authorization Code Grant，RFC 6749）把流程拆成两段：浏览器前端通道只传一个一次性的 `code`，真正的令牌在后端通道（客户端直连授权服务器）换取。PKCE（RFC 7636，读作 pixie）再给 `code` 加一把锁：客户端先生成随机的 `code_verifier`，只把它的哈希 `code_challenge` 放进第一步；换令牌时再出示原文。偷到 `code` 的人没有 `code_verifier`，换不出令牌。

```
Browser            Client (8081)              Keycloak (8180)          API (8082)
  |  GET /private     |                           |                       |
  |------------------>|                           |                       |
  |  302 -> /auth?..  |  gen state, verifier      |                       |  生成随机值并存入会话
  |<------------------|                           |                       |
  |  GET /auth?response_type=code&code_challenge=..  -------------------->|  浏览器跳到授权服务器
  |  login + consent  |                           |                       |
  |  302 -> /login/oauth2/code/keycloak?code=..&state=..                  |  code 经浏览器回到客户端
  |------------------>|  check state              |                       |
  |                   |  POST /token code+verifier|                       |  后端通道换令牌
  |                   |-------------------------->|                       |
  |                   |  access_token, id_token   |                       |
  |                   |<--------------------------|                       |
  |                   |  GET /api/notes  Authorization: Bearer AT ------->|  携带令牌调用 API
```

第 0 步：客户端生成三个随机值（这里是示例值）：

```
state          = af0ifjsldkj
code_verifier  = dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
code_challenge = BASE64URL(SHA256(code_verifier)) = E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
```

`code_verifier` 是 43～128 个字符的高熵随机串；`S256` 表示对它做 SHA-256 再做无填充的 Base64URL。上面这一对值正是 RFC 7636 附录里的示例，可以用来核对自己的实现。`plain` 方式（challenge 等于 verifier 原文）只在无法做 SHA-256 时才允许，实际中不要用。

第 1 步：客户端把浏览器重定向到授权端点（为了可读已换行，实际是一行 URL）：

```
HTTP/1.1 302 Found
Location: http://localhost:8180/realms/demo/protocol/openid-connect/auth
  ?response_type=code
  &client_id=notes-web
  &redirect_uri=http%3A%2F%2Flocalhost%3A8081%2Flogin%2Foauth2%2Fcode%2Fkeycloak
  &scope=openid%20profile%20notes.read
  &state=af0ifjsldkj
  &nonce=n-0S6_WzA2Mj
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
```

- `scope=openid` 表示这是 OIDC 请求，会额外拿到 ID Token；`nonce` 会被原样写进 ID Token，用来防 ID Token 重放。
- `state` 由客户端存进会话，回调时比对，防 CSRF（见“攻击者视角”）。
- `redirect_uri` 必须与授权服务器上登记的值**精确匹配**。

第 2 步：用户在 Keycloak 登录并同意后，Keycloak 把浏览器送回客户端：

```
HTTP/1.1 302 Found
Location: http://localhost:8081/login/oauth2/code/keycloak?state=af0ifjsldkj&session_state=...&code=SplxlOBeZQQYbYS6WxSbIA
```

客户端先检查 `state` 与会话里的值相同，再进入第 3 步。`code` 一次性、有效期很短（通常几十秒到一分钟）。

第 3 步：客户端后端直连令牌端点，用 `code` + `code_verifier` 换令牌（机密客户端还要做客户端认证，这里用 HTTP Basic）：

```
POST /realms/demo/protocol/openid-connect/token HTTP/1.1
Host: localhost:8180
Authorization: Basic bm90ZXMtd2ViOnNlY3JldA==
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=SplxlOBeZQQYbYS6WxSbIA
&redirect_uri=http%3A%2F%2Flocalhost%3A8081%2Flogin%2Foauth2%2Fcode%2Fkeycloak
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

授权服务器会校验：`code` 未被用过且属于这个 `client_id`；`redirect_uri` 与第 1 步相同；`SHA256(code_verifier)` 等于第 1 步的 `code_challenge`。全部通过才返回：

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIi...",
  "expires_in": 300,
  "refresh_expires_in": 1800,
  "refresh_token": "eyJhbGciOiJIUzUxMiIsInR5cCIgOiAiSldUIiwia2lkIi...",
  "token_type": "Bearer",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUIiwia2lkIi...",
  "scope": "openid profile notes.read"
}
```

怎么读：`token_type=Bearer` 表示“谁持有谁就能用”，所以令牌泄露等于身份泄露；`expires_in=300` 是 Keycloak 默认的 5 分钟 Access Token；`refresh_token` 的轮换与撤销见 [[ss-token]]；`id_token` 只因为 scope 里有 `openid` 才出现。

第 4 步：客户端调用 API：`GET /api/notes` 加请求头 `Authorization: Bearer eyJhbGciOiJSUzI1NiIs...`。资源服务器用授权服务器公布的公钥（JWKS）验签，再检查 `iss`、`exp`、`aud`/scope。

### 3. 为什么隐式模式和密码模式被废弃

RFC 6749 当年定义了四种授权方式：授权码、隐式（Implicit）、密码（Resource Owner Password Credentials）、客户端凭证（Client Credentials）。2025 年发布的 RFC 9700（OAuth 2.0 Security Best Current Practice）总结了十几年的攻击经验，结论是：

| 授权方式 | RFC 9700 的态度 | 原因 |
|---|---|---|
| 隐式 `response_type=token` | 不应再使用（SHOULD NOT） | Access Token 直接出现在重定向 URL 的 fragment 里，会进浏览器历史、可能被恶意脚本或开放重定向偷走；无法绑定客户端、无法用 PKCE 保护；不能发 Refresh Token |
| 密码模式 `grant_type=password` | 禁止使用（MUST NOT） | 客户端直接拿到用户密码，违背 OAuth 的初衷；无法接入 MFA、验证码、联合登录；教会用户“在第三方页面输密码”，等于训练钓鱼 |
| 授权码 + PKCE | 推荐；公共客户端必须用 PKCE，机密客户端也建议用 | code 只走前端通道且有 PKCE 绑定，令牌只走后端通道 |
| 客户端凭证 | 保留 | 服务对服务调用，没有用户参与 |

隐式模式当初存在，是因为十几年前的单页应用无法跨域 POST 令牌端点；今天浏览器普遍支持 CORS，SPA 完全可以用授权码 + PKCE，所以隐式模式没有存在理由了。更进一步的做法是 BFF（Backend for Frontend）：令牌只留在后端，浏览器只拿一个 HttpOnly 会话 Cookie——下面实践里的 `oauth2Login` 应用就是这种形态。

正在制定中的 OAuth 2.1 草案把这些结论直接写进了核心规范：去掉隐式和密码模式、授权码必须配 PKCE、redirect_uri 精确匹配。

### 4. OIDC：ID Token、UserInfo、Discovery

OAuth2 的 Access Token 对客户端来说是**不透明**的：规范不要求客户端能解析它，它是给资源服务器看的。于是 OIDC 专门给客户端发了一张“身份证”——ID Token，一定是签名的 JWT。解码第 3 步里 `id_token` 的 payload：

```
{
  "iss": "http://localhost:8180/realms/demo",
  "sub": "4f3c1c1e-9f0a-4a7e-b0e2-2c3d5a6b7c8d",
  "aud": "notes-web",
  "exp": 1790000300,
  "iat": 1790000000,
  "auth_time": 1789999990,
  "nonce": "n-0S6_WzA2Mj",
  "azp": "notes-web",
  "preferred_username": "alice",
  "email": "alice@example.com"
}
```

客户端必须校验：签名（用 JWKS 公钥）、`iss` 等于配置的发行者、`aud` 包含自己的 `client_id`、`exp` 未过期、`nonce` 等于第 1 步发出的值。用户的唯一标识是 `iss` + `sub` 的组合，而**不是** email（email 可改、可能未验证，用 email 关联账号是经典的账号接管漏洞）。

| 对比 | ID Token | Access Token |
|---|---|---|
| 给谁看 | 客户端（Relying Party） | 资源服务器（API） |
| 回答什么 | 用户是谁、何时怎样登录的 | 持有者能访问哪些资源（scope） |
| `aud` | 客户端的 `client_id` | API（Keycloak 默认常见为 `account`，可配置） |
| 格式 | 规范要求是 JWT | 规范不限定；Keycloak 默认是 JWT |
| 发给 API 吗 | 不 | 是，`Authorization: Bearer` |

:::tip 课程问题：ID Token 能不能拿来调用后端 API？
不能。第一，受众不对：ID Token 的 `aud` 是客户端自己，一个正确校验 `aud` 的 API 会拒绝它；如果某个 API 接受了，说明它没校验受众，任何其他应用拿到的 ID Token（比如用户登录过的另一个恶意客户端）都能被拿来冒充调用，这就是“令牌替换”问题。第二，语义不对：ID Token 表达“认证事件”，不携带授权范围（scope），API 无法据此判断能做什么。第三，生命周期不对：ID Token 没有刷新、撤销、Introspection 这套机制。正确做法是向授权服务器申请一张 `aud` 指向该 API 的 Access Token。
:::

**UserInfo 端点**：客户端用 Access Token 调用 `GET /realms/demo/protocol/openid-connect/userinfo`，拿到最新的用户属性（claims）。它适合拿 ID Token 里没放的信息；它本身是一个受 Access Token 保护的资源。

```
$ curl -s -H "Authorization: Bearer $AT" http://localhost:8180/realms/demo/protocol/openid-connect/userinfo
{"sub":"4f3c1c1e-...","email_verified":true,"preferred_username":"alice","email":"alice@example.com"}
```

**Discovery**：发行者 URL 后加 `/.well-known/openid-configuration`，就能拿到全部端点和能力清单。Spring Boot 只需配一个 `issuer-uri`，启动时就是靠它自动发现其余端点的。

```
$ curl -s http://localhost:8180/realms/demo/.well-known/openid-configuration | jq '{issuer,authorization_endpoint,token_endpoint,userinfo_endpoint,jwks_uri,code_challenge_methods_supported}'
{
  "issuer": "http://localhost:8180/realms/demo",
  "authorization_endpoint": "http://localhost:8180/realms/demo/protocol/openid-connect/auth",
  "token_endpoint": "http://localhost:8180/realms/demo/protocol/openid-connect/token",
  "userinfo_endpoint": "http://localhost:8180/realms/demo/protocol/openid-connect/userinfo",
  "jwks_uri": "http://localhost:8180/realms/demo/protocol/openid-connect/certs",
  "code_challenge_methods_supported": ["plain", "S256"]
}
```

### 5. OAuth 常见漏洞：redirect_uri、state、令牌泄露

OAuth 协议本身没多少“漏洞”，问题几乎都出在**实现和配置**上。三类最高频的：

| 漏洞 | 成因 | 后果 | 修复 |
|---|---|---|---|
| redirect_uri 校验不严 | 授权服务器只做前缀匹配、通配符、只比域名，或者允许任意子路径 | `code`（隐式模式下直接是令牌）被发到攻击者控制的地址，账号被接管 | 注册完整 URL，逐字符精确匹配 |
| state 缺失或不校验 | 客户端不发 state，或回调时不比对 | 登录 CSRF：受害者被登录进攻击者账号，或攻击者的第三方账号被绑定到受害者账号 | 每次授权生成随机 state 存会话并校验；再加 PKCE |
| 令牌泄露 | 令牌或 code 出现在 URL、Referer、访问日志、前端 localStorage、错误报告里 | 持有即可用（Bearer），直到过期 | 不用隐式模式；回调页设 `Referrer-Policy`；日志脱敏；短有效期 |

具体攻击步骤见下文“攻击者视角”。记住一条主线：OAuth 的安全性依赖于“code 只能回到合法客户端 + 只有发起者能兑换 code + 令牌只在后端通道流动”，任何一环松动都会出事。

### 6. Spring Security 的三块拼图

| 模块 | 角色 | 入口 API | Boot 配置前缀 |
|---|---|---|---|
| OAuth2 Client | Client（含 OIDC 登录） | `http.oauth2Login(...)`、`http.oauth2Client(...)` | `spring.security.oauth2.client.*` |
| OAuth2 Resource Server | Resource Server | `http.oauth2ResourceServer(o -> o.jwt(...))` | `spring.security.oauth2.resourceserver.*` |
| Authorization Server | Authorization Server | 见下文说明 | `spring.security.oauth2.authorizationserver.*` |

`oauth2Login` 在过滤器链（见 [[ss-arch]]）里加入两个关键过滤器：`OAuth2AuthorizationRequestRedirectFilter` 处理 `/oauth2/authorization/{registrationId}`，生成 state/nonce/PKCE 并重定向；`OAuth2LoginAuthenticationFilter` 处理 `/login/oauth2/code/{registrationId}` 回调，校验 state、换令牌、校验 ID Token，最后得到 `OAuth2AuthenticationToken`（主体是 `OidcUser`）。`oauth2ResourceServer` 加入 `BearerTokenAuthenticationFilter`，把合法 JWT 变成 `JwtAuthenticationToken`，之后照常走 [[ss-authz]] 的授权。

Authorization Server：原来的独立项目 Spring Authorization Server 已经并入 Spring Security 主仓库（官方文档路径见资源列表里的“Authorization Server（原 Spring Authorization Server）”）。它的 7.x 具体配置 API 本课不展开，要自建授权服务器时请以当前版本的官方参考文档为准；本课的实践使用 Keycloak，Spring 端只做客户端和资源服务器。

## 动手实践

### 实践 1：用 Keycloak 搭授权服务器

MyNotes 占用了 8080，所以把 Keycloak 映射到 8180。`start-dev` 是开发模式（HTTP、内置 H2 数据库），只能用于学习：

```
docker run --name kc -p 8180:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0 start-dev
```

预期输出（节选）：看到类似 `Keycloak 26.0.x on JVM ... started in 5.xxxs. Listening on: http://0.0.0.0:8080` 和 `Running the server in development mode. DO NOT use this configuration in production.` 即可。Keycloak 26 起管理员用 `KC_BOOTSTRAP_ADMIN_*` 变量创建，旧的 `KEYCLOAK_ADMIN` 变量已被标记为弃用。

打开 `http://localhost:8180`，用 admin/admin 登录管理控制台，按顺序配置：

1. 左上角下拉 → Create realm，名称 `demo`。
2. Users → Create user，用户名 `alice`，填 email 并勾选 Email verified；Credentials 页设置密码 `alice123`，关闭 Temporary。
3. Client scopes → Create client scope，名称 `notes.read`，类型 Optional；进入它的 Mappers → Configure a new mapper → Audience，Included Custom Audience 填 `notes-api`，打开 Add to access token。这样带这个 scope 的 Access Token 的 `aud` 就会包含 `notes-api`。
4. Clients → Create client，Client ID `notes-web`；Client authentication 打开（机密客户端），只勾 Standard flow（关闭 Direct access grants，也就是密码模式）；Valid redirect URIs 填 `http://localhost:8081/login/oauth2/code/keycloak`（完整 URL，不要用 `*`）；Web origins 填 `http://localhost:8081`。
5. `notes-web` → Advanced → Proof Key for Code Exchange Code Challenge Method 选 `S256`，保存。设置后不带 PKCE 的授权请求会被 Keycloak 拒绝。
6. `notes-web` → Client scopes → Add client scope，把 `notes.read` 加为 Optional；Credentials 页复制 Client secret。
7. 再建一个公共客户端 `cli-demo` 供手动实验：Client authentication 关闭，Standard flow 开，redirect URI 填 `http://localhost:9999/cb`，同样设置 PKCE 为 S256，并在它的 Client scopes 里也把 `notes.read` 加为 Optional。

验证：`curl -s http://localhost:8180/realms/demo/.well-known/openid-configuration | jq .issuer` 应输出 `"http://localhost:8180/realms/demo"`。这个值就是后面 Spring 配置里的 `issuer-uri`，两边必须逐字相同（包括端口，不带结尾斜杠）。

### 实践 2：手动走一遍授权码 + PKCE（curl）

先亲手做一遍，之后看 Spring 的日志才知道它在干什么。在 macOS/Linux 终端生成 verifier 和 challenge：

```
VERIFIER=$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=\n')
STATE=$(openssl rand -hex 16)
echo "$VERIFIER"; echo "$CHALLENGE"; echo "$STATE"
echo "http://localhost:8180/realms/demo/protocol/openid-connect/auth?response_type=code&client_id=cli-demo&redirect_uri=http%3A%2F%2Flocalhost%3A9999%2Fcb&scope=openid%20notes.read&state=$STATE&code_challenge=$CHALLENGE&code_challenge_method=S256"
```

把最后一行 URL 贴到浏览器，用 alice 登录。浏览器会跳到 `http://localhost:9999/cb?state=...&code=...` 并显示“无法连接”——这是正常的，本机 9999 没有服务。从地址栏复制 `code`，先确认 `state` 和上面打印的一致，然后在一分钟内执行：

```
curl -s -X POST http://localhost:8180/realms/demo/protocol/openid-connect/token \
  -d grant_type=authorization_code -d client_id=cli-demo \
  -d redirect_uri=http://localhost:9999/cb \
  -d code="PASTE_CODE_HERE" -d code_verifier="$VERIFIER" | jq '{token_type,expires_in,scope}'
```

预期输出：

```
{
  "token_type": "Bearer",
  "expires_in": 300,
  "scope": "openid email profile notes.read"
}
```

怎么读：`scope` 里除了你请求的，还有 Keycloak 默认附加的 `email profile`（它们是该客户端的 Default client scopes）。再做三个对照实验，观察 Keycloak 返回的 `error`：

| 操作 | 预期结果 | 说明 |
|---|---|---|
| 同一个 code 再换一次 | `invalid_grant` | code 一次性 |
| 换一个随机的 `code_verifier` | `invalid_grant`，描述里提到 PKCE 校验失败 | 偷到 code 也没用 |
| 授权 URL 去掉 `code_challenge` | 登录页直接报错，`error=invalid_request`，提示缺少 code_challenge | 第 5 步强制了 PKCE |
| redirect_uri 改成 `http://localhost:9999/cb/../evil` | 显示 Invalid parameter: redirect_uri | 精确匹配生效 |

把上面 curl 的 `| jq ...` 换成 `| jq -r .access_token` 存进变量 `AT`，在本地解码 payload：`echo "$AT" | cut -d. -f2 | tr '_-' '/+' | base64 -d`（末尾缺 `=` 填充时可能报 invalid input，但 JSON 已经打印出来了）。确认 `aud` 包含 `notes-api`、`scope` 包含 `notes.read`、`iss` 与 Discovery 的 issuer 相同。令牌是凭证，不要贴到在线解码网站。

### 实践 3：Spring Boot 客户端 `oauth2Login`（notes-web，端口 8081）

新建一个独立的 Spring Boot 4.1 项目（不要改 MyNotes 本身），依赖：`spring-boot-starter-web`、`spring-boot-starter-security`，以及 OAuth2 客户端 starter。Spring Boot 4 把 OAuth2 starter 改名为 `spring-boot-starter-security-oauth2-client`（Boot 3.x 叫 `spring-boot-starter-oauth2-client`），以你所用版本的官方文档为准。

`application.yml`：

```yaml
server:
  port: 8081
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-id: notes-web
            client-secret: ${NOTES_WEB_SECRET}
            authorization-grant-type: authorization_code
            scope: openid,profile,notes.read
        provider:
          keycloak:
            issuer-uri: http://localhost:8180/realms/demo
logging:
  level:
    org.springframework.security: DEBUG
```

- 注册 ID `keycloak` 决定了两个 URL：发起登录 `/oauth2/authorization/keycloak`，回调 `/login/oauth2/code/keycloak`（默认 `redirect-uri` 是 `{baseUrl}/login/oauth2/code/{registrationId}`），这正是 Keycloak 里登记的那一个。
- 只写 `issuer-uri`，其余端点启动时通过 Discovery 获取；所以启动时 Keycloak 必须可达。
- 密钥通过环境变量注入，不要提交到 Git。

安全配置：机密客户端也显式开启 PKCE（Spring Security 对公共客户端自动启用 PKCE；对机密客户端的默认行为在不同版本有变化，显式配置最稳妥）：

```java
package com.example.notesweb;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.DefaultOAuth2AuthorizationRequestResolver;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestCustomizers;
import org.springframework.security.oauth2.client.web.OAuth2AuthorizationRequestRedirectFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    SecurityFilterChain web(HttpSecurity http, ClientRegistrationRepository repo) throws Exception {
        var resolver = new DefaultOAuth2AuthorizationRequestResolver(repo,
                OAuth2AuthorizationRequestRedirectFilter.DEFAULT_AUTHORIZATION_REQUEST_BASE_URI);
        resolver.setAuthorizationRequestCustomizer(OAuth2AuthorizationRequestCustomizers.withPkce());

        http.authorizeHttpRequests(a -> a
                .requestMatchers("/").permitAll()
                .anyRequest().authenticated())
            .oauth2Login(o -> o.authorizationEndpoint(e -> e.authorizationRequestResolver(resolver)))
            .logout(l -> l.logoutSuccessUrl("/"));
        return http.build();
    }
}
```

控制器：`/me` 展示 OIDC 用户，`/notes` 拿着 Access Token 调用 API（BFF 形态：令牌只在服务端）：

```java
package com.example.notesweb;

import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.annotation.RegisteredOAuth2AuthorizedClient;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

@RestController
public class NotesWebController {

    private final RestClient api = RestClient.create("http://localhost:8082");

    @GetMapping("/me")
    Map<String, Object> me(@AuthenticationPrincipal OidcUser user) {
        return Map.of("sub", user.getSubject(),
                "username", user.getPreferredUsername(),
                "idTokenAud", user.getIdToken().getAudience());
    }

    @GetMapping("/notes")
    String notes(@RegisteredOAuth2AuthorizedClient("keycloak") OAuth2AuthorizedClient client) {
        String accessToken = client.getAccessToken().getTokenValue();
        return api.get().uri("/api/notes")
                .headers(h -> h.setBearerAuth(accessToken))
                .retrieve().body(String.class);
    }
}
```

启动：`NOTES_WEB_SECRET=<复制的secret> ./mvnw spring-boot:run`。先不用浏览器，用 curl 看第 1 步的重定向：

```
$ curl -si http://localhost:8081/oauth2/authorization/keycloak | grep -i '^location'
Location: http://localhost:8180/realms/demo/protocol/openid-connect/auth?response_type=code&client_id=notes-web&scope=openid%20profile%20notes.read&state=Xk3...&redirect_uri=http://localhost:8081/login/oauth2/code/keycloak&nonce=q9V...&code_challenge=4Zr...&code_challenge_method=S256
```

怎么读：`state`、`nonce`、`code_challenge` 都是 Spring 生成的，它们和 `code_verifier` 一起保存在服务端会话里（`HttpSessionOAuth2AuthorizationRequestRepository`）。如果这里没有 `code_challenge`，说明 PKCE 没开，Keycloak 会拒绝（因为实践 1 第 5 步强制了 S256）。

然后用浏览器访问 `http://localhost:8081/me`，被重定向到 Keycloak 登录，登录后看到：

```
{"sub":"4f3c1c1e-...","username":"alice","idTokenAud":["notes-web"]}
```

`idTokenAud` 是 `notes-web`，再次印证 ID Token 是发给客户端的。DEBUG 日志里能看到回调请求依次经过 `OAuth2LoginAuthenticationFilter`，并出现类似 `Set SecurityContextHolder to OAuth2AuthenticationToken [Principal=Name: [4f3c1c1e-...] ...` 的行——认证完成后的会话处理与 [[ss-arch]] 中表单登录一样。访问 `/notes` 需要实践 4 的 API 先启动。

### 实践 4：资源服务器 `oauth2ResourceServer(jwt)`（notes-api，端口 8082）

另建一个项目，依赖 `spring-boot-starter-web`、`spring-boot-starter-security` 和资源服务器 starter（Boot 4 为 `spring-boot-starter-security-oauth2-resource-server`，Boot 3.x 为 `spring-boot-starter-oauth2-resource-server`）。

```yaml
server:
  port: 8082
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8180/realms/demo
          audiences: notes-api
```

- `issuer-uri`：启动时通过 Discovery 找到 `jwks_uri` 拉取公钥，并校验每个令牌的 `iss`；同时默认校验 `exp`/`nbf`。
- `audiences`：要求 `aud` 包含 `notes-api`。不配这一行，任何发给同一 realm 其他应用的令牌（包括 ID Token）都可能通过验签。

```java
package com.example.notesapi;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class ApiSecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(a -> a
                .requestMatchers("/api/notes/**").hasAuthority("SCOPE_notes.read")
                .anyRequest().authenticated())
            .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(keycloakConverter())))
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(c -> c.disable()); // 纯 Bearer 头、无 Cookie 会话的 API，CSRF 不适用
        return http.build();
    }

    private JwtAuthenticationConverter keycloakConverter() {
        var scopes = new JwtGrantedAuthoritiesConverter(); // scope claim -> SCOPE_xxx
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Collection<GrantedAuthority> out = new ArrayList<>(scopes.convert(jwt));
            Map<String, Object> realm = jwt.getClaimAsMap("realm_access");
            if (realm != null && realm.get("roles") instanceof List<?> roles) {
                roles.forEach(r -> out.add(new SimpleGrantedAuthority("ROLE_" + r)));
            }
            return out;
        });
        converter.setPrincipalClaimName("preferred_username");
        return converter;
    }
}
```

```java
package com.example.notesapi;

import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NotesApiController {

    @GetMapping("/api/notes")
    Map<String, Object> notes(@AuthenticationPrincipal Jwt jwt) {
        // 数据归属用 iss+sub，而不是 email；对象级授权沿用 ss-authz 的做法
        return Map.of("owner", jwt.getSubject(),
                "client", jwt.getClaimAsString("azp"),
                "notes", List.of("charging schedule", "OBS bucket policy"));
    }
}
```

`realm_access.roles` 是 Keycloak 放 realm 角色的位置；把它映射成 `ROLE_xxx` 之后，[[ss-authz]] 里的 `hasRole`、`@PreAuthorize` 可以原样使用。用实践 2 的方式拿 `cli-demo` 的令牌（scope 带 `notes.read`），分别测试：

```
$ curl -si http://localhost:8082/api/notes | head -3
HTTP/1.1 401
WWW-Authenticate: Bearer

$ curl -s -H "Authorization: Bearer $AT" http://localhost:8082/api/notes
{"owner":"4f3c1c1e-...","client":"cli-demo","notes":["charging schedule","OBS bucket policy"]}

$ curl -si -H "Authorization: Bearer $IDT" http://localhost:8082/api/notes | grep -i www-auth
WWW-Authenticate: Bearer error="invalid_token", error_description="An error occurred while attempting to decode the Jwt: The aud claim is not valid", error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"
```

怎么读：没有令牌是 401 且只有 `Bearer`（RFC 6750 的挑战头）；Access Token 通过，`azp`（authorized party）告诉你是哪个客户端代用户来调用的；第三条用 ID Token（`$IDT` 取自令牌响应的 `id_token`）调用，签名、`iss` 都对，但 `aud` 是 `cli-demo` 而非 `notes-api`，被拒绝——这就是课程问题的实验证明。具体的 `error_description` 文字随版本可能略有不同。如果授权请求里不带 `notes.read`，Access Token 的 `aud` 里没有 `notes-api`，同样会 401；若你去掉 `audiences` 配置再试，则会在授权阶段得到 403 和 `error="insufficient_scope"`。

最后回到浏览器访问 `http://localhost:8081/notes`：notes-web 用会话里保存的 Access Token 调用 notes-api，返回同样的 JSON，`client` 为 `notes-web`。完整的一次授权码 + PKCE 登录与 API 调用就闭环了。

### 实践 5：PortSwigger OAuth 实验

在 PortSwigger Web Security Academy 的 OAuth authentication 专题（资源列表里有链接）注册免费账号，配合 Burp Suite 社区版完成实验。建议顺序与每个实验要观察的点：

| 实验主题 | 要在 Burp 里找什么 | 对应本课 |
|---|---|---|
| 隐式模式下的认证绕过 | 客户端把令牌换来的用户信息 POST 给自己后端，后端不校验令牌与 email 的对应关系 | 隐式模式为什么被废弃 |
| 强制绑定 OAuth 账号（profile linking） | 绑定社交账号的授权请求没有 `state` | state 缺失 → CSRF |
| 通过 redirect_uri 劫持账号 | 授权端点接受任意 `redirect_uri` | redirect_uri 校验不严 |
| 通过开放重定向窃取令牌 | redirect_uri 只校验前缀，可用 `/../` 跳到站内开放重定向 | 路径穿越 + 开放重定向 |
| 通过代理页窃取令牌 | 站内某页面用 `postMessage` 把 `location.href` 发给任意 origin | 令牌通过前端泄露 |

做法：打开 Burp 代理浏览器，完整走一遍登录，在 HTTP history 里找到 `/auth?client_id=...` 请求，逐个参数思考“这个值被篡改后服务器会不会发现”。每做完一个实验，写一句“如果这是我的 Spring/Keycloak 系统，哪个配置能挡住它”，这比过关本身更重要。

## 攻击者视角

**1. redirect_uri 校验不严。** 假设授权服务器登记的是 `https://shop.example.com/callback`，但只做前缀或域名匹配。攻击者构造链接发给受害者：

```
https://idp.example.com/auth?response_type=code&client_id=shop
  &redirect_uri=https://shop.example.com/callback/../redirect?url=https://evil.example
  &scope=openid&state=x
```

受害者已登录 IdP，点击后可能无感知地完成授权，`code` 先到达站内的开放重定向，再带着 URL 片段或 Referer 被送到 `evil.example`。常见绕过形式：`callback.evil.example`（子域名前缀）、`shop.example.com.evil.example`、`shop.example.com@evil.example`、`/callback/../`、大小写或编码变体、在允许 `*` 的 Keycloak 配置里任意路径。没有 PKCE 的客户端，攻击者拿到 code 就能在自己的浏览器里走回调完成登录。

**2. state 缺失（登录 CSRF / 账号绑定劫持）。** 攻击者用自己的第三方账号开始授权，拿到属于自己的 `code` 后**不使用**，而是把回调链接 `https://shop.example.com/callback?code=ATTACKER_CODE` 嵌进一张图片或自动提交的页面。受害者（已登录电商网站）访问后，网站把攻击者的第三方账号绑定到受害者账号上，此后攻击者用“第三方登录”即可进入受害者账号。state 与会话绑定就能识别出这个回调不是受害者自己发起的。

**3. 令牌泄露。** 常见路径：隐式模式令牌在 URL 片段里被页面脚本读到；回调页带着 `?code=` 加载了第三方统计脚本或图片，code 通过 `Referer` 头泄露；Nginx 访问日志记录了完整查询串（`?code=`、有的系统还把 `access_token` 放在查询参数里）；前端把令牌放 localStorage 后被 XSS（见 [[web-xss]]）读走；移动端/车机 App 日志打印了 `Authorization` 头。拿到的 Access Token 直接用 `curl -H "Authorization: Bearer ..."` 调 API。

**4. 其他值得检查的点。** 用 email 而不是 `iss`+`sub` 关联账号（IdP 允许未验证 email 时可接管账号）；资源服务器不校验 `aud`，接受其他客户端的令牌或 ID Token；scope 升级（授权时只同意 `read`，换令牌时篡改 scope 得到更多）；OIDC 动态客户端注册接口对外开放，`logo_uri` 等 URL 字段被服务器拉取导致 SSRF（见 [[web-ssrf]]）。JWT 签名本身的攻击见 [[web-authn]]。

## 防御与最佳实践

| 层面 | 做法 | Spring / Keycloak 落地 |
|---|---|---|
| 授权方式 | 只用授权码 + PKCE（S256）；服务间调用用客户端凭证；禁用隐式和密码模式 | Keycloak 客户端只开 Standard flow，关 Implicit flow 和 Direct access grants；Advanced 里 PKCE 设为 S256 |
| redirect_uri | 注册完整 URL，精确匹配；不用通配符；每个环境单独登记 | Valid redirect URIs 不写 `*`；生产只登记 HTTPS 地址 |
| state / nonce | 每次随机生成、与会话绑定、一次性使用 | `oauth2Login` 自动生成并校验，不要自己重写回调逻辑绕过它 |
| 客户端形态 | 浏览器应用优先 BFF：令牌只在服务端，浏览器只拿 HttpOnly + Secure + SameSite Cookie | 本课的 notes-web；SPA 不要把令牌放 localStorage |
| 资源服务器 | 校验签名、`iss`、`exp`、`aud`；按 scope/角色做授权；对象级授权不能省 | `issuer-uri` + `audiences`；`hasAuthority("SCOPE_...")`；[[ss-authz]] 的对象级检查 |
| 令牌泄露面 | 回调页设置 `Referrer-Policy: no-referrer`；日志不记查询串和 `Authorization` 头；令牌永不放 URL | Nginx `log_format` 用 `$uri` 替代 `$request_uri`；Spring 日志脱敏 |
| 最小权限 | 客户端只申请必要 scope；Access Token 短有效期 | Keycloak 默认 5 分钟；刷新与撤销见 [[ss-token]] |
| 账号关联 | 用 `iss`+`sub` 作外部身份主键；按 email 合并账号前要求 `email_verified` 并二次确认 | 用户表存 `(issuer, subject)` 唯一索引 |

检测：在授权服务器侧监控同一 code 被重复兑换（可能已泄露）、`invalid_grant`/PKCE 失败突增、redirect_uri 校验失败的请求；在资源服务器侧统计 401 `invalid_token` 的来源 IP 和 `azp`。Keycloak 的 Events（Realm settings → Events）可以开启登录与管理事件记录。

## 常见误区

- **“OAuth2 就是登录协议。”** OAuth2 只解决授权；拿到 Access Token 不等于知道用户是谁。做登录要用 OIDC，看 ID Token。
- **“机密客户端有 client_secret，不需要 PKCE。”** RFC 9700 建议机密客户端也用 PKCE，它还能防授权码注入（攻击者把偷来的 code 塞进自己的会话回调）。
- **“有了 PKCE 就不需要 state。”** PKCE 保护的是 code 的兑换，state 还承担“回调是不是本会话发起的”这一职责；Spring 两者都做，自己实现时也应两者都做。
- **“JWT 验签通过就可以信任。”** 同一个 realm 签发给所有客户端的令牌都能验签通过，必须再校验 `aud` 和 scope。
- **“SPA 用隐式模式更简单。”** 隐式模式已不推荐，SPA 用授权码 + PKCE，更好的是 BFF。
- **“redirect_uri 写成 `https://shop.example.com/*` 方便多环境。”** 通配符正是 redirect_uri 漏洞的源头，多环境就多登记几条完整 URL。
- **“用 email 关联第三方账号很自然。”** 外部身份的唯一键是 `iss`+`sub`；email 可以变化、可能未验证。
- **“把 Keycloak 的 `start-dev` 直接部署到测试服务器。”** 开发模式使用 HTTP 和内置数据库，只适合本机学习；正式环境用 `start` 并配置 HTTPS、hostname 和外部数据库。

## 自测

:::details 1. 说出 OAuth2 的四个角色，并在“充电桩 App 读取车辆电量”的场景里各对应谁。
Resource Owner 是车主；Client 是充电桩运营商 App；Authorization Server 是车企的身份平台（例如 Keycloak）；Resource Server 是提供车辆电量接口的 vehicle-api。车主在授权服务器上同意授权，App 拿 Access Token 调用 vehicle-api，全程拿不到车主密码。
:::

:::details 2. PKCE 的 code_verifier 和 code_challenge 分别在哪一步出现？它防的是什么攻击？
`code_challenge`（S256 即 SHA-256 后 Base64URL）在第 1 步授权请求中经浏览器发出；`code_verifier` 原文只在第 3 步客户端后端请求令牌端点时出现。授权服务器比对两者，因此即使 code 在前端通道被截获（Referer、日志、恶意 App 注册同一回调 scheme、授权码注入），攻击者没有 verifier 也换不出令牌。
:::

:::details 3. RFC 9700 为什么不再推荐隐式模式、禁止密码模式？
隐式模式把 Access Token 放在重定向 URL 片段里，易经浏览器历史、脚本、开放重定向泄露，且无法绑定客户端、不能用 PKCE。密码模式让客户端直接拿到用户密码，违背授权委托的初衷，无法支持 MFA 和联合登录，还会训练用户在第三方页面输入密码。替代方案都是授权码 + PKCE。
:::

:::details 4. ID Token 能不能拿来调用后端 API？为什么？
不能。ID Token 的 `aud` 是客户端，API 正确校验 `aud` 时会拒绝它；它表达的是认证事件而非授权范围，没有 scope；也不具备 Access Token 的刷新、撤销机制。若 API 接受 ID Token，任何拿到用户 ID Token 的其他客户端都能冒充调用。调用 API 应使用 `aud` 指向该 API 的 Access Token，本课实践 4 用 `audiences: notes-api` 验证了这一点。
:::

:::details 5. 客户端配置里只写了 issuer-uri，Spring 是怎么知道令牌端点和公钥地址的？
通过 OIDC Discovery：启动时请求 `{issuer-uri}/.well-known/openid-configuration`，读取 `authorization_endpoint`、`token_endpoint`、`userinfo_endpoint`、`jwks_uri` 等，并校验返回的 `issuer` 与配置一致。所以 issuer 字符串两边必须逐字相同，启动时授权服务器也必须可达。
:::

:::details 6. 授权服务器对 redirect_uri 只做前缀匹配，攻击者可以怎么利用？怎么修？
可以构造 `https://合法域名/callback/../` 加站内开放重定向，或利用子域名、`@`、编码变体，把 code（隐式模式下是令牌）送到攻击者控制的地址，进而登录受害者账号。修复：授权服务器登记完整 URL 并精确匹配；Keycloak 不用 `*`；客户端启用 PKCE 作为纵深防御；清理站内开放重定向。
:::

:::details 7. 没有 state 参数时，“强制绑定第三方账号”攻击是怎么发生的？
攻击者用自己的第三方账号走授权，截下回调里的 code 不用，诱导已登录的受害者访问 `callback?code=攻击者的code`。客户端无法区分回调是否由受害者发起，于是把攻击者的第三方身份绑定到受害者账号，攻击者此后用第三方登录进入。state 随机生成并与会话绑定，回调时比对即可拒绝。
:::

:::details 8. 资源服务器用 Keycloak 的令牌时，SCOPE_notes.read 和 ROLE_admin 分别从哪里来？
Spring 默认的 `JwtGrantedAuthoritiesConverter` 把 `scope` claim 中的每一项变成 `SCOPE_xxx`；Keycloak 的 realm 角色在 `realm_access.roles` 里，Spring 不会自动识别，需要像实践 4 那样自定义 `JwtAuthenticationConverter` 映射成 `ROLE_xxx`，之后才能用 `hasRole` / `@PreAuthorize`。
:::

## 一句话总结

OAuth2 用授权码 + PKCE 让客户端在不接触密码的情况下拿到有范围、短期的 Access Token，OIDC 再用 ID Token 告诉客户端“用户是谁”；安全的关键在于 redirect_uri 精确匹配、state 与 PKCE 都要有、令牌只走后端通道，以及 API 只接受 `aud` 指向自己的 Access Token。
