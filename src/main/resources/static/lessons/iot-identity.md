## 为什么要学

上一课 [[iot-mqtt]] 里你已经看到：Broker 默认谁都能连，ClientID、用户名、密码全是客户端自报的，抓包或拆机就能拿到。所有攻击的第一步都是“连得上、且冒充得了别人”。这一课解决的就是第一个根本问题——**设备身份**：怎么让每一台设备有一个独立、可证明、可吊销的身份，让攻击者拆掉一台也波及不到第二台。

这是从“能用”到“安全”的分水岭，也是**项目③**的核心里程碑“一机一证 + mTLS”。你会用 openssl 自己搭一个私有 CA，给每台模拟设备签一张证书，给 EMQX 开 8883 双向 TLS（mTLS），让没有合法证书的连接在 TLS 握手阶段就被拒之门外——比到应用层再判断更早、更彻底。

对你这个背景（做过汽车/IoT、用过 MQTT）来说，这一课把你已有的“设备接入”经验补上关键一环。学完你应该能：说清一型一密、一机一密、一机一证的区别和影响面；解释 TLS 单向认证和 mTLS 的差别；用 openssl 建 CA 并签发/吊销设备证书；给 EMQX 配 mTLS 并验证无证书连不上；讲清楚为什么私钥必须存在安全芯片里而不是普通 Flash。

:::tip 版本约定
本课的 EMQX 配置以 **EMQX 5.x 开源版**为准，其监听器和 TLS 配置用 HOCON 格式，和 4.x 差别大。具体配置项名称（如证书路径、`verify`、`fail_if_no_peer_cert` 等的确切写法）请以你所用版本的 EMQX 官方文档为准，本课给出的是结构和思路，不要把示例字段名当成一定正确。
:::

## 核心概念

### 1. 一型一密 vs 一机一密 vs 一机一证

| 方案 | 做法 | 优点 | 缺点 / 被拆机后的影响 |
|---|---|---|---|
| 一型一密 | 同一型号所有设备烧同一个密钥（或产品密钥），首次上线再“动态注册”换取设备密钥 | 产线最省事，无需逐台烧录 | 拆一台即拿到全型号共享密钥，可冒充或批量注册该型号任意设备 |
| 一机一密 | 每台设备一个独立密钥（常用于 HMAC 签名生成 MQTT 密码） | 影响面缩到单台，可单独禁用 | 平台需保存每台的密钥（对称密钥两端都有），平台库泄露即全部泄露 |
| 一机一证 | 每台设备一对非对称密钥 + CA 签发的证书 | 平台只存公钥/证书，私钥不出设备；可用 CRL/OCSP 吊销；TLS 握手阶段即认证 | 要建 PKI、管理签发、轮换、吊销；设备需有能力做非对称运算 |

**问题：一型一密的设备被拆机提取密钥后，影响范围有多大？** 答：**整个型号**。攻击者从一台设备的固件中取出共享密钥后，可以：冒充同型号任何设备（只要猜到或枚举到其 ClientID/序列号）；如果平台支持“凭产品密钥动态注册”，还能批量注册伪造设备、抢注尚未激活的真实设备身份。而且你**无法只吊销那一台**——吊销共享密钥等于让全型号设备同时掉线，只能靠 OTA 全量换密钥。已出厂的百万台设备都是同一个“单点”。一机一密/一机一证把爆炸半径缩到单台，被拆的那台直接拉黑即可。

### 2. MQTT over TLS 与 mTLS 双向认证

```
one-way TLS (server auth only)
device                    broker
  |-- ClientHello ---------->|
  |<- ServerHello -----------|
  |<- server cert -----------|   设备用 CA 校验服务端
  |== MQTT CONNECT (user/pw)>|   设备身份仍靠用户名密码

mTLS (mutual)
device                    broker
  |-- ClientHello ---------->|
  |<- ServerHello -----------|
  |<- server cert -----------|   设备校验服务端
  |<- CertificateRequest ----|   服务端要求客户端证书
  |-- client cert ---------->|   Broker 用 CA 校验设备证书
  |-- CertificateVerify ---->|   用私钥签名，证明持有私钥
  |== MQTT CONNECT =========>|   设备身份 = 证书
```

