## 为什么要学

[[ss-arch]] 解决了“你是谁”：请求经过过滤器链，认证成功后 `SecurityContextHolder` 里有了一个可信的 `Authentication`。这一课解决下一个问题：“你能做什么、能看哪些数据”。Lab 04 的越权漏洞（水平越权看别人的笔记、垂直越权调管理员接口）本质上都是授权缺失，而不是认证缺失——用户确实登录了，只是系统没有检查他有没有权限碰这条数据。

对 Java 后端来说，授权是最容易“写散”的逻辑：Controller 里一个 `if (user.isAdmin())`，Service 里一个 `if (!order.getUserId().equals(uid))`，Mapper 里又一个 `WHERE shop_id = ?`，漏掉一处就是一个 IDOR。电商后台的“店长只能看本店订单”、车联网平台的“车队管理员只能看自己车队的车辆”、IoT 平台的“租户 A 看不到租户 B 的设备”，全是同一类问题。本课把它拆成三层：URL 级、方法级、对象/数据级，每层用 Spring Security 6+/7 的标准 API 实现。

学完之后你能：设计用户 / 角色 / 权限 / 组织四张核心表（项目② 的第一个里程碑）；用 `authorizeHttpRequests` 做粗粒度拦截；用 `@PreAuthorize` + `@EnableMethodSecurity` 做接口权限；写一个自定义 `AuthorizationManager` 做对象级检查；在 MyBatis 里把租户 / 组织条件落到 SQL，做到“数据级权限”。

:::tip 版本约定
沿用 [[ss-arch]] 的环境：Spring Boot 4.1（Spring Security 7.x）、Java 17、lambda DSL。涉及 6.x 与 7.x 差异的地方会单独标出。
:::

> 本课中的攻击手法只用于你自己的实验环境或获得授权的目标。

## 核心概念

先把三层授权放在一张图里，后面每一节都在填其中一格：

```
request: GET /api/orders/1001   (alice, ROLE_SHOP_MANAGER, tenant=7)
   |
   v
[1] URL layer      AuthorizationFilter + authorizeHttpRequests   粗粒度：能不能进这个路径
   |               "/api/admin/** needs ROLE_ADMIN"
   v
[2] Method layer   @PreAuthorize("hasAuthority('order:read')")    接口级：有没有这个操作权限
   |
   v
[3] Object layer   AuthorizationManager / @PostAuthorize          对象级：这一条数据是不是你的
   |
   v
[4] Data layer     SQL: WHERE tenant_id = 7 AND org_path LIKE ... 数据级：列表查询只返回可见范围
```

- URL 层和方法层回答“能不能做这类操作”，只看身份和权限码，不查数据库里的业务数据。
- 对象层回答“能不能碰这一条”，需要加载资源（或至少它的归属字段）。
- 数据层回答“列表里应该出现哪些条”，必须在 SQL 里过滤，不能查出来再在 Java 里过滤（分页、count 都会错，还可能把别人的数据带进缓存和日志）。

### 1. RBAC：用户-角色-权限，角色继承

RBAC（Role-Based Access Control）的核心是加一层间接：权限不直接授予用户，而是授予角色，用户再被分配角色。

```
User  --(user_role)-->  Role  --(role_permission)-->  Permission
alice                   SHOP_MANAGER                  order:read
                                                      order:refund
bob                     SHOP_STAFF                    order:read
```

在 Spring Security 里，这些最终都会变成 `Authentication.getAuthorities()` 里的一组 `GrantedAuthority` 字符串。约定是：

| 概念 | 存储形式 | 检查方式 |
|---|---|---|
| 角色 | `ROLE_SHOP_MANAGER`（带 `ROLE_` 前缀） | `hasRole('SHOP_MANAGER')`（自动补前缀） |
| 权限码 | `order:refund`（无前缀） | `hasAuthority('order:refund')` |

建议：**代码里检查权限码，而不是角色名**。`@PreAuthorize("hasRole('ADMIN')")` 写死了“谁能做”，以后新增一个“财务”角色也要能退款，就得改代码；`hasAuthority('order:refund')` 只写“需要什么能力”，给哪个角色分配是数据库配置的事。角色用于分组和 URL 层粗拦截，权限码用于接口级控制。

**角色继承（Role Hierarchy）**：`ADMIN` 自动拥有 `MANAGER` 的一切，`MANAGER` 自动拥有 `USER` 的一切。Spring Security 用 `RoleHierarchy` 表达：

