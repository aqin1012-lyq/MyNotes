## 为什么要学

这一课是**离你日常工作最近**的一块安全内容。你写了 6 年后端，绝大部分时间就在写 REST 接口：`@RestController`、`@RequestBody`、分页查询、增删改查。API 安全讲的不是什么新漏洞，而是"你每天在写的接口，怎么就成了漏洞"。很多问题（越权、批量赋值、返回过多字段）扫描器根本扫不出来，只能靠写代码的人懂原理、在设计时就防住——这正是后端工程师的主场。

在学习路线里，它是 Web 安全阶段的收口：把前面 [[web-access]]（越权）、[[web-authn]]（认证）、[[web-ssrf]]（SSRF）等散点，用 **OWASP API Security Top 10 (2023)** 这张清单串成一套"审计一个接口模块"的方法论。它也直接通向 [[ss-authz]] 的对象级授权和项目②认证中心的设计。

学完这一课你应该能做到：逐条说清 OWASP API Top 10 (2023) 每一项是什么、在 Java/Spring 里长什么样、怎么防；区分 BOLA 与 BFLA；用 DTO 与实体分离根治批量赋值；给列表接口加上分页上限和限流。最终目标是能拿这张清单，独立审计一个真实接口模块。

:::warn 授权原则
本课的审计和测试只能针对你自己的项目、本仓库的 Lab 或明确授权的系统。用工作中的真实接口练习时只在本地做、只写笔记，不要把公司代码或数据外传。
:::

## 核心概念

### 1. OWASP API Security Top 10 (2023) 逐条理解

OWASP 为 API 单独出了一份 Top 10（区别于通用的 OWASP Top 10），因为 API 的风险重心和网页不同：网页常担心 XSS/CSRF，API 则集中在**授权**（谁能访问哪个对象、哪个功能、哪个字段）和**资源滥用**上。下面是 2023 版全表，先建立全局观：

| 编号 | 名称 | 一句话本质 | Spring 里的典型样子 |
|---|---|---|---|
| API1 | Broken Object Level Authorization (BOLA) | 能访问不属于自己的对象（水平越权/IDOR） | `findById(id)` 不带 owner 校验 |
| API2 | Broken Authentication | 认证本身被绕过或伪造 | 弱 JWT、弱口令、无锁定（见 [[web-authn]]） |
| API3 | Broken Object Property Level Authorization | 能读/写不该碰的**字段**（合并了旧版"过度暴露"+"批量赋值"） | 返回整个实体、`@RequestBody` 绑定整个实体 |
| API4 | Unrestricted Resource Consumption | 不限制资源消耗，导致 DoS 或高额账单 | 无分页上限、无限流、无超时 |
| API5 | Broken Function Level Authorization (BFLA) | 能调用不该调用的**功能/接口**（垂直越权） | 普通用户能调 `/admin/**` |
| API6 | Unrestricted Access to Sensitive Business Flows | 敏感业务流程被自动化滥用 | 秒杀/抢券/注册被脚本刷 |
| API7 | Server Side Request Forgery (SSRF) | 服务端替攻击者发请求 | URL 预览、Webhook（见 [[web-ssrf]]） |
| API8 | Security Misconfiguration | 各种不安全配置 | CORS 过宽、错误栈外泄、默认口令 |
| API9 | Improper Inventory Management | 接口资产失管：废弃/影子/未文档化接口 | 老版本 `/v1` 没下线、测试接口上了生产 |
| API10 | Unsafe Consumption of APIs | 盲信第三方 API 返回的数据 | 直接反序列化/信任上游返回 |

要记住的规律：**排第一、第三、第五的都是授权问题**（对象级、字段级、功能级），这就是 API 安全和 [[web-access]] 的核心重叠——授权必须在服务端、对每个请求、对每个对象/字段/功能逐一判断。下面挑最该由后端亲手写对的几条展开。

### 2. BOLA 与 BFLA：对象级 vs 功能级授权失效

这是 API 安全里最高发的两类，很多人会混。用一句话分清：**BOLA 是"这个功能你能用，但你在用它访问别人的对象"；BFLA 是"这个功能你压根就不该用"。**

- **BOLA（API1，对象级）** = 水平越权 = [[web-access]] 里的 IDOR。接口本身普通用户可以调，问题在于它按 `id` 取数据却不检查"这个 id 是不是你的"。例：`GET /api/orders/42`，alice 把 42 改成 43 就看到了 bob 的订单。
- **BFLA（API5，功能级）** = 垂直越权。问题在于**这个接口/操作本身**该由更高权限的人调用，却没做角色校验。例：普通用户直接请求 `POST /api/admin/users/1/ban` 就封了别人。

