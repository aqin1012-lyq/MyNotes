## 为什么要学

到目前为止，MyNotes 的“当前用户”是靠请求头 `X-User-Id` 模拟的：谁都能在 curl 里写 `X-User-Id: 3` 冒充 admin。这本身就是 Lab 04 那一类越权漏洞的根源——身份来自不可信的客户端输入。这一课开始进入路线图的第 4 站 Spring Security，目标是让“你是谁”由服务端在认证之后决定，而不是由客户端声称。

对 Java 后端来说，Spring Security 是绕不过去的：几乎所有 Spring Boot 项目的登录、权限、Token 校验、CSRF 防护都在它的过滤器链里完成。很多人会“抄一段配置跑起来”，但一出问题（登录后还是 401、跨域 403、异步线程里拿不到用户）就只能盲改。本课要做的是把它的**架构**讲透：请求进入 Tomcat 之后，经过哪些对象，身份存在哪里，失败时谁来返回 401/403。

学完之后你能：画出 `DelegatingFilterProxy → FilterChainProxy → SecurityFilterChain` 的调用关系；用 `users` 表 + BCrypt 实现表单登录（Lab 10）；看懂 DEBUG 日志里的过滤器顺序；解释 `@Async` 里为什么拿不到用户。这是项目② 安全认证中心的地基，后面的 [[ss-authz]]、[[ss-oauth2]]、[[ss-token]] 全都建立在这套架构之上。

:::tip 版本约定
本课基于 Spring Boot 4.1（对应 Spring Security 7.x）、Java 17。所有配置使用 lambda DSL + `SecurityFilterChain` Bean，不使用已删除的 `WebSecurityConfigurerAdapter` 和 `antMatchers`。
:::

> 本课中的攻击手法只用于你自己的 MyNotes 实验环境或获得授权的目标。

## 核心概念

### 1. DelegatingFilterProxy → FilterChainProxy → SecurityFilterChain

Servlet 容器（Tomcat）只认识标准的 `jakarta.servlet.Filter`，它不知道 Spring 容器里有哪些 Bean。Spring Security 用三层结构把两者接起来：

```
HTTP request
   |
   v
Tomcat FilterChain
   |-- other filters (CharacterEncoding ...)
   |-- DelegatingFilterProxy          <- Servlet 容器注册的普通 Filter
   |       |  delegates to bean "springSecurityFilterChain"
   |       v
   |   FilterChainProxy               <- Spring Bean，安全入口
   |       |  pick FIRST chain whose securityMatcher matches
   |       v
   |   SecurityFilterChain #1  (/secure/l10/**)
   |       |-- SecurityContextHolderFilter
   |       |-- CsrfFilter
   |       |-- LogoutFilter
   |       |-- UsernamePasswordAuthenticationFilter
   |       |-- ExceptionTranslationFilter
   |       |-- AuthorizationFilter
   |   SecurityFilterChain #2  (/**)
   |
   v
DispatcherServlet -> @RestController
```

- `DelegatingFilterProxy`：一个“桥”，由 Spring Boot 自动注册到 Servlet 容器，真正的工作委托给名为 `springSecurityFilterChain` 的 Bean。好处是可以延迟到 Spring 容器就绪后再查找 Bean。
- `FilterChainProxy`：持有一个 `List<SecurityFilterChain>`，按顺序找**第一个**匹配当前请求的链，只执行这一条。它还负责清理 `SecurityContextHolder`、用 `HttpFirewall` 拒绝可疑 URL（如包含 `;`、`//`、编码后的 `/`）。
- `SecurityFilterChain`：你用 `HttpSecurity` 构建出来的一组有序 Filter。一个应用可以有多条，用 `securityMatcher(...)` 区分、用 `@Order` 排序。

类比你熟悉的 Nginx：`FilterChainProxy` 像 `server` 块，`SecurityFilterChain` 像按顺序匹配的 `location`，匹配到一个就不再往下找。所以**更具体的链要放在更前面**，`/**` 的兜底链放最后。

### 2. Authentication / AuthenticationManager / AuthenticationProvider / UserDetailsService