```java
@Bean
static RoleHierarchy roleHierarchy() {
    return RoleHierarchyImpl.fromHierarchy("""
            ROLE_ADMIN > ROLE_SHOP_MANAGER
            ROLE_SHOP_MANAGER > ROLE_SHOP_STAFF
            """);
}
```

`fromHierarchy` 是 6.3 起提供的静态工厂（也可以用 `RoleHierarchyImpl.withDefaultRolePrefix().role("ADMIN").implies("SHOP_MANAGER").build()`）。声明成 `static` 的 `@Bean`，是为了让方法安全的基础设施在早期就能拿到它。较新版本中 `authorizeHttpRequests` 和方法安全都会自动使用容器里的 `RoleHierarchy` Bean；如果你发现某一层没生效，查阅你所用版本的 Authorization 文档确认。

注意两点：一是继承只在**检查时**展开，`getAuthorities()` 里依然只有原始角色；二是如果你的权限码是从 `role_permission` 表按“用户实际拥有的角色”加载的，那么 `RoleHierarchy` 不会帮你把下级角色的权限码也查出来——要么在加载时自己沿层级展开，要么干脆在数据里给上级角色也分配这些权限码。项目② 推荐后者：层级关系简单直观，权限码靠数据配置。

### 2. ABAC：基于属性的策略

RBAC 回答不了“店长只能退**本店**、**7 天内**、**金额小于 5000** 的订单”。这类规则依赖属性，就是 ABAC（Attribute-Based Access Control）。NIST SP 800-162 把属性分成几类：

| 属性类别 | 例子 |
|---|---|
| 主体（Subject） | 用户 id、所属组织、租户、角色、安全等级 |
| 资源（Object） | 订单的店铺 id、创建人、状态、金额；车辆的车队 id |
| 操作（Action） | read / update / refund / export |
| 环境（Environment） | 当前时间、来源 IP、是否走 VPN、设备是否受信 |

策略就是一个布尔函数：`allow = f(subject, object, action, environment)`。实践中很少上独立的策略引擎，常见做法是 **RBAC 做底 + ABAC 做补充**：先用权限码判断“有没有退款能力”，再用属性判断“这一单你能不能退”。

```java
// 策略：有退款权限，且订单属于自己的组织（含下级），且下单不超过 7 天
boolean canRefund(LoginUser u, Order o, Instant now) {
    return u.hasAuthority("order:refund")
        && o.getTenantId().equals(u.getTenantId())
        && o.getOrgPath().startsWith(u.getOrgPath())
        && o.getCreatedAt().isAfter(now.minus(Duration.ofDays(7)));
}
```

`orgPath` 是组织树的“物化路径”，如 `/1/3/7/`，后面数据表设计会用到。这个函数本身没有依赖 Spring，便于单测；下面会把它接到 `@PreAuthorize` 和 `AuthorizationManager` 上。

### 3. authorizeHttpRequests 与 @PreAuthorize / @PostAuthorize

**URL 层**：`authorizeHttpRequests` 注册的是 `AuthorizationFilter`（过滤器链的最后一环，见 [[ss-arch]]）。规则**按声明顺序匹配，第一个命中即生效**，所以具体的写前面，`anyRequest()` 放最后。

```java
@Bean
SecurityFilterChain api(HttpSecurity http) throws Exception {
    http
        .securityMatcher("/api/**")
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/public/**").permitAll()
            .requestMatchers("/api/admin/**").hasRole("ADMIN")
            .requestMatchers(HttpMethod.DELETE, "/api/**").hasAuthority("data:delete")
            .anyRequest().authenticated())
        .formLogin(Customizer.withDefaults());
    return http.build();
}
```

- `permitAll` / `authenticated` / `hasRole` / `hasAnyRole` / `hasAuthority` / `hasAnyAuthority` / `denyAll` / `access(AuthorizationManager)`。
- 兜底规则建议是 `authenticated()` 甚至 `denyAll()`：新增接口忘了配规则时默认安全（fail closed）。
- URL 层看不到业务对象，只适合“整块路径属于谁”这种粗粒度规则。

**方法层**：在配置类上加 `@EnableMethodSecurity`（它取代了旧的 `@EnableGlobalMethodSecurity`，默认就开启 `@PreAuthorize` / `@PostAuthorize` / `@PreFilter` / `@PostFilter`）。

