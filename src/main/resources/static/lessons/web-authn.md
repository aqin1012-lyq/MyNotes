## 为什么要学

认证（Authentication，"你是谁"）是几乎每个后端系统的第一道门，也是最容易被做错的一道门。你做了 6 年 Java 后端，登录接口、发 Token、校验 Token 大概率都写过；但"密码到底该怎么存""登录失败提示该怎么写""JWT 除了能解码还能被怎么伪造"这些细节，一旦错了就是账号批量沦陷级别的事故。

这一课处在学习路线从"Web 漏洞"迈向"[[ss-arch]] Spring Security"的衔接点。它和 [[web-access]] 是一对：认证解决"你是谁"，授权解决"你能干什么"。它也直接连着 [[net-token]] 里 Session 与 JWT 的概念，这里把安全细节补齐。学完之后你去做项目②"安全认证中心"（BCrypt + 限流 + 锁定 + RBAC），就有了完整的地基。

学完这一课你应该能做到：用 Spring Security 的 `PasswordEncoder` 正确存密码并解释为什么不能用 MD5/SHA；设计登录限流/锁定并写出防用户枚举的统一提示；解释会话固定并在登录后更换 Session ID；把 JWT 的四类经典攻击（alg=none、RS256→HS256 混淆、弱 HMAC 密钥、kid 注入）讲清楚，并写出一段**正确**的校验代码。

:::warn 授权原则
本课的攻击手法（爆破、JWT 伪造）只能用于你自己的账号、本仓库的 Lab 或明确授权的目标。对他人账号做撞库/爆破属于违法。
:::

## 核心概念

### 1. 密码存储：为什么不能用 MD5/SHA，而要用 BCrypt / Argon2

先记住一个事实：**普通哈希（MD5、SHA-1、SHA-256）是为"快"设计的，而密码哈希需要"慢"。** MD5/SHA 每秒能算几十亿次，攻击者拿到数据库后可以用彩虹表或 GPU 暴力碰撞，弱口令几秒就还原。加盐（salt）能破掉彩虹表和"相同密码哈希相同"的问题，但挡不住针对单个密码的高速爆破——因为算得太快。

密码专用哈希（BCrypt、scrypt、Argon2）的思路是**故意慢、且慢的程度可调**：

- **BCrypt**：内置盐，有一个 cost/工作因子（如 10、12），每加 1，计算量翻倍。Spring Security 默认强度是 10。产出的字符串形如 `$2a$10$....`，盐和 cost 都编码在里面，校验时无需你单独存盐。
- **Argon2**：较新的密码哈希（Argon2id 变体），除了时间成本，还引入**内存成本**，能更好地对抗 GPU/专用硬件并行爆破。OWASP Password Storage Cheat Sheet（见资料）把它列为优先推荐之一。
- 二者都做到：相同密码每次哈希结果不同（因为盐不同）；校验用库提供的 `matches`，你永远不"解密"密码——密码哈希是单向的。

在 Spring Security 里，用 `PasswordEncoder` 抽象这件事：

```java
@Bean
PasswordEncoder passwordEncoder() {
    // 推荐：委派编码器，能同时校验多种算法，便于平滑升级
    return PasswordEncoderFactories.createDelegatingPasswordEncoder();
}
```

`DelegatingPasswordEncoder` 存出来的哈希带前缀，如 `{bcrypt}$2a$10$...` 或 `{argon2}$argon2id$...`。它的好处是**可平滑迁移**：老用户还是 `{bcrypt}`，新用户可以是 `{argon2}`，同一套代码都能校验。存密码与校验：

```java
String hash = passwordEncoder.encode(rawPassword);      // 注册时存 hash
boolean ok = passwordEncoder.matches(rawPassword, hash); // 登录时校验
```

如果你只想要 BCrypt，也可以直接 `new BCryptPasswordEncoder(12)`。**绝不要**自己写 `DigestUtils.md5Hex(password)` 存库——这就是 Lab 10 要修掉的历史包袱。

### 2. 暴力破解、撞库与防用户枚举

三个相关但不同的攻击：**暴力破解**（对一个账号猜大量密码）、**撞库**（用别处泄露的"账号+密码"组合批量试你的站，因为很多人跨站重用密码）、**用户枚举**（先探测"哪些用户名存在"，缩小爆破范围）。

