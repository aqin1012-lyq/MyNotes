## 为什么要学

[[iot-identity]] 解决了“你是谁”：没有合法证书连不上。但一台合法设备连上之后，如果它能订阅 `#`、能往别的车的下行主题里发“开锁”，那身份做得再好也白搭。这一课解决第二个根本问题——**授权**：每个已认证的客户端能对哪些主题做发布、做订阅。

你会发现它和 Web 安全里的越权几乎一模一样。[[web-access]] 和 Lab 04 里，`GET /orders/{id}` 不检查订单是否属于当前用户，就是 IDOR；MQTT 里 car-001 订阅 `devices/car-002/up` 而 Broker 不检查主题是否属于 car-001，就是 **IoT 版 IDOR**。只不过这里的“资源 ID”藏在主题路径里，“当前用户”是连接时认证出来的设备身份。

这一课是**项目③**里“HTTP 回调认证 / 授权（ACL）”“指令下发审计”“异常行为检测”三个里程碑的主体。你会用 Spring Boot 写一个控制器，让 EMQX 在每次连接、发布、订阅时回调它来做决定，并写测试证明“设备 A 读不到设备 B”。对 Java 后端来说这是最舒服的一种方案：授权逻辑回到你熟悉的代码、数据库和测试里。

:::tip 版本约定
本课以 **EMQX 5.x（示例按 5.8 编写）**为准。EMQX 4.x 的 HTTP 认证/授权是插件形式，占位符是 `%c`、`%u` 这种写法，结果主要靠 HTTP 状态码表达；5.x 改成了认证器/授权源链、`${clientid}` 这种占位符、JSON 响应体表达结果，两者不兼容，更新的大版本也可能再变。**请求体里有哪些占位符、响应体要求什么格式，一律以你所用版本的 EMQX 文档“认证 › HTTP”“授权 › HTTP”两节为准。**
:::

## 核心概念

### 1. EMQX 授权（ACL）：基于 ClientID / 用户名的主题模板

EMQX 5.x 的授权由一条**授权源链**组成，每个客户端发布或订阅时按顺序检查：

```
PUBLISH / SUBSCRIBE (clientid, username, topic, action)
   |
   v
[superuser?] --yes--> allow                  认证时被标为超级用户则跳过授权
   | no
   v
[cache hit?] --yes--> cached result           授权结果默认有缓存
   | no
   v
source 1 (e.g. file acl.conf) --allow/deny--> done
   | no match (ignore)
   v
source 2 (e.g. http / mysql / redis) --allow/deny--> done
   | no match
   v
no_match  --> allow or deny                   兜底动作，务必设为 deny
```

授权源可以是文件（`acl.conf`）、内置数据库、MySQL、Redis、MongoDB、HTTP 服务等。几个关键配置（名称以 5.x 文档为准）：`no_match`（全部不匹配时怎么办）、`deny_action`（拒绝发布时是静默丢弃还是断开连接）、`cache`（授权结果缓存，改了规则可能不会立刻对已连接客户端生效）。

文件授权源的规则是 Erlang 元组写法，可以用**占位符**把主题和当前客户端绑定——这就是“主题模板”：

```
%% acl.conf 示例（EMQX 5.x 语法，占位符为 ${clientid} / ${username}）
{allow, all, publish,   ["devices/${clientid}/up", "devices/${clientid}/status"]}.
{allow, all, subscribe, ["devices/${clientid}/down"]}.
{deny,  all}.
```

EMQX 在检查时把 `${clientid}` 替换成当前连接的 ClientID，于是 car-001 只能匹配到 `devices/car-001/...`。注意两点：模板里的 ClientID 本身必须是**可信的**（已和证书 CN 绑定），否则攻击者把 ClientID 设为 `car-002` 就绕过了；另外 EMQX 默认附带的 `acl.conf` 是为了“开箱能用”，通常只拦了字面上的 `#` 和 `$SYS/#` 等少数情况，像 `devices/#`、`+/+/up` 这类订阅未必会被拦，最后一条往往还是“其余全部允许”，生产环境不能直接用。

