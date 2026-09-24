## 为什么要学

越权（Broken Access Control，访问控制失效）在 OWASP Top 10 2021 版里排第一。它不像 SQL 注入那样有“特征 payload”，扫描器很难发现：请求格式完全正常，只是把 URL 里的 `orderId=1001` 改成了 `1002`，服务端就把别人的订单吐了出来。它是**业务逻辑漏洞**，只能靠设计和代码审查来防。

你做过的电商、车联网、IoT 平台里全是这种场景：用户查自己的订单、车主查自己的车辆轨迹、设备只能上报自己的数据。只要某个接口“按 id 查”而没有校验“这个 id 属于当前用户吗”，就是一个 IDOR。车联网里如果能遍历 VIN 查到别人的车辆位置或远程控车，后果远比泄露一条笔记严重。

学完这一课，你应该能做到：

- 区分水平越权、垂直越权、过度返回数据，并在代码里一眼认出它们。
- 用“对象级授权”思路写查询：带着 owner 条件去查，而不是查完再比较。
- 设计“默认拒绝 + 集中式授权检查”的结构，并独立完成 Lab 04 的修复版。

> 本课的攻击示例只可用于你自己的 Lab（本机 `/vuln/l04`）或已获授权的目标，不要拿去打别人的系统。

## 核心概念

### 认证 vs 授权

先分清两个词，越权全出在第二个上：

- **认证（Authentication）**：你是谁？登录、验证密码/token，确认身份。
- **授权（Authorization）**：你能对这个资源做什么？确认已认证的身份有没有权限执行当前操作。

越权 = 授权环节缺失或做错。注意 Lab 04 里当前用户是用请求头 `X-User-Id` 模拟的——这本身就是个巨大的认证漏洞（谁都能改这个头冒充别人），Lab 09/10 才会用 Spring Security 换掉它。但即便认证是真的，**授权照样能单独出错**，这一课聚焦的正是授权。

### 水平越权（IDOR）

同级别用户之间，A 访问了 B 的数据。“IDOR”（不安全的直接对象引用）是它最常见的形态：接口直接拿用户传来的对象 id 去查，不校验归属。看 Lab 04 漏洞版 `VulnAccessController`：

```java
@GetMapping("/vuln/l04/notes/{id}")
public ResponseEntity<Note> get(@RequestHeader("X-User-Id") long userId, @PathVariable long id) {
    // BUG: userId 拿到了，却从没和这条 note 的 owner 比较过
    return ResponseEntity.of(notes.findById(id));
}
```

`userId` 参数就摆在那里，却完全没用上。alice（id=1）请求 `/vuln/l04/notes/4`，就能读到 admin 的笔记——因为服务端只按 id 查，不问“这条归谁”。

### 垂直越权

低权限角色执行了高权限操作，比如普通用户调用了管理员接口。Lab 04 的第二个漏洞：

```java
@GetMapping("/vuln/l04/admin/users")
public List<Map<String, Object>> listUsers(@RequestHeader("X-User-Id") long userId) {
    // BUG: 没有任何角色检查；SELECT * 还把 password 列带了出去
    return jdbc.queryForList("SELECT * FROM users");
}
```

路径里有 `/admin/` 不等于有保护。很多系统以为“前端菜单里没有这个按钮，普通用户就不会调”，但攻击者直接看前端 JS、抓包、猜路径就能找到它。**授权必须在服务端每个接口上执行**，前端隐藏只是体验，不是安全。

### 过度返回数据（Excessive Data Exposure）

即使授权做对了，返回的字段也可能太多。`SELECT *` + 直接把 `Map` 或实体序列化成 JSON，会把数据库里的所有列都吐给前端：密码哈希、手机号、内部状态、风控字段……前端“不展示”没用，攻击者看的是原始响应。

更隐蔽的隐患是**未来**：今天 users 表只有 4 列，明天有人加了 `id_card`、`api_secret` 列，`SELECT *` 的接口会**自动**开始泄露它们，没有任何人改过这个接口的代码。所以正确做法是：显式列出要查的列，并用专门的 DTO（Java `record` 很合适）定义“这个接口对外暴露什么”，让返回结构成为一份白名单。