防御是一套组合拳：

- **限流（rate limiting）**：按 IP、按账号、按"IP+账号"维度限制单位时间内的登录尝试。可用 Redis 计数器 + 滑动窗口实现，也可用网关/WAF。注意撞库是"每个账号只试一两次、但账号极多"，纯按账号限流挡不住，需要按 IP/设备指纹配合。
- **账号锁定**：连续失败 N 次后锁定一段时间（如 5 次锁 15 分钟）。要小心：纯按账号锁定会被攻击者用来**恶意锁定**别人（拒绝服务），所以更稳的是"渐进式延迟 + 验证码 + 风控"，而非简单硬锁。
- **验证码 / MFA**：失败几次后弹验证码挡自动化；高价值账号强制多因素认证（MFA，如 TOTP 动态口令），这样即使密码泄露也登不进去。MFA 是对抗撞库最有效的手段。
- **防用户枚举**：这就是本课的问题——**为什么"用户名不存在"和"密码错误"要返回同样的提示**。如果"用户名不存在"和"密码错误"提示不同，攻击者不用猜密码，先批量枚举出所有真实用户名，再针对性撞库/爆破。所以：登录失败一律返回同一句话（如"用户名或密码错误"）、同样的 HTTP 状态、**并尽量保持响应时间一致**（否则"存在的用户走了 BCrypt 校验、不存在的用户直接返回"会产生时间差，成为时间侧信道——常见做法是对不存在的用户也跑一次假的密码校验来抹平耗时）。注册和"忘记密码"接口同理，不要暴露"该邮箱已注册/未注册"。

### 3. 会话固定：登录后必须更换 Session ID

**会话固定（Session Fixation）**攻击的套路：攻击者先拿到一个合法但未登录的 Session ID（比如自己访问网站得到一个，或诱导受害者使用一个攻击者已知的 Session ID，例如通过 URL 里的 `;jsessionid=...`），再想办法让受害者用这个 Session ID 去登录。如果服务端登录成功后**沿用同一个 Session ID**，那么受害者一登录，这个"攻击者已知的 ID"就变成了已认证会话，攻击者拿着它就冒充了受害者。

根治方法只有一句话：**认证成功后，作废旧会话、生成一个全新的 Session ID。** 这样攻击者预先知道的那个 ID 在登录瞬间就失效了。

好消息是 Spring Security **默认就开启**了会话固定防护，策略是 `changeSessionId`（登录后更换 Session ID 但保留会话属性）。你需要做的是别把它关掉，并了解相关配置：

```java
http.sessionManagement(session -> session
    .sessionFixation(sf -> sf.changeSessionId())   // 默认即此，登录后换新 ID
    .maximumSessions(1)                             // 可选：同一账号最多一个活跃会话
);
```

如果你不用框架、手写 Servlet 登录，就要自己做：`request.changeSessionId()`（Servlet 3.1+），或 `request.getSession().invalidate()` 后再 `request.getSession(true)` 建新会话。配套还要给 Session Cookie 加上 `HttpOnly`（防 [[web-xss]] 窃取）、`Secure`、`SameSite`（防 [[web-csrf]]），并在登出时真正 `invalidate()` 会话。注意：纯 JWT（无服务端会话）的无状态认证不存在会话固定问题，但它有自己的一套麻烦——下面就是。

### 4. JWT 的四类经典攻击

先回顾结构（详见 [[net-token]]）：JWT = `Header.Payload.Signature`，三段用 `.` 连接，各段是 Base64URL 编码。Header 里有 `alg`（签名算法）；Payload 是明文可读的声明（`sub`、`exp`、`iss`、`aud` 等）；Signature 是对前两段的签名。**Base64URL 不是加密**——任何人都能解码看到 Payload，所以 JWT 里绝不放敏感信息。安全全靠签名校验：签名对不上就该拒绝。四类攻击都在攻击"校验"这一环。

