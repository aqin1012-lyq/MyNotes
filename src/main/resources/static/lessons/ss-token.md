## 为什么要学

[[net-token]] 讲清了 JWT 的结构和“无法撤销”的难题，[[ss-arch]] 讲了过滤器链，[[ss-authz]] 讲了授权，[[ss-oauth2]] 讲了授权码 + PKCE 怎么拿到 token。这一课回答剩下的问题：token 拿到之后，**活多久、怎么续、怎么作废、怎么登出、出事后怎么查**。这就是 Token 生命周期设计。

对 Java 后端来说，这些都是天天碰到的需求：App 七天免登录、改密码后踢掉所有设备、车机换绑后旧账号立即失效、电商后台运营离职当天停用账号、安全部门来问“上周三谁导出了用户手机号”。做不好会有两类后果：要么 token 一旦泄露就一直能用，要么出了事日志里什么都查不到，甚至日志里记了明文 token，日志本身成了泄露源。

学完之后你能：在项目② 认证中心里实现“短 Access Token + Refresh Token 轮换 + 重放检测”，用 Redis 做撤销（jti 黑名单、用户版本号），实现真正的登出与 SSO 全局登出，并输出结构化审计日志。

:::tip 版本与依赖约定
Spring Boot 4.1（Spring Security 7.x）、Java 17、lambda DSL；API 在 Spring Security 6.x 中同样可用。JWT 签发和验证用 Spring Security 的 `spring-security-oauth2-jose`（底层是 Nimbus JOSE + JWT）；Redis 用 Spring Data Redis 的 `StringRedisTemplate`。
:::

> 本课中的攻击手法只用于你自己的实验环境或获得授权的目标。

## 核心概念

### 1. 短 Access Token + Refresh Token 轮换与重放检测

两种 token 分工不同：

| | Access Token (AT) | Refresh Token (RT) |
|---|---|---|
| 用途 | 每次调 API 都带上 | 只发给认证中心的 `/token` 或 `/refresh` |
| 形式 | 常用 JWT，资源服务器本地验签 | 建议不透明随机串，服务端存储 |
| 有效期 | 短：5 到 15 分钟 | 长：几天到几十天，另设“绝对上限” |
| 撤销 | 难（本地验证，见下一节） | 容易：删掉服务端记录即可 |
| 暴露面 | 大：每个请求、每个下游服务 | 小：只在刷新时出现一次 |

AT 短，是为了把“泄露后能被冒用的时间窗口”压小；RT 长，是为了用户不必频繁登录。但 RT 本身也会被偷（XSS 读 localStorage、手机被 root、日志泄露），所以要做**轮换（Rotation）**：每次用 RT 换新 AT 时，同时发一个**新 RT**，旧 RT 立即作废。同一次登录产生的所有 RT 构成一个“家族”（family）。

```
login  -> AT1 + RT1        family F = {RT1}                 登录，创建家族
t+15m  RT1 -> AT2 + RT2    RT1 marked USED, F = {RT1*,RT2}  正常轮换
t+30m  RT2 -> AT3 + RT3    RT2 marked USED                  正常轮换

--- attacker stole RT2 earlier ---
t+31m  attacker sends RT2  RT2 already USED -> REUSE!       旧 RT 被重放
       => revoke family F (RT3 dead too), audit + alert     整个家族作废并告警
t+32m  user sends RT3      family revoked -> 401            用户被迫重新登录
```

**问题：Refresh Token 被偷了，Rotation 机制如何帮你发现？** 关键在于：一个 RT 只允许用一次，而真用户和攻击者手里拿的是**同一个** RT。两人之中必然有一个先用、一个后用。后用的那一方提交的是“已使用”的 RT，服务端据此判定“这个 RT 至少被两个人持有”，也就是**已泄露**。服务端分不清谁是真用户，所以最稳的做法是**把整个家族作废**，让双方都必须重新走登录（真用户能过密码/MFA，攻击者过不了），同时写审计日志、触发告警。

两种顺序都能被发现：攻击者先用，则真用户下次刷新时触发重放；真用户先用，则攻击者使用时触发。没有轮换时，一个被偷的 RT 可以和真用户并行使用到过期，服务端完全察觉不到。

还要注意三点：

- 必须**记住已使用的 RT**（至少保留到它原本的过期时间），否则无法区分“重放”和“不存在的 RT”。
- 并发刷新：App 两个线程同时拿 RT1 刷新，会误判为重放。可以设几秒的宽限期（同一 RT 在宽限期内重复使用时返回同一组新 token），或在客户端串行化刷新。宽限期越长，攻击者可利用的窗口越大。
- 家族要有**绝对过期时间**（例如登录后 30 天必须重新登录），否则轮换可以让一个会话无限续命。

### 2. Token 撤销：黑名单、版本号、Introspection

[[net-token]] 已经列过“JWT 泄露后怎么办”的五种手段，这里只展开工程上最常用的三种，以及它们的代价。

