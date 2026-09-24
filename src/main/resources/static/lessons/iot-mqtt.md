## 为什么要学

你在工作里用过 MQTT 和 EMQX：设备连上来、上报数据、平台下发指令，能跑就行。但从安全视角看，MQTT 是一个**所有人共享同一条消息总线**的协议：只要 Broker 的认证和授权没配好，任何一个连得上的客户端都可能读到全部设备的数据，甚至冒充平台给车/设备下指令。Web 世界里“越权”要一个接口一个接口地找，MQTT 里一个 `#` 订阅就可能把整个租户看光。

这一课是 S7 IoT Security 的起点，也是**项目③ IoT 安全平台**的第一块砖：用 Docker Compose 起 EMQX，用 Eclipse Paho（Java）写设备模拟器，先把“默认配置下有多危险”亲手复现出来。后面 [[iot-identity]] 解决“你是谁”（一机一证、mTLS），[[iot-acl]] 解决“你能碰哪些主题”（HTTP 回调授权），[[iot-standards]] 把这些做法对齐到行业标准。

你已经会用 MQTT，这是你相对纯 Web 安全从业者的**差异化优势**：大多数 Web 安全工程师没接过设备，大多数 IoT 开发没用攻击者眼光看过 Broker。学完这一课，你应该能：看懂 CONNECT 报文里每个字段的安全含义；说清通配符、Retain、Will、会话接管各自能被怎么滥用；在本机搭出一个可被攻击、也可被加固的 EMQX 实验环境。

:::tip 版本约定
本课以 **MQTT 3.1.1 / 5.0** 和 **EMQX 5.x 开源版**为准。EMQX 5.x 的配置格式（HOCON）和 4.x 差别很大，更新的大版本也可能再变。凡是涉及具体配置项、回调字段的地方，请以你所用版本的 EMQX 官方文档为准，不要照抄网上 4.x 时代的教程。
:::

## 核心概念

### 1. 报文结构与 CONNECT 里的身份字段

每个 MQTT 控制报文都由三部分组成：**固定头**（1 字节报文类型+标志位，加上变长编码的“剩余长度”）、**可变头**、**载荷**。常见类型有 CONNECT、CONNACK、PUBLISH、PUBACK、SUBSCRIBE、SUBACK、PINGREQ、DISCONNECT；MQTT 5.0 还加了 AUTH（用于增强认证）。

```
CONNECT packet (MQTT 3.1.1)
+----------------------------+
| fixed header: 0x10 | len   |
+----------------------------+
| protocol name: "MQTT"      |
| protocol level: 4          |   3.1.1 = 4, 5.0 = 5
| connect flags              |   username / password / will retain / will qos / will / clean session
| keep alive (seconds)       |
+----------------------------+
| payload:                   |
|   ClientID                 |   设备自报的“名字”
|   will topic / will msg    |   仅当 will flag=1
|   username                 |
|   password                 |   任意二进制，可以是密码、Token、签名
+----------------------------+
```

安全上最要紧的三点：

- **ClientID、用户名、密码全部是客户端自己填的**。Broker 不做认证时，它们只是“自我介绍”，和 Web 里前端传的 `userId` 参数一样不可信。
- 在不加 TLS 的 1883 端口上，用户名和密码是**明文**传输的，抓包即得（回忆 [[net-tls]]）。
- MQTT 5.0 在 CONNECT 里增加了 Properties（会话过期时间、最大报文长度、认证方法等），CONNACK 用 Reason Code 精确说明失败原因，比如“用户名或密码错误”“未授权”。

同一个 ClientID 再次连接时，协议规定**服务端必须断开旧连接**（会话接管，Session Takeover）。这是正常特性，却也是“ClientID 抢占攻击”的根源，后面细讲。

### 2. 主题与通配符 `+` / `#`

主题是用 `/` 分层的字符串，如 `devices/car-001/up`。订阅时可以用通配符：

| 通配符 | 含义 | 例子 | 匹配 |
|---|---|---|---|
| `+` | 单层 | `devices/+/up` | 所有设备的上行 |
| `#` | 多层，只能放最后 | `devices/#` | devices 下的一切 |
| `#` 单独使用 | 所有主题 | `#` | 除 `$` 开头以外的全部主题 |

以 `$` 开头的主题（如 `$SYS/...`）不会被 `#` 匹配，EMQX 用 `$SYS/` 发布 Broker 自身的运行信息。通配符**只能用于订阅，不能用于发布**。