**攻击一：alg=none。** JWT 规范里有一个 `none` 算法表示"不签名"。如果服务端校验时**信任 Header 里的 alg**，攻击者就把 `alg` 改成 `none`、把签名段留空、随意篡改 Payload（比如把 `"role":"user"` 改成 `"role":"admin"`），服务端一看 alg=none 就不验签直接放行。根因：**让攻击者控制的 Header 决定要不要/怎么验签。**

**攻击二：算法混淆 RS256 → HS256。** RS256 是非对称签名：私钥签名、**公钥**验签，公钥通常是公开的。HS256 是对称签名：用**同一个密钥**签名和验签。攻击套路：把 Header 的 `alg` 从 `RS256` 改成 `HS256`，然后用服务端那把**公开的 RSA 公钥当作 HMAC 密钥**去签名。如果服务端的验签代码写成"从 token 读 alg，是 HS256 就用配置里的密钥做 HMAC 校验"，而它配置里那把"密钥"恰好是公钥（或验签函数把公钥字节喂给了 HMAC），签名就会通过——攻击者用公开信息伪造出了合法 token。根因同样是**验签算法由 token 说了算**，加上公钥可被当成 HMAC 密钥。

**攻击三：弱 HMAC 密钥。** HS256 的安全性完全取决于密钥的强度。如果密钥是 `secret`、`123456`、`your-256-bit-secret` 这类弱口令或示例值，攻击者可以拿到任意一个合法 token（比如自己登录得到的），用 hashcat 或 `jwt_tool` 之类工具**离线爆破**出密钥，之后就能任意签发 token。根因：密钥太弱、可猜。HS256 密钥必须足够长且随机（RFC 8725 建议密钥长度不低于哈希输出长度，HS256 即至少 256 位/32 字节的高熵随机值），且绝不硬编码进代码或提交到 Git（呼应 [[cloud-secrets]]）。

**攻击四：kid 注入。** Header 里可选的 `kid`（key ID）用来告诉服务端"用哪把密钥验签"。如果服务端**直接拿 kid 去查库/读文件/拼路径**而不校验，就出问题：`kid` 值是攻击者可控的，可能被注入 SQL（`kid` 拼进 SQL 查密钥 → [[web-sqli]]）、路径穿越（`kid: "../../dev/null"` 让密钥变成空文件内容，再用空密钥签名）、甚至指向攻击者可控的 URL。根因：**把 token 里攻击者可控的字段当成可信的密钥来源。**

一句话串起来：这四类攻击的共同根因是**服务端把"该信谁、用什么算法、用哪把密钥"的决定权交给了攻击者可控的 token 头部**。

### 5. JWT 最佳实践与正确的校验代码

对策（对应 RFC 8725 JSON Web Token BCP，见资料）：

- **服务端固定算法**，不信任 token 里的 `alg`；明确只接受你签发时用的算法（如只认 RS256），拒绝 `none`。
- 用非对称（RS256/ES256）时，验签**只用公钥**，且校验器要拒绝 HS256，避免算法混淆。
- HS256 密钥用足够长的高熵随机值，从配置/密钥管理读取，不硬编码、不进 Git。
- **校验标准声明**：`exp`（过期，必须校验，别只解码不验过期）、`nbf`、`iss`（签发者）、`aud`（受众，确认这个 token 是发给"我这个服务"的）。
- 用成熟库并保持更新，不要自己拼 JWT 校验逻辑；`kid` 等字段做严格白名单/校验，不直接用于查询或读文件。
- 短有效期 + Refresh Token（见 [[ss-token]]）；JWT 本身难以撤销，所以配合黑名单/版本号做撤销。

下面是正确校验的示例，**假设使用 jjwt 0.12.x**（`io.jsonwebtoken:jjwt-api/jjwt-impl/jjwt-jackson`，即 `Jwts.parser()...parseSignedClaims(...)` 这套新 API）。jjwt 从设计上就不接受 `alg=none`，并要求你显式提供验签密钥：

```java
import io.jsonwebtoken.*;
import javax.crypto.SecretKey;

// HS256：key 是从配置/密钥管理读入的高熵随机密钥（>=32 字节），绝不硬编码
Claims verifyHs256(String jwt, SecretKey key) {
    return Jwts.parser()
        .verifyWith(key)              // 固定用这把密钥验签
        .requireIssuer("my-auth")     // 校验 iss
        .requireAudience("my-api")    // 校验 aud，确认是发给本服务的
        .clockSkewSeconds(30)         // 容忍少量时钟偏差
        .build()
        .parseSignedClaims(jwt)       // 验签 + 自动校验 exp/nbf，失败抛异常
        .getPayload();
    // 会抛：SignatureException(签名不对) / ExpiredJwtException(过期) 等，捕获后一律当作 401
}
```