### 2. 设备只能 pub devices/{id}/up，只能 sub devices/{id}/down

这是 IoT 授权最核心的一条规则，可以画成一张“对象级授权矩阵”：

| 主体 | publish | subscribe |
|---|---|---|
| 设备 `{id}` | `devices/{id}/up`、`devices/{id}/status` | `devices/{id}/down`（精确匹配，不允许通配符） |
| 平台服务 | `devices/+/down` 中合法设备 ID 的主题 | `devices/+/up`、`devices/+/status` |
| 其他任何人 | 拒绝 | 拒绝 |

设计要点：主题里的 `{id}` 必须来自**认证结果**而不是客户端自报；设备订阅请求里只要出现 `+` 或 `#` 一律拒绝（不给“订阅一片”的机会）；上行和下行分开，设备不能往自己的 `down` 发消息伪造平台指令，也不能订阅自己的 `up`（没必要就不给）。

**这和 Web 的 IDOR 有什么共同点？** 本质完全相同：**资源标识由请求方提供，服务端没有验证“这个资源属于当前主体”**。Web 里资源 ID 在 URL/参数里（`/orders/42`），IoT 里在主题路径里（`devices/car-002/up`）；Web 里当前主体来自 Session/Token，IoT 里来自连接认证（证书 CN）。防御思路也一样：从可信的身份出发，服务端逐次检查“主体 ↔ 资源”的归属关系，默认拒绝。区别在于 MQTT 多了通配符——一个 `#` 相当于一次请求遍历所有 ID，影响比单个 IDOR 更大。

### 3. 平台侧指令下发的授权与审计

设备不能随便发指令，平台也不能“谁都能让平台发指令”。真实攻击里，更常见的不是直接打 Broker，而是打**平台的下发接口**：App 调 `POST /api/vehicles/{vin}/unlock`，后端不检查这辆车是否属于当前用户，攻击者改个 VIN 就能开别人的车——经典 IDOR，只是后果是物理世界的。

```
App/Ops --HTTPS--> Platform API --(1) authz: user owns vin?-->     用户与车辆的归属校验
                        |      --(2) risk: MFA / rate limit-->       高危指令加强校验
                        |      --(3) audit log (who/what/when)-->    落库，不可篡改
                        |      --(4) sign cmd {id,nonce,exp}-->      签名 + 过期时间
                        v
                  EMQX --devices/{vin}/down--> device                设备验签、查重、看过期
                        <--devices/{vin}/up (ack cmdId)--            回执关联审计记录
```

- **授权**：在 Spring 层按“用户—车辆/设备归属”做对象级校验（回忆 [[ss-authz]]），而不只是“登录了就行”。解锁、远程启动、OTA 这类高危指令，按角色和场景再加一道（二次确认、MFA、频率限制）。
- **平台连接 Broker 的身份**：平台也是一个 MQTT 客户端，给它独立的凭据和**有限的**权限（只能发 `down`、只能收 `up`），不要图省事用超级用户，否则平台一被攻破，攻击者就拥有整个 Broker。
- **审计**：每条指令记录“谁（操作人/调用方）、对哪台设备、什么指令、何时、来源 IP、结果回执”，指令 ID 贯穿平台日志、MQTT 载荷和设备回执，出事时能完整还原。
- **防重放**：指令体带唯一 ID、nonce、过期时间，由平台签名；设备验签、缓存最近 nonce 拒绝重复、拒绝过期指令。这补上了 [[iot-mqtt]] 里“QoS 防不了重放”的缺口。

### 4. 异常行为检测：频率、非常规主题、离线重连风暴

授权挡住“不该做的事”，检测负责发现“正在尝试做坏事”和“身份已经被克隆”：