`Authentication` 是一个接口，既表示“认证请求”，也表示“认证结果”：

| 属性 | 认证前（请求） | 认证后（结果） |
|---|---|---|
| `principal` | 用户名字符串 | `UserDetails` 对象（你的用户） |
| `credentials` | 明文密码 | 通常被擦除为 `null` |
| `authorities` | 空 | `ROLE_USER` 等权限集合 |
| `isAuthenticated()` | `false` | `true` |

表单登录时各对象的协作：

```
UsernamePasswordAuthenticationFilter
   | new UsernamePasswordAuthenticationToken("alice", "alice123")   未认证
   v
AuthenticationManager (ProviderManager)
   | loop providers, first one that supports() the token
   v
DaoAuthenticationProvider
   |-- UserDetailsService.loadUserByUsername("alice")   查 users 表
   |-- PasswordEncoder.matches(raw, stored)             比对 BCrypt
   |-- check enabled / locked / expired
   v
UsernamePasswordAuthenticationToken(userDetails, null, [ROLE_USER])   已认证
   |
   v
SecurityContextHolder + session  ->  success handler (redirect)
```

- `AuthenticationManager`：只有一个方法 `authenticate(Authentication)`。默认实现 `ProviderManager` 持有多个 `AuthenticationProvider`，逐个尝试。
- `AuthenticationProvider`：真正干活的。`DaoAuthenticationProvider` 处理用户名密码；以后你会见到 `JwtAuthenticationProvider`（[[ss-token]]）、`OidcAuthorizationCodeAuthenticationProvider`（[[ss-oauth2]]）。
- `UserDetailsService`：只负责“按用户名加载用户”，不负责比对密码。这是你最常自己实现的接口，数据可以来自 MySQL、LDAP、Redis。

失败时 Provider 抛 `AuthenticationException` 的子类，如 `BadCredentialsException`、`LockedException`、`DisabledException`。注意：默认情况下“用户不存在”也会被转换为 `BadCredentialsException`（`hideUserNotFoundExceptions` 默认为 true），这是为了防止用户名枚举。

### 3. SecurityContextHolder 与线程模型

认证结果放在 `SecurityContext` 里，`SecurityContextHolder` 默认用 **ThreadLocal** 保存它（策略 `MODE_THREADLOCAL`）。在 Tomcat 的“一个请求一个线程”模型下，这意味着：同一个请求内任何地方都能用静态方法拿到当前用户。

```java
Authentication auth = SecurityContextHolder.getContext().getAuthentication();
String name = auth.getName();
```

一个请求的生命周期：

1. `SecurityContextHolderFilter` 通过 `SecurityContextRepository`（默认是 HttpSession + request attribute）加载上下文，放进 ThreadLocal。
2. 后续 Filter、Controller、Service 读取 ThreadLocal。
3. 请求结束，`FilterChainProxy` 清空 ThreadLocal，防止线程池复用时把 alice 的身份“漏”给下一个请求。

Spring Security 6 起有一个重要变化：`SecurityContextHolderFilter` **只加载不自动保存**。如果你自己写登录接口（不用 formLogin），认证成功后必须显式调用 `securityContextRepository.saveContext(context, request, response)`，否则下一次请求就“掉登录”。formLogin 内部已经替你做了。

**@Async 为什么拿不到当前用户？** `@Async` 方法在另一个线程（线程池）里执行，ThreadLocal 不跨线程，所以 `getAuthentication()` 返回 `null`。解决办法：

- 把需要的信息（如 userId）作为**参数**传进异步方法——最简单、最清晰，推荐。
- 用 Spring Security 提供的包装器 `DelegatingSecurityContextAsyncTaskExecutor` 包装执行 `@Async` 的线程池，它会在提交任务时复制当前上下文、执行后清理。
- `MODE_INHERITABLETHREADLOCAL` 只对“新建”的子线程生效，线程池里的线程是复用的，会拿到旧的/错的身份，**不要**在线程池场景用它。