RS256 场景把 `verifyWith(key)` 换成 `verifyWith(publicKey)`（`RSAPublicKey`）。由于你在签发时用的是 RS256、验签只提供公钥，且 jjwt 会校验 token 的算法与密钥类型匹配，攻击者把 `alg` 改成 HS256 拿公钥当 HMAC 密钥的混淆攻击就无法通过。若用 Spring Security OAuth2 Resource Server，则更推荐直接用它的 `JwtDecoder`（Nimbus 实现），在配置里固定算法和 `issuer-uri`，同样能规避这些坑（见 [[ss-token]]）。关键是：**永远显式指定算法与密钥，让校验失败抛异常，并把任何异常都当成认证失败。**

## 动手实践

### 实践 1（Lab 09）：JWT 漏洞攻防

Lab 09 尚未内置，下面用命令行手工体会。先解码一个 JWT，确认 Payload 是明文：

```
# 取 JWT 的第二段（Payload）做 Base64URL 解码
echo 'eyJzdWIiOiJhbGljZSIsInJvbGUiOiJ1c2VyIn0' | base64 -d 2>/dev/null; echo
```

预期输出（Payload 明文可读，说明它没被加密，只是编码）：

```
{"sub":"alice","role":"user"}
```

怎么读：任何人都能看到里面的 `role`，所以这里绝不能放密码等敏感数据；能不能被篡改，取决于服务端**验不验签**。

体会 alg=none：把 Header 改成 `{"alg":"none","typ":"JWT"}`、Payload 改成 `{"sub":"alice","role":"admin"}`，各自 Base64URL 编码后用 `.` 连接，**第三段签名留空**（即以 `.` 结尾）。把这个 token 发给一个"信任 alg"的漏洞校验端点：

```
curl -s http://127.0.0.1:8080/vuln/l09/me \
  -H 'Authorization: Bearer eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhbGljZSIsInJvbGUiOiJhZG1pbiJ9.'
```

预期：漏洞端点返回 `role=admin`，说明未验签就被当成管理员。用上面 jjwt 的正确校验替换后，同样的请求会抛异常、返回 401——因为 jjwt 拒绝 `none` 且要求验签密钥。弱 HMAC 密钥的体验可用 `jwt_tool` 或 hashcat 对一个用弱密钥（如 `secret`）签发的 HS256 token 做离线爆破，几秒内跑出密钥；把密钥换成 32 字节随机值后就跑不出来。这就直观说明"密钥强度 = HS256 的安全上限"。

### 实践 2（Lab 10）：明文密码 → BCrypt

目标：把"明文/MD5 存密码"迁移到 BCrypt，且**不需要让用户重设密码**。思路是"下次登录时顺带升级"。

第一步，加 `PasswordEncoder`（用上面的 `DelegatingPasswordEncoder`）。第二步，注册/改密时一律存 `encode()` 结果。第三步，对存量老用户做平滑迁移：

```java
// 登录校验：老数据是明文时先按明文比对，成功后立刻重哈希为 BCrypt 写回
boolean login(User u, String raw) {
    boolean ok;
    if (u.getPasswordHash().startsWith("{")) {         // 已是带前缀的现代哈希
        ok = passwordEncoder.matches(raw, u.getPasswordHash());
    } else {                                            // 历史明文（仅迁移期临时兼容）
        ok = u.getPasswordHash().equals(raw);
    }
    if (ok && !u.getPasswordHash().startsWith("{")) {   // 校验通过且还是老格式 -> 升级
        u.setPasswordHash(passwordEncoder.encode(raw));
        userRepo.save(u);
    }
    return ok;
}
```

验证方式：注册一个新用户，直接查库看密码字段。预期：

```
# 不再是明文，而是带算法前缀的 BCrypt 哈希（每次注册盐不同，值都不一样）
{bcrypt}$2a$10$N9qo8uLOickgx2ZMRZoMy...
```