- **单向 TLS**（8883 + 服务端证书）：防窃听、防中间人，设备知道自己连的是真 Broker；但 Broker 不知道设备是谁，身份仍靠 CONNECT 里的用户名密码。
- **mTLS**：Broker 同时要求客户端出示证书，并用受信 CA 校验。设备还必须用私钥签 `CertificateVerify`，证明“证书是我的”——**只偷到证书没用，必须偷到私钥**。没有合法证书的连接在 TLS 握手阶段就失败，连 CONNECT 都发不出来。
- 证书里的 **CN（或 SAN）** 可以作为设备 ID，再要求 MQTT 的 ClientID 必须等于它，就堵住了上一课的 ClientID 抢占。

### 3. 设备证书的签发、轮换与吊销

一套最小可用的设备 PKI：

```
Root CA (offline, long-lived)           根 CA 离线保存，只用来签中间 CA
   |
   +-- Device Issuing CA (online)       在线签发设备证书，泄露可单独吊销
   |      +-- device cert CN=car-001
   |      +-- device cert CN=car-002
   |
   +-- Server CA / server cert          Broker 的服务端证书，SAN 写域名
```

- **签发**：最佳做法是**密钥在设备内生成**（最好在安全芯片里），设备只把 CSR（证书签名请求，含公钥）交给产线或平台，CA 签好证书写回设备。私钥从头到尾不离开设备。反面做法是“服务器统一生成私钥再烧进去”，那样私钥在产线系统里走过一遭，泄露面大得多。
- **证书内容**：CN 写设备 ID；扩展密钥用途 `extendedKeyUsage=clientAuth`，这样这张证书不能被拿去冒充服务端；有效期不宜过长，按设备的轮换能力定。
- **轮换**：证书到期前，设备用现有身份（旧证书建立的 mTLS 连接）申请新证书，平台签发后设备切换。要提前轮换、留出重试窗口；否则一批设备同一天到期同一天掉线。CA 本身也要有轮换计划：新旧 CA 并存一段时间（Broker 同时信任两者）。
- **吊销**：设备被盗、被拆、退役时要能让它的证书立刻失效。两种标准手段：**CRL**（CA 发布“已吊销证书序列号列表”，Broker 定期拉取比对）和 **OCSP**（实时查询某张证书状态，OCSP Stapling 由服务端代为附上查询结果）。EMQX 5.x 的 SSL 监听器支持 CRL 检查和 OCSP Stapling，具体配置项和支持版本请查官方文档。
- **应用层兜底**：即使 CRL 更新有延迟，平台也可以在认证回调里维护一张“设备黑名单/状态表”，发现被禁用的设备 ID 直接拒绝（见 [[iot-acl]] 的 HTTP 回调）。

### 4. 安全存储：TPM / 安全芯片 / TEE

一机一证的安全性 = 私钥的安全性。私钥如果以文件形式放在 Flash 里，攻击者拆机读 Flash 照样拿走，一机一证就退化成“拆一台冒充一台”。

| 方案 | 是什么 | 典型场景 |
|---|---|---|
| 安全芯片 / Secure Element（SE） | 独立的防篡改芯片，私钥在芯片内生成、签名在芯片内完成，**私钥永不导出** | 物联网模组、车载 T-Box、银行卡、eSIM |
| TPM | 可信平台模块，按 TCG 规范设计的安全芯片，提供密钥存储、签名、度量启动 | PC、服务器、部分工控/网关 |
| TEE | 主处理器上隔离出的安全执行环境（如 ARM TrustZone），密钥和敏感运算在“安全世界”里 | 手机、车机、较高端的 IoT SoC |