### 对象级授权：查询时带上 owner 条件

修 IDOR 有两种写法，差别很大。以电商订单为例（不是 Lab 代码，思路相同）：

```java
// 写法 A：先查出来，再在 Java 里比较
Order o = orderMapper.findById(orderId);
if (o == null || !o.userId().equals(currentUserId)) throw new NotFoundException();

// 写法 B：把归属条件直接写进查询
// SELECT ... FROM orders WHERE id = #{orderId} AND user_id = #{currentUserId}
Optional<Order> o = orderMapper.findByIdAndUserId(orderId, currentUserId);
```

推荐写法 B，理由：

- **不会忘**：数据根本查不出来，后续代码（日志、缓存、异常信息）也就没机会把别人的数据漏出去。写法 A 里对象已经在内存了，一旦有人漏写或删掉那个 `if`，就直接泄露。
- **列表/批量接口同样适用**：`WHERE user_id = ?` 天然只返回自己的数据；写法 A 要在循环里逐条过滤，还容易出现分页总数泄露。
- **更新/删除更关键**：`UPDATE orders SET ... WHERE id = ? AND user_id = ?`，看影响行数是否为 0，一条语句完成“校验 + 操作”，没有“先查后改”的竞态窗口。

写法 A 也不是完全不行（比如权限规则复杂、要根据对象多个字段判断时），但必须保证每条路径都经过检查，最好封装进一个统一方法，而不是散落在各个 Controller 里。

### 默认拒绝，集中式授权检查

越权漏洞的主要来源是“忘了”：100 个接口里 99 个写了检查，漏了 1 个。所以结构上要让“忘记”变成“拒绝”而不是“放行”：

- **默认拒绝（deny by default）**：没有明确授权的请求一律拒绝。新加的接口如果没人配置权限，应该是访问不了，而不是谁都能访问。
- **集中式检查**：URL 级、方法级的授权规则放在一个地方统一管理，而不是在每个 Controller 方法开头手写 `if (!isAdmin) ...`。

在 Spring Security 6+ 里（Lab 10 会接入），典型做法是 URL 规则集中在 `SecurityFilterChain`，最后一条兜底拒绝：

```java
@Bean
SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth
            .requestMatchers("/admin/**").hasRole("ADMIN")
            .requestMatchers("/api/**").authenticated()
            .anyRequest().denyAll());   // 没列出来的一律拒绝
    return http.build();
}
```

对象级规则（“这条数据是不是你的”）URL 规则表达不了，可以用方法级授权 `@PreAuthorize`（需 `@EnableMethodSecurity`），或者在 Service 层统一“按当前用户查询”。这部分在 [[ss-authz]] 里会展开。

一个请求到达时，授权要依次回答三个问题：

```
request --> [1] authenticated?  --> [2] role allowed?  --> [3] owns this object?  --> handler
                 no: 401              no: 403                no: 404 (or 403)
```

## 动手实践

### 实践 1：先把 Lab 04 漏洞版打一遍

启动应用（`export JAVA_HOME=$(/usr/libexec/java_home -v 17)` 后 `./mvnw spring-boot:run`）。预置数据：alice(1)、bob(2)、admin(3)；笔记 id 1、2 属于 alice，3 属于 bob，4 属于 admin。

**水平越权**：alice 读 admin 的笔记。

```bash
curl -H 'X-User-Id: 1' localhost:8080/vuln/l04/notes/4
```

期望输出：

```json
{"id":4,"ownerId":3,"title":"admin secrets","content":"prod db password: hunter2"}
```

怎么读：请求头说“我是 1”，返回的 `ownerId` 却是 3。任何时候响应里对象的归属和当前用户对不上，就是水平越权。实战中攻击者会把 id 从 1 遍历到 N，把全表拖走。

**垂直越权 + 过度返回**：alice 调管理员接口。

```bash
curl -H 'X-User-Id: 1' localhost:8080/vuln/l04/admin/users
```

期望输出（H2 返回的列名是大写）：

