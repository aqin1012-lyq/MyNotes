## 为什么要学

HTTP 是无状态的：服务器处理完一个请求就“忘了”你是谁。要实现“登录一次，后续请求都认得你”，必须让客户端每次带上一个凭证。业界有两条主路线：**有状态的 Session**（服务端记住你，客户端只拿一个随机 ID）和**无状态的 Token**（服务端把“你是谁”签名后交给客户端保管，最常见的格式是 JWT）。

你做过的项目里多半两种都见过：传统后台用 `JSESSIONID` + Spring Session（Redis）；App、小程序、车机端、微服务之间则常用 `Authorization: Bearer eyJ...`。但很多团队选 JWT 的理由只是“听说无状态更好”，结果遇到“用户改密码后旧 token 还能用”“怎么强制踢人下线”时才发现代价。

这一课只建立**概念和取舍**：JWT 长什么样、签名是怎么回事、Session 和 JWT 各自擅长什么、token 放哪里各有什么风险。具体的攻击手法（`alg=none`、弱密钥爆破、算法混淆等）在 [[web-authn]] 深入，Spring Security 里 token 的签发、刷新、撤销等完整生命周期在 [[ss-token]] 动手实现，OAuth2 的 access token/ID token 在 [[ss-oauth2]]。

学完后你应该能：一眼读懂一个 JWT 的内容；在设计评审里说清楚“这个场景该用 Session 还是 JWT，代价是什么”；回答“JWT 泄露了怎么办”。

## 核心概念

### 1. 先看 Session：服务端记状态

```
1. POST /login (user+password)   --> server creates session {id: 7f3a.., userId: 1, role: user}
                                     stored in memory / Redis
2. <-- Set-Cookie: JSESSIONID=7f3a...; HttpOnly; Secure; SameSite=Lax
3. GET /orders  Cookie: JSESSIONID=7f3a...  --> server looks up 7f3a.. -> userId 1
```

客户端手里只有一个**随机、无意义**的 ID，所有真实信息都在服务端。想让某个用户下线？删掉服务端那条记录即可。代价是服务端要存状态，多实例部署时要么粘性会话，要么把 Session 放进 Redis（Spring Session）。

### 2. JWT 结构：Header.Payload.Signature，Base64URL ≠ 加密

JWT（JSON Web Token，RFC 7519）是三段用 `.` 连接的字符串：

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwibmFtZSI6ImFsaWNlIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDkwMH0.YcljepBYbUgB4yqp3QyJgUCEkSR1hCCNI6tuLbJbIyg

header    = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
payload   = eyJzdWIiOiIxIiwibmFtZSI6ImFsaWNlIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDkwMH0
signature = YcljepBYbUgB4yqp3QyJgUCEkSR1hCCNI6tuLbJbIyg
```

每一段都是 **Base64URL** 编码（标准 Base64 把 `+` `/` 换成 `-` `_`，并去掉末尾的 `=`，便于放进 URL 和 HTTP 头）：

| 段 | 解码后 | 作用 |
|---|---|---|
| Header | `{"alg":"HS256","typ":"JWT"}` | 声明签名算法 |
| Payload | `{"sub":"1","name":"alice","role":"user","iat":1790000000,"exp":1790000900}` | 声明（claims），即“关于这个用户的陈述” |
| Signature | 32 字节的 HMAC-SHA256 结果 | 证明前两段没被改过、确实是持有密钥的一方签发的 |

签名的计算方式（HS256）：

```
signature = HMAC_SHA256(key, base64url(header) + "." + base64url(payload))
```

Payload 里常见的**注册声明**：`iss`（签发者）、`sub`（主体，通常是用户 ID）、`aud`（受众，给哪个服务用）、`exp`（过期时间）、`nbf`（生效时间）、`iat`（签发时间）、`jti`（token 唯一 ID）。时间都是 Unix 秒数，上面的 `exp - iat = 900`，即 15 分钟有效期。

**最重要的一点：Base64URL 是编码，不是加密。** 任何拿到 token 的人都能解出 payload 的明文，不需要任何密钥。签名只保证**完整性和来源**（不能改），不保证**机密性**（能看）。所以：

- 不要在 payload 里放密码、手机号、身份证号、车辆 VIN 与车主的对应关系、内部系统地址等敏感信息。
- 如果确实需要加密，要用 JWE（JSON Web Encryption，五段结构），但大多数场景的正确答案是“别放进去”。
- 我们日常说的 JWT 几乎都是 JWS（签名的 JWT）。

### 3. HS256（共享密钥）vs RS256/ES256（公私钥）

| | HS256 | RS256 | ES256 |
|---|---|---|---|
| 算法 | HMAC + SHA-256 | RSA 签名（PKCS#1 v1.5）+ SHA-256 | ECDSA，P-256 曲线 + SHA-256 |
| 密钥 | 一个共享密钥，签发和验证用同一个 | 私钥签发，公钥验证 | 私钥签发，公钥验证 |
| 谁能伪造 token | **任何能验证的服务**都能签发 | 只有持有私钥的认证中心 | 只有持有私钥的认证中心 |
| 签名长度 | 32 字节 | 与 RSA 密钥长度相同（2048 位密钥是 256 字节） | 64 字节 |
| 适合场景 | 单体应用，签发者 = 验证者 | 多服务、第三方验证 | 同 RS256，签名更短 |

用微服务的视角理解最直观：

```
HS256:  auth-service --(secret K)--> order-service, payment-service, vehicle-service
        every service holds K  =>  any leaked service can mint tokens for anyone