```java
@Bean
public Executor taskExecutor() {
    ThreadPoolTaskExecutor pool = new ThreadPoolTaskExecutor();
    pool.setCorePoolSize(4);
    pool.initialize();
    return new DelegatingSecurityContextAsyncTaskExecutor(pool);
}
```

同理，MQTT 消费线程、`CompletableFuture.supplyAsync`、定时任务里都没有 Web 请求的用户上下文——这些场景的“身份”应该是设备 ID 或系统账户，要显式传递并记录到审计日志。

### 4. PasswordEncoder 与 DelegatingPasswordEncoder

密码存储的原则：**不可逆、加盐、足够慢**。MD5/SHA-256 太快，GPU 每秒能算数十亿次，而 BCrypt 通过“cost 因子”（默认 10，即 2^10 轮）刻意变慢。一个 BCrypt 哈希长这样：

```
$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
 |   |  |<------ 22 chars salt ----->|<------ 31 chars hash ----->|
 |   +-- cost = 10
 +------ version
```

盐是随机生成并写在哈希里的，所以同一个密码每次 `encode` 结果都不同，比对要用 `matches(raw, encoded)`，**不能**自己 encode 一遍再 `equals`。

`DelegatingPasswordEncoder` 解决“算法迁移”问题：存储格式为 `{id}encoded`，例如 `{bcrypt}$2a$10$...`、`{noop}alice123`。它根据前缀选择对应的编码器比对；新密码统一用默认算法（`PasswordEncoderFactories.createDelegatingPasswordEncoder()` 的默认 id 是 `bcrypt`）。

```java
PasswordEncoder enc = PasswordEncoderFactories.createDelegatingPasswordEncoder();
String hash = enc.encode("alice123");       // {bcrypt}$2a$10$....
enc.matches("alice123", hash);              // true
enc.upgradeEncoding("{noop}alice123");      // true，说明该升级了
```

配合 `UserDetailsPasswordService`，`DaoAuthenticationProvider` 会在用户**登录成功**、且 `upgradeEncoding` 返回 true 时，调用 `updatePassword` 把旧哈希替换成新哈希——这就是生产环境“不重置密码也能从 MD5 迁到 BCrypt”的做法（旧数据需先加上 `{MD5}` 之类的前缀）。

| 编码器 | 场景 |
|---|---|
| `BCryptPasswordEncoder` | 默认首选，生态最广 |
| `Argon2PasswordEncoder` / `SCryptPasswordEncoder` | 内存困难型，抗 GPU 更强，需要额外依赖（BouncyCastle） |
| `Pbkdf2PasswordEncoder` | 需要 FIPS 合规时 |
| `NoOpPasswordEncoder` | 只用于演示，已标记为废弃 |

### 5. 异常处理：AuthenticationEntryPoint vs AccessDeniedHandler（401 vs 403）

`ExceptionTranslationFilter` 位于 `AuthorizationFilter` 之前，用 try/catch 包住后面的链，把安全异常翻译成 HTTP 响应：

```
AuthorizationFilter throws
   |
   +-- AuthenticationException              -> AuthenticationEntryPoint   401 / 跳转登录页
   |
   +-- AccessDeniedException
         |-- user is anonymous             -> AuthenticationEntryPoint   先去登录
         +-- user is authenticated         -> AccessDeniedHandler        403
```

| | 401 Unauthorized | 403 Forbidden |
|---|---|---|
| 真实含义 | 未认证：我不知道你是谁 | 已认证但无权限：我知道你是谁，但你不能做 |
| 处理者 | `AuthenticationEntryPoint` | `AccessDeniedHandler` |
| formLogin 默认行为 | 302 跳转 `/login` | 403 错误页 |
| API 常见做法 | 返回 401 JSON，带 `WWW-Authenticate` | 返回 403 JSON |

对 REST API，登录页跳转没有意义，常见配置是：

```java
http.exceptionHandling(ex -> ex
        .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED))
        .accessDeniedHandler((req, res, e) -> res.sendError(HttpServletResponse.SC_FORBIDDEN)));
```