**(a) jti 黑名单（Redis denylist）。** 签发 AT 时写入唯一 `jti`。需要撤销某个 AT 时写 `deny:jti:<jti>`，TTL = 该 token 的剩余有效期（`exp - now`）。token 过期后，验签本身就会拒绝它，黑名单条目也随之自动消失，Redis 不会无限增长。资源服务器每个请求查一次 `EXISTS`。

**(b) 用户级版本号（token version）。** Redis/MySQL 里存 `tv:<userId> = 3`，签发 AT 时写入 claim `tv=3`。改密码、强制下线、禁用账号时执行 `INCR tv:<userId>`，此后所有 `tv<4` 的 token 都被拒绝。一次操作作废该用户所有设备的 token。也可以用 `invalidBefore` 时间戳，与 `iat` 比较，效果相同。

**(c) Introspection（RFC 7662）。** AT 用不透明随机串，资源服务器每次拿它去问认证中心：

```
POST /oauth2/introspect HTTP/1.1
Host: auth.example.com
Authorization: Basic b3JkZXItc2VydmljZTpzZWNyZXQ=
Content-Type: application/x-www-form-urlencoded

token=2YotnFZFEjr1zCsicMWpAA&token_type_hint=access_token

HTTP/1.1 200 OK
Content-Type: application/json

{"active":true,"client_id":"mall-app","username":"alice",
 "scope":"order:read","sub":"1001","exp":1790000000}
```

RFC 7662 规定响应里只有 `active` 是必需的；token 无效、过期或已撤销时返回 `{"active":false}`，不透露原因。introspection 端点本身必须要求调用方认证（上例用资源服务器自己的 client 凭证走 Basic），否则它就成了“token 有效性探测器”。

| 方案 | 生效速度 | 每请求成本 | 粒度 | 主要缺点 |
|---|---|---|---|---|
| 只靠短 AT 过期 | 最多一个 AT 寿命 | 0 | — | 有几分钟窗口 |
| jti 黑名单 | 立即 | 1 次 Redis | 单个 token | 需要知道要撤销的 jti |
| 用户版本号 | 立即 | 1 次 Redis（可短缓存） | 用户全部 token | 不能只踢一台设备 |
| Introspection | 立即 | 1 次 HTTP 到认证中心 | 单个 token | 认证中心成为瓶颈和单点，需缓存 |

实践中常见组合：**AT 短 + RT 可撤销 + 用户版本号**作为基线，对高风险操作（管理员、支付、车辆远程控制指令）再叠加 jti 黑名单或 introspection。注意：给 introspection 结果加缓存会重新引入“撤销延迟”，缓存时间就是你的窗口。

### 3. 登出的真正含义：客户端、服务端、SSO 全局登出

“点了退出”可能对应三种完全不同强度的动作：

| 层次 | 做了什么 | 被偷的 token 还能用吗 |
|---|---|---|
| 客户端登出 | 前端删掉 localStorage / 内存里的 token，跳回登录页 | **能**。服务端什么都不知道 |
| 服务端登出 | 撤销该会话的 RT 家族，把当前 AT 的 jti 放入黑名单（或等它过期）；Session 模式下 `session.invalidate()` | 不能（或最多剩一个 AT 寿命） |
| SSO 全局登出 | 结束认证中心（IdP）上的 SSO 会话，并通知所有接入的应用（RP）结束本地会话 | 所有应用都不能 |

只做客户端登出是最常见的误区：接口返回 200，界面也回到了登录页，但 token 在服务端看来仍然有效。

**SSO 场景为什么更复杂？** 用户在 IdP 有一个 SSO 会话（通常是 IdP 域名下的 Cookie），在每个应用里又各有一个本地会话。只退出应用 A 的本地会话时，下次访问 A 会被重定向到 IdP，而 IdP 会话还在，于是**不用输入密码就又登录了**。所以“全局登出”要做两件事：

- **结束 IdP 会话**：OIDC RP-Initiated Logout。应用把浏览器重定向到 IdP 发现文档里的 `end_session_endpoint`，带上 `id_token_hint`、`post_logout_redirect_uri`（必须是预先注册过的地址）和 `state`。
- **通知其他 RP**：OIDC Back-Channel Logout（IdP 服务端直接 POST 一个 `logout_token` 到各 RP 注册的登出地址，RP 根据其中的 `sid`/`sub` 结束本地会话）或 Front-Channel Logout（IdP 在浏览器里用 iframe 加载各 RP 的登出地址，容易被第三方 Cookie 限制影响）。

在 Spring Security 里，作为 OIDC 客户端（RP）的应用这样接入：

```java
@Bean
SecurityFilterChain web(HttpSecurity http, ClientRegistrationRepository repo) throws Exception {
    var oidcLogout = new OidcClientInitiatedLogoutSuccessHandler(repo);
    oidcLogout.setPostLogoutRedirectUri("{baseUrl}/");   // 必须在 IdP 预先登记
    http
        .authorizeHttpRequests(a -> a.anyRequest().authenticated())
        .oauth2Login(Customizer.withDefaults())
        .logout(l -> l.logoutSuccessHandler(oidcLogout))   // 本地登出后跳到 IdP 的 end_session_endpoint
        .oidcLogout(o -> o.backChannel(Customizer.withDefaults())); // 接收 IdP 的 back-channel logout_token
    return http.build();
}
```