**订阅 `#` 意味着什么？** 意味着你成了整个 Broker 的“镜像”：所有设备的上报数据（位置、车速、电量、门锁状态、用户手机号）、平台下发的所有指令（解锁、远程启动、固件 URL）、Will 消息、Retained 消息全部实时流到你面前。它相当于 Web 世界里“一条 SQL 把全表 dump 走”，而且是持续的、实时的。

### 3. QoS、Retain、Will 消息

| 特性 | 作用 | 安全含义 |
|---|---|---|
| QoS 0 | 最多一次，发了就不管 | 丢了不重发；指令不要依赖 QoS 0 |
| QoS 1 | 至少一次，可能重复 | 设备可能收到**重复指令**，指令必须幂等或带唯一 ID |
| QoS 2 | 恰好一次（四次握手） | 只保证 Broker 与客户端之间的一跳，不防恶意重放 |
| Retain | Broker 为该主题保存最后一条消息，新订阅者一订阅就收到 | 被写入一条恶意保留消息后，**之后每个上线的订阅者都会中招**，直到被覆盖或清除 |
| Will | 客户端异常断开时 Broker 代发的“遗言” | 谁能设置 Will、发到哪个主题，同样要受 ACL 约束 |

几个容易记混的细节：

- 清除某主题的保留消息：向该主题发布一条 **retain=1、载荷为空** 的消息。
- QoS 是“投递保证”，**不是安全保证**。QoS 2 的“恰好一次”靠的是报文 ID，攻击者自己再发一条新报文，Broker 当然照单全收。
- Will 常用于上报“设备离线”。如果任意客户端都能以 `devices/car-001/status` 为 Will 主题，就能伪造别人的离线状态。
- MQTT 5.0 有“消息过期间隔”（Message Expiry Interval），可以让保留消息或离线消息过期，对指令类消息很有用。

### 4. EMQX：集群、规则引擎、数据桥接

EMQX 是 Erlang/OTP 写的 MQTT Broker。和安全相关的组件：

```
 devices --MQTT 1883/8883--> +-----------------------+
 web/app --WS 8083/8084----> |  EMQX node            |
                             |  - listeners          |
 admin ---HTTP 18083-------> |  - dashboard/REST API |   管理面，必须内网 + 强口令
                             |  - authn / authz      |   认证、授权链
                             |  - rule engine (SQL)  |   消息过滤/转换
                             |  - data integration   |   写 MySQL/Kafka/HTTP...
                             +-----------+-----------+
                                         | cluster (Erlang distribution + RPC)
                             +-----------+-----------+
                             |  EMQX node 2          |   节点间端口绝不能对公网开放
                             +-----------------------+
```

- **监听器**：默认 1883（MQTT/TCP）、8883（MQTT/SSL）、8083（WebSocket）、8084（WSS），18083 是 Dashboard 和 REST API。
- **集群**：5.x 引入了 core/replicant 架构。节点间通过 Erlang 分布式协议通信，靠一个共享的 **cookie** 互认；cookie 有公开的默认值，拿到 cookie 并能连上节点端口的人等同于拿到了节点控制权。生产环境务必修改 `node.cookie`，并用防火墙隔离节点间端口。
- **规则引擎**：用类 SQL 处理消息，比如 `SELECT clientid, payload.speed AS speed FROM "devices/+/up" WHERE payload.speed > 120`。它运行在 Broker 内部，**能读所有匹配主题的消息**，所以谁能编辑规则，谁就相当于能订阅 `#`。
- **数据桥接 / 数据集成**：把消息转发到 MySQL、Kafka、HTTP 服务等（5.x 后期版本把“数据桥接”重新组织为 Sink/Source 等概念，名称以文档为准）。配置里会保存下游数据库密码，Dashboard 权限要当作“数据库管理员”级别来管。
- **Dashboard**：默认账号是公开的 `admin` / `public`，首次登录必须改；暴露在公网的 18083 是真实世界里常见的入口。

## 动手实践

### 练习：用 Docker 起 EMQX，用 Paho（Java）写设备模拟器

这是项目③的第一个里程碑。在项目外新建一个目录 `iot-lab/`（不要放进 MyNotes 的 `src/`），先写 `docker-compose.yml`：

```yaml
# iot-lab/docker-compose.yml —— 假设 EMQX 5.8.x 开源版
# 具体 tag 请到 Docker Hub 的 emqx/emqx 页面确认
services:
  emqx:
    image: emqx/emqx:5.8.0
    container_name: emqx
    ports:
      - "127.0.0.1:1883:1883"     # MQTT/TCP，只绑本机
      - "127.0.0.1:8883:8883"     # MQTT/SSL，下一课用
      - "127.0.0.1:18083:18083"   # Dashboard
```

```bash
docker compose up -d
docker exec emqx emqx ctl status
```