注意：只有**过滤器链里**抛出的异常才会经过 `ExceptionTranslationFilter`。`@PreAuthorize` 在 Controller 方法上抛的 `AccessDeniedException` 会先经过 Spring MVC 的异常处理——如果你写了一个 `@ExceptionHandler(Exception.class)` 把所有异常都转成 500，就会把 403 吞掉，这是很常见的坑。

## 动手实践

### 实践 1：Lab 10——给 MyNotes 接入表单登录，替换 X-User-Id

目标：新增 `/secure/l10/**` 接口，身份来自“表单登录 + `users` 表 + BCrypt”，而不是请求头。已有的 Lab 01–05 暂时保持原样（它们的教学前提就是 `X-User-Id`），所以我们用**两条** SecurityFilterChain：一条严格保护 Lab 10，一条兜底放行旧实验。

```
request path              chain                     rule
/login, /logout       --> #1 lab10Chain (Order 1)   formLogin + CSRF
/secure/l10/admin/**  --> #1 lab10Chain             hasRole ADMIN
/secure/l10/**        --> #1 lab10Chain             authenticated
everything else       --> #2 legacyChain (Order 2)  permitAll   旧实验和学习站，暂不保护
```

**第 1 步：加依赖（pom.xml）。** 版本由 Spring Boot 父 POM 管理，不写 version：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
```

一旦加入 starter、还没写任何配置时，Spring Boot 会保护**所有**接口，并在启动日志里打印一个随机密码（用户名 `user`），你之前的 `./mvnw test` 会大面积变成 401。这正好说明了“默认安全”的设计。接下来的配置会覆盖这个默认行为。

**第 2 步：带 id 的用户对象。** 框架自带的 `User` 只有用户名，而笔记归属靠 `owner_id`，所以扩展一个字段：

```java
package com.aqin.mynotes.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.User;

import java.util.Collection;

public class LoginUser extends User {

    private final long id;

    public LoginUser(long id, String username, String password,
                     Collection<? extends GrantedAuthority> authorities) {
        super(username, password, authorities);
        this.id = id;
    }