`oidcLogout(...).backChannel(...)` 从 Spring Security 6.2 起提供；它依赖 IdP 支持 Back-Channel Logout 并登记了 RP 的回调地址，具体路径和多实例部署下的会话清理方式请以你所用版本的官方文档为准。登出请求仍然要走 POST + CSRF 防护（[[web-csrf]]），否则攻击者可以用一个图片标签把用户“强制登出”。

### 4. SSO：基于 OIDC 的单点登录

OIDC 在 OAuth2 授权码流程之上加了一个 **ID Token**（JWT，描述“谁登录了”）和标准的 UserInfo、发现文档（`/.well-known/openid-configuration`）。授权码 + PKCE 的细节见 [[ss-oauth2]]，这里只看 SSO 是怎么“单点”的：

```
Browser          App A (RP)          IdP (auth center)         App B (RP)
   |--GET /a------->|                        |                        |
   |<-302 authorize-|                        |                        |  A 无本地会话
   |--GET /authorize?client_id=A&scope=openid+...--->|                |
   |<-------- login page, user enters password -------|               |  IdP 建立 SSO 会话
   |<-302 A/callback?code=...  + Set-Cookie IdP_SSO---|               |
   |--callback----->|--code -> id_token,AT,RT-->|                     |  A 建立本地会话
   |                                                                   |
   |--GET /b------------------------------------------------------->|  B 无本地会话
   |<-302 authorize---------------------------------------------------|
   |--GET /authorize?client_id=B + Cookie IdP_SSO---->|               |  带着 IdP 会话
   |<-302 B/callback?code=... (no password!)---------|               |  直接发 code
   |--callback---------------------------------------------------->|  B 登录成功
```

要点：

- “单点”靠的是 **IdP 上的会话**，不是在应用之间共享 token。每个 RP 拿到的是自己的 ID Token / AT（`aud` 不同），不要让 App B 接受发给 App A 的 token。
- RP 必须校验 ID Token 的 `iss`、`aud`、`exp`、签名，以及请求时带的 `nonce`；Spring Security 的 `oauth2Login` 会自动完成这些校验。
- ID Token 用来**登录 RP**，不是用来调 API 的；调 API 用 AT。
- 项目② 的认证中心可以用 Spring Authorization Server 充当 IdP，电商后台、运营平台、车队管理平台作为 RP 接入。

### 5. 审计日志：谁、什么时候、对什么、做了什么

审计日志和调试日志目的不同：调试日志给开发看，可以随时删改；审计日志是**证据**，要回答“谁（who）在什么时候（when）从哪里（where）对什么（what）做了什么（action），结果如何（outcome）”，要能按用户、按时间检索，并且不能被业务人员随意修改。

| 字段 | 示例 | 说明 |
|---|---|---|
| `ts` | `2026-09-24T10:15:03.120Z` | UTC 时间，服务器要做时间同步 |
| `event` | `REFRESH_REUSE_DETECTED` | 枚举值，便于告警规则匹配 |
| `actor` | `userId=1001` / `client=mall-app` | 身份用 ID，不用可变的昵称 |
| `target` | `family=6f1c...` / `order=88` | 被操作的对象 |
| `outcome` | `SUCCESS` / `FAILURE` / `DENIED` | 失败同样要记 |
| `ip` / `ua` | `203.0.113.7` | 注意反向代理后要取可信的真实 IP |
| `traceId` | `4bf92f35...` | 关联业务日志 |

应该记录的认证事件：登录成功与失败、账号锁定、MFA、token 签发、刷新、**重放检测**、撤销、登出、改密、权限变更，以及敏感数据的导出。

**绝不记录**：密码（包括错误密码，它常常是用户的另一个真实密码）、完整的 AT/RT/授权码/ID Token、`Authorization` 和 `Cookie` 请求头、验证码、密钥。需要关联某个 token 时，记它的 `jti` 或 RT 的 SHA-256 前几位。个人信息（手机号、VIN）按需脱敏。另外，写入日志的用户输入要防止换行注入伪造日志行，结构化 JSON 输出能天然避免这一点。

## 动手实践

### 实践：在认证中心里实现 Refresh Token 轮换 + Redis 撤销 + 审计日志

这是项目② 里程碑“Access Token + Refresh Token 轮换”“Token 撤销（Redis）与登出”“审计日志”的最小实现。为了聚焦 token 生命周期，登录部分假设已经按 [[ss-arch]] 完成（`AuthenticationManager` 校验用户名密码），这里直接从“认证成功后签发 token”开始。认证中心和资源服务器写在同一个应用里，拆开时只需把 `JwtDecoder` 部分放到资源服务器。