```java
@Configuration
@EnableMethodSecurity
class MethodSecurityConfig { }

@Service
class OrderService {
    @PreAuthorize("hasAuthority('order:read')")
    public List<Order> list(OrderQuery q) { ... }

    // 调用前：结合参数做判断，#id 引用方法参数
    @PreAuthorize("hasAuthority('order:refund') and @orderAuthz.canRefund(authentication, #id)")
    public void refund(Long id) { ... }

    // 调用后：拿返回值判断，不满足则抛 AccessDeniedException（403）
    @PostAuthorize("returnObject.tenantId == authentication.principal.tenantId")
    public Order get(Long id) { ... }
}
```

- `@orderAuthz` 引用名为 `orderAuthz` 的 Spring Bean，复杂逻辑写在 Java 里，SpEL 只做拼装，便于单测。
- `#id` 依赖编译时保留参数名（`-parameters`）；`spring-boot-starter-parent` 已经默认开启，自己配 Maven 时要检查。
- 方法安全基于 Spring AOP 代理：**同一个类内部 `this.refund()` 调用不会经过代理，注解不生效**。
- `@PostAuthorize` 意味着方法已经执行完了：只适合只读查询，千万别放在有副作用（修改、发消息）的方法上。
- `@PostFilter` 在内存里过滤集合，分页和总数会错，列表场景应改为 SQL 过滤（见第 5 节）。

### 4. 自定义 AuthorizationManager 实现对象级授权

`AuthorizationManager<T>` 是 Spring Security 6 起统一的授权抽象：URL 层的 `AuthorizationFilter`、方法层的拦截器，内部都是在调用它。输入是“当前认证信息 + 被保护的对象 T”，输出是允许 / 拒绝。

:::warn 6.x 与 7.x 的方法名
6.3 及更早版本要实现的是 `AuthorizationDecision check(Supplier<Authentication>, T)`；6.4 引入 `authorize(...)` 返回 `AuthorizationResult` 并弃用 `check`；7.x 以 `authorize` 为准，参数类型为 `Supplier<? extends Authentication>`。下面按 7.x 写，编译报错时请对照你所用版本的 Javadoc 调整签名。`AuthorizationDecision` 实现了 `AuthorizationResult`，两种写法都能直接 `return new AuthorizationDecision(bool)`。
:::

典型场景：`/api/orgs/{orgId}/**` 下所有接口，只允许该组织（或其上级组织）的成员访问。把它挂在 URL 层：

```java
@Component
class OrgAccessManager implements AuthorizationManager<RequestAuthorizationContext> {

    private final OrgMapper orgMapper;

    OrgAccessManager(OrgMapper orgMapper) { this.orgMapper = orgMapper; }

    @Override
    public AuthorizationResult authorize(Supplier<? extends Authentication> authentication,
                                         RequestAuthorizationContext ctx) {
        Authentication auth = authentication.get();
        if (auth == null || !(auth.getPrincipal() instanceof LoginUser user)) {
            return new AuthorizationDecision(false);
        }
        long orgId;
        try {
            orgId = Long.parseLong(ctx.getVariables().get("orgId"));
        } catch (NumberFormatException e) {
            return new AuthorizationDecision(false);   // fail closed
        }
        OrgRef org = orgMapper.findRef(orgId);           // 只查 tenant_id + path
        boolean ok = org != null
                && org.tenantId().equals(user.getTenantId())
                && org.path().startsWith(user.getOrgPath());
        return new AuthorizationDecision(ok);
    }
}
```

接入配置，`{orgId}` 这种路径变量会被 `RequestAuthorizationContext.getVariables()` 取到：

```java
.authorizeHttpRequests(auth -> auth
    .requestMatchers("/api/orgs/{orgId}/**").access(orgAccessManager)
    .anyRequest().authenticated())
```

对于需要加载完整业务对象的检查（订单、笔记、车辆），更自然的位置是方法层。做法是把判断逻辑放在一个 Bean 里，由 `@PreAuthorize` 调用：

```java
@Component("orderAuthz")
class OrderAuthz {
    private final OrderMapper orderMapper;
    OrderAuthz(OrderMapper orderMapper) { this.orderMapper = orderMapper; }

    public boolean canRefund(Authentication auth, Long orderId) {
        if (!(auth.getPrincipal() instanceof LoginUser u)) return false;
        OrderRef o = orderMapper.findRef(orderId);      // tenant_id, org_path, created_at
        return o != null
            && o.tenantId().equals(u.getTenantId())
            && o.orgPath().startsWith(u.getOrgPath())
            && o.createdAt().isAfter(Instant.now().minus(Duration.ofDays(7)));
    }
}
```