    public long getId() {
        return id;
    }
}
```

**第 3 步：从 `users` 表加载用户。** 同时实现 `UserDetailsPasswordService`，让旧格式密码在登录成功时被自动升级：

```java
package com.aqin.mynotes.security;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsPasswordService;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class DbUserDetailsService implements UserDetailsService, UserDetailsPasswordService {

    private final JdbcTemplate jdbc;

    public DbUserDetailsService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UserDetails loadUserByUsername(String username) {
        List<LoginUser> found = jdbc.query(
                "SELECT id, username, password, role FROM users WHERE username = ?",
                (rs, i) -> new LoginUser(rs.getLong("id"), rs.getString("username"),
                        rs.getString("password"),
                        List.of(new SimpleGrantedAuthority("ROLE_" + rs.getString("role")))),
                username);
        if (found.isEmpty()) {
            throw new UsernameNotFoundException("user not found");
        }
        return found.get(0);
    }

    @Override
    public UserDetails updatePassword(UserDetails user, String newPassword) {
        jdbc.update("UPDATE users SET password = ? WHERE username = ?", newPassword, user.getUsername());
        LoginUser old = (LoginUser) user;
        return new LoginUser(old.getId(), old.getUsername(), newPassword, old.getAuthorities());
    }
}
```

要点：SQL 用 `?` 参数化（Lab 01 的教训）；表里 `role` 存的是 `USER`/`ADMIN`，这里加上 `ROLE_` 前缀，这样 `hasRole("ADMIN")` 才能匹配（`hasRole` 会自动补 `ROLE_`，`hasAuthority` 不会）。

**第 4 步：完整的 SecurityFilterChain 配置。**

```java
package com.aqin.mynotes.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** Lab 10: real login. Only these paths enter this chain. */
    @Bean
    @Order(1)
    SecurityFilterChain lab10Chain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/secure/l10/**", "/login", "/logout")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/secure/l10/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .formLogin(form -> form
                .defaultSuccessUrl("/secure/l10/me", true)
                .permitAll())
            .logout(logout -> logout
                .logoutSuccessUrl("/login?logout")
                .permitAll());
        // CSRF, session fixation protection, security headers: enabled by default
        return http.build();
    }

    /** Everything else (labs 01-05, study site, H2 console): unchanged for now. */
    @Bean
    @Order(2)
    SecurityFilterChain legacyChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
            .csrf(csrf -> csrf.disable())                       // labs use headers, not cookies; revisit in Lab 03
            .headers(h -> h.frameOptions(f -> f.sameOrigin())); // H2 console uses frames
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }
}
```

逐行读懂：

- 只要容器里有一个 `UserDetailsService` Bean 和一个 `PasswordEncoder` Bean，Spring Security 就会自动组装 `DaoAuthenticationProvider`（还会发现它同时是 `UserDetailsPasswordService`），Boot 默认的随机密码用户也随之消失。
- `lab10Chain` 的 `securityMatcher` 决定“哪些请求进这条链”；`authorizeHttpRequests` 决定“进来后要什么权限”。两者别混淆。
- 规则**从上到下**匹配，所以具体的 `/admin/**` 写在 `anyRequest()` 前面。
- `formLogin` 不指定 `loginPage` 时，框架会生成一个默认登录页（`GET /login`），表单里自带隐藏字段 `_csrf`。
- `legacyChain` 关闭 CSRF 是**有意识的临时妥协**：旧实验不用 Cookie 会话，因此没有 CSRF 前提；等 Lab 03 做 CSRF 时再收紧。

**第 5 步：把明文密码变成 BCrypt。** 先写一个一次性的测试生成哈希（每次运行结果都不同，这是正常的）：

```java
class HashGenTests {
    @Test
    void printHashes() {
        PasswordEncoder enc = PasswordEncoderFactories.createDelegatingPasswordEncoder();
        for (String raw : List.of("alice123", "bob123", "S3cret!")) {
            System.out.println(raw + " -> " + enc.encode(raw));
        }
    }
}
```

```
alice123 -> {bcrypt}$2a$10$Qx1....（共 68 个字符左右）
bob123 -> {bcrypt}$2a$10$7Lk....
S3cret! -> {bcrypt}$2a$10$Zp0....
```

把输出粘进 `data.sql` 的 `password` 列（列宽 128，放得下），并把 `schema.sql` 里 “plaintext on purpose” 的注释改掉。也可以先体验“自动升级”：把某个用户写成 `{noop}alice123`，用 alice 登录一次，再到 H2 控制台执行 `SELECT username, password FROM users`，会看到她的密码已经变成 `{bcrypt}$2a$10$...`——这是第 3 步 `updatePassword` 被调用的结果。

:::warn 旧测试会受影响
Lab 01 的 UNION 注入测试和 Lab 04 的过度返回测试断言“能读到明文 `S3cret!`”。改成哈希后，这些断言需要改成“读到了 password 列”（例如断言值以 `{bcrypt}` 开头）。攻击依旧成功，只是偷到的变成了哈希——这正是哈希存储的意义：泄露后攻击者还得离线爆破。
:::

**第 6 步：Lab 10 接口，身份来自 SecurityContext。**

```java
package com.aqin.mynotes.lab.l10auth;

import com.aqin.mynotes.note.Note;
import com.aqin.mynotes.note.NoteRepository;
import com.aqin.mynotes.security.LoginUser;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
public class SecureLoginController {

    private final NoteRepository notes;

    public SecureLoginController(NoteRepository notes) {
        this.notes = notes;
    }

    @GetMapping("/secure/l10/me")
    public Map<String, Object> me(@AuthenticationPrincipal LoginUser me) {
        return Map.of("id", me.getId(), "username", me.getUsername(),
                "roles", me.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList());
    }

    @GetMapping("/secure/l10/notes")
    public List<Note> myNotes(@AuthenticationPrincipal LoginUser me) {
        return notes.findAll().stream().filter(n -> n.ownerId() == me.getId()).toList();
    }
}
```

对比 Lab 04：以前 `@RequestHeader("X-User-Id")` 是客户端说了算，现在 `@AuthenticationPrincipal` 取的是服务端认证后放进 SecurityContext 的对象，客户端无法伪造。（Lab 04 的修复版仍是你的练习：提示——可以把 `X-User-Id` 换成 `@AuthenticationPrincipal`，再做归属比对和角色判断，并用 DTO 控制返回字段。）

**第 7 步：用 curl 走一遍登录。**

```bash
# 1) 未登录访问：被重定向到登录页
curl -si http://127.0.0.1:8080/secure/l10/me | head -3
# 2) 取登录页，保存 Cookie，抠出 CSRF token
TOKEN=$(curl -s -c jar.txt http://127.0.0.1:8080/login | sed -n 's/.*name="_csrf" type="hidden" value="\([^"]*\)".*/\1/p')
# 3) 提交表单
curl -si -b jar.txt -c jar.txt -d "username=alice&password=alice123&_csrf=$TOKEN" http://127.0.0.1:8080/login | head -5
# 4) 带着新会话访问
curl -s -b jar.txt http://127.0.0.1:8080/secure/l10/me
```

示例输出（节选）：

```
HTTP/1.1 302
Location: http://127.0.0.1:8080/login