共同思想：**应用代码只能“请芯片签名”，拿不到私钥本身**。攻击者即使拿到设备 root 权限，最多能在设备在手时借用签名能力，而无法把私钥带走批量复制。配合“设备丢失 → 吊销证书”，风险就被限制在单台、有限时间内。

## 动手实践

### 练习：给 EMQX 配置 mTLS，用私有 CA 为每个模拟设备签发证书

继续使用上一课的 `iot-lab/` 目录。建议用 **OpenSSL 3**（macOS 自带的 `openssl` 其实是 LibreSSL，部分参数不同，可 `brew install openssl@3` 后用它的完整路径）。实验里为简化只建一级 CA，生产环境应按上面的图分根 CA 和签发 CA。

**第 1 步：私有 CA**

```bash
mkdir -p certs && cd certs
openssl req -x509 -new -newkey rsa:2048 -nodes -sha256 -days 3650 \
  -keyout ca.key -out ca.crt -subj "/CN=IoT Lab Root CA"
```

**第 2 步：Broker 服务端证书（SAN 必须包含设备连接时用的主机名）**

```bash
openssl req -new -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=emqx"
printf "subjectAltName=DNS:localhost,DNS:emqx,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n" > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -sha256 -out server.crt -extfile server.ext
```

**第 3 步：一机一证**

```bash
printf "extendedKeyUsage=clientAuth\n" > client.ext
for id in car-001 car-002; do
  openssl req -new -newkey rsa:2048 -nodes -keyout $id.key -out $id.csr -subj "/CN=$id"
  openssl x509 -req -in $id.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -days 365 -sha256 -out $id.crt -extfile client.ext
done
openssl verify -CAfile ca.crt car-001.crt
openssl x509 -in car-001.crt -noout -subject -issuer -enddate -ext extendedKeyUsage
```

预期输出类似：

```
car-001.crt: OK
subject=CN=car-001
issuer=CN=IoT Lab Root CA
notAfter=Sep 24 08:00:00 2027 GMT
X509v3 Extended Key Usage:
    TLS Web Client Authentication
```

读法：`OK` 表示证书链能追溯到你的 CA；subject 的 CN 就是设备 ID；EKU 只有 Client Authentication，说明它不能被拿去当服务端证书。这里为了演示在电脑上生成了设备私钥，真实产线应在设备安全芯片内生成密钥、只导出 CSR。`ca.key` 是整套体系的命根子，实验结束后也别随手提交到 Git。

**第 4 步：EMQX 开启 8883 双向认证**

EMQX 5.x 支持用 `EMQX_` 前缀的环境变量覆盖 HOCON 配置，层级用双下划线 `__` 分隔。下面的变量对应配置里的 `listeners.ssl.default.ssl_options.*`，以 EMQX 5.8 为假设，**请在你版本的文档“开启 SSL/TLS 连接”一节核对字段名**：

```yaml
services:
  emqx:
    image: emqx/emqx:5.8.0
    container_name: emqx
    ports:
      - "127.0.0.1:1883:1883"
      - "127.0.0.1:8883:8883"
      - "127.0.0.1:18083:18083"
    volumes:
      - ./certs:/opt/emqx/etc/lab-certs:ro
    environment:
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CACERTFILE: /opt/emqx/etc/lab-certs/ca.crt
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__CERTFILE: /opt/emqx/etc/lab-certs/server.crt
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__KEYFILE: /opt/emqx/etc/lab-certs/server.key
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__VERIFY: verify_peer
      EMQX_LISTENERS__SSL__DEFAULT__SSL_OPTIONS__FAIL_IF_NO_PEER_CERT: "true"
```

`verify_peer` 让 Broker 校验客户端证书，`fail_if_no_peer_cert` 让“不带证书”的客户端直接握手失败——只设前者而漏掉后者，不带证书的客户端仍可能连进来，这是常见的配置坑。容器内 EMQX 以非 root 用户运行，若启动报读不到 `server.key`，检查文件权限。生产环境还应关闭 1883 明文监听器，本实验暂时保留作对比。

```bash
docker compose up -d --force-recreate
docker exec emqx emqx ctl listeners
```