| 信号 | 可能意味着什么 | 数据从哪来 |
|---|---|---|
| 单设备发布频率远超正常（如平时 3 秒一条，突然每秒几百条） | 设备被控制发起洪泛、固件 bug、脚本冒充 | 规则引擎统计、平台消费侧计数 |
| 授权被拒绝（尤其是订阅 `#`、`+`、别人的主题） | 探测、越权尝试；正常设备几乎不会触发 | 授权回调日志（你的 HTTP 服务天然能记录） |
| 同一 ClientID 频繁在不同 IP 之间被踢来踢去 | 身份被克隆，两台“同名设备”在互相抢占 | 连接/断开事件、会话接管次数 |
| 大量设备短时间同时掉线又重连（重连风暴） | 网络故障、Broker 重启，也可能是 DDoS 或恶意固件推送后的连锁反应 | 连接事件、`$SYS` 统计、监控指标 |
| 非常规时间、非常规地域的连接 | 凭据泄露后被异地使用 | 连接事件中的来源 IP |

EMQX 5.x 自带一些防护能力，例如连接抖动检测（频繁上下线的客户端可被临时封禁）、监听器级别的连接/消息速率限制、黑名单（按 ClientID、用户名、IP 封禁），以及规则引擎可订阅的客户端连接/断开等事件主题。具体配置名以文档为准。检测到异常后的动作要分级：告警 → 限速 → 临时封禁 → 吊销证书，避免误杀一片正常设备。

## 动手实践

### 练习：基于 HTTP 回调（Java 服务）的 EMQX 认证 + 授权，并测试设备 A 读不到设备 B

整体结构（项目③的 Docker Compose 里新增一个 `platform` 服务，就是你的 Spring Boot 应用）：

```
device --mTLS 8883--> EMQX --POST /emqx/authn--> platform (Spring Boot)   连接时：你是谁？
                          --POST /emqx/authz--> platform                  每次 pub/sub：能不能？
                          <-- {"result":"allow" | "deny" | "ignore"} --   JSON 结果
```

**第 1 步：配置 EMQX 的 HTTP 认证器与 HTTP 授权源**

实验时推荐在 Dashboard 的“访问控制”页面里点选配置（HTTP Server 类型），不容易写错；下面的 HOCON 用来帮助你理解字段结构，**以 EMQX 5.8 为假设，确切写法和占位符列表请对照文档**：

```
authentication = [
  {
    mechanism = password_based
    backend = http
    method = post
    url = "http://platform:8080/emqx/authn"
    headers { "content-type" = "application/json", "x-emqx-token" = "change-me" }
    body {
      clientid = "${clientid}"
      username = "${username}"
      password = "${password}"
      cn       = "${cert_common_name}"
      peerhost = "${peerhost}"
    }
  }
]

authorization {
  no_match = deny
  deny_action = disconnect
  sources = [
    {
      type = http
      method = post
      url = "http://platform:8080/emqx/authz"
      headers { "content-type" = "application/json", "x-emqx-token" = "change-me" }
      body { clientid = "${clientid}", username = "${username}", topic = "${topic}", action = "${action}" }
    }
  ]
}
```

理解这段配置的关键：**`body` 里等号左边的键名是你自己定的**（它们就是你的 Controller 收到的 JSON 字段名），等号右边的 `${...}` 占位符才是 EMQX 规定的。所以真正需要去文档核对的只有两样东西：占位符名称（比如证书 CN 的占位符在你的版本里叫什么），以及响应体格式（5.x 用 JSON 里的 `result` 字段表示 allow/deny/ignore，认证响应还可以带 `is_superuser`）。`x-emqx-token` 是自定义请求头，用来让平台确认“回调确实来自 EMQX”。记得把默认 `acl.conf` 文件授权源删掉或挪到 HTTP 源之后，否则它可能先返回 allow。

**第 2 步：把授权规则写成一个纯 Java 类**

先把规则写成不依赖 Spring 的类，方便单元测试。`action` 的取值按 5.x 文档是 `publish` / `subscribe`，请核对：