预期输出类似：

```
Node 'emqx@172.18.0.2' 5.8.0 is started
```

读法：节点名、版本号、`started` 三样都对上，说明 Broker 起来了。浏览器打开 `http://127.0.0.1:18083`，用默认账号登录后会被要求改密码——记住“默认口令是公开的”这件事，后面攻击者视角会用到。端口前面加 `127.0.0.1:` 是和 MyNotes 的 `server.address` 同一个思路：实验环境不对局域网暴露。

接着写模拟器。本课用 **Paho 的 mqttv3 客户端**（`org.eclipse.paho.client.mqttv3`，同时支持 MQTT 3.1.1），因为它在存量项目里最常见、API 最简单；需要 MQTT 5 特性（Reason Code、消息过期）时可以换 `org.eclipse.paho.mqttv5.client`，两者的包名和类名不同，不能混用。

```xml
<dependency>
  <groupId>org.eclipse.paho</groupId>
  <artifactId>org.eclipse.paho.client.mqttv3</artifactId>
  <version>1.2.5</version>
</dependency>
```

```java
import org.eclipse.paho.client.mqttv3.*;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ThreadLocalRandom;

public class DeviceSimulator {
    public static void main(String[] args) throws Exception {
        String deviceId = args.length > 0 ? args[0] : "car-001";
        MqttClient client = new MqttClient("tcp://127.0.0.1:1883", deviceId, new MemoryPersistence());

        MqttConnectOptions opts = new MqttConnectOptions();
        opts.setCleanSession(true);
        opts.setAutomaticReconnect(true);
        opts.setUserName(deviceId);
        opts.setPassword("demo-secret".toCharArray());   // 下一课换成证书
        opts.setWill("devices/" + deviceId + "/status",
                "offline".getBytes(StandardCharsets.UTF_8), 1, true);
        client.connect(opts);

        // 只订阅发给自己的下行主题
        client.subscribe("devices/" + deviceId + "/down", 1, (topic, msg) ->
                System.out.printf("[%s] CMD %s -> %s%n", deviceId, topic,
                        new String(msg.getPayload(), StandardCharsets.UTF_8)));

        client.publish("devices/" + deviceId + "/status",
                "online".getBytes(StandardCharsets.UTF_8), 1, true);

        while (true) {
            int speed = ThreadLocalRandom.current().nextInt(0, 130);
            String json = "{\"speed\":" + speed + ",\"ts\":" + System.currentTimeMillis() + "}";
            client.publish("devices/" + deviceId + "/up", json.getBytes(StandardCharsets.UTF_8), 1, false);
            System.out.println("[" + deviceId + "] UP " + json);
            Thread.sleep(3000);
        }
    }
}
```

开两个终端分别用参数 `car-001`、`car-002` 运行，预期输出：

```
[car-001] UP {"speed":87,"ts":1790000000000}
[car-001] UP {"speed":12,"ts":1790000003000}
```

然后用 mosquitto 的命令行客户端（不想装可以用 `eclipse-mosquitto` 镜像里的 `mosquitto_pub`/`mosquitto_sub`）给 car-001 发条指令：

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -t devices/car-001/down -m '{"cmd":"unlock"}' -q 1
```

car-001 的终端打印 `[car-001] CMD devices/car-001/down -> {"cmd":"unlock"}`。

读法：注意你**没配任何用户名密码**，mosquitto_pub 就把“开锁”指令发进去了；模拟器里填的 `demo-secret` 也根本没人校验。这就是 EMQX 5.x 没有配置任何认证器时的行为：放行所有连接。再执行 `docker exec emqx emqx ctl clients list`，能看到两个设备和刚才的临时客户端，每行都有 clientid、username、peername（来源 IP:端口）等信息，这是排查“谁连进来了”的第一手资料。

## 攻击者视角

> 下面所有操作只能在你自己的实验环境或已获授权的目标上进行。

前提很现实：设备用的 MQTT 地址、端口往往写死在固件里或 App 里，抓包、逆向 APK、拆机读 Flash 都能拿到；很多产线上的 Broker 甚至直接暴露在公网。假设攻击者已经能连上 Broker，以下攻击**在默认无认证配置下全部可行**。

### 1. 订阅 `#`：一次性看光全网

```bash
mosquitto_sub -h <broker> -p 1883 -t '#' -v
```

`-v` 会把主题名一起打印。屏幕上立刻刷出所有设备的上报、所有下行指令。想连内部主题也一起看，再订阅一个 `$SYS/#`，能拿到连接数、订阅数、各类统计，用于摸清规模。这是侦察阶段成本最低、收益最高的一招，对应问题“订阅 `#` 会泄露什么”：**全部业务数据 + 全部控制指令 + Broker 自身运行状态**。