RS256:  auth-service (private key) --publishes--> JWKS endpoint (public keys)
        other services fetch public key  =>  they can verify, but cannot mint
```

HS256 的风险在于**密钥扩散**：10 个服务验证 token，就有 10 个地方存着“能伪造任何用户身份”的密钥，任何一个配置文件泄露（Git 仓库、Nacos/Apollo 配置中心、镜像环境变量）都会导致全局沦陷。此外，HS256 的密钥如果是 `secret`、`123456` 这类短字符串，拿到一个 token 就能离线爆破（这类攻击在 [[web-authn]] 里实操）。密钥至少要与哈希输出等长（HS256 为 256 位即 32 字节）且随机生成。

非对称算法里，认证中心通常通过 **JWKS**（JSON Web Key Set）端点发布公钥，Header 里的 `kid` 指明用哪把钥匙验签，从而支持密钥轮换。这正是 Spring Security OAuth2 Resource Server 里 `jwk-set-uri` 配置的来源（见 [[ss-oauth2]]）。

一个关键的安全原则：**验证方必须自己决定接受哪种算法**，而不是相信 token Header 里写的 `alg`。否则攻击者可以把 `alg` 改成 `none`，或者在 RS256 的系统里改成 HS256、拿公钥当 HMAC 密钥来签名（算法混淆）。成熟的库都支持固定算法，这些攻击细节留到 [[web-authn]]。

### 4. Session 与 JWT 在“撤销 / 扩展 / 跨服务”上的取舍

| 维度 | Session（服务端存储） | JWT（自包含） |
|---|---|---|
| 撤销（踢下线、改密后失效） | 简单：删除服务端记录，立即生效 | 困难：token 在 `exp` 前一直有效，要么等过期，要么引入黑名单等服务端状态 |
| 扩展（多实例、水平扩容） | 需要共享存储（Redis）或粘性会话 | 验证只需密钥/公钥，任何实例都能验，无需查库 |
| 跨服务 / 跨域 | Cookie 受域名限制，下游服务要回查会话中心 | 放在头里随请求传递，下游服务可本地验证 |
| 权限变更生效 | 立即（服务端改了就是改了） | payload 里的角色要等 token 刷新后才更新 |
| 体积 | Cookie 里只有几十字节 ID | 几百字节到数 KB，每个请求都带 |
| 泄露后影响 | 服务端可立即作废该会话 | 在有效期内都可被冒用 |

几个务实的结论：

- **单体 Web 应用、后台管理系统**：Session + Redis 往往是更简单、更安全的选择，撤销能力是实打实的。
- **多服务、移动端、设备端**：JWT 的“本地验证”很有价值，但要配合**短有效期 access token（如 5 到 15 分钟）+ 可撤销的 refresh token**（refresh token 存在服务端，可以作废），把“无法撤销”的窗口压到很短。
- 所谓“JWT 无状态”一旦加上黑名单、refresh token 存储，其实又回到了部分有状态。这不是失败，而是正常的工程折中。
- 车联网场景的例子：车机长期在线、网络不稳定，频繁回源查 Session 不现实，适合短期 JWT；但车辆过户、账号注销时必须能立即让旧凭证失效，这就要求有撤销机制兜底。

### 5. Token 放在 Cookie 还是 Authorization 头

这里的“token”既可以是 Session ID，也可以是 JWT。存放位置决定了你主要防哪种攻击：

| | Cookie（HttpOnly） | Authorization 头（JS 从 localStorage/内存读取后添加） |
|---|---|---|
| 怎么发送 | 浏览器**自动**附带到匹配域名的请求 | 前端代码**手动**添加 `Authorization: Bearer ...` |
| 主要风险 | **CSRF**：恶意网站诱导浏览器发请求，Cookie 会被自动带上 | **XSS**：任何能执行 JS 的注入都能直接读走 token |
| XSS 下的后果 | JS 读不到 HttpOnly Cookie，但仍可在页面内“借用”会话发请求 | token 被偷走后可以在攻击者自己的机器上长期使用 |
| 主要防护 | `SameSite=Lax/Strict`、CSRF token、校验 Origin | 杜绝 XSS（输出编码、CSP）、缩短有效期 |
| 适合 | 浏览器 Web 应用 | 移动 App、车机、IoT 设备、服务间调用（没有浏览器，不存在 CSRF） |

一个安全的 Session Cookie 应该长这样：

```
Set-Cookie: SESSION=YjU2...; Path=/; Secure; HttpOnly; SameSite=Lax
```

- `HttpOnly`：JS 读不到，XSS 偷不走。
- `Secure`：只通过 HTTPS 发送。
- `SameSite=Lax`：跨站的 POST 等请求不带 Cookie，挡住大部分 CSRF（详见 [[web-csrf]]）。

没有“绝对安全”的位置：Cookie 用 SameSite 和 CSRF token 防 CSRF，头部方案必须先把 XSS 防住（见 [[web-xss]]）。对浏览器应用，业界更常见的建议是“HttpOnly Cookie + SameSite + CSRF 防护”，因为 XSS 比 CSRF 更难彻底杜绝，而 token 一旦被读走，损失更大。

## 动手实践

### 实践：解码一个 JWT，确认 payload 是明文可读的

本节用的样例 token（HS256，密钥是实验用的 `lab-only-secret-change-me-32bytes!!`）：

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwibmFtZSI6ImFsaWNlIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDkwMH0.YcljepBYbUgB4yqp3QyJgUCEkSR1hCCNI6tuLbJbIyg
```