**第 0 步：依赖与 Redis。** 以下两个 artifact 由 Spring Boot 的依赖管理统一版本，无需写版本号：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
<!-- BearerTokenAuthenticationFilter / JwtAuthenticationProvider -->
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-resource-server</artifactId>
</dependency>
<!-- NimbusJwtEncoder / NimbusJwtDecoder, depends on nimbus-jose-jwt -->
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-oauth2-jose</artifactId>
</dependency>
```

```bash
docker run -d --name redis-lab -p 127.0.0.1:6379:6379 redis:7
```

Spring Boot 默认连接 `localhost:6379`，本地实验不用额外配置。Redis 只绑定 127.0.0.1，生产环境要加密码/ACL 和 TLS（[[cloud-secrets]]）。

**第 1 步：Redis 键设计。** RT 用 32 字节随机数（Base64URL 编码），Redis 里只存它的 SHA-256，Redis 被拖库也拿不到可用的 RT。

| 键 | 值 | TTL | 作用 |
|---|---|---|---|
| `rt:<sha256>` | `<familyId>:<userId>` | RT 有效期（7 天） | 查 RT 属于哪个家族、哪个用户 |
| `rt:used:<sha256>` | 使用时间 | 同上 | 标记“已使用”，用于重放检测 |
| `rtfam:<familyId>` | `<userId>` | 家族绝对寿命（30 天） | 家族存活；删掉即整个家族作废 |
| `deny:jti:<jti>` | `1` | AT 剩余寿命 | AT 黑名单 |
| `tv:<userId>` | 整数 | 不过期 | 用户 token 版本号 |

“已使用”用 `SET key value NX EX ttl`（`setIfAbsent`）实现：它是原子的，两个并发请求拿同一个 RT，只有一个能设置成功，另一个必然被判为重放，不存在“先读再写”的竞态。

**第 2 步：签名密钥、JwtEncoder 与带撤销检查的 JwtDecoder。**

```java
// imports: com.nimbusds.jose.jwk.{JWKSet,RSAKey}, com.nimbusds.jose.jwk.source.ImmutableJWKSet,
// org.springframework.security.oauth2.jwt.*, org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator
@Configuration
class JwtConfig {
    static final String ISSUER = "http://127.0.0.1:8080";

    @Bean
    KeyPair jwtKeyPair() throws Exception {          // demo only: new key on every start
        var gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        return gen.generateKeyPair();
    }

    @Bean
    JwtEncoder jwtEncoder(KeyPair kp) {
        RSAKey jwk = new RSAKey.Builder((RSAPublicKey) kp.getPublic())
                .privateKey((RSAPrivateKey) kp.getPrivate())
                .keyID("k1").build();
        return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
    }

    @Bean
    JwtDecoder jwtDecoder(KeyPair kp, RevocationValidator revocation) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder
                .withPublicKey((RSAPublicKey) kp.getPublic()).build(); // RS256 only
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(ISSUER),       // exp/nbf/iss
                revocation));                                        // jti + tv
        return decoder;
    }
}
```

注意 `setJwtValidator` 会**替换**默认校验器，所以必须把 `createDefaultWithIssuer` 一起放进去，否则连 `exp` 都不校验了。生产环境的私钥应来自 KMS/密钥库并固定 `kid`，资源服务器通过 JWKS 取公钥，见 [[cloud-secrets]]。

**第 3 步：撤销校验器（资源服务器侧）。** 每个带 Bearer token 的请求，在验签之后都会经过它：

```java
@Component
class RevocationValidator implements OAuth2TokenValidator<Jwt> {
    private final StringRedisTemplate redis;
    RevocationValidator(StringRedisTemplate redis) { this.redis = redis; }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt jwt) {
        String jti = jwt.getId();
        if (jti == null || Boolean.TRUE.equals(redis.hasKey("deny:jti:" + jti))) {
            return fail("token revoked");
        }
        String current = redis.opsForValue().get("tv:" + jwt.getSubject());
        long tv = current == null ? 0 : Long.parseLong(current);
        Object claim = jwt.getClaim("tv");
        if (!(claim instanceof Number n) || n.longValue() != tv) {
            return fail("token version outdated");
        }
        return OAuth2TokenValidatorResult.success();
    }

    private static OAuth2TokenValidatorResult fail(String msg) {
        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", msg, null));
    }
}
```

校验失败时，`BearerTokenAuthenticationEntryPoint` 返回 401，并在 `WWW-Authenticate` 头里带上 `error="invalid_token"`。这里对 Redis 的故障策略是“查不到就抛异常 → 请求失败”（fail closed）；如果你选择 Redis 故障时放行，要把它写成明确的、有告警的决定。

**第 4 步：签发与轮换服务。** 先看签发部分：

```java
public record TokenPair(String accessToken, String refreshToken, long expiresIn) {}

@Service
class TokenService {
    static final Duration AT_TTL = Duration.ofMinutes(10);
    static final Duration RT_TTL = Duration.ofDays(7);
    static final Duration FAMILY_TTL = Duration.ofDays(30);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JwtEncoder encoder;
    private final StringRedisTemplate redis;
    private final AuditLogger audit;
    TokenService(JwtEncoder e, StringRedisTemplate r, AuditLogger a) {
        this.encoder = e; this.redis = r; this.audit = a;
    }