```java
package com.example.iot.acl;

import java.util.Set;
import java.util.regex.Pattern;

public class DevicePolicy {
    private static final Pattern DEVICE_ID = Pattern.compile("^[a-z0-9-]{3,32}$");
    private final Set<String> disabledDevices;
    private final String platformClientId;

    public DevicePolicy(Set<String> disabledDevices, String platformClientId) {
        this.disabledDevices = disabledDevices;
        this.platformClientId = platformClientId;
    }

    /** 设备认证：必须带证书，ClientID 必须等于证书 CN，且设备未被禁用 */
    public boolean authenticateDevice(String clientId, String certCn) {
        return certCn != null && !certCn.isBlank()
                && DEVICE_ID.matcher(certCn).matches()
                && certCn.equals(clientId)
                && !disabledDevices.contains(certCn);
    }

    /** 授权：默认拒绝，只放行白名单中的精确主题 */
    public boolean authorize(String clientId, String action, String topic) {
        if (topic == null || clientId == null) return false;
        if (clientId.equals(platformClientId)) {
            return switch (action) {
                case "publish" -> isDeviceTopic(topic, "down");
                case "subscribe" -> topic.equals("devices/+/up") || topic.equals("devices/+/status");
                default -> false;
            };
        }
        if (topic.contains("+") || topic.contains("#")) return false;   // 设备一律不许用通配符
        return switch (action) {
            case "publish" -> topic.equals("devices/" + clientId + "/up")
                           || topic.equals("devices/" + clientId + "/status");
            case "subscribe" -> topic.equals("devices/" + clientId + "/down");
            default -> false;
        };
    }

    private boolean isDeviceTopic(String topic, String dir) {
        String[] p = topic.split("/", -1);
        return p.length == 3 && p[0].equals("devices") && DEVICE_ID.matcher(p[1]).matches() && p[2].equals(dir);
    }
}
```

注意这里全部用 `equals` 精确比较，不用 `startsWith`：`topic.startsWith("devices/car-001")` 会把 `devices/car-0010/down` 也放进来，这和 Web 里用前缀判断路径导致绕过是同一类错误。设备 ID 用白名单正则限制字符集，也顺带挡住了 ClientID 里夹带 `/`、`+`、`#` 的花招。平台客户端的认证（用户名+密码或它自己的证书）请你按 [[ss-arch]] 学过的方式自己补上，密码用 BCrypt 存，不要硬编码。

**第 3 步：Spring Boot 回调控制器**

```java
package com.example.iot.acl;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

@RestController
@RequestMapping("/emqx")
public class EmqxHookController {
    private static final Logger log = LoggerFactory.getLogger(EmqxHookController.class);

    // 字段名与 EMQX body 模板中等号左边的键一致
    public record AuthnRequest(String clientid, String username, String password, String cn, String peerhost) {}
    public record AuthzRequest(String clientid, String username, String topic, String action) {}

    private final DevicePolicy policy;
    private final byte[] hookToken;

    public EmqxHookController(DevicePolicy policy, @Value("${iot.emqx.hook-token}") String hookToken) {
        this.policy = policy;
        this.hookToken = hookToken.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/authn")
    public Map<String, Object> authn(@RequestHeader(value = "x-emqx-token", required = false) String token,
                                     @RequestBody AuthnRequest req) {
        if (!validToken(token)) return deny();
        boolean ok = policy.authenticateDevice(req.clientid(), req.cn());
        log.info("AUTHN clientid={} cn={} ip={} result={}", req.clientid(), req.cn(), req.peerhost(), ok);
        // 注意：不要把 password 打进日志
        return ok ? Map.of("result", "allow", "is_superuser", false) : deny();
    }

    @PostMapping("/authz")
    public Map<String, Object> authz(@RequestHeader(value = "x-emqx-token", required = false) String token,
                                     @RequestBody AuthzRequest req) {
        if (!validToken(token)) return deny();
        boolean ok = policy.authorize(req.clientid(), req.action(), req.topic());
        if (!ok) log.warn("AUTHZ_DENY clientid={} action={} topic={}", req.clientid(), req.action(), req.topic());
        return ok ? Map.of("result", "allow") : deny();
    }

    private boolean validToken(String token) {
        return token != null && MessageDigest.isEqual(hookToken, token.getBytes(StandardCharsets.UTF_8));
    }

    private static Map<String, Object> deny() { return Map.of("result", "deny"); }
}
```