HTTP/1.1 302
Set-Cookie: JSESSIONID=5E1C...; Path=/; HttpOnly
Location: http://127.0.0.1:8080/secure/l10/me

{"id":1,"username":"alice","roles":["ROLE_USER"]}
```

怎么读：第 1 次 302 是 `AuthenticationEntryPoint` 在工作（未认证 → 去登录）；登录成功后 `JSESSIONID` 换了新值，这是**会话固定防护**（登录前的会话 ID 作废）；最后返回的身份来自服务端。再试两件事：不带 `_csrf` 提交登录会得到 403（`CsrfFilter` 拦截）；用 alice 的会话访问 `/secure/l10/admin/anything` 会得到 403（已认证但无权限，`AccessDeniedHandler`）。登录页的 sed 正则依赖默认页面的 HTML，若版本不同抠不出来，直接 `curl -s .../login` 看一眼字段顺序再调整。

**第 8 步：写成自动化测试。** 类上的注解和 `MockMvc` 注入方式照抄现有的 `AccessControlTests`（Boot 4 中测试注解的包名与 Boot 3 不同，照抄最稳），方法体如下：

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.unauthenticated;

@Test
void loginWithBcryptPassword() throws Exception {
    mvc.perform(formLogin().user("alice").password("alice123")).andExpect(authenticated().withRoles("USER"));
    mvc.perform(formLogin().user("alice").password("wrong")).andExpect(unauthenticated());
}

@Test
void anonymousIsRedirectedAndUserCannotReachAdmin() throws Exception {
    mvc.perform(get("/secure/l10/me")).andExpect(status().is3xxRedirection());
    mvc.perform(get("/secure/l10/admin/x").with(user("alice").roles("USER"))).andExpect(status().isForbidden());
}
```

`formLogin()` 会自动带上合法的 CSRF token；`user(...)` 来自 `SecurityMockMvcRequestPostProcessors`，直接往 SecurityContext 里塞一个用户，适合测授权而不关心登录过程。

### 实践 2：开启 DEBUG 日志，观察过滤器链

在 `application.properties` 里加：

```
logging.level.org.springframework.security=TRACE
```

重启后访问 `/secure/l10/me`，日志大致如下（以 Spring Security 6/7 为例，具体 Filter 列表随版本和配置略有差异）：

```
Trying to match request against DefaultSecurityFilterChain [RequestMatcher=Or [/secure/l10/**, /login, /logout], Filters=[...]] (1/2)
Securing GET /secure/l10/me
Invoking DisableEncodeUrlFilter (1/16)
Invoking SecurityContextHolderFilter (3/16)
Invoking CsrfFilter (5/16)
Invoking UsernamePasswordAuthenticationFilter (7/16)
Invoking AnonymousAuthenticationFilter (14/16)
Invoking ExceptionTranslationFilter (15/16)
Invoking AuthorizationFilter (16/16)
Set SecurityContextHolder to anonymous SecurityContext
Sending AnonymousAuthenticationToken [...] to authentication entry point since access is denied
Redirecting to http://127.0.0.1:8080/login
```