### 2. ClientID 抢占（会话接管）

协议规定同一 ClientID 后连的踢掉先连的。如果 ClientID 可预测（`car-001`、设备序列号、IMEI），攻击者用同样的 ClientID 连上：

```bash
mosquitto_sub -h <broker> -t 'devices/car-001/down' -i car-001
```

真实设备被 Broker 踢下线，攻击者**接管了它的下行主题**，平台发给这台车的解锁、启动指令现在发到了攻击者手里；反过来攻击者也能用这个身份上报伪造数据。这就是 IoT 版的“身份冒用”，根因是 ClientID 既是身份又无需证明。

### 3. 从固件提取“一型一密”共享密钥

很多产品为了省事，**整型号所有设备烧同一个用户名/密码或同一个 HMAC 密钥**（一型一密）。攻击者拆一台设备，`binwalk` 解固件、`strings` 翻字符串，或逆向 App，往往能找到形如 `MQTT_PASS=...` 或用于签名的固定 Secret。拿到后，这个密钥对**该型号所有设备**都有效——买一台、破一台，等于拿到全网通行证。这正是 [[iot-identity]] 要用“一机一密 / 一机一证”解决的问题。

### 4. 指令重放

抓到平台下发的一条 `{"cmd":"unlock"}`（哪怕是密文，只要不带时效和签名），原样再发一遍，锁又开一次：

```bash
mosquitto_pub -h <broker> -t devices/car-001/down -m '{"cmd":"unlock"}'
```

QoS 2 也拦不住，因为这是一条全新报文。防御靠**应用层**：指令带 nonce/时间戳 + 服务端签名，设备侧校验并拒绝重复或过期的 nonce。

### 5. 保留消息投毒

向一个下行主题写入带 retain 的恶意指令：

```bash
mosquitto_pub -h <broker> -t devices/car-001/down -m '{"cmd":"unlock"}' -r -q 1
```

`-r` 让 Broker 把它**保存**下来。以后 car-001 每次上线、一订阅 `devices/car-001/down`，就立刻收到这条“开锁”。一次投毒，长期生效，且很隐蔽。清除要发一条空的 retain 消息：`mosquitto_pub -t devices/car-001/down -r -n`（`-n` 表示空载荷）。

## 防御与最佳实践

这一课先建立“该做什么”的清单，具体实现分别在后两课落地：

- **关闭匿名、强制认证**。EMQX 5.x 里通过配置认证器（authenticator）实现；没有匹配的认证器时的默认动作（放行还是拒绝）由配置决定，务必显式设成拒绝。生产环境用 mTLS 证书认证（见 [[iot-identity]]）或 HTTP 回调（见 [[iot-acl]]）。
- **一机一密 / 一机一证**，杜绝一型一密的共享密钥。密钥/私钥存进安全芯片，不落明文 Flash。
- **主题级授权（ACL）**：设备只能 `pub devices/{自己}/up`、只能 `sub devices/{自己}/down`，禁止任何设备订阅 `#` 或 `+`。这是防住上面 1、2、5 的根本手段。
- **绑定 ClientID 与身份**：用证书 CN 或认证返回的身份约束允许使用的 ClientID，让别人无法用你的 ClientID 抢占。
- **指令加签名 + 时效**：nonce/时间戳 + 服务端签名，设备侧校验，防重放（第 4 招）。
- **谨慎使用 Retain**：下行指令类主题原则上不用 retain；确需使用时，下发新指令前先清旧的。
- **管理面加固**：Dashboard/REST（18083）改默认口令、只开内网；集群节点端口和 `node.cookie` 严格隔离；数据桥接里的下游凭据当机密管理。
- **可观测**：用 `emqx ctl clients list`、`$SYS/` 主题、审计日志监控异常连接；异常行为检测（频率、非常规主题、重连风暴）在 [[iot-acl]] 展开。

在你熟悉的 Java 平台侧，把“设备接入”想成和“用户登录”同构：CONNECT ≈ 登录，主题 ≈ 资源，ACL ≈ 接口鉴权，指令签名 ≈ 防篡改/防重放。你在 [[ss-authz]] 学的对象级授权思想，直接可以搬过来。

## 常见误区