#### 方法 1：jwt.io

打开 jwt.io，把上面的 token 粘贴到编码（Encoded）输入框。页面会立刻显示解码后的 Header 和 Payload，你能直接读到 `"name": "alice"`、`"role": "user"`，**全程不需要任何密钥**。再把上面的密钥填进签名校验的密钥输入框，页面会提示签名有效；随便改一个字符，就会提示签名无效。

:::warn 不要把生产 token 贴到任何在线网站
jwt.io 说明解码在浏览器本地完成，但养成习惯：真实环境的 token 一律离线解码。一个未过期的生产 token 就是一张可直接使用的登录凭证。
:::

#### 方法 2：命令行离线解码

```bash
T='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwibmFtZSI6ImFsaWNlIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDkwMH0.YcljepBYbUgB4yqp3QyJgUCEkSR1hCCNI6tuLbJbIyg'
python3 -c 'import sys,base64,json
for part in sys.argv[1].split(".")[:2]:
    print(json.dumps(json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))), indent=2))' "$T"
```

输出：

```
{
  "alg": "HS256",
  "typ": "JWT"
}
{
  "sub": "1",
  "name": "alice",
  "role": "user",
  "iat": 1790000000,
  "exp": 1790000900
}
```

读法：`"=" * (-len(part) % 4)` 是在补回 Base64URL 去掉的 `=` 填充。如果你偷懒用 `cut -d. -f2 | base64 -d`，在 macOS 上会看到末尾被截断成 `..."exp":179000090`，就是因为缺了填充，这也从侧面说明它只是编码。用 `date -r 1790000900`（macOS）或 `date -d @1790000900`（Linux）可以把 `exp` 换成人类可读的时间。