要点：对象不存在和无权访问**都返回拒绝**；对外可以统一成 404，避免攻击者通过 403/404 的差异枚举哪些 id 存在。Spring Security 也支持把 `AuthorizationManager<MethodInvocation>` 直接装进方法拦截器（`AuthorizationManagerBeforeMethodInterceptor`），适合做成自定义注解，但 SpEL + Bean 的写法对大多数项目已经够用。

### 5. 多租户 / 组织维度的数据隔离

列表、导出、统计这类接口没有单个“对象”可以检查，只能在 SQL 里加条件。两个维度：

- **租户（tenant）**：SaaS 里不同客户之间硬隔离，任何人（包括租户内的管理员）都不能跨租户。
- **组织（org）**：租户内部的部门树，常见的“数据范围”有：仅本人、本部门、本部门及下级、全部（本租户内）。

铁律：**租户 id 和组织信息只从服务端的 `Authentication` 里取，永远不从请求参数、请求头或请求体里取。** 前端传 `?tenantId=8` 就能看租户 8 的数据，是 SaaS 里最典型的越权。

```java
public record DataScope(long tenantId, long userId, String orgPath, Level level) {
    public enum Level { SELF, ORG_AND_CHILDREN, ALL }

    public static DataScope current() {
        LoginUser u = (LoginUser) SecurityContextHolder.getContext()
                .getAuthentication().getPrincipal();
        Level level = u.hasAuthority("data:all") ? Level.ALL
                    : u.hasAuthority("data:org_tree") ? Level.ORG_AND_CHILDREN
                    : Level.SELF;
        return new DataScope(u.getTenantId(), u.getId(), u.getOrgPath(), level);
    }
}
```

MyBatis 映射里显式使用它（`#{}` 是预编译参数，不会注入）：

```xml
<select id="listOrders" resultType="Order">
  SELECT o.* FROM orders o
  WHERE o.tenant_id = #{scope.tenantId}
  <choose>
    <when test="scope.level.name() == 'SELF'">AND o.created_by = #{scope.userId}</when>
    <when test="scope.level.name() == 'ORG_AND_CHILDREN'">AND o.org_path LIKE CONCAT(#{scope.orgPath}, '%')</when>
  </choose>
  ORDER BY o.id DESC LIMIT #{limit} OFFSET #{offset}
</select>
```

对应的 Mapper 方法签名是 `List<Order> listOrders(@Param("scope") DataScope scope, @Param("limit") int limit, @Param("offset") int offset)`。`ALL` 分支不追加条件，但**租户条件永远在**。`org_path` 以斜杠结尾（`/1/3/`），所以 `LIKE '/1/3/%'` 不会误匹配 `/1/30/`；给 `(tenant_id, org_path)` 建联合索引，前缀 LIKE 可以用上索引。

靠每个 Mapper 手写 `tenant_id = ?` 迟早会漏。常见的兜底手段：

| 手段 | 做法 | 注意 |
|---|---|---|
| MyBatis 拦截器 | 实现 `Interceptor` 拦截 `StatementHandler.prepare`，解析 SQL 并自动追加租户条件 | 要用 SQL 解析器（如 JSqlParser）改写，别用字符串拼接；MyBatis-Plus 自带多租户插件可参考 |
| 数据库行级安全 | PostgreSQL 的 Row Level Security 策略 | MySQL 没有原生行级安全，只能靠应用层或视图 |
| 分库 / 分 schema | 每个租户一个库 | 隔离最强，运维成本最高 |
| 测试兜底 | 集成测试用租户 A 的身份调所有列表接口，断言结果里没有租户 B 的数据 | 最便宜，强烈建议 |

拦截器是“防漏”，不是替代：显式写出的条件便于代码评审，拦截器保证忘写时也不会跨租户。

### 6. 思考题：“管理员能看所有数据”写在哪一层？

结论：**“是不是管理员”在认证 / 授权层决定一次，“能看哪些行”落在 SQL 层执行；URL 层和方法层只负责“能不能进这个功能”。**

- **URL 层做不到**：`/api/orders` 这个路径普通店员和管理员都要用，差别在返回哪些行，URL 规则表达不了“行”。
- **方法层不适合做过滤**：`@PostFilter` 在内存里筛，分页和总数都错，还要把全表查出来；在 Service 里写 `if (isAdmin) mapperA() else mapperB()`，每个列表接口复制一遍，迟早漏。
- **SQL 层是执行点**：像上面的 `DataScope` 一样，由统一的代码根据权限码（`data:all`）算出数据范围，Mapper 根据范围拼条件。“管理员”只是 `level = ALL` 的一种情况，没有任何地方硬编码角色名。