怎么读：第一行说明 `FilterChainProxy` 在按顺序尝试匹配两条链（`1/2`）；`(n/16)` 是这条链里 Filter 的序号；未登录时 `AnonymousAuthenticationFilter` 放入匿名身份，`AuthorizationFilter` 拒绝后由 `ExceptionTranslationFilter` 交给入口点重定向。再访问 `/api/study/progress`，会看到它匹配到第 2 条链（`2/2`），Filter 更少且直接放行。看完记得把级别调回去：TRACE 日志量很大，而且可能打印请求细节。

## 攻击者视角

面对一个 Spring Security 应用，攻击者不会去“破解框架”，而是找**配置的缝隙**：

- **身份来自客户端**：像旧版 MyNotes 那样信任 `X-User-Id`、`X-Forwarded-User` 之类的头。网关注入身份头时，如果后端也能被直接访问，攻击者绕过网关自己加头即可。
- **链的匹配漏洞**：`securityMatcher` 或 `requestMatchers` 写得太窄（如只保护 `/admin`，漏了 `/admin/`、`/api/admin/**`），或兜底链是 `permitAll`，新加的接口默认就是公开的——我们的 `legacyChain` 正是这种风险，所以它只能是过渡方案。
- **规则顺序错误**：`anyRequest().permitAll()` 写在前面，后面的 `hasRole` 永远不会生效。
- **用户名枚举与撞库**：对比“用户不存在”和“密码错误”的响应内容和耗时差异；用泄露的密码库对 `/login` 撞库。默认表单登录**没有**限流和锁定。
- **会话攻击**：会话固定（登录前种一个已知 JSESSIONID）、窃取 Cookie（配合 XSS，见 [[web-xss]]）。
- **拿到哈希后离线爆破**：通过 SQL 注入（Lab 01）拿到 `users` 表，MD5 可以秒查彩虹表，BCrypt 则慢得多，弱密码仍然危险。
- **错误信息泄露**：自定义异常处理把堆栈、SQL 返回给前端。

## 防御与最佳实践

- **默认拒绝**：最后一条链用 `anyRequest().authenticated()` 或 `denyAll()`，公开接口逐个 `permitAll()` 列出来。
- **身份只来自 SecurityContext**：业务代码里用 `@AuthenticationPrincipal` 或 `SecurityContextHolder`，不读任何身份类请求头。
- **密码**：`DelegatingPasswordEncoder` + BCrypt（或 Argon2）；借助 `UserDetailsPasswordService` 平滑迁移旧哈希；在注册/改密时拒绝已知弱密码。
- **登录保护**（项目② 里程碑“登录 BCrypt + 限流 + 锁定”）：按账号和 IP 两个维度用 Redis 计数限流，连续失败后临时锁定或要求验证码；锁定时返回与密码错误相同的提示，避免泄露账号是否存在。
- **保留默认防护**：不要随手 `csrf.disable()`（Cookie 会话的应用必须开启）；会话固定防护、安全响应头保持默认。
- **统一 401/403**：API 配置 `HttpStatusEntryPoint` 和 `AccessDeniedHandler`，返回不含内部细节的 JSON；全局 `@ExceptionHandler` 不要吞掉 `AccessDeniedException`。
- **异步传递身份**：显式传 userId，或用 `DelegatingSecurityContextAsyncTaskExecutor`。
- **测试即文档**：每条授权规则都有 MockMvc 测试（匿名 → 302/401，普通用户 → 403，管理员 → 200），防止以后改配置时悄悄放开。
- **可观测**：记录登录成功/失败事件（可监听 `AuthenticationSuccessEvent` / `AbstractAuthenticationFailureEvent`），日志里只记用户名、IP、结果，绝不记密码。

## 常见误区