看到 `{bcrypt}$2a$...` 且同一个密码两次注册结果不同，就说明 BCrypt + 随机盐生效了。老用户登录一次后，其字段也会从明文变成 `{bcrypt}$2a$...`。全部迁移完成后，把上面兼容明文的分支删掉。这套做法把 Lab 10 从"明文"一路带到"现代密码存储 + 平滑升级"，正是项目②登录模块的核心。

### 实践 3：完成 PortSwigger Authentication 与 JWT 实验

到 PortSwigger Web Security Academy 的 Authentication 与 JWT attacks 两个模块从 Apprentice 做起（见资料）。Authentication 侧重用户枚举（观察提示/响应时间差异）、爆破、"记住我"和多步登录的逻辑缺陷；JWT 侧重 alg=none、未验签、弱密钥、算法混淆、kid/jku 等。它自带的 JWT Editor（Burp 扩展）能方便地改 Header/Payload 并重签。做完把每个实验的"根因—利用—修复"三行记进笔记，与本课的攻击分类对上号。

## 攻击者视角

- **枚举 → 撞库 → 爆破**：先用提示差异或响应时间差异枚举出真实用户名，再拿泄露库撞库（成本极低、命中率不低），对高价值账号才上定向爆破。
- **抓 token 找软肋**：拿到一个 JWT，先解码看 `alg` 和声明；试 `alg=none`、试把 RS256 改 HS256 用公钥当密钥、用 hashcat 爆 HMAC 弱密钥、篡改 `kid` 看有没有注入/穿越、看 `exp` 是否真的被校验。
- **会话相关**：尝试会话固定（登录前后 Session ID 变没变）、Cookie 缺 `HttpOnly` 时配合 [[web-xss]] 窃取会话、缺 `SameSite` 时配合 [[web-csrf]]。
- **旁路认证**：找"忘记密码""改邮箱""OAuth 回调"等边路逻辑，往往比正门弱（延伸到 [[ss-oauth2]]）。

## 防御与最佳实践

- 密码：一律 `PasswordEncoder`（BCrypt cost>=10 或 Argon2id），随机盐，绝不 MD5/SHA/明文；用 `DelegatingPasswordEncoder` 便于升级。
- 登录：统一失败提示 + 抹平响应时间防枚举；按 IP/账号/设备多维限流；渐进延迟 + 验证码，高价值账号强制 MFA；密码策略参考 NIST（重长度与查泄露库，不强制无意义的复杂度和频繁改密）。
- 会话：登录后 `changeSessionId`（Spring Security 默认）；Cookie 加 `HttpOnly`/`Secure`/`SameSite`；登出真正 `invalidate`。
- JWT：服务端固定算法、拒绝 none、只用公钥验 RS256、HS256 用高熵密钥；校验 `exp`/`iss`/`aud`；短有效期 + Refresh + 撤销机制（[[ss-token]]）；密钥走密钥管理不进 Git（[[cloud-secrets]]）。
- 通用：所有认证失败当 401 统一处理；认证与授权分层（认证只证明"你是谁"，能不能做某事交给 [[web-access]]/[[ss-authz]]）；关键操作记审计日志（不记密码/完整 token）。

## 常见误区

- **"加了盐的 MD5/SHA 就够了。"** 盐只破彩虹表，挡不住高速爆破。密码必须用故意慢的 BCrypt/Argon2。
- **"JWT 是加密的，放里面很安全。"** Base64URL 不是加密，Payload 明文可读。安全靠签名校验，不是保密。
- **"能解码出内容就说明 token 有效。"** 解码不等于验签。必须验签 + 校验 `exp`/`iss`/`aud`，任何一步失败都拒绝。
- **"用了 HTTPS 就不用防爆破/枚举。"** HTTPS 只保传输，登录逻辑本身的枚举、爆破、撞库照样发生。
- **"锁定账号总是好的。"** 纯按账号硬锁会被用来恶意锁定他人（DoS），要配合验证码/风控/渐进延迟。
- **"提示写详细点用户体验好。"** "该用户不存在""密码错误"这类精确提示直接送给攻击者一份用户名清单。
- **"JWT 天然无状态，所以不用撤销。"** 正因为无状态，泄露后在过期前难以作废，必须额外设计短有效期 + 黑名单/版本号。