还要补两条边界：一是 SaaS 场景下“所有数据”指**本租户的所有数据**，租户条件对管理员也不豁免；需要跨租户的平台运营功能应该是**独立的接口 + 独立的角色 + 审计日志**，而不是给普通接口开后门。二是 URL 层仍然有用：`/api/admin/**` 这种纯管理功能，用 `hasRole("ADMIN")` 在最外层挡掉，减少攻击面。

## 动手实践

### 实践：设计用户 / 角色 / 权限 / 组织四张表，实现接口级 + 数据级权限

这是项目② 的第一个里程碑。建议在项目② 的独立工程里做（MySQL 8），也可以先在 MyNotes 的 H2 里试（H2 需要去掉 `ENGINE`、`COMMENT` 等 MySQL 专有语法）。Lab 04 的修复版是你自己的练习，本实践不直接改它，但做完之后思路可以直接迁移过去。

**第 1 步：DDL。** 四张核心表 + 两张关联表，所有业务表都带 `tenant_id`：

```sql
CREATE TABLE sys_org (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id  BIGINT       NOT NULL,
  parent_id  BIGINT       NULL,
  name       VARCHAR(64)  NOT NULL,
  path       VARCHAR(255) NOT NULL,          -- e.g. /1/3/7/
  KEY idx_org_tenant_path (tenant_id, path)
);

CREATE TABLE sys_user (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id  BIGINT       NOT NULL,
  org_id     BIGINT       NOT NULL,
  username   VARCHAR(64)  NOT NULL,
  password   VARCHAR(128) NOT NULL,          -- {bcrypt}...
  enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE KEY uk_user_tenant_name (tenant_id, username)
);

CREATE TABLE sys_role (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id  BIGINT       NOT NULL,
  code       VARCHAR(64)  NOT NULL,          -- ADMIN / SHOP_MANAGER
  name       VARCHAR(64)  NOT NULL,
  UNIQUE KEY uk_role_tenant_code (tenant_id, code)
);

CREATE TABLE sys_permission (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  code       VARCHAR(64)  NOT NULL UNIQUE,   -- order:read / order:refund / data:all
  name       VARCHAR(64)  NOT NULL
);

CREATE TABLE sys_user_role (
  user_id BIGINT NOT NULL, role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sys_role_permission (
  role_id BIGINT NOT NULL, permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id)
);
```

设计取舍：权限码是**全局**的（由开发者定义，跟代码里的 `hasAuthority` 一一对应），角色是**租户内**的（每个客户可以自己组合角色）。关联表没写外键是常见的互联网风格，保留外键也可以。再准备一张业务表和种子数据：

```sql
CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  tenant_id BIGINT NOT NULL, org_path VARCHAR(255) NOT NULL,
  created_by BIGINT NOT NULL, amount DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_orders_tenant_path (tenant_id, org_path)
);
-- tenant 1: org /1/ (HQ) -> /1/2/ (Shop A), /1/3/ (Shop B); tenant 2: org /4/
INSERT INTO sys_org VALUES (1,1,NULL,'HQ','/1/'),(2,1,1,'Shop A','/1/2/'),
                           (3,1,1,'Shop B','/1/3/'),(4,2,NULL,'Other Co','/4/');
INSERT INTO orders (tenant_id, org_path, created_by, amount) VALUES
  (1,'/1/2/',2,100),(1,'/1/3/',3,200),(2,'/4/',9,999);
```

用户规划：`boss`（租户 1，HQ，角色 ADMIN，拥有 `data:all`），`alice`（租户 1，Shop A 店长，拥有 `order:read`、`order:refund`、`data:org_tree`），`bob`（租户 1，Shop B 店员，只有 `order:read`，数据范围 SELF）。用户、角色、关联表的 INSERT 按这个规划自己补全，这是熟悉模型最快的方式。

**第 2 步：登录时加载角色和权限码。** 在 [[ss-arch]] 的 `UserDetailsService` 基础上，把角色（加 `ROLE_` 前缀）和权限码一起放进 authorities，并在自定义的 `LoginUser` 里带上 `tenantId`、`orgPath`：

```sql
SELECT 'ROLE' AS type, r.code AS authority FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id
 WHERE ur.user_id = ?
UNION
SELECT 'PERM', p.code FROM sys_user_role ur
  JOIN sys_role_permission rp ON rp.role_id = ur.role_id
  JOIN sys_permission p ON p.id = rp.permission_id
 WHERE ur.user_id = ?
```