```json
[{"ID":1,"USERNAME":"alice","PASSWORD":"alice123","ROLE":"USER"},
 {"ID":2,"USERNAME":"bob","PASSWORD":"bob123","ROLE":"USER"},
 {"ID":3,"USERNAME":"admin","PASSWORD":"S3cret!","ROLE":"ADMIN"}]
```

怎么读：两个问题叠在一起。第一，`ROLE=USER` 的 alice 拿到了管理员接口的结果（垂直越权）；第二，即便是管理员来调，`PASSWORD` 列也不该出现在响应里（过度返回）。

**更根本的问题**：

```bash
curl -H 'X-User-Id: 3' localhost:8080/vuln/l04/admin/users
```

怎么读：任何人只要把头改成 `3` 就“成为”了 admin。这说明身份来自客户端可控的值时，所有授权检查都能被绕过——这是认证问题，Lab 09/10 解决。在那之前，Lab 04 的修复只修“授权逻辑”这一层。

### 实践 2：自己实现 SecureAccessController（练习）

这是本项目留给你的练习，下面只给要求和提示，不给答案。文件：`src/main/java/com/aqin/mynotes/lab/l04idor/SecureAccessController.java`，现在两个方法都返回 `501 Not Implemented`。

验收标准（来自 `AccessControlTests` 里 4 个 `@Disabled` 用例）：

| 请求 | 期望 |
|---|---|
| alice 读 `/secure/l04/notes/1`（自己的） | 200，`title` 为 `alice shopping` |
| alice 读 `/secure/l04/notes/4`（admin 的） | **404** |
| alice 调 `/secure/l04/admin/users` | **403** |
| admin 调 `/secure/l04/admin/users` | 200，含 `username: alice`，且没有 `password`/`PASSWORD` 字段 |

提示（按需逐条看）：

- 笔记接口：`NoteRepository.findById` 已经有了，但想一想“对象级授权”一节——你是想查完再比较，还是在 `NoteRepository` 里加一个带 owner 条件的查询？两种都能过测试，但理由不同。
- 别人的笔记和不存在的笔记，应该返回同一个结果（404）。`ResponseEntity.of(Optional)` 在 Optional 为空时就返回 404。
- 用户接口要先判断当前用户的角色。角色存在 users 表的 `role` 列里，你需要自己写一个参数化查询把它查出来；查不到用户时该怎么处理，按“默认拒绝”原则想。
- 返回类型别用 `Map` 也别用 `SELECT *`：定义一个只含 `id`、`username`、`role` 的 `record`，SQL 里显式列出这几列。测试用的 JSON 字段名是小写 `username`，record 字段名直接决定 JSON 字段名。
- 403 可以用 `ResponseEntity.status(HttpStatus.FORBIDDEN).build()`。

写完后删掉测试里的 4 个 `@Disabled`，跑：

```bash
./mvnw test -Dtest=AccessControlTests
```

期望结尾：