- **“上了 TLS 就安全了。”** TLS 只保证传输加密和服务端身份（回忆 [[net-tls]]）。它不认识“设备是谁”，也不管“这个设备能不能订阅这个主题”。认证和授权是另外两件事。
- **“用户名密码填了就等于认证了。”** 只有当 Broker 配置了认证器去校验它，它才有意义；EMQX 默认不校验。模拟器里那句 `demo-secret` 就是摆设。
- **“QoS 2 恰好一次，能防重放。”** QoS 只在协议一跳内去重同一报文 ID，防不了攻击者构造的新报文。防重放是应用层的事。
- **“内网 Broker 不用认证。”** 一旦有一台设备被攻陷、或办公网与设备网没隔离，内网就是攻击者的主场；`#` 一订，全网皆知。
- **“Retain 只是个缓存，无所谓。”** 它会把一条消息“钉”在主题上影响所有未来订阅者，是投毒的绝佳载体。
- **“ClientID 随便填。”** 可预测且不受约束的 ClientID 直接导致会话接管。

## 自测

:::details 1. 如果任何客户端都能订阅 `#`，会泄露什么？
会泄露**几乎一切**：所有设备的上报数据（位置、车速、电量、门锁状态，可能含手机号等个人信息）、平台下发的所有控制指令（解锁、远程启动、固件下载 URL）、各设备的 Will/Retained 消息。若再订阅 `$SYS/#`，还能拿到 Broker 的连接数、订阅数等运行统计，用于摸清系统规模。等价于对整个消息总线做了一次持续、实时的“全量导出”，是侦察阶段成本最低的一招。防御是 ACL 禁止设备使用通配符订阅，只允许订阅自己的下行主题。
:::

:::details 2. CONNECT 报文里的 ClientID、用户名、密码可信吗？
不可信，它们全是客户端自己填的“自我介绍”，和 Web 前端传的 `userId` 参数性质相同。只有当 Broker 配置了认证器去校验，用户名/密码才有意义；EMQX 默认不校验就直接放行。在明文 1883 端口上它们还会被抓包截获。真正的设备身份要靠 mTLS 证书或服务端回调认证来确立。
:::

:::details 3. 为什么“ClientID 抢占”能接管一台设备？
MQTT 协议规定同一个 ClientID 后连接的会话必须踢掉先连接的（会话接管）。如果 ClientID 可预测（序列号、IMEI 等）且不受身份约束，攻击者用相同 ClientID 连上，就把真实设备挤下线，并接管它的下行主题——平台发给该设备的指令转而到达攻击者，攻击者也能以该身份伪造上报。防御是把允许使用的 ClientID 与认证身份（如证书 CN）绑定。
:::

:::details 4. QoS 2 的“恰好一次”能防止指令重放吗？
不能。QoS 2 只保证在“Broker↔某客户端”这一跳内，同一个报文 ID 不被重复投递。攻击者抓到指令后构造并发送一条**全新报文**，Broker 会当作正常新消息处理。防重放必须在应用层：指令携带 nonce/时间戳并由服务端签名，设备侧校验签名、拒绝过期或重复的 nonce。
:::

:::details 5. Retain 消息为什么危险？
Broker 会为带 retain 标志的主题保存最后一条消息，任何**新订阅者一订阅就立即收到它**。攻击者向下行指令主题写入一条带 retain 的恶意指令（如开锁），此后该设备每次上线订阅都会中招，一次投毒长期生效且隐蔽。清除方法是向该主题发布一条 retain=1、载荷为空的消息。最佳实践是指令类主题不用 retain。
:::

:::details 6. 一型一密和一机一密，被拆机提取密钥后的影响差别？
一型一密整个型号共享同一密钥，攻击者破解一台即可冒充**该型号全部设备**，影响是全网级的；一机一密每台独立，破一台只影响一台，且可单独吊销。这正是从固件里 `strings`/逆向就能提取共享密钥这类攻击的根因，解决办法是一机一密乃至一机一证，并把密钥存入安全芯片。详见 [[iot-identity]]。
:::

:::details 7. EMQX 的 Dashboard 和集群通信为什么要重点加固？
Dashboard/REST API（18083）默认账号口令是公开的 `admin`/`public`，暴露公网就是现成入口；它能编辑规则引擎和数据桥接，而规则引擎能读所有匹配主题的消息（等价于订阅 `#`），数据桥接里还存着下游数据库凭据。集群节点间用 Erlang 分布式协议 + 共享 cookie 互认，cookie 默认值公开，拿到即等于节点控制权。所以管理面要改默认口令、只开内网，节点端口和 `node.cookie` 严格隔离。
:::

## 一句话总结

MQTT 是一条所有设备共享的消息总线，它的每个特性——ClientID、通配符、QoS、Retain、Will——都对应一种滥用方式，而 Broker 默认不认证、不授权，所以安全的全部重量都压在你后面要做的**认证（你是谁）**和**授权（你能碰哪些主题）**上。