`type = 'ROLE'` 的行在 Java 里拼成 `"ROLE_" + authority`，`PERM` 行原样使用。`LoginUser` 实现 `UserDetails`，额外持有 `id`、`tenantId`、`orgPath` 字段，以及一个便捷方法 `hasAuthority(String)`。

**第 3 步：URL 层 + 方法层配置。** 为了方便 curl 验证，这里用 HTTP Basic + 无状态会话（没有 Cookie 会话，所以关闭 CSRF 是安全的；表单登录的版本见 [[ss-arch]]）：

```java
@Configuration
@EnableMethodSecurity
class SecurityConfig {
    @Bean
    SecurityFilterChain api(HttpSecurity http, OrgAccessManager orgAccess) throws Exception {
        http.securityMatcher("/api/**")
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/orgs/{orgId}/**").access(orgAccess)
                .anyRequest().authenticated())
            .httpBasic(Customizer.withDefaults())
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .csrf(csrf -> csrf.disable());
        return http.build();
    }
}

@RestController
@RequestMapping("/api/orders")
class OrderController {
    private final OrderService svc;
    OrderController(OrderService svc) { this.svc = svc; }

    @GetMapping
    List<Order> list() { return svc.list(DataScope.current()); }

    @PostMapping("/{id}/refund")
    void refund(@PathVariable Long id) { svc.refund(id); }
}
```

`OrderService.list` 标注 `@PreAuthorize("hasAuthority('order:read')")` 并把 `DataScope` 传给 Mapper；`refund` 标注第 3 节的 `@PreAuthorize("hasAuthority('order:refund') and @orderAuthz.canRefund(authentication, #id)")`。

**第 4 步：用 curl 验证。** 假设用户 id 为 boss=1、alice=2、bob=3，种子订单 1 由 alice 在 Shop A 创建，订单 2 由 bob 在 Shop B 创建，订单 3 属于租户 2。

```bash
curl -s -u alice:alice123 http://127.0.0.1:8080/api/orders
curl -s -u bob:bob123     http://127.0.0.1:8080/api/orders
curl -s -u boss:boss123   http://127.0.0.1:8080/api/orders
```

预期输出（字段顺序可能不同）：

```
[{"id":1,"tenantId":1,"orgPath":"/1/2/","createdBy":2,"amount":100.00, ...}]
[{"id":2,"tenantId":1,"orgPath":"/1/3/","createdBy":3,"amount":200.00, ...}]
[{"id":2, ...},{"id":1, ...}]
```