| 误区 | 事实 |
|---|---|
| “Spring Security 就是一个登录功能” | 它是一条过滤器链，登录只是其中一个 Filter；授权、CSRF、安全头、会话管理都在链上 |
| `securityMatcher` 和 `requestMatchers` 是一回事 | 前者选择“哪条链”，后者在链内决定“什么权限” |
| 多条链都会执行 | `FilterChainProxy` 只执行**第一条**匹配的链 |
| `hasRole("ROLE_ADMIN")` | `hasRole` 自动加前缀，应写 `hasRole("ADMIN")`；数据库存 `ADMIN` 时要在加载用户时补 `ROLE_` |
| encode 一次再 `equals` 比对密码 | BCrypt 每次盐不同，必须用 `matches` |
| 用 SHA-256 加盐就够了 | 太快，应使用 BCrypt/Argon2 等慢哈希 |
| 401 和 403 随便返回 | 401 = 未认证，403 = 已认证但无权 |
| `MODE_INHERITABLETHREADLOCAL` 能解决 @Async | 线程池线程复用，会串身份；应显式传参或用 Delegating 包装器 |
| 写 REST API 就可以关 CSRF | 只有不用 Cookie（如纯 Bearer Token）时才成立；用 Session Cookie 就必须开 |

## 自测

:::details 1. 一个请求到达 Controller 之前，依次经过哪三个 Spring Security 的关键对象？
`DelegatingFilterProxy`（Servlet 容器里的桥接 Filter）→ `FilterChainProxy`（Spring Bean，选择第一条匹配的链，并负责清理上下文和防火墙检查）→ `SecurityFilterChain`（真正执行的一组有序 Filter）。
:::

:::details 2. @Async 方法里为什么拿不到当前登录用户？怎么解决？
`SecurityContextHolder` 默认基于 ThreadLocal，而 `@Async` 在线程池的另一个线程执行，拿不到调用线程的 ThreadLocal。推荐把 userId 作为参数传入；或用 `DelegatingSecurityContextAsyncTaskExecutor` 包装线程池。不要用 `MODE_INHERITABLETHREADLOCAL`，线程池复用线程会导致身份错乱。
:::

:::details 3. UserDetailsService 负责比对密码吗？
不负责。它只按用户名加载用户（含哈希后的密码和权限）；比对由 `DaoAuthenticationProvider` 调用 `PasswordEncoder.matches` 完成。
:::

:::details 4. 数据库里的密码是 `{bcrypt}$2a$10$...`，前缀有什么用？
这是 `DelegatingPasswordEncoder` 的格式，前缀告诉它用哪个编码器比对。它让同一张表里新旧算法并存，并能通过 `upgradeEncoding` + `UserDetailsPasswordService` 在登录时自动迁移到新算法。
:::

:::details 5. 未登录访问受保护接口和普通用户访问管理员接口，分别由谁处理、返回什么？
都由 `ExceptionTranslationFilter` 捕获。未登录（匿名）交给 `AuthenticationEntryPoint`：表单登录下 302 到 `/login`，API 下通常 401。已登录但无权限交给 `AccessDeniedHandler`：403。
:::

:::details 6. Lab 10 里为什么登录成功后 JSESSIONID 变了？
会话固定防护：认证成功时换一个新的会话 ID，使攻击者预先种下的会话 ID 失效。这是 Spring Security 的默认行为。
:::

:::details 7. 我们的 legacyChain 有什么安全风险？正式项目应该怎么做？
它对所有未匹配的请求 `permitAll` 且关闭了 CSRF，任何新加的接口默认公开。它只是为了不破坏旧实验的过渡方案。正式项目应让兜底规则为 `authenticated()` 或 `denyAll()`，公开接口显式白名单，并保留 CSRF。
:::

## 一句话总结

Spring Security 是一条由 `FilterChainProxy` 选中的过滤器链：认证把“你是谁”放进 ThreadLocal 里的 SecurityContext，授权据此放行或拒绝，401/403 由 `ExceptionTranslationFilter` 翻译；Lab 10 用 `users` 表 + BCrypt + 表单登录，把身份从“客户端声称”变成“服务端认定”。