反例（同时踩 BOLA，因为按 id 查却不校验归属）：

```java
@GetMapping("/api/orders/{id}")
public Order get(@PathVariable Long id) {
    return orderRepo.findById(id).orElseThrow();   // 谁的都能查，越权
}
```

正确做法——**在查询条件里带上当前用户**，让"不属于我的对象"根本查不出来，而不是查出来再比较：

```java
@GetMapping("/api/orders/{id}")
public OrderDto get(@PathVariable Long id, @AuthenticationPrincipal User me) {
    Order o = orderRepo.findByIdAndOwnerId(id, me.getId())   // 带 owner 条件
                       .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    return OrderDto.from(o);
}
```

注意两点：一是"查完再 `if (o.ownerId != me.id) throw`"也能挡住，但容易漏写、且有的分支会忘；把归属放进 SQL 条件更稳。二是越权时返回 **404 而非 403**，避免泄露"这个 id 确实存在"。BFLA 则用 URL 级 + 方法级授权兜住：`authorizeHttpRequests` 把 `/api/admin/**` 限定给 ADMIN 角色，再在方法上加 `@PreAuthorize("hasRole('ADMIN')")` 做纵深（见 [[ss-authz]]）。把自增 id 换成 UUID **不能**根治越权，它只是让 id 难猜（见 [[web-access]] 的讨论），授权校验才是根本。

### 3. 批量赋值（Mass Assignment）：DTO 与实体分离

这就是本课的问题——**直接用 JPA 实体接收 `@RequestBody` 会怎样？** 答案：攻击者可以给你实体里**任何**字段赋值，包括你没打算让他改的字段（`role`、`enabled`、`balance`、`ownerId`）。这属于 API3（对象属性级授权失效）的"写"侧，也叫批量赋值/自动绑定漏洞。

看反例。实体和接口这样写：

```java
@Entity class User {
    @Id Long id;
    String username;
    String password;
    String role;       // "USER" / "ADMIN"
    boolean enabled;
}

@PostMapping("/api/register")
public User register(@RequestBody User user) {   // 危险：整个实体都可被赋值
    return userRepo.save(user);
}
```

攻击者只要在注册请求里多塞几个字段：

```
POST /api/register
{"username":"mallory","password":"x","role":"ADMIN","enabled":true}
```

Spring 会老老实实把 `role` 绑成 `ADMIN`——攻击者自助注册成了管理员。同理，更新接口若绑定整个实体，攻击者能改 `id`、`ownerId` 把对象"过户"，或改 `balance` 改余额。

根治手段是**DTO 与实体分离**：为每个接口定义只含"允许客户端提供的字段"的 DTO，服务端再显式、可控地把 DTO 映射到实体，敏感字段由服务端赋值：

```java
public record RegisterReq(String username, String password) {}   // 只暴露该让用户填的字段

@PostMapping("/api/register")
public UserDto register(@RequestBody @Valid RegisterReq req) {
    User u = new User();
    u.setUsername(req.username());
    u.setPassword(passwordEncoder.encode(req.password()));
    u.setRole("USER");        // 由服务端固定，客户端无从干预
    u.setEnabled(true);
    return UserDto.from(userRepo.save(u));   // 出参也用 DTO，避免过度暴露 password 等
}
```

要点：**入参 DTO** 决定"客户端能写哪些字段"（防批量赋值），**出参 DTO** 决定"客户端能看哪些字段"（防过度数据暴露，别把 `password`、内部状态直接序列化出去）。这一进一出，就把 API3 的读写两侧都堵住了。用 MapStruct 之类做映射也行，但核心是"字段白名单由你显式控制"，绝不让请求体直接落到实体上。这也是项目里最该养成的肌肉记忆。

### 4. 限流、分页上限与资源消耗型攻击

API4（不受限的资源消耗）讲的是：一个请求能让服务端付出**不成比例**的代价——CPU、内存、数据库、带宽、第三方调用费用（比如每次调用都发短信/调 OpenAI）。它既是 DoS，也可能是"账单炸弹"。常见入口和对策：