怎么读：alice 的范围是 `ORG_AND_CHILDREN`，只看到 Shop A；bob 是 `SELF`，只看到自己建的；boss 有 `data:all`，看到租户 1 的全部两条，但**看不到订单 3**——租户条件对管理员也生效。

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -u bob:bob123     http://127.0.0.1:8080/api/orders/2/refund
curl -s -o /dev/null -w '%{http_code}\n' -X POST -u alice:alice123 http://127.0.0.1:8080/api/orders/2/refund
curl -s -o /dev/null -w '%{http_code}\n' -X POST -u alice:alice123 http://127.0.0.1:8080/api/orders/1/refund
curl -s -o /dev/null -w '%{http_code}\n'         -u alice:alice123 http://127.0.0.1:8080/api/admin/users
curl -s -o /dev/null -w '%{http_code}\n'                           http://127.0.0.1:8080/api/orders
```

```
403
403
200
403
401
```

怎么读：第 1 行 bob 没有 `order:refund`，接口级拒绝；第 2 行 alice 有权限码，但订单 2 属于 Shop B，对象级拒绝（这正是水平越权被挡住）；第 3 行全部通过；第 4 行 URL 层 `hasRole("ADMIN")` 拒绝（垂直越权被挡住）；第 5 行没有认证，由 `AuthenticationEntryPoint` 返回 401，响应头里有 `WWW-Authenticate: Basic ...`。401 与 403 的区别见 [[ss-arch]]。

**第 5 步：把上面的矩阵写成测试。** 仿照 Lab 的风格，“同一个攻击打同一个接口，必须被挡住”。`spring-security-test` 的 `@WithUserDetails("alice")` 会调用你的 `UserDetailsService` 装载真实的 `LoginUser`，比 `@WithMockUser` 更贴近实际：

```java
@Test
@WithUserDetails("alice")
void aliceCannotRefundOtherShopsOrder() throws Exception {
    mvc.perform(post("/api/orders/2/refund")).andExpect(status().isForbidden());
}
```

跑 `./mvnw test` 后预期看到 `Tests run: N, Failures: 0`。建议至少覆盖：每个角色 × 每个接口 × 本人 / 同组织 / 其他组织 / 其他租户 四种数据归属。这张矩阵就是项目② 里“RBAC 接口权限 + 数据权限”里程碑的验收标准。

## 攻击者视角

授权漏洞通常不需要任何特殊工具，Burp 的 Repeater 加两个账号就够了。攻击者的思路：

- **换 id**：`/api/orders/1` 改成 `/api/orders/2`，看是否返回别人的数据（IDOR / 水平越权）。连续 id 还能批量遍历。
- **换租户参数**：请求里凡是出现 `tenantId`、`orgId`、`shopId`、`userId` 的地方都改一遍，包括 JSON 请求体、查询参数和自定义请求头。
- **绕过 URL 规则**：只在 URL 层防护时，尝试同一功能的其他入口，例如旧版本接口 `/api/v1/...`、导出接口、批量接口、GraphQL 或 WebSocket。
- **换 HTTP 方法**：规则只写了 `GET`，试试 `PUT` / `PATCH` / `DELETE` 是否落到 `permitAll`。
- **利用 403 / 404 差异**：存在但无权返回 403，不存在返回 404，就能枚举出有效 id。
- **批量赋值**：更新个人资料时在 JSON 里附带 `"roleIds":[1]` 或 `"tenantId":2`，如果后端直接把请求体映射到实体再保存，就完成了提权。
- **找没加注解的方法**：新接口、内部调用（`this.xxx()` 绕过代理）、定时任务和 MQ 消费者触发的逻辑都不经过 `@PreAuthorize`。

## 防御与最佳实践

- **分层且默认拒绝**：URL 层兜底 `anyRequest().authenticated()`（或 `denyAll()`），方法层每个公开的 Service 方法都有 `@PreAuthorize`，对象层和数据层负责“哪一条”。
- **身份字段只从 `Authentication` 取**：`tenantId`、`orgPath`、`userId` 一律来自 `LoginUser`，请求里的同名字段直接忽略。
- **DTO 与实体分离**：更新接口用专门的请求 DTO，只包含允许修改的字段，杜绝批量赋值改 `roleIds` / `tenantId`。
- **检查权限码而不是角色名**：代码里写 `hasAuthority('order:refund')`，角色和权限的映射放在数据库里。
- **授权逻辑集中**：对象级规则写在 `OrderAuthz` 这类 Bean 或 `AuthorizationManager` 里，数据范围由 `DataScope` 统一计算，便于评审和单测。
- **不可枚举**：对外统一返回 404，或至少让“不存在”和“无权”看起来一样；主键可以考虑用不连续的 id，但这只是减少暴露，不能替代授权检查。
- **异步入口单独处理**：MQ 消费者、定时任务没有登录用户，要显式构造系统身份并限定租户，不能“因为没人登录所以不检查”。
- **权限变更要能生效**：权限缓存在 Session 或 Token 里时，角色被收回后要有失效机制（项目② 的 Token 撤销里程碑，见 [[ss-token]]）。
- **审计与检测**：记录所有 `AccessDeniedException`（用户、租户、资源 id、接口），同一用户短时间内大量 403 往往就是在遍历 id；可以用自定义 `AccessDeniedHandler` 记录，或注册一个 `AuthorizationEventPublisher` Bean（如 `SpringAuthorizationEventPublisher`）后监听 `AuthorizationDeniedEvent`。
- **测试矩阵**：每个接口至少有一个“其他租户的用户访问必须失败”的测试。

## 常见误区

| 误区 | 实际情况 |
|---|---|
| 登录了就够了 | 认证只回答“你是谁”；Lab 04 的越权全都发生在已登录用户身上 |
| 前端隐藏了按钮就安全 | 攻击者直接发 HTTP 请求，按钮隐藏只是体验，不是控制 |
| 只在 URL 层配规则 | URL 层看不到数据归属，挡不住水平越权 |
| `hasRole('ROLE_ADMIN')` | `hasRole` 会自动加前缀，应写 `hasRole('ADMIN')`；想写全名用 `hasAuthority('ROLE_ADMIN')` |
| 加了 `@PreAuthorize` 但没生效 | 忘了 `@EnableMethodSecurity`，或者是同类内部调用绕过了代理，或者方法不是通过 Spring Bean 调用的 |
| 查出全部数据再在 Java 里过滤 | 分页和总数错误，性能差，数据还可能进入日志和缓存；应在 SQL 里过滤 |
| 管理员不受租户限制 | 租户隔离对所有人生效；跨租户能力要单独的接口、角色和审计 |
| 用 `@PostAuthorize` 保护修改操作 | 检查发生在方法执行之后，副作用（写库、发消息）通常已经发生了 |
| 用 UUID 代替授权 | 不可猜测只降低枚举风险，id 一旦通过日志、分享链接泄露，仍会越权 |

## 自测

:::details 1. RBAC 中为什么建议代码里检查权限码（`order:refund`），而不是角色名（`ADMIN`）？
角色名检查把“谁能做”写死在代码里，新增或调整角色就要改代码发版。权限码只描述“需要什么能力”，哪个角色拥有它由 `sys_role_permission` 表配置，业务变化时只改数据。角色仍适合用在 URL 层做粗粒度拦截。
:::

:::details 2. 配置了 `RoleHierarchy`（ADMIN > MANAGER）后，ADMIN 用户的 `getAuthorities()` 里会出现 `ROLE_MANAGER` 吗？
不会。层级只在授权检查时展开（`getReachableGrantedAuthorities`），`Authentication` 里仍是原始的角色。同理，它也不会自动把 MANAGER 角色在数据库里关联的权限码加载给 ADMIN。
:::

:::details 3. “店长只能退本店 7 天内的订单”为什么不能只用 RBAC 表达？应该怎么实现？
RBAC 只能表达“店长有退款权限”，而“本店”“7 天内”是资源和环境的属性，属于 ABAC。实现上用 `hasAuthority('order:refund')` 做底，再用 `@PreAuthorize("... and @orderAuthz.canRefund(authentication, #id)")` 调用一个 Bean，按订单的租户、组织路径、创建时间判断。
:::

:::details 4. `authorizeHttpRequests` 里先写 `.anyRequest().authenticated()` 再写 `.requestMatchers("/api/admin/**").hasRole("ADMIN")` 会怎样？
规则按顺序匹配，第一个命中即生效，`anyRequest()` 会吃掉所有请求，普通登录用户也能访问管理接口。Spring Security 6+ 在 `anyRequest()` 之后继续声明 `requestMatchers` 会在启动时直接抛异常，但不要依赖这个保护，应该始终把具体规则放前面、兜底规则放最后。
:::

:::details 5. 一个 Service 方法上有 `@PreAuthorize`，但通过同一个类的另一个方法 `this.refund(id)` 调用时没有被拦截，为什么？
方法安全基于 Spring AOP 代理，只有经过代理对象的调用才会触发拦截器。同类内部 `this.xxx()` 直接调用目标对象，绕过了代理。解决办法：把需要保护的方法放到另一个 Bean 里，或在入口方法上也做检查。
:::

:::details 6. 自定义 `AuthorizationManager<RequestAuthorizationContext>` 适合做什么？怎么拿到路径里的 `{orgId}`？
适合“整段路径归属于某个资源”的对象级检查，例如 `/api/orgs/{orgId}/**`。用 `.requestMatchers("/api/orgs/{orgId}/**").access(manager)` 注册，在实现里通过 `ctx.getVariables().get("orgId")` 取值，再查组织的租户和路径与当前用户比较；解析失败或查不到时返回拒绝。
:::

:::details 7. 列表接口的数据隔离为什么要落在 SQL 层？租户 id 应该从哪里取？
内存过滤会导致分页和总数错误，要先查出全部数据，还可能把越权数据带进缓存和日志。租户 id 只能从服务端的 `Authentication`（如 `LoginUser.getTenantId()`）取，绝不能取请求参数、请求头或请求体里的值。可以用 MyBatis 拦截器自动追加租户条件，作为忘写时的兜底。
:::

:::details 8. “管理员能看所有数据”应该写在 URL 层、方法层还是 SQL 层？
由统一代码根据权限码（如 `data:all`）算出数据范围，由 SQL 层按范围拼条件执行；URL 层和方法层只决定能不能进这个功能。URL 层表达不了“行”，方法层过滤会导致分页错误且容易遗漏。另外“所有”只限本租户，跨租户能力应做成独立接口 + 独立角色 + 审计。
:::

## 一句话总结

授权要分层：URL 层用 `authorizeHttpRequests` 挡整块路径，方法层用 `@PreAuthorize` 查权限码，对象层用 `AuthorizationManager` 或授权 Bean 查“这一条是不是你的”，数据层用 SQL 里的租户和组织条件决定“列表里有哪些条”，而所有身份属性都只来自服务端的 `Authentication`。