输出里 `ssl:default` 一段应显示 `running : true` 和 `listen_on : 0.0.0.0:8883`（格式因版本略有不同）。

**第 5 步：验证有证书能连、没证书连不上**

```bash
# 有证书
openssl s_client -connect 127.0.0.1:8883 -CAfile ca.crt -cert car-001.crt -key car-001.key </dev/null 2>/dev/null | grep "Verify return code"
mosquitto_sub -h 127.0.0.1 -p 8883 --cafile ca.crt --cert car-001.crt --key car-001.key -i car-001 -t 'devices/car-001/down' -d
# 没证书
mosquitto_sub -h 127.0.0.1 -p 8883 --cafile ca.crt -t 'devices/car-001/down' -d
```

预期：第一条输出 `Verify return code: 0 (ok)`；第二条的 `-d` 调试输出里能看到 `Client car-001 sending CONNECT`、`received CONNACK (0)`、`sending SUBSCRIBE`，然后挂起等待消息；第三条失败，错误文字随版本不同，常见的是 TLS 告警 `certificate required` 或 `Connection lost`。

读法：`Verify return code: 0` 是**客户端**对服务端证书的校验结果（SAN 匹配、链可信）；而第三条失败说明**服务端**拒绝了没有客户端证书的连接——在 MQTT 层之前，攻击者连 CONNECT 都发不出去，上一课的“匿名订阅 `#`”在 8883 上已经不成立了。

**第 6 步：Paho 模拟器改用证书**

先把设备证书+私钥打成 PKCS#12，把 CA 放进信任库：

```bash
openssl pkcs12 -export -in car-001.crt -inkey car-001.key -certfile ca.crt \
  -name car-001 -out car-001.p12 -passout pass:changeit
keytool -importcert -noprompt -alias iot-ca -file ca.crt \
  -keystore truststore.p12 -storetype PKCS12 -storepass changeit
```

模拟器仍用 **Paho mqttv3**，只需把连接地址换成 `ssl://`，再给它一个 SSLSocketFactory：

```java
import javax.net.ssl.*;
import java.io.FileInputStream;
import java.security.KeyStore;

static SSLSocketFactory mtlsFactory(String p12, String trust, char[] pwd) throws Exception {
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (var in = new FileInputStream(p12)) { ks.load(in, pwd); }
    KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    kmf.init(ks, pwd);

    KeyStore ts = KeyStore.getInstance("PKCS12");
    try (var in = new FileInputStream(trust)) { ts.load(in, pwd); }
    TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    tmf.init(ts);

    SSLContext ctx = SSLContext.getInstance("TLS");
    ctx.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
    return ctx.getSocketFactory();
}

// main 里：
MqttClient client = new MqttClient("ssl://localhost:8883", deviceId, new MemoryPersistence());
MqttConnectOptions opts = new MqttConnectOptions();
opts.setSocketFactory(mtlsFactory("certs/" + deviceId + ".p12", "certs/truststore.p12", "changeit".toCharArray()));
opts.setHttpsHostnameVerificationEnabled(true);   // 校验服务端证书 SAN
```

预期：`car-001` 正常连上并开始打印 `UP ...`。故意让 car-002 加载 car-001.p12 会怎样？在只有 mTLS 的情况下**能连上**——Broker 只知道“这是 CA 签过的合法设备”，还不会检查 ClientID 是否等于证书 CN。这个缺口留给 [[iot-acl]]：在 HTTP 认证回调里拿到证书 CN（EMQX 5.x 提供证书相关占位符，名称以文档为准），要求 `clientid == CN`。

读法：`setHttpsHostnameVerificationEnabled(true)` 很关键，关掉它等于不校验“我连的是不是真的 Broker”，和 Java 里信任所有证书的 `TrustManager` 一样是中间人漏洞的温床。

**第 7 步（选做）：吊销一台设备**