- **分页无上限**：`GET /api/orders?size=1000000` 一次拉百万行，直接打爆内存/数据库。对策：服务端**强制**分页上限，不信任客户端传的 `size`。
- **无限流**：单账号/单 IP 每秒打几千次。对策：网关或应用层限流（令牌桶/漏桶），按 IP、账号、接口维度限。
- **无超时/无大小限制**：慢请求、超大请求体、深层嵌套 JSON、递归 GraphQL 查询。对策：设连接/读超时、请求体大小上限、限制 JSON 深度、GraphQL 限制查询复杂度与深度。

分页上限的写法（关键是**服务端夹紧**，别用客户端给的原值）：

```java
@GetMapping("/api/orders")
public Page<OrderDto> list(@RequestParam(defaultValue = "0") int page,
                           @RequestParam(defaultValue = "20") int size) {
    int safeSize = Math.min(Math.max(size, 1), 100);   // 夹到 1..100，无论客户端传多大
    Pageable pageable = PageRequest.of(Math.max(page, 0), safeSize);
    return orderRepo.findByOwnerId(currentUserId(), pageable).map(OrderDto::from);
}
```

Spring Data 的 `Pageable` 还可以用 `spring.data.web.pageable.max-page-size` 全局配置上限，或用 `@PageableDefault(size=20)` 设默认；但**务必确认框架版本会对超限值做夹紧**——稳妥起见，像上面那样自己 `Math.min` 兜底最保险。资源消耗型防护是纵深的：应用层夹紧 + 网关限流 + 数据库慢查询监控 + 对计费型下游（短信、云 API）单独加配额，一层都不能少。API6（敏感业务流滥用）在此基础上更进一步——即使每次请求都合法，被脚本高频重复调用（刷券、抢购、批量注册）也是滥用，需要验证码、设备指纹、业务风控来防。

### 5. API 资产管理：废弃接口、影子 API 与其余几条

API9（不当的资产管理）关注的是"你根本不知道自己还开着哪些接口"。真实系统里最危险的往往不是主力接口，而是被遗忘的那些：

- **废弃接口（deprecated）**：`/v1` 升级到 `/v2` 后 `/v1` 没下线，还带着老漏洞、老鉴权逻辑在跑。
- **影子 API（shadow API）**：没进网关、没进文档、没进监控的接口——临时调试接口、内部接口意外对外、某个服务私自暴露的端点。它们不在你的防护清单上，攻击者却能扫到。
- **测试/预发环境**：数据是真的、防护是弱的，常带 `actuator`、Swagger、调试开关。

对策：维护一份**权威 API 清单**（用 OpenAPI/Swagger 自动生成并纳入 CI）、所有流量必须经过统一网关（没上网关的就是影子）、明确接口的版本与下线策略、定期扫描对外端点比对清单。Spring 里尤其注意 `spring-boot-actuator` 的 `/actuator/**` 别裸奔（`env`、`heapdump`、`threaddump` 会泄露大量信息），要用 Spring Security 保护并只暴露必要端点——这既是 API9 也是 API8。

顺带收尾另外两条：**API8（安全配置错误）**在 Java/Spring 里常见为 CORS 反射 Origin 且允许携带凭证（见 [[web-basics]]）、生产返回详细错误栈（`server.error.include-stacktrace=never`）、默认口令、缺安全响应头。**API10（不安全地消费第三方 API）**是你作为客户端调上游时盲信其返回：直接把上游 JSON 反序列化（可能触发 [[web-deser]] 的多态问题）、跟随上游给的重定向（可能变 [[web-ssrf]]）、不校验上游数据就入库。对第三方返回同样要"不可信输入"对待：校验、限大小、设超时、白名单跟随重定向。

## 动手实践

### 实践 1：用 OWASP API Top 10 审计一个接口模块

挑一个你熟悉的接口模块（在本地做、只写笔记、不外传公司代码）。方法是拿这份清单逐条对着接口问问题。以一个订单模块（`GET /api/orders/{id}`、`GET /api/orders`、`POST /api/orders`、`PATCH /api/orders/{id}`）为例，审计清单和判定标准：