    /** called after username/password (and MFA) succeeded */
    public TokenPair login(String userId, List<String> authorities) {
        String familyId = UUID.randomUUID().toString();
        redis.opsForValue().set("rtfam:" + familyId, userId, FAMILY_TTL);
        audit.event("LOGIN_SUCCESS", userId, "family=" + familyId, "SUCCESS");
        return issue(userId, authorities, familyId);
    }

    private TokenPair issue(String userId, List<String> authorities, String familyId) {
        Instant now = Instant.now();
        String tv = redis.opsForValue().get("tv:" + userId);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(JwtConfig.ISSUER).subject(userId)
                .issuedAt(now).expiresAt(now.plus(AT_TTL))
                .id(UUID.randomUUID().toString())          // jti
                .claim("tv", tv == null ? 0L : Long.parseLong(tv))
                .claim("sid", familyId)
                .claim("scope", String.join(" ", authorities))
                .build();
        JwsHeader header = JwsHeader.with(SignatureAlgorithm.RS256).keyId("k1").build();
        String at = encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();

        String rt = randomToken();
        redis.opsForValue().set("rt:" + sha256(rt), familyId + ":" + userId, RT_TTL);
        return new TokenPair(at, rt, AT_TTL.toSeconds());
    }
```

接着是刷新（轮换 + 重放检测）：

```java
    public TokenPair refresh(String rt, String ip) {
        String hash = sha256(rt);
        String owner = redis.opsForValue().get("rt:" + hash);
        if (owner == null) {                       // unknown or expired
            audit.event("REFRESH_INVALID", "-", "rt=" + hash.substring(0, 8), "FAILURE");
            throw new BadCredentialsException("invalid refresh token");
        }
        String familyId = owner.split(":")[0], userId = owner.split(":")[1];

        Boolean first = redis.opsForValue()
                .setIfAbsent("rt:used:" + hash, Instant.now().toString(), RT_TTL);
        if (!Boolean.TRUE.equals(first)) {         // second use => stolen
            revokeFamily(familyId);
            audit.event("REFRESH_REUSE_DETECTED", userId,
                    "family=" + familyId + " ip=" + ip, "DENIED");
            throw new BadCredentialsException("invalid refresh token");
        }
        if (!Boolean.TRUE.equals(redis.hasKey("rtfam:" + familyId))) {
            audit.event("REFRESH_FAMILY_REVOKED", userId, "family=" + familyId, "DENIED");
            throw new BadCredentialsException("invalid refresh token");
        }
        audit.event("TOKEN_REFRESHED", userId, "family=" + familyId, "SUCCESS");
        return issue(userId, authoritiesOf(userId), familyId);
    }

    public void revokeFamily(String familyId) {
        redis.delete("rtfam:" + familyId);   // all RTs in the family die at once
    }

    private List<String> authoritiesOf(String userId) {
        return List.of("order:read");        // load from DB in the real project
    }
```

最后是登出、“踢掉所有设备”和工具方法：

```java
    /** server-side logout of the current device */
    public void logout(Jwt at) {
        revokeFamily(at.getClaimAsString("sid"));
        Duration left = Duration.between(Instant.now(), at.getExpiresAt());
        if (!left.isNegative() && !left.isZero()) {
            redis.opsForValue().set("deny:jti:" + at.getId(), "1", left); // TTL = remaining life
        }
        audit.event("LOGOUT", at.getSubject(), "family=" + at.getClaimAsString("sid"), "SUCCESS");
    }

    /** password changed / account disabled: all devices */
    public void revokeAllForUser(String userId, String reason) {
        redis.opsForValue().increment("tv:" + userId);
        audit.event("TOKENS_REVOKED_ALL", userId, "reason=" + reason, "SUCCESS");
    }