用 `openssl ca` 维护一个简易 CA 数据库后，执行 `openssl ca -revoke car-002.crt` 再 `openssl ca -gencrl -out ca.crl`，把 CRL 配给 EMQX 的 SSL 监听器（CRL 检查的配置项见文档）。重连后 car-002 应握手失败，car-001 不受影响。这正是“一机一证可单独吊销”的价值。`openssl ca` 需要一份 CA 配置文件，这一步留给你照着 OpenSSL 文档自己搭，是很好的练习。

## 攻击者视角

> 以下思路只用于你自己的实验环境或已获授权的目标。

攻击者面对设备身份，核心问题只有一个：**能不能拿到一份“可以冒充别人”的凭据，以及它能冒充多少台**。

- **提取一型一密共享密钥**：拿一台设备，从固件（`binwalk` 解包、`strings` 搜 `mqtt`/`secret`/`key`）、调试串口、App 逆向里找共享密钥或产品密钥。一型一密下拿到即可冒充整个型号；若平台允许“凭产品密钥动态注册”，还能批量造假设备、抢注未激活设备。
- **偷设备私钥文件**：一机一证但私钥明文放在文件系统里（如 `/etc/certs/device.key`），拿到 root 或读出 Flash 就能复制这台设备的身份。影响限于单台，但若平台不校验 ClientID 与 CN 的对应，攻击者可以**用这一张合法证书去连任意 ClientID**，把单台失陷放大成全网冒充。
- **找不校验证书的一方**：设备端 `TrustManager` 信任一切、或关了主机名校验，攻击者在 Wi-Fi/基站层面做中间人，伪造 Broker 下发指令、收集设备凭据。服务端 `verify_none` 或漏配 `fail_if_no_peer_cert`，则 mTLS 形同虚设。
- **利用吊销缺失**：设备丢了、员工离职带走了测试设备、退役设备流到二手市场，如果平台根本没有吊销机制（不查 CRL/OCSP，也没有设备黑名单），这些证书在有效期内一直可用。
- **攻 CA 本身**：签发 CA 的私钥放在一台普通服务器上、签发接口没有鉴权，攻击者就能给自己签“任意设备”的证书——这比偷一台设备的私钥严重得多。

## 防御与最佳实践

- **一机一证优先，至少一机一密**；彻底淘汰一型一密，存量产品若依赖它，确保“动态注册”只能对未激活设备用一次，注册后设备密钥与序列号绑定。
- **私钥在安全芯片/TEE 中生成且不可导出**，产线只处理 CSR；没有安全芯片的低端设备，至少做到私钥加密存储、关闭调试口、固件加密。
- **Broker 端**：8883 开 `verify_peer` + `fail_if_no_peer_cert`，关闭 1883 明文；只信任设备签发 CA，不要把公共 CA 放进设备信任链。
- **身份绑定**：ClientID 必须等于证书 CN（或从证书派生），在认证回调中强制检查，并在授权中只按“已认证的身份”而非客户端自报的字段做判断。
- **设备端**：固定（pin）平台 CA，开启主机名校验，绝不用“信任所有证书”的实现。
- **全生命周期**：短有效期 + 自动轮换；CRL/OCSP 或平台黑名单支持即时吊销；根 CA 离线，签发 CA 放在 HSM/云 KMS 中，签发接口强鉴权并审计每一次签发。
- **检测**：同一证书/同一设备 ID 在多个 IP 同时或频繁交替上线（会话接管风暴），往往意味着身份被克隆，要告警。

## 常见误区

- **“上了 8883 就是双向认证了。”** 8883 只是 TLS 端口；只有服务端证书的是单向 TLS，Broker 仍不知道设备是谁。必须显式开启客户端证书校验。
- **“配了 verify_peer 就够了。”** 还要配置“没有客户端证书就拒绝”（EMQX 中为 `fail_if_no_peer_cert` 一类选项），否则不带证书的客户端可能照样连进来。
- **“有了证书，ClientID 就可信了。”** 证书证明的是“这是某台合法设备”，ClientID 仍是客户端自报的。不把两者绑定，偷到一张证书就能冒充任意 ClientID。
- **“一机一密就一定比一型一密安全。”** 如果平台用同一个主密钥派生所有设备密钥，而主密钥又在设备里或平台上保管不善，本质上还是一把钥匙。
- **“私钥加个密码放 Flash 就行。”** 解密私钥的密码也得存在设备上，拆机一样能拿到。真正的保护是私钥不可导出的硬件。
- **“证书有效期设 20 年最省事。”** 省的是签发，赔的是失控：没有轮换能力、吊销再不健全，泄露的证书就是一张 20 年通行证。