```
Tests run: 6, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

怎么读：6 个用例 = 2 个“漏洞版能被打穿”+ 4 个“修复版挡住”。删 `@Disabled` 之前这里会显示 `Skipped: 4`；如果某个用例失败，看失败信息里的 `Status expected:<404> but was:<403>` 这类提示，它会告诉你是状态码还是字段没对上。最后用实践 1 的三条 curl 把 `/vuln` 换成 `/secure` 再手工验证一遍。

### 实践 3：PortSwigger Access control（Apprentice）

在 Web Security Academy 的 Access control 分类做 Apprentice 级实验。典型题目：未受保护的管理后台（从 `robots.txt` 或前端 JS 里找到管理路径，直接访问）、通过可修改的请求参数或 Cookie 提升角色、用户 id 放在请求参数里可改成别人的（IDOR）。做的时候给每题标上“水平/垂直/过度返回”哪一类，并写下服务端缺了哪一个检查。横幅变绿即通过。

## 攻击者视角

访问控制是攻击者投入产出比最高的一类漏洞，因为它不需要复杂 payload，改个数字就行。常见套路：

- **遍历对象 id**：把 `?id=1001` 改成 `1002、1003...`，或写脚本从 1 遍历到 N，把不属于自己的数据批量拖走。自增 id 让这一步毫不费力。
- **翻前端要隐藏接口**：管理功能的按钮虽然对普通用户隐藏，但对应的 API 路径就写在前端 JS、`robots.txt`、Swagger 文档里。攻击者读源码、抓包，直接构造请求调用。
- **改角色/身份标识**：如果角色来自可篡改的地方（Cookie、请求参数、JWT 里未验签的字段、本 Lab 的 `X-User-Id` 头），就直接改成 admin。
- **换方法/换路径**：GET 被拦了试 POST，`/user/x` 被拦了试 `/api/v1/user/x` 或 `/admin/user/x`，找漏配的那个入口。
- **看原始响应而非页面**：前端不展示的字段，在 JSON 响应里可能全都有（过度返回）。攻击者永远看原始报文。

核心心态：**每一个“对象 id + 当前身份”的组合，攻击者都会试着错配。** 你的每个接口都要能回答“你是谁、你能对这个对象做什么”。

## 防御与最佳实践

- **服务端每个接口都做授权**，绝不依赖前端隐藏。前端不显示按钮只是体验优化，不是安全边界。
- **对象级授权写进查询**：`WHERE id = ? AND owner_id = ?`，让不属于当前用户的数据根本查不出来；更新删除看影响行数。优于“查出来再比较”。
- **默认拒绝**：没有明确授权规则的请求一律拒绝（Spring Security 用 `.anyRequest().denyAll()` 或 `.authenticated()` 兜底）。新接口默认关着，比默认开着安全得多。
- **集中式授权**：URL/方法级规则集中在 `SecurityFilterChain` 或 `@PreAuthorize`，不要把 `if (isAdmin)` 散落在各处，减少“漏写”。
- **最小暴露**：显式选列 + DTO/record 定义对外字段，杜绝 `SELECT *` 和直接序列化实体，防过度返回和“加字段即泄露”。
- **身份来自可信来源**：当前用户从服务端会话/已验签的 token 取，绝不信任客户端可改的 `X-User-Id`、参数里的 `userId`、未验签的 JWT 字段。
- **不用 id 是否可猜作为防线**：UUID 让遍历变难，但不能替代授权检查（见误区）。
- **审计与测试**：为“A 不能访问 B 的资源”“USER 不能调 admin 接口”写自动化测试（正如 Lab 的攻防用例），把授权变成回归测试的一部分；对敏感操作记录访问日志便于检测。

一句记忆：**默认拒绝 → 集中授权 → 对象级查询带 owner → 最小字段暴露 → 身份只信服务端。**

## 常见误区

- **“把自增 id 换成 UUID 就修好了越权。”** 没有。UUID 只是让“猜/遍历 id”变难，属于“隐藏”，不是“授权”。id 会通过分享链接、Referer、日志、上一个接口的响应泄露；一旦攻击者拿到别人的 UUID，没有归属校验照样能访问。真正的修复是每次访问都校验对象归属。
- **“前端没有这个入口，普通用户访问不到。”** 前端只是 UI。攻击者直接调 API，前端隐藏毫无防护作用。授权必须在服务端。
- **“接口路径里有 /admin，就说明它受保护了。”** 命名不等于检查。没有代码/配置去校验角色，`/admin/**` 和 `/public/**` 一样谁都能进。
- **“我在 Controller 开头写了 if 检查，够了。”** 分散的手写检查最容易漏写，且难以审计。要默认拒绝 + 集中式授权，让“忘记配置”导致“拒绝”而非“放行”。
- **“授权做对了，返回什么字段无所谓。”** 过度返回是独立问题。即便只有本人能查，把 password、手机号、内部字段一起返回也是泄露，且加新列时会自动扩大泄露面。
- **“先查出对象再比较 owner 和带条件查询没区别。”** 有区别。查出来后对象已在内存，漏写或误删那个比较就直接泄露；带 owner 条件查询让不属于你的数据根本不出现，容错性高得多。

## 自测

:::details 1. 把自增 ID 换成 UUID 能解决越权吗？
不能。UUID 只是让 id 难以猜测和遍历，属于“隐蔽性”而非“访问控制”。id 仍可能通过分享的链接、浏览器历史、Referer、日志、或前一个接口的响应泄露出去；攻击者一旦拿到别人的 UUID，若服务端没有归属校验，照样能访问其资源。真正的解法是每次访问都在服务端校验“这个对象属于当前用户吗”（最好写进查询条件 `WHERE id=? AND owner_id=?`）。UUID 可以作为纵深防御减小遍历面，但绝不能替代授权检查。
:::

:::details 2. 为什么别人的笔记应返回 404 而不是 403？
403（Forbidden）等于承认“这条资源存在，只是你没权限”，这会泄露资源的存在性——攻击者据此就能枚举出哪些 id 有效、探测系统里有多少条数据。返回 404（Not Found）则让“无权访问”和“资源不存在”对攻击者不可区分，不泄露任何信息。用带 owner 条件的查询实现这点很自然：查不到就是查不到，统一 404。（对需要明确区分的后台管理场景，有时会用 403，属设计权衡。）
:::

:::details 3. 对象级授权，应该“查询时带 owner 条件”还是“查出来再比较”？
优先“查询时带 owner 条件”（`WHERE id=? AND owner_id=?`）。原因：不属于当前用户的数据根本查不出来，后续的日志、缓存、异常都没机会泄露它，容错性高；列表接口天然只返回自己的数据；更新删除用一条 `UPDATE ... WHERE id=? AND owner_id=?` 看影响行数即可，避免“先查后改”的竞态。而“查出来再比较”会把对象先加载到内存，一旦漏写或误删那个比较判断就直接泄露，风险集中在一行 if 上。
:::

:::details 4. 水平越权、垂直越权、过度返回数据有什么区别？
水平越权：同级别用户之间，A 访问了 B 的数据（如按 id 查别人的订单），最常见形态是 IDOR。垂直越权：低权限角色执行了高权限操作（如普通用户调管理员接口）。过度返回数据：授权可能没错，但响应里带了不该给的字段（如 `SELECT *` 把密码、手机号一起返回），且加新列时会自动扩大泄露。三者可叠加出现——Lab 04 的管理员接口就同时是垂直越权（无角色检查）和过度返回（泄露 password 列）。
:::

:::details 5. 为什么不能依赖前端隐藏来做访问控制？
因为前端只是 UI，运行在用户完全可控的浏览器里。隐藏按钮、不渲染菜单只影响“看得见什么”，不影响“能调什么”。攻击者会直接阅读前端 JS、抓包、查 `robots.txt`/Swagger 找到 API 路径，再用 curl/Postman 直接构造请求调用，绕过整个前端。所以授权检查必须在服务端每个接口上执行，前端隐藏只是体验优化。
:::

:::details 6. “默认拒绝 + 集中式授权”为什么比在每个方法里写 if 更安全？
越权漏洞的头号来源是“忘了”——几十个接口里漏写一个检查。默认拒绝让“没有明确授权规则”的结果是“拒绝访问”而不是“放行”，于是新加的接口哪怕没人配权限也是安全的（访问不了），而非默默敞开。集中式授权把规则放在一处（`SecurityFilterChain`、`@PreAuthorize`）统一管理和审计，比分散在各 Controller 里的手写 if 更不容易漏、更容易 review。两者结合，把“疏忽”从“泄露”变成“拒绝”。
:::

:::details 7. `SELECT *` + 直接返回实体/Map，除了泄露密码还有什么隐患？
最大的隐患在未来：今天表里没有敏感列，明天有人加了 `id_card`、`api_secret`，`SELECT *` 的接口会自动开始把它们返回给前端，而没有任何人改过这个接口的代码，也不会有 review 注意到。此外直接序列化实体/Map 让“对外暴露什么”变得不可控、和内部数据模型耦合。正解是显式选列 + 用专门的 DTO/record 定义对外字段，让响应结构成为一份明确的白名单。
:::

## 一句话总结

越权是授权环节的缺失，扫描器难发现、只能靠设计：每个请求都要回答“你是谁、你能对这个对象做什么”，用默认拒绝 + 集中式授权 + 把 owner 条件写进查询 + 最小字段暴露来防，而换 UUID、藏前端入口都不是授权。