#### 方法 3：Java 解码 + 验签，并体会“能看但不能改”

保存为 `JwtPeek.java`，JDK 11+ 可以直接用 `java JwtPeek.java` 运行单文件源码：

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

public class JwtPeek {
    public static void main(String[] args) throws Exception {
        String[] parts = args[0].split("\\.");
        Base64.Decoder dec = Base64.getUrlDecoder(); // 能处理无填充的 Base64URL
        System.out.println("header  = " + new String(dec.decode(parts[0]), StandardCharsets.UTF_8));
        System.out.println("payload = " + new String(dec.decode(parts[1]), StandardCharsets.UTF_8));

        if (args.length > 1) { // 传入密钥时校验 HS256 签名
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(args[1].getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] expected = mac.doFinal((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            boolean ok = MessageDigest.isEqual(expected, dec.decode(parts[2])); // 常量时间比较
            System.out.println("signature valid = " + ok);
        }
    }
}
```

先验证原 token，再把 payload 里的 `user` 改成 `admin`、保留原签名：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
java JwtPeek.java "$T" 'lab-only-secret-change-me-32bytes!!'

P=$(printf '%s' '{"sub":"1","name":"alice","role":"admin","iat":1790000000,"exp":1790000900}' | base64 | tr '+/' '-_' | tr -d '=')
T2="$(echo "$T" | cut -d. -f1).$P.$(echo "$T" | cut -d. -f3)"
java JwtPeek.java "$T2" 'lab-only-secret-change-me-32bytes!!'
```

输出：

```
header  = {"alg":"HS256","typ":"JWT"}
payload = {"sub":"1","name":"alice","role":"user","iat":1790000000,"exp":1790000900}
signature valid = true
header  = {"alg":"HS256","typ":"JWT"}
payload = {"sub":"1","name":"alice","role":"admin","iat":1790000000,"exp":1790000900}
signature valid = false
```

读法：两次都能读出 payload（**没有机密性**）；但篡改后签名校验失败（**有完整性**）。攻击者想要伪造 `admin`，就必须拿到密钥，或者找到不校验签名/接受 `alg=none` 的服务端实现。这个 Demo 只是为了理解原理，项目里请用成熟库（如 Nimbus JOSE + JWT、Spring Security 的 `JwtDecoder`），它们还会校验 `exp`、`nbf`、`aud` 等。

## 攻击者视角

> 本课涉及的手法只能在你自己的实验环境或已获授权的目标上尝试。

拿到一个 token 时，攻击者的检查清单大致是：

- **先解码看内容**：payload 里有没有手机号、内部 ID、角色、租户 ID、内部服务名？这些信息本身就是情报，也提示了可以尝试篡改的字段（比如把 `role` 改成 `admin`，把 `tenantId` 换成别家的）。
- **看 Header 的 `alg`**：HS256 意味着存在共享密钥，可以尝试离线爆破弱密钥；也可以测试服务端是否接受 `alg=none`、是否存在算法混淆（细节在 [[web-authn]]）。
- **看 `exp`**：有效期长达数天甚至“永不过期”的 token，一旦从日志、浏览器 localStorage、抓包、URL 参数中泄露，就是长期可用的万能钥匙。
- **测试撤销**：用户登出、改密码后，旧 token 还能不能用？很多 JWT 实现的“登出”只是前端删掉 token，服务端完全不知情。
- **找存放位置的弱点**：token 在 localStorage 里 → 找 XSS；在 Cookie 里但没有 SameSite/CSRF 防护 → 试 CSRF；出现在 URL 里 → 查 Referer、代理日志、浏览器历史。
- **跨服务复用**：A 服务签发给 B 服务的 token，拿去访问 C 服务是否也能通过？如果各服务都不校验 `aud`，一个低权限服务的 token 可能打开高价值服务。

### 问题：JWT 泄露后，在过期前你有什么办法让它失效？

JWT 的验证是本地完成的，所以“让它失效”一定意味着**在验证路径上加入某种服务端状态**。可选手段，从精确到粗暴：

1. **jti 黑名单**：签发时给每个 token 一个唯一 `jti`，泄露时把 `jti` 写入 Redis，TTL 设为该 token 的剩余有效期；每次验证时查一次黑名单。精确，但每个请求多一次 Redis 查询。
2. **用户级版本号 / 失效时间点**：在 Redis 或数据库里给用户存一个 `tokenVersion`（或 `invalidBefore` 时间戳），token 里带上签发时的版本；改密码、强制下线时版本号加一，验证时发现版本不一致（或 `iat` 早于失效时间点）就拒绝。一次操作让该用户所有旧 token 失效。
3. **吊销 refresh token + 等 access token 自然过期**：如果 access token 只有 5 到 15 分钟，删掉服务端存储的 refresh token 后，攻击者最多再用几分钟。这是“短 access + 可撤销 refresh”设计的价值。
4. **轮换签名密钥**：更换 HS256 密钥或 RS256 私钥（从 JWKS 中移除旧公钥），所有用旧密钥签发的 token 立即失效。这会让**全部用户**重新登录，适合密钥本身泄露的情况。
5. **网关层拦截**：在 API 网关/Nginx 上临时按 token 特征或用户 ID 拦截，作为应急止血手段。

事后还要做：排查泄露途径（日志是否打印了完整的 Authorization 头？token 是否出现在 URL 里？），并审计这段时间内该 token 的使用记录。

## 防御与最佳实践

**选型**

- 浏览器为主的单体应用：优先 Session（Spring Session + Redis），Cookie 设置 `HttpOnly; Secure; SameSite=Lax`。
- 多服务 / App / 设备端：短有效期 JWT access token + 服务端可撤销的 refresh token；多服务验证时用 RS256/ES256，私钥只留在认证服务。

**JWT 签发与验证**

- payload 只放必要的、不敏感的声明（用户 ID、角色、`iss`、`aud`、`exp`、`jti`）。
- 验证方固定允许的算法，校验签名、`exp`、`nbf`、`iss`、`aud`，拒绝 `alg=none`。
- HS256 密钥至少 256 位随机值，放在密钥管理服务或环境变量中，不进 Git（见 [[cloud-secrets]]）。
- 不要把 token 放进 URL；日志里对 `Authorization` 头和 Cookie 做脱敏。

Spring Boot 中 Session Cookie 的配置（`application.properties`）：

```properties
server.servlet.session.cookie.http-only=true
server.servlet.session.cookie.secure=true
server.servlet.session.cookie.same-site=lax
server.servlet.session.timeout=30m
```

Spring Security 资源服务器里固定算法验证 HS256 的写法（依赖 `spring-boot-starter-oauth2-resource-server`，完整流程见 [[ss-token]]）：

```java
@Bean
JwtDecoder jwtDecoder(@Value("${app.jwt.secret}") String secret) {
    SecretKey key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key)
            .macAlgorithm(MacAlgorithm.HS256)   // 只接受 HS256，不看 token 自己怎么声明
            .build();
    decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer("https://auth.example.com"));
    return decoder;
}

@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));
    return http.build();
}
```

`createDefaultWithIssuer` 会校验时间戳（`exp`/`nbf`）和 `iss`；如需校验 `aud`，再组合一个自定义的 `OAuth2TokenValidator`。

**检测**

- 监控同一 `jti` 或同一用户的 token 在短时间内出现在差异很大的 IP / 设备上。
- 记录签名校验失败、`alg` 异常的请求数量，突增往往意味着有人在篡改或爆破。

## 常见误区

- **“JWT 是加密的，里面放什么都行”**：默认的 JWT 只是签名，任何人都能解码读到 payload。
- **“用了 JWT 就不需要考虑 CSRF”**：如果你把 JWT 放进 Cookie 让浏览器自动携带，CSRF 风险和 Session Cookie 完全一样。
- **“放 localStorage 比 Cookie 安全”**：它只是把 CSRF 风险换成了 XSS 风险，而且 XSS 下 token 能被整个带走。
- **“登出就是前端删掉 token”**：服务端不知情，被偷走的副本照样能用，需要撤销机制。
- **“JWT 一定比 Session 性能好”**：验签也有开销，token 体积还会增加每个请求的流量；Redis 查一次 Session 通常只要毫秒级甚至更少。选型应基于撤销、跨服务等需求，而不是想当然的性能。
- **“有效期设长一点用户体验更好”**：应该用 refresh token 解决体验问题，access token 保持短有效期。

## 自测

:::details 1. JWT 的三段分别是什么？为什么说“Base64URL ≠ 加密”？
Header（算法等元数据）、Payload（声明）、Signature（对前两段的签名）。Base64URL 只是一种可逆的编码，不需要任何密钥就能还原，所以 payload 对任何拿到 token 的人都是明文。签名只防篡改，不防查看。
:::

:::details 2. 攻击者把 payload 里的 role 从 user 改成 admin，为什么通常会失败？什么情况下会成功？
签名是对 header 和 payload 计算的，改动 payload 后签名不再匹配，服务端验签失败。会成功的情况：服务端没有验签（只解码）、接受 `alg=none`、存在算法混淆漏洞，或 HS256 密钥太弱被爆破出来。
:::

:::details 3. 10 个微服务都要验证 token，为什么更推荐 RS256/ES256 而不是 HS256？
HS256 下每个验证方都持有能签发 token 的共享密钥，任何一个服务泄露密钥，攻击者就能伪造任意用户的 token。RS256/ES256 下只有认证服务持有私钥，其他服务只拿公钥，只能验证不能签发，还可以通过 JWKS 和 `kid` 做密钥轮换。
:::

:::details 4. 说出 Session 相比 JWT 的两个优势和两个劣势。
优势：撤销简单（删除服务端记录即立即失效）；权限变更即时生效；Cookie 里只有一个很短的随机 ID，不泄露信息。劣势：服务端要存状态，多实例需要 Redis 或粘性会话；跨域、跨服务传递不便，下游服务需要回查会话存储。
:::

:::details 5. Token 放在 HttpOnly Cookie 和放在 Authorization 头里，分别主要面临什么风险？怎么防？
Cookie 由浏览器自动携带，主要风险是 CSRF，用 `SameSite`、CSRF token、校验 Origin 防护；它是 HttpOnly 的，XSS 读不到。Authorization 头需要 JS 读取 token，主要风险是 XSS 直接偷走 token，要靠杜绝 XSS（输出编码、CSP）和短有效期缓解；它不会被自动携带，因此没有 CSRF 问题。
:::

:::details 6. 一个用户报告手机丢了，你要让他所有设备上的 JWT 立即失效，怎么设计？
在服务端给用户维护 `tokenVersion`（或 `invalidBefore` 时间戳），token 里携带签发时的版本；处理丢失时把版本号加一，验证时发现版本不匹配就拒绝。同时删除该用户所有 refresh token，让它们无法换取新的 access token。
:::

:::details 7. 为什么不要把 token 放在 URL 参数里？
URL 会被记录在浏览器历史、Nginx 访问日志、代理日志中，还可能通过 Referer 头泄露给第三方站点。token 应该放在 Authorization 头或 Cookie 里，并在日志中脱敏。
:::

## 一句话总结

Session 把状态留在服务端、撤销容易；JWT 把签名后的状态交给客户端、扩展容易但撤销困难；JWT 只防篡改不防查看，存放位置决定你要重点防 CSRF 还是 XSS。