再用 `@Bean` 注册 `DevicePolicy`（禁用列表先用 `Set.of()`，项目里换成查 MySQL/Redis）。几点说明：回调接口是给 EMQX 调的，不要暴露到公网，在 Compose 里只让 `emqx` 容器能访问；如果应用接了 Spring Security，要为 `/emqx/**` 单独配一条 `SecurityFilterChain`（例如 `securityMatcher("/emqx/**")`、`permitAll()` 交给上面的令牌校验，并关闭该路径的 CSRF），不要让它继承用户登录那套规则；`AUTHZ_DENY` 日志就是第 4 节“授权被拒”检测的数据源。回调在每次连接、每次订阅/发布（未命中缓存时）都会被调用，接口必须快：设备状态放 Redis 等缓存，避免每次查库。

**第 4 步：测试——设备 A 读不到设备 B**

先写单元测试，毫秒级跑完，覆盖各种绕过尝试：

```java
package com.example.iot.acl;

import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class DevicePolicyTests {
    private final DevicePolicy p = new DevicePolicy(Set.of("car-999"), "platform");

    @Test void deviceCanOnlyUseOwnTopics() {
        assertTrue(p.authorize("car-001", "publish", "devices/car-001/up"));
        assertTrue(p.authorize("car-001", "subscribe", "devices/car-001/down"));
    }
    @Test void deviceACannotReadDeviceB() {
        assertFalse(p.authorize("car-001", "subscribe", "devices/car-002/up"));
        assertFalse(p.authorize("car-001", "subscribe", "devices/car-002/down"));
    }
    @Test void wildcardsAreDenied() {
        for (String t : new String[]{"#", "devices/#", "devices/+/up", "+/car-001/down"}) {
            assertFalse(p.authorize("car-001", "subscribe", t), t);
        }
    }
    @Test void prefixTrickIsDenied() {
        assertFalse(p.authorize("car-001", "subscribe", "devices/car-0010/down"));
    }
    @Test void deviceCannotForgeCommands() {
        assertFalse(p.authorize("car-001", "publish", "devices/car-001/down"));
        assertFalse(p.authorize("car-001", "publish", "devices/car-002/down"));
    }
    @Test void clientIdMustMatchCertCn() {
        assertTrue(p.authenticateDevice("car-001", "car-001"));
        assertFalse(p.authenticateDevice("car-002", "car-001"));   // ClientID 抢占
        assertFalse(p.authenticateDevice("car-001", null));       // 没证书
        assertFalse(p.authenticateDevice("car-999", "car-999"));  // 已禁用
    }
}
```

预期 `mvn test` 输出 `Tests run: 6, Failures: 0, Errors: 0`。读法：每个用例对应一种真实攻击——订阅别人的主题（IDOR）、通配符、前缀绕过、伪造下行指令、ClientID 抢占、使用已吊销设备。先写这些“红队用例”再写实现，和 MyNotes 的 Lab 测试是同一个套路：攻击必须被挡住。

再写一个端到端测试证明“真的读不到”（需要先 `docker compose up` 起 EMQX + platform，可用 JUnit 的 `@Tag("e2e")` 与单元测试分开跑）：car-001 尝试订阅 car-002 的上行，同时 car-002 发一条消息，断言 car-001 收不到。

```java
@Test @Tag("e2e")
void deviceACannotReceiveDeviceBMessages() throws Exception {
    MqttClient a = connect("car-001");   // 复用 iot-identity 中的 mtlsFactory
    MqttClient b = connect("car-002");
    var received = new java.util.concurrent.atomic.AtomicInteger();
    int granted;
    try {
        IMqttToken tok = a.subscribeWithResponse("devices/car-002/up", 1,
                (topic, msg) -> received.incrementAndGet());
        granted = tok.getGrantedQos()[0];
    } catch (MqttException e) {
        granted = 0x80;                    // 部分客户端版本对被拒订阅直接抛异常
    }
    b.publish("devices/car-002/up", "{\"speed\":42}".getBytes(), 1, false);
    Thread.sleep(2000);
    assertEquals(0x80, granted);          // SUBACK 返回 0x80 = 订阅失败
    assertEquals(0, received.get());      // 真正的目标：一条也收不到
}
```