## 自测

:::details 1. 为什么密码不能用 MD5/SHA 存，而要用 BCrypt/Argon2？加盐还不够吗？
MD5/SHA 为快而设计，每秒可算数十亿次，便于 GPU 爆破。加盐只能破彩虹表和"相同密码同哈希"，挡不住针对单密码的高速爆破。BCrypt/Argon2 是故意慢、成本可调的密码哈希（Argon2 还加内存成本对抗 GPU），内置随机盐，是正确选择。
:::

:::details 2. 为什么"用户名不存在"和"密码错误"要返回相同提示？还要注意什么？
避免用户枚举：不同提示会让攻击者先批量确认哪些用户名真实存在，再定向撞库/爆破。除了统一提示和状态码，还要抹平响应时间（对不存在的用户也跑一次假的密码校验），否则时间差会成为侧信道。注册、找回密码接口同理。
:::

:::details 3. 什么是会话固定？如何根治？Spring Security 默认怎么做？
攻击者让受害者使用一个攻击者已知的 Session ID 去登录，若登录后沿用该 ID，攻击者就得到已认证会话。根治：认证成功后作废旧会话、生成全新 Session ID。Spring Security 默认启用 `changeSessionId` 策略做到这一点。
:::

:::details 4. 解释 JWT 的 alg=none 攻击及其根因。
攻击者把 Header 的 `alg` 改成 `none`、签名段留空、任意篡改 Payload（如提权为 admin）。若服务端信任 token 里的 alg，看到 none 就不验签直接放行。根因：让攻击者可控的 Header 决定是否/如何验签。对策：服务端固定算法、拒绝 none。
:::

:::details 5. RS256→HS256 算法混淆是怎么回事？为什么公钥公开也能被利用？
RS256 用私钥签、公钥验，公钥通常公开。攻击者把 alg 改成 HS256，用这把公开的公钥当 HMAC 密钥去签名。若服务端"按 token 的 alg 选算法"，且把公钥当成了 HMAC 密钥来验签，签名就会通过，于是用公开信息伪造出合法 token。对策：服务端固定算法、RS256 只用公钥验签并拒绝 HS256。
:::

:::details 6. HS256 弱密钥和 kid 注入分别是什么？
弱密钥：HS256 安全性全靠密钥强度，若密钥是 secret/示例值，可拿一个合法 token 离线爆破出密钥再任意签发。对策：用 >=32 字节高熵随机密钥，走密钥管理不进 Git。kid 注入：Header 的 `kid` 指示用哪把密钥，若服务端直接拿它查库/读文件/拼路径，攻击者可注入 SQL、路径穿越（指向空文件用空密钥签名）等。对策：对 kid 做严格白名单校验。
:::

:::details 7. 用 jjwt（假设 0.12.x）写正确校验要点有哪些？
用 `Jwts.parser().verifyWith(key)` 显式指定验签密钥、固定算法；`parseSignedClaims` 会验签并自动校验 exp/nbf；再用 `requireIssuer`/`requireAudience` 校验 iss/aud。jjwt 本身拒绝 none 且要求提供密钥。任何校验异常（签名错、过期等）都统一当作 401。
:::

:::details 8. 为什么纯 JWT（无状态）泄露后比 Session 更难处理？怎么缓解？
Session 是服务端存状态，登出/撤销只需删服务端会话。JWT 无状态，签发后服务端不留记录，在过期前无法自然作废。缓解：短有效期 + Refresh Token 轮换（[[ss-token]]），并配合黑名单/用户 token 版本号实现主动撤销。
:::

## 一句话总结

认证安全的两条主线：密码用故意慢的 BCrypt/Argon2 + 随机盐存储，并用限流/锁定/MFA/统一提示对抗爆破、撞库与枚举；JWT 的所有经典攻击（none、算法混淆、弱密钥、kid 注入）都源于"服务端把该信谁、用什么算法、用哪把密钥交给了攻击者可控的 token 头部"，对策是服务端固定算法、正确验签、校验 exp/iss/aud，并配合会话固定防护与短有效期。