```
API1 BOLA   查单个订单时带 owner 条件了吗？换成别人的 id 会 404 吗？   问题→改成 findByIdAndOwnerId
API3 属性级  出参是 DTO 还是整个实体？入参能否塞入 status/ownerId？      问题→入参出参都用 DTO
API5 BFLA   /api/admin/** 有角色校验吗？普通用户直调会 403 吗？        问题→加 URL+方法级授权
API4 资源    list 的 size 有上限吗？传 size=100000 会怎样？             问题→Math.min 夹到 100
API2 认证    Token 怎么校验？弱口令/弱密钥？（见 web-authn）             问题→修认证
API7 SSRF   有没有按 URL 拉取外部资源的字段？（见 web-ssrf）            问题→白名单
API8 配置   CORS、错误栈、actuator 暴露情况？                          问题→收紧配置
API9 资产   有没有废弃 /v1、未文档化接口？在网关后吗？                  问题→下线/纳管
```

实操验证 BOLA/分页两条（用本仓库的 `X-User-Id` 模拟当前用户）：

```
# 用 alice(1) 的身份访问 bob(2) 的订单，期望 404 而不是 200
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-User-Id: 1' http://127.0.0.1:8080/api/orders/2

# 传超大 size，期望返回条数被夹紧（不是真的返回十万条）
curl -s -H 'X-User-Id: 1' 'http://127.0.0.1:8080/api/orders?size=100000' | head
```

怎么读：第一条若返回 `200` 并带出 bob 的数据，就是 BOLA，记进笔记并按上表整改；返回 `404` 才算通过。第二条若响应体明显巨大或服务卡顿，说明分页没夹紧。把每条的"结论（通过/问题）+ 证据 + 整改项"写成一张表，就是一份可复用的接口安全审计报告——这正是练习要求的产物。

### 实践 2：完成 PortSwigger API testing 实验

到 PortSwigger Web Security Academy 的 API testing 模块（见资料）。它会带你用 Burp 观察 API 请求、篡改对象 id 复现 BOLA、在请求体里加隐藏字段复现批量赋值、探测未文档化的接口。做完把每个实验对应到本课的 API 编号，和实践 1 的审计表相互印证。

## 攻击者视角

攻击者拿到一套 API，套路很固定：

- **枚举对象**：把 URL 里的 id 逐一改（`/orders/1`、`/2`、`/3`…），或改请求体里的 `userId`、`accountId`，看能否拿到别人的数据（BOLA）。
- **改功能路径**：把 `/user/**` 换成 `/admin/**`、把 `GET` 换成 `DELETE/PATCH`，看功能级授权是否只做在前端(BFLA)。
- **加字段**：在注册/更新请求里塞 `role`、`isAdmin`、`enabled`、`balance`，赌你直接绑定了实体（批量赋值）。
- **压资源**：把 `size`/`limit` 调到极大、发深层嵌套 JSON、高频重放敏感业务流（刷券、批量注册）。
- **找边角**：抓 JS/移动端流量挖未文档化接口、试 `/v1` 老版本、扫 `/actuator`、`/swagger-ui`、`/api-docs`。
- **利用出网**：找能填 URL 的字段做 SSRF（API7）、看能否让服务盲信第三方返回（API10）。

## 防御与最佳实践

- **授权是第一位**：每个请求都在服务端回答"你是谁、能对这个对象/字段/功能做什么"。对象级把 owner 放进查询条件；功能级用 URL + 方法级双重授权；字段级用入参/出参 DTO（见 [[ss-authz]]）。
- **DTO 与实体永远分离**：不用实体直接接 `@RequestBody`，不把实体直接序列化返回；敏感字段由服务端赋值。
- **默认限额**：分页服务端夹紧、请求体大小上限、超时、按多维度限流、对计费型下游设配额。
- **配置收紧**：CORS 用白名单不反射 Origin、生产关错误栈、actuator 加保护、补齐安全响应头（见 [[web-basics]]）。
- **资产可见**：OpenAPI 清单纳入 CI、全流量走网关、明确版本与下线、定期扫描比对。
- **对上游也不可信**：消费第三方 API 时校验、限大小、设超时、控制重定向（连到 [[web-ssrf]]/[[web-deser]]）。
- **纵深与观测**：认证、限流在网关，授权在应用，慢查询与异常在监控；关键操作记审计日志。

## 常见误区