读法：MQTT 3.1.1 里被拒绝的订阅在 SUBACK 中返回 `0x80`（Failure），MQTT 5 则返回“未授权”等原因码。第二个断言才是本质：无论客户端库如何报告，**消息都不能到达 A**。同时去看 platform 日志，应有一行 `AUTHZ_DENY clientid=car-001 action=subscribe topic=devices/car-002/up`——这就是你的越权告警数据。

## 攻击者视角

> 以下手法只用于你自己的实验环境或已获授权的目标。

攻击者手里通常有一台合法设备的身份（自己买的设备、拆出来的证书），目标是**横向扩大到别的设备**：

- **通配符探测**：依次尝试订阅 `#`、`devices/#`、`+/+/up`、`$SYS/#`，看哪个 SUBACK 是成功的。默认 `acl.conf` 往往只拦字面的 `#`，`devices/#` 就漏了。
- **IDOR 式枚举**：把主题里的设备 ID 换成相邻序列号，`devices/car-002/up`、`devices/car-003/down`……ID 越可预测，枚举越容易。
- **前缀/编码绕过**：利用服务端用 `startsWith`、正则写错、大小写不一致等实现缺陷，例如 `devices/car-0010/down`，或 ClientID 里夹带 `/`、`+` 让模板替换出意料之外的主题。
- **伪造下行**：往自己或别人的 `down` 主题发布“平台指令”，如果设备侧不验签，就等于控制了设备。结合 Retain 就是 [[iot-mqtt]] 的保留消息投毒。
- **利用授权缓存与会话**：规则改了，但已连接客户端的授权缓存还在，旧会话里的订阅可能仍在生效；对被禁用设备只改数据库不踢连接，攻击者的连接会一直活着。
- **绕过 Broker 打平台**：直接调平台的指令下发 HTTP 接口改 VIN/设备 ID，Broker 的 ACL 再严也没用。
- **打回调接口本身**：如果 `/emqx/authz` 暴露在外、又不校验来源，攻击者可以探测授权逻辑；更糟的是 EMQX 把回调地址配成可被攻击者影响的地址（这属于 SSRF/配置篡改的范畴，见 [[web-ssrf]]）。

## 防御与最佳实践

- **默认拒绝**：`no_match = deny`；删掉或收紧默认 `acl.conf`；HTTP 回调出错或超时时的行为也要确认（以文档为准），不能 fail-open。
- **身份来自认证，主题只能用认证后的身份拼**：ClientID 与证书 CN 绑定；授权规则中的 `{id}` 只取可信身份。
- **精确匹配 + 白名单**：设备禁止通配符订阅；主题精确比较；设备 ID 字符集白名单。
- **上下行分离**：设备只能 pub `up`、sub `down`；平台只能 pub `down`、sub `up`；不给任何业务客户端超级用户。
- **指令链路**：平台 API 做“用户—设备”归属校验和高危指令加固；指令签名 + nonce + 过期时间；全链路审计，指令 ID 贯穿。
- **生效与撤销**：禁用设备时同时踢掉现有连接（EMQX 提供按 ClientID 踢客户端的管理接口/CLI）、加入黑名单、吊销证书；理解授权缓存的 TTL，关键变更后主动踢连接。
- **回调接口加固**：只允许内网 EMQX 访问、校验共享令牌、不记录密码、接口要快且有熔断；把 `AUTHZ_DENY` 接入告警。
- **检测与响应**：频率、授权拒绝、会话接管、重连风暴、异地连接五类信号做基线和告警；动作分级：告警 → 限速 → 封禁 → 吊销。

## 常见误区