    private static String randomToken() {
        byte[] b = new byte[32];
        RANDOM.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static String sha256(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256")
                    .digest(s.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

`revokeAllForUser` 只让 AT 失效；RT 家族还需要一并清理。简单做法是在 `refresh` 里也校验版本号（家族创建时把 `tv` 记进 `rtfam:` 的值），或维护 `user:fams:<userId>` 集合逐个删除，留给你在项目里选一种实现。

**第 5 步：接口与过滤器链。**

```java
@RestController
@RequestMapping("/auth")
class AuthController {
    record LoginReq(String username, String password) {}
    record RefreshReq(String refreshToken) {}

    private final AuthenticationManager authManager;
    private final TokenService tokens;
    AuthController(AuthenticationManager m, TokenService t) { this.authManager = m; this.tokens = t; }

    @PostMapping("/login")
    TokenPair login(@RequestBody LoginReq req) {
        Authentication a = authManager.authenticate(
                UsernamePasswordAuthenticationToken.unauthenticated(req.username(), req.password()));
        return tokens.login(a.getName(), a.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority).toList());
    }

    @PostMapping("/refresh")
    TokenPair refresh(@RequestBody RefreshReq req, HttpServletRequest http) {
        return tokens.refresh(req.refreshToken(), http.getRemoteAddr());
    }

    @PostMapping("/logout")
    ResponseEntity<Void> logout(@AuthenticationPrincipal Jwt jwt) {
        tokens.logout(jwt);
        return ResponseEntity.noContent().build();
    }

    @ExceptionHandler(BadCredentialsException.class)
    ResponseEntity<Map<String, String>> invalid() {   // same answer for every failure
        return ResponseEntity.status(401).body(Map.of("error", "invalid_grant"));
    }
}
```

```java
@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    http
        .securityMatcher("/auth/**", "/api/**")
        .authorizeHttpRequests(a -> a
            .requestMatchers(HttpMethod.POST, "/auth/login", "/auth/refresh").permitAll()
            .requestMatchers("/api/orders/**").hasAuthority("SCOPE_order:read")
            .anyRequest().authenticated())
        .oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults())) // uses our JwtDecoder bean
        .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        .csrf(c -> c.disable());   // OK only because tokens travel in headers/body, never cookies
    return http.build();
}
```

`AuthenticationManager` 与 `UserDetailsService` 沿用 [[ss-arch]] 中的配置。默认的 `JwtAuthenticationConverter` 会把 `scope` claim 转成 `SCOPE_` 前缀的权限，所以这里写 `SCOPE_order:read`。如果把 RT 放进 HttpOnly Cookie（浏览器场景更推荐），就不能再关闭 CSRF，并应把 Cookie 的 `Path` 限定为 `/auth/refresh`、`SameSite=Strict`。

**第 6 步：结构化审计日志。** 用一个独立的 logger 名 `AUDIT`，方便单独路由到审计存储；字段用 SLF4J 2 的 key-value API：

```java
@Component
class AuditLogger {
    private static final Logger AUDIT = LoggerFactory.getLogger("AUDIT");

    void event(String event, String actor, String target, String outcome) {
        AUDIT.atInfo()
             .addKeyValue("event", event)
             .addKeyValue("actor", actor)
             .addKeyValue("target", target)
             .addKeyValue("outcome", outcome)
             .log(event);
        // never pass passwords, raw tokens, Authorization/Cookie headers here
    }
}
```

```yaml
logging:
  structured:
    format:
      console: ecs     # Spring Boot 3.4+; also: logstash, gelf
```

Spring Boot 3.4 起内置结构化日志（ECS / Logstash / GELF 格式），MDC 与 SLF4J 的 key-value 会作为 JSON 字段输出；具体字段名请以你所用版本的 Spring Boot 文档“Structured Logging”一节为准。生产上把 `AUDIT` logger 单独写到一个 appender，发往只追加（append-only）的存储（ELK、云日志服务），业务数据库账号无权删改；也可以同时落 MySQL 的 `audit_log` 表方便后台查询。

**第 7 步：验证轮换与重放检测。** 启动应用后（用户 `alice` 按 [[ss-arch]] 配置）：

```bash
# 1) login
R1=$(curl -s -X POST localhost:8080/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"alice-pass"}')
echo "$R1" | jq .
RT1=$(echo "$R1" | jq -r .refreshToken)

# 2) normal refresh: RT1 -> RT2
R2=$(curl -s -X POST localhost:8080/auth/refresh -H 'Content-Type: application/json' \
     -d "{\"refreshToken\":\"$RT1\"}")
RT2=$(echo "$R2" | jq -r .refreshToken)

# 3) replay RT1 (what an attacker holding a stolen copy would do)
curl -s -i -X POST localhost:8080/auth/refresh -H 'Content-Type: application/json' \
     -d "{\"refreshToken\":\"$RT1\"}"

# 4) the legitimate client now tries RT2
curl -s -X POST localhost:8080/auth/refresh -H 'Content-Type: application/json' \
     -d "{\"refreshToken\":\"$RT2\"}"
```

预期输出（token 已截断）：

```
{ "accessToken": "eyJraWQiOiJrMSIsImFsZyI6IlJTMjU2In0.eyJzdWIi...",
  "refreshToken": "q3Jx0mZ...", "expiresIn": 600 }

HTTP/1.1 401
Content-Type: application/json
{"error":"invalid_grant"}

{"error":"invalid_grant"}
```

怎么读：第 3 步重放 RT1 被拒绝，这本身不稀奇；关键是第 4 步，**合法的 RT2 也被拒绝了**，因为重放触发了整个家族作废。应用日志里应能看到（ECS 格式，已省略无关字段）：

```
{"@timestamp":"2026-09-24T02:15:03.120Z","log.level":"INFO","log.logger":"AUDIT","message":"TOKEN_REFRESHED","event":"TOKEN_REFRESHED","actor":"alice","target":"family=6f1c...","outcome":"SUCCESS"}
{"@timestamp":"2026-09-24T02:15:09.847Z","log.level":"INFO","log.logger":"AUDIT","message":"REFRESH_REUSE_DETECTED","event":"REFRESH_REUSE_DETECTED","actor":"alice","target":"family=6f1c... ip=127.0.0.1","outcome":"DENIED"}
{"@timestamp":"2026-09-24T02:15:12.301Z","log.level":"INFO","log.logger":"AUDIT","message":"REFRESH_FAMILY_REVOKED","event":"REFRESH_FAMILY_REVOKED","actor":"alice","target":"family=6f1c...","outcome":"DENIED"}
```

日志里没有任何 token 原文，只有家族 ID。`REFRESH_REUSE_DETECTED` 就是告警规则要盯的事件。再用 `redis-cli` 看状态：

```
$ redis-cli --scan --pattern 'rt*'
rt:9c1d4e...          # RT1
rt:used:9c1d4e...     # RT1 used
rt:5a7b20...          # RT2
rt:used:5a7b20...     # RT2 used (by step 4)
$ redis-cli TTL rt:used:9c1d4e...
(integer) 604781
$ redis-cli EXISTS rtfam:6f1c...
(integer) 0
```

`rtfam:` 已不存在，说明家族被撤销；`rt:used:` 的 TTL 接近 7 天，说明“已使用”标记会一直保留到 RT 本来的过期时间。

**第 8 步：验证登出与黑名单。**

```bash
AT=$(curl -s -X POST localhost:8080/auth/login -H 'Content-Type: application/json' \
     -d '{"username":"alice","password":"alice-pass"}' | jq -r .accessToken)
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/api/orders -H "Authorization: Bearer $AT"
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8080/auth/logout -H "Authorization: Bearer $AT"
curl -s -i localhost:8080/api/orders -H "Authorization: Bearer $AT" | head -3
redis-cli --scan --pattern 'deny:jti:*' | head -1 | xargs redis-cli TTL
```

```
200
204
HTTP/1.1 401
WWW-Authenticate: Bearer error="invalid_token", error_description="..."
(integer) 587
```

怎么读：同一个 AT，登出前 200、登出后 401，说明这是**服务端登出**而不只是前端删 token；黑名单条目 TTL 约 587 秒，等于 AT 的剩余寿命，到期自动清理。`/api/orders` 假设是你已有的受保护接口（例如 [[ss-authz]] 中的订单接口）。再重新登录拿一个 AT，执行 `redis-cli INCR tv:alice` 后用它调用，应返回 401；再登录一次拿到的新 AT 带着新版本号，可以正常访问。这就是版本号“一刀切”的效果。

## 攻击者视角

- **偷 RT 比偷 AT 值钱**：AT 十分钟就过期，RT 能用几天。攻击者会找 XSS 读 `localStorage`、看 App 的本地存储和备份、翻日志和 APM 里的请求体、抓未加密的内网流量。
- **不轮换时的静默持久化**：拿到 RT 后与真用户并行刷新，服务端看起来一切正常。有轮换时，攻击者会尝试**抢先刷新**并持续刷新，让真用户的 RT 先失效——真用户只会觉得“又要登录了”。所以重放检测一定要作废家族并告警，而不是只拒绝这一次请求。
- **利用宽限期与竞态**：如果“已使用”的判断是先 `GET` 再 `SET`，两个并发请求可能都通过；如果宽限期设成几分钟，攻击者就有几分钟的窗口。
- **只做了客户端登出**：用户点了退出，攻击者手里的 AT/RT 照样能用。改密码不撤销旧 token 同理，这在账号被盗后的处置中尤其致命。
- **SSO 会话残留**：只退出 RP 不结束 IdP 会话，公用电脑上的下一个人访问任意接入应用都会被“自动登录”。
- **拿日志当泄露源**：`logging.level.org.springframework.web=TRACE`、网关访问日志记录完整 `Authorization` 头、审计日志里写了 RT 原文，都等于把凭证交给了能读日志的人。
- **反审计**：攻击者会删改日志或往日志注入换行伪造记录；日志与业务同权限、同主机存储时尤其容易。

## 防御与最佳实践

- AT 5 到 15 分钟；RT 设滑动有效期 + 家族绝对上限；高风险操作（改密、支付、远程开车门）要求重新认证，不只看 token。
- RT 必须轮换，服务端只存哈希；“已使用”标记用原子操作（`SET NX`）实现，保留到 RT 原过期时间；重放即作废家族 + 审计 + 告警。
- 撤销组合：短 AT + 可撤销 RT + 用户版本号为基线；需要单 token 立即失效时加 jti 黑名单（TTL = 剩余寿命）；需要集中控制时用 introspection，并清楚缓存时间就是撤销延迟。
- 改密码、禁用账号、角色降级、设备解绑时，自动触发 `revokeAllForUser` 并清理 RT 家族；刷新时从数据库重新加载权限，不要把旧 AT 里的权限复制到新 AT。
- 登出一定落到服务端；SSO 应用接入 RP-Initiated Logout，并尽量支持 Back-Channel Logout；登出接口走 POST + CSRF 防护。
- 资源服务器固定验签算法、校验 `iss`/`aud`/`exp`；多个 RP 不互相接受对方的 token。
- 浏览器端 RT 放 HttpOnly + Secure + SameSite Cookie，并限定 Path；App/车机端放系统安全存储（Android Keystore、iOS Keychain）。
- 审计日志：覆盖登录、刷新、重放、撤销、登出、权限变更；统一字段；UTC 时间；独立 logger、只追加存储、与业务分权；敏感字段不记录或只记哈希前缀；日志输出结构化 JSON。
- 检测规则示例：同一 `actor` 短时间内出现 `REFRESH_REUSE_DETECTED`、同一家族的刷新 IP 跨地域跳变、大量 `REFRESH_INVALID`（可能在枚举/撞 RT）。
- 自查时可以对照 OWASP ASVS 中会话管理与日志相关的章节，这也是项目② 里程碑“ASVS L2 自查”的一部分。

## 常见误区

- **“JWT 是无状态的，所以不能撤销。”** 能撤销，代价是在验证路径上引入少量状态（黑名单、版本号）。这是工程折中，不是设计失败。
- **“有了 Refresh Token 就可以把 AT 设成一天。”** 恰恰相反，RT 存在的意义就是让 AT 可以很短。
- **“轮换就是每次发新 RT。”** 只发新 RT 却不记录、不检测旧 RT 的再次使用，就发现不了盗用；旧 RT 必须作废，并在被重用时作废整个家族。
- **“黑名单要永久保存。”** 只需保存到 token 自然过期；过期后验签就会拒绝它。
- **“前端删掉 token 就是登出。”** 那只是客户端登出，服务端必须撤销。
- **“退出了应用就退出了 SSO。”** IdP 会话还在，下次会被静默登录回来。
- **“SSO 就是多个系统共用同一个 token。”** 单点靠的是 IdP 会话；每个应用应拿到自己 `aud` 的 token。
- **“审计日志越详细越好，把请求体全记下来。”** 请求体里有密码和 token；审计要的是“谁对什么做了什么”，不是原始数据。

## 自测

:::details 1. Refresh Token 被偷了，Rotation 机制如何帮你发现？
每个 RT 只能用一次，用过后被标记为“已使用”并换发新 RT。真用户和攻击者持有同一个 RT，总有一方后使用，后使用者提交的是已使用的 RT，服务端据此判定泄露（重放），作废整个 RT 家族、记审计日志并告警。双方都必须重新登录，攻击者因过不了密码/MFA 而出局。
:::

:::details 2. 为什么重放时要作废整个家族，而不是只拒绝这一次请求？
服务端无法分辨谁是真用户。如果只拒绝这一次，可能被拒的是真用户，攻击者则拿着新 RT 继续用下去。作废家族后双方都失去会话，只有能重新认证的真用户能回来。
:::

:::details 3. jti 黑名单条目的 TTL 应该设多少？为什么？
设为该 AT 的剩余有效期（`exp - now`）。过期后 token 本身已无法通过验签，条目不再有意义，让它随 TTL 自动删除，Redis 不会无限增长。
:::

:::details 4. jti 黑名单、用户版本号、Introspection 各适合什么场景？
jti 黑名单：精确撤销单个 token，如单设备登出。用户版本号：一次作废某用户全部 token，如改密、禁用账号。Introspection：需要认证中心集中、实时判断 token 状态，或使用不透明 AT 时；代价是每请求一次网络调用，需要缓存，而缓存时间就是撤销延迟。
:::

:::details 5. 用户在 SSO 环境下点“退出”，要做哪些事才算真正登出？
清除客户端的 token；服务端撤销本应用的 RT/会话（AT 进黑名单或等待过期）；通过 RP-Initiated Logout 结束 IdP 的 SSO 会话；由 IdP 通过 Back-Channel（或 Front-Channel）Logout 通知其他 RP 结束各自的本地会话。
:::

:::details 6. 刷新接口判断“已使用”时，为什么不能先 GET 再 SET？
两个并发请求可能同时 GET 到“未使用”，然后都成功换到新 token，重放检测被绕过。应使用原子操作，如 `SET key value NX EX ttl`（`setIfAbsent`）或 Lua 脚本。
:::

:::details 7. 审计日志要记录什么，绝对不能记录什么？
记录：时间（UTC）、事件类型、操作者 ID、目标对象、结果、来源 IP、traceId；覆盖登录、刷新、重放、撤销、登出、权限变更等。不能记录：密码（含错误密码）、完整的 AT/RT/授权码/ID Token、Authorization 与 Cookie 头、密钥和验证码；需要关联时用 jti 或哈希前缀。
:::

:::details 8. 为什么 `NimbusJwtDecoder.setJwtValidator` 里要同时放 `JwtValidators.createDefaultWithIssuer`？
`setJwtValidator` 会替换默认校验器。只放自定义的撤销校验器会导致 `exp`、`nbf`、`iss` 不再被校验，过期 token 也能通过。
:::

## 一句话总结

Access Token 要短，Refresh Token 要轮换并用“一次性 + 重放即作废家族”来暴露盗用，撤销靠 Redis 里的黑名单与版本号，登出要落到服务端乃至 IdP，所有这些动作都写进不含敏感数据的结构化审计日志。