## 自测

:::details 1. 一型一密的设备被拆机提取密钥后，影响范围有多大？
影响**整个型号**的所有设备。攻击者拿到共享密钥后可冒充该型号任何设备（知道或枚举到其 ClientID/序列号即可）；平台若支持凭产品密钥动态注册，还能批量伪造或抢注设备。且无法只吊销被拆的那一台——撤销共享密钥会让全型号同时掉线，只能 OTA 全量换密钥。一机一密/一机一证把影响缩到单台，单独拉黑即可。
:::

:::details 2. 单向 TLS 和 mTLS 的区别是什么？
单向 TLS 只有服务端出示证书，设备确认自己连的是真 Broker，防窃听和中间人，但 Broker 不知道设备是谁，身份仍靠用户名密码。mTLS 中服务端还会发 CertificateRequest，设备出示由受信 CA 签发的证书并用私钥签名 CertificateVerify 证明持有私钥；没有合法证书的连接在 TLS 握手阶段就失败，连 MQTT CONNECT 都发不出。
:::

:::details 3. 为什么设备私钥最好在设备内生成、只导出 CSR？
这样私钥从生成到使用都不离开设备（最好不离开安全芯片），产线和平台只接触公钥与证书。若由服务器统一生成私钥再烧录，私钥会经过产线系统、网络和存储，任何一环泄露都会批量泄露设备身份。
:::

:::details 4. CRL 和 OCSP 分别是什么？为什么还要应用层黑名单？
CRL 是 CA 发布的已吊销证书序列号列表，Broker 定期获取并比对；OCSP 是实时查询单张证书状态的协议，OCSP Stapling 由服务端附带查询结果。二者都有更新周期或可用性问题，应用层在认证回调中维护设备状态表/黑名单，可以做到即时禁用，作为兜底。
:::

:::details 5. 安全芯片（SE）、TPM、TEE 在设备身份中起什么作用？
它们提供受保护的密钥存储与运算：私钥在其中生成、签名在其中完成、私钥不可导出。应用代码只能“请它签名”，攻击者即使拿到 root 也只能在设备在手时借用签名能力，无法把私钥复制走批量冒充。SE 是独立防篡改芯片，TPM 是按 TCG 规范的安全芯片，TEE 是主处理器上隔离出的安全执行环境（如 TrustZone）。
:::

:::details 6. 只配了 mTLS，car-002 用 car-001 的证书能连上吗？怎么堵住？
能连上，因为 Broker 只校验“证书由受信 CA 签发”，不校验 ClientID 与证书的对应关系。要在认证环节（如 EMQX 的 HTTP 认证回调，或把证书 CN 映射为 ClientID/用户名的选项）强制 `clientid == 证书 CN`，并且授权只基于已认证的身份。这在 [[iot-acl]] 中实现。
:::

:::details 7. 设备端代码里哪些写法会让 TLS 形同虚设？
自定义一个信任所有证书的 TrustManager、关闭主机名校验（如 Paho 的 `setHttpsHostnameVerificationEnabled(false)`）、把公共 CA 全部放进信任库而非只信任平台 CA。这些都会让中间人可以伪造 Broker。
:::

## 一句话总结

设备身份的目标是“一台一个、可证明、可吊销”：一机一证 + mTLS 让没有合法证书的连接在握手阶段就出局，私钥放进安全芯片让拆机也带不走，再把 ClientID 绑定到证书 CN，拆一台就只丢一台。