- **“有了 mTLS 就不需要 ACL。”** 认证只回答“你是谁”，不回答“你能做什么”。合法设备照样可以订阅 `#`。
- **“默认 acl.conf 已经拦了 `#`，够了。”** 它只拦了少数字面主题，`devices/#`、`+/+/up` 等依然可能放行，且兜底规则通常是全部允许。
- **“用 `startsWith` 判断主题前缀就行。”** 前缀判断会把 `car-0010` 当成 `car-001` 的子资源，必须按层级精确比较。
- **“授权只在 Broker 做。”** 指令多数是从平台 API 发起的，平台 API 的对象级授权同样关键，否则攻击者绕过 Broker 直接让平台替他发指令。
- **“改了数据库里的权限马上生效。”** 授权结果有缓存，已建立的订阅不会自动撤销；需要主动踢连接。
- **“平台账号用超级用户最方便。”** 平台一旦被攻破，攻击者就获得整个 Broker 的读写权。

## 自测

:::details 1. MQTT 主题授权和 Web 的 IDOR 有什么共同点？
本质相同：资源标识由请求方提供（Web 在 URL/参数里如 `/orders/42`，MQTT 在主题路径里如 `devices/car-002/up`），服务端没有验证“该资源属于当前主体”。当前主体在 Web 中来自 Session/Token，在 MQTT 中来自连接认证（如证书 CN）。防御也相同：从可信身份出发逐次校验主体与资源的归属，默认拒绝。区别是 MQTT 有通配符，一次 `#` 订阅就相当于遍历所有 ID。
:::

:::details 2. 设备的标准授权规则是什么？为什么禁止通配符？
设备 `{id}` 只能发布 `devices/{id}/up`（及状态主题），只能订阅 `devices/{id}/down`，`{id}` 取自认证后的可信身份。禁止 `+`、`#` 是因为通配符一次匹配多台设备的主题，一旦放行就是批量越权；设备本身也没有订阅别人主题的业务需要。
:::

:::details 3. 在 EMQX 5.x 的 HTTP 回调配置中，哪些字段名是你定的、哪些是 EMQX 规定的？
请求 `body` 模板中等号左边的键名是你定的，它们就是 Controller 收到的 JSON 字段；等号右边的 `${clientid}`、`${topic}`、`${action}` 等占位符由 EMQX 规定；响应格式（5.x 中 JSON 的 `result` 取 allow/deny/ignore，认证响应可带 `is_superuser`）也由 EMQX 规定。后两者要按所用版本的文档核对，4.x 与 5.x 不兼容。
:::

:::details 4. 为什么主题比较不能用 `startsWith`？
前缀比较会把 `devices/car-0010/down` 当成 `devices/car-001` 开头而放行，造成越权。应按 `/` 分层精确比较，并对设备 ID 做字符集白名单，防止 ClientID 中夹带 `/`、`+`、`#` 改变主题结构。
:::

:::details 5. 禁用了一台设备，为什么它可能还在收消息？
授权结果有缓存，已建立的订阅不会因为数据库改动而自动撤销，现有 TCP 连接也还活着。正确做法是禁用时同时通过 EMQX 管理接口/CLI 踢掉该客户端、加入黑名单并吊销证书，认证回调中也检查禁用状态以阻止重连。
:::

:::details 6. 平台侧指令下发要做哪些安全控制？
在 API 层做“用户—设备”归属的对象级授权；高危指令（解锁、启动、OTA）加二次确认/MFA/频率限制；平台连接 Broker 使用独立且最小权限的身份，不用超级用户；指令带唯一 ID、nonce、过期时间并签名，设备验签防重放；全链路审计谁在何时对哪台设备发了什么指令、结果如何。
:::

:::details 7. 举出三种可以从授权回调和连接事件中发现的异常行为。
授权被拒绝（尤其是通配符或他人主题的订阅），说明在探测越权；同一 ClientID 在不同 IP 间频繁被踢（会话接管），说明身份可能被克隆；单设备发布频率远超基线或大量设备同时掉线重连（重连风暴），可能是被控洪泛、故障或攻击。检测后按告警、限速、封禁、吊销分级处置。
:::

## 一句话总结

MQTT 的授权就是 IoT 版的对象级授权：主题里的设备 ID 必须等于认证出来的身份、精确匹配、默认拒绝、禁止通配符，再加上平台指令的归属校验、签名审计和异常检测，才能保证“设备 A 永远读不到设备 B”。