- **"前端不显示删除按钮，就没人能删。"** 功能级授权只做在前端等于没做，攻击者直接构造请求即可（BFLA）。
- **"id 换成 UUID 就不会被越权。"** UUID 只是难猜，仍可能从别处拿到；不带 owner 校验照样 BOLA。授权才是根本。
- **"用实体接收请求体又快又省事。"** 这正是批量赋值的根源，攻击者能给 `role`/`balance` 等任意字段赋值。
- **"返回整个实体方便前端用。"** 会过度暴露 `password`、内部状态等字段（API3 读侧）。出参也要用 DTO。
- **"限流是运维在网关做的事，跟我无关。"** 分页上限、请求体大小、超时、下游配额这些资源控制必须在应用里也做。
- **"内部接口不会被外面调到。"** 影子 API 常因配置或部署疏忽对外暴露，一旦被扫到就是缺口。
- **"HTTPS + 登录了就安全。"** 传输和认证都对，但 BOLA/BFLA/批量赋值是授权问题，照样发生。

## 自测

:::details 1. OWASP API Top 10 (2023) 里哪几条本质是授权问题？分别是什么级别？
API1 BOLA（对象级/水平越权）、API3 对象属性级授权失效（字段级，含过度暴露和批量赋值）、API5 BFLA（功能级/垂直越权）。它们都要求在服务端对每个请求逐一校验"能否访问这个对象/字段/功能"。
:::

:::details 2. BOLA 和 BFLA 有什么区别？
BOLA 是"这个功能你能用，但你在用它访问别人的对象"（水平越权，如改 id 看别人订单）；BFLA 是"这个功能你根本不该用"（垂直越权，如普通用户调管理员接口）。前者靠查询带 owner 条件，后者靠 URL+方法级角色授权。
:::

:::details 3. 直接用 JPA 实体接收 @RequestBody 会有什么安全问题？怎么根治？
批量赋值：攻击者能给实体里任何字段赋值，包括 `role`、`enabled`、`balance`、`ownerId` 等本不该由客户端控制的字段，可能自助提权或篡改归属/余额。根治：入参用只含允许字段的 DTO，服务端显式映射到实体、敏感字段由服务端赋值；出参也用 DTO 防过度暴露。
:::

:::details 4. 修 BOLA 时，为什么"查询带 owner 条件"比"查出来再比较"更好？越权应返回 404 还是 403？
带 owner 条件（如 `findByIdAndOwnerId`）让不属于自己的对象根本查不出来，不依赖每个分支都记得写比较，更不易漏。查出来再 `if` 比较容易在某些路径忘写。越权宜返回 404，避免用 403 泄露"该 id 确实存在"这一信息。
:::

:::details 5. 分页上限为什么要在服务端夹紧？只配 defaultValue 够吗？
因为 `size` 是客户端可控的不可信输入，传 `size=100000` 会打爆内存/数据库（API4）。`defaultValue` 只管"没传时用多少"，管不住"传了个超大值"。必须服务端 `Math.min` 夹到上限，或确认框架版本会对超限值夹紧。
:::

:::details 6. 什么是影子 API 和废弃接口？为什么危险？怎么管？
影子 API 是没进网关/文档/监控的接口（调试接口、意外暴露的内部接口）；废弃接口是升级后没下线的老版本（如 `/v1`）。它们不在防护清单里却能被扫到，常带老漏洞或弱鉴权。对策：OpenAPI 清单纳入 CI、全流量走网关、明确版本与下线策略、定期扫描比对。
:::

:::details 7. API10（不安全消费第三方 API）在 Java 里具体指什么？怎么防？
指你作为客户端调上游时盲信其返回：直接反序列化上游 JSON（可能触发多态反序列化漏洞）、跟随上游给的重定向（可能变 SSRF）、不校验就入库。防御：把第三方返回也当不可信输入——校验、限响应大小、设超时、白名单控制重定向。
:::

:::details 8. 为什么说 API 安全的重心是授权和资源消耗，而不是 XSS/CSRF？
API 通常返回 JSON 供程序消费、多用 Bearer Token 无浏览器会话，XSS/CSRF 的场景相对弱；而 API 直接以 id/字段/功能暴露资源，最容易出的是对象级/字段级/功能级授权失效，以及不限量导致的资源滥用。所以 Top 10 里 API1/3/5 是授权、API4/6 是资源消耗。
:::

## 一句话总结

API 安全的重心是授权和资源消耗：对象级（BOLA）、字段级（批量赋值/过度暴露）、功能级（BFLA）三种授权失效必须在服务端对每个请求逐一校验，靠"查询带 owner 条件 + 入参出参 DTO + URL/方法级角色授权"根治；再配合分页上限、限流、超时、资产纳管和对上游数据的不信任，就能拿 OWASP API Top 10 (2023) 这张清单把一个接口模块系统地审一遍。
