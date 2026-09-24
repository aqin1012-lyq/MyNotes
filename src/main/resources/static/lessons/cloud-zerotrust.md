## 为什么要学

你做过的车联网和电商系统，大概率是这样的：外网入口有 Nginx + HTTPS，进了内网之后，服务之间用 HTTP 明文互调，Feign 调用不带任何认证，“反正都在 VPC 里”。MySQL、Redis、EMQX 的管理端口对整个内网开放。这就是经典的**边界安全模型**：外面是敌人，里面都是自己人。它的问题是：攻击者只要突破一个点（一个有 RCE 的旧服务、一台员工电脑、一个 SSRF），就站到了“自己人”的位置上，可以横向移动到任何地方。

**零信任**（Zero Trust）把默认假设反过来：**网络位置不代表可信，每一次访问都要验证身份、验证权限**。落到后端工程上，最核心的技术就是 **PKI + mTLS**（服务之间互相出示证书）以及 **API Gateway / 身份感知代理**（每个请求都经过统一的鉴权与策略执行点）。

这一课承接 [[net-tls]]（TLS 握手与证书校验）和 [[ss-token]]（应用层令牌），并为后面的 [[iot-identity]] 打基础：IoT 设备用 X.509 证书连 MQTT 本质上就是 mTLS。学完后你能：自己搭一个私有 CA、签发服务证书；给两个 Spring Boot 服务配置双向 TLS；说清零信任的原则和架构组件；理解 Istio 如何自动完成这一切。

:::tip 环境约定
openssl 命令在 OpenSSL 3.x 上验证过（1.1.1 基本相同）。Spring Boot 配置使用 SSL Bundle（Spring Boot 3.1 引入，4.x 延续）。
:::

## 核心概念

### 1. PKI：CA 层级、证书签发、吊销（CRL / OCSP）

**PKI**（公钥基础设施）回答一个问题：“我怎么相信这个公钥真的属于 order-service？”答案是：由一个双方都信任的 **CA**（证书颁发机构）用自己的私钥对“身份 + 公钥”签名，得到**证书**。

**CA 层级**：

```
 Root CA (offline, 10y)          根 CA：私钥离线保存，只签中间 CA
   |
   +-- Intermediate CA (1-5y)    中间 CA：日常签发，泄露了可由根 CA 吊销
         |
         +-- inventory-service.crt (days~1y)   叶子证书：服务端
         +-- order-service.crt     (days~1y)   叶子证书：客户端
```

信任锚是根证书：客户端的信任库里只放根 CA 证书；服务端握手时发送“叶子证书 + 中间证书”组成的链，客户端逐级验证签名直到信任的根。

**证书签发流程**：服务自己生成私钥（私钥**永远不离开**服务）→ 用私钥生成 CSR（证书签名请求，含公钥和申请的名字）→ CA 审核后签发证书。证书里需要关注的字段：

| 字段 | 作用 |
|---|---|
| Subject / SAN | 身份。主机名校验看的是 SAN（Subject Alternative Name），不是 CN |
| Validity | 有效期。服务证书越短越好（Istio 默认以小时计的量级自动轮换） |
| Basic Constraints | `CA:TRUE` 才能签发下级证书；叶子证书必须是 `CA:FALSE` |
| Key Usage / Extended Key Usage | 用途限制：`serverAuth`（TLS 服务端）、`clientAuth`（TLS 客户端） |

**吊销**：私钥泄露了，证书还没到期怎么办？

- **CRL**（证书吊销列表）：CA 定期发布一份被吊销证书序列号的列表，验证方下载后比对。缺点是列表会变大、有更新延迟。
- **OCSP**：验证方实时向 CA 的 OCSP 响应器询问“这张证书还有效吗”。缺点是增加延迟、暴露访问隐私、响应器不可用时怎么办（很多客户端默认“软失败”即放行）。**OCSP Stapling** 让服务端预先取好 OCSP 响应在握手中一起发送。

实践中，内部服务网格更倾向于**短期证书**（几小时到几天）：与其费力吊销，不如让它很快自然过期。

### 2. 零信任的核心原则（NIST SP 800-207）

NIST SP 800-207 把零信任概括为若干原则（tenets），用自己的话归纳：

1. 所有数据源和计算服务都视为**资源**（包括 IoT 设备、员工自带设备）。
2. **无论网络位置如何，所有通信都要保护**：内网流量同样加密、认证。
3. 对资源的访问**按会话授予**，授权前先认证，且只授予完成任务所需的最小权限。
4. 访问由**动态策略**决定：身份、设备状态、行为、时间、位置等属性共同参与判断。
5. 持续监测和度量所有自有资产的完整性和安全状态。
6. 认证和授权是**动态的、严格执行的**，在允许访问之前完成，并持续重新评估。
7. 尽可能收集资产、网络、通信的状态信息，用来持续改进安全态势。

架构上的三个逻辑组件：

```
 subject --request--> [ PEP ] ------------> resource      PEP：策略执行点（网关/代理/sidecar）
                        |  ^
                ask     v  | allow/deny
                     [ PA ] <--> [ PE ]  <-- signals       PA：策略管理器  PE：策略引擎
                                   ^         (IAM, device, SIEM, threat intel)
```

- **PE**（Policy Engine）：做决定；**PA**（Policy Administrator）：把决定下发给执行点（例如发会话凭证）；**PEP**（Policy Enforcement Point）：真正放行或阻断的地方。

在你的 Spring 世界里：API Gateway 或 sidecar 是 PEP；策略决策服务（如 OPA）承担 PE 的角色，签发短期令牌的授权服务器（如 Spring Authorization Server）则类似 PA；Spring Security 过滤器链其实就是应用内的 PEP。

### 3. 服务间 mTLS 与服务网格（Istio）身份

普通 TLS 只有客户端验证服务端；**mTLS**（mutual TLS）让服务端也要求客户端出示证书并验证。握手中的关键差别：

```
 client (order)                          server (inventory)
   | ---- ClientHello ------------------------> |
   | <--- ServerHello, Certificate,  ---------- |   server cert chain
   |      CertificateRequest                    |   <- only in mTLS: ask client cert
   | ---- Certificate, CertificateVerify -----> |   client cert + proof of private key
   | ---- Finished ---------------------------> |
   |          server verifies client chain      |   验证失败则握手中止，请求根本到不了应用
```

mTLS 给你两样东西：**链路加密**，以及**强身份**（对端是谁，由证书里的名字确定，而且对方必须持有对应私钥）。拿到身份后，应用或代理还要做**授权**：“order-service 可以调 `/stock/**`，但 marketing-service 不行”。

**服务网格**把这件事从应用中拿走：Istio 在每个 Pod 旁边注入 Envoy sidecar（或在 ambient 模式下使用节点级代理），由 istiod 充当 CA，自动给每个工作负载签发短期证书，证书中的身份是 **SPIFFE ID**，格式为 `spiffe://<信任域>/ns/<命名空间>/sa/<ServiceAccount>`，即身份绑定的是 K8s ServiceAccount，而不是 IP。常用的两类资源：

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: shop
spec:
  mtls:
    mode: STRICT          # 只接受 mTLS 流量
---
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: inventory-allow-order
  namespace: shop
spec:
  selector:
    matchLabels:
      app: inventory
  action: ALLOW
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/order"]
    to:
    - operation:
        methods: ["GET", "POST"]
        paths: ["/stock/*"]
```

`principals` 里写的就是 SPIFFE ID 去掉 `spiffe://` 前缀的部分。（`security.istio.io/v1` 是较新的 Istio 版本使用的 API 版本，老版本使用 `v1beta1`，以你的 Istio 版本为准。）

### 4. API Gateway 的鉴权、限流、WAF

东西向流量（服务之间）靠 mTLS；南北向流量（外部进来）的统一入口是 **API Gateway**（Spring Cloud Gateway、Kong、APISIX、云厂商的 API 网关），它是天然的 PEP：

| 能力 | 做什么 | 例子 |
|---|---|---|
| 鉴权 | 校验 JWT / OAuth2 access token、API key，把身份透传给后端 | 网关校验 JWT 签名和过期，后端仍做业务级授权（见 [[ss-oauth2]]） |
| 限流 | 按用户、IP、API key 限制速率，防爆破、防刷、防资源耗尽 | 登录接口每 IP 每分钟 N 次；短信验证码每手机号每天 N 次 |
| WAF | 基于规则识别 SQL 注入、XSS、扫描器特征、恶意 Bot | 华为云 WAF 挂在网关或 ELB 前面 |
| 其他 | 请求大小限制、CORS、统一审计日志、灰度 | 所有请求记录 who/what/when，送往 SIEM |

注意：网关鉴权**不能**替代后端鉴权。如果后端服务可以绕过网关被直接访问（同一个 VPC 里谁都能连），那网关就只是一扇前门、后门大开。零信任要求后端也验证：要么 mTLS 只接受网关的证书，要么后端自己校验 token，最好两者都做。

## 动手实践

### 练习：用 openssl 搭私有 CA，给两个 Spring Boot 服务配置 mTLS

场景：`order-service`（客户端）调用 `inventory-service`（服务端，8443 端口）。为了步骤简洁，这里用根 CA 直接签发叶子证书；生产中应当是“离线根 CA → 中间 CA → 叶子证书”。

**第 1 步：创建根 CA。**

```bash
mkdir -p pki && cd pki
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ca.key
openssl req -x509 -new -key ca.key -sha256 -days 3650 \
  -subj "/CN=MyNotes Lab Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -out ca.crt
openssl x509 -in ca.crt -noout -subject -issuer -ext basicConstraints,keyUsage
```

```
subject=CN=MyNotes Lab Root CA
issuer=CN=MyNotes Lab Root CA
X509v3 Basic Constraints: critical
    CA:TRUE
X509v3 Key Usage: critical
    Certificate Sign, CRL Sign
```

**解读**：subject 等于 issuer，说明这是自签名的根证书；`CA:TRUE` 和 `Certificate Sign` 表示它可以签发其他证书。`ca.key` 是整个信任体系的命脉，实际环境要离线保存或放进 HSM / KMS。

**第 2 步：为两个服务生成私钥和 CSR，并签发证书。**

```bash
for svc in inventory order; do
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $svc.key
  openssl req -new -key $svc.key -subj "/CN=$svc-service" -out $svc.csr
done

cat > inventory.ext <<'X'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:inventory-service,DNS:localhost,IP:127.0.0.1
X

cat > order.ext <<'X'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
subjectAltName=URI:spiffe://mynotes.local/order-service
X

openssl x509 -req -in inventory.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -sha256 -extfile inventory.ext -out inventory.crt
openssl x509 -req -in order.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 365 -sha256 -extfile order.ext -out order.crt
openssl verify -CAfile ca.crt inventory.crt order.crt
openssl x509 -in order.crt -noout -subject -issuer -ext extendedKeyUsage,subjectAltName
```

```
Certificate request self-signature ok
subject=CN=inventory-service
Certificate request self-signature ok
subject=CN=order-service
inventory.crt: OK
order.crt: OK
subject=CN=order-service
issuer=CN=MyNotes Lab Root CA
X509v3 Extended Key Usage:
    TLS Web Client Authentication
X509v3 Subject Alternative Name:
    URI:spiffe://mynotes.local/order-service
```

**解读**：`verify` 两个 OK 说明链验证通过。服务端证书的 SAN 必须包含客户端实际访问用的主机名（这里是 `localhost`），否则客户端会报主机名不匹配。客户端证书的 EKU 是 `clientAuth`，身份用 SPIFFE 风格的 URI 表达（仿照 Istio）。`genpkey` 生成的是 PKCS#8 格式（`-----BEGIN PRIVATE KEY-----`），Spring Boot 的 PEM bundle 可以直接读取。

**第 3 步：配置服务端 inventory-service。** 把 `ca.crt`、`inventory.crt`、`inventory.key` 放到 `certs/` 目录（不要打进 jar，不要提交到 Git）。`application.yml`：

```yaml
server:
  port: 8443
  ssl:
    bundle: inventory-server
    client-auth: need        # 必须出示客户端证书，否则握手失败
spring:
  ssl:
    bundle:
      pem:
        inventory-server:
          keystore:
            certificate: "file:certs/inventory.crt"
            private-key: "file:certs/inventory.key"
          truststore:
            certificate: "file:certs/ca.crt"   # 只信任我们的私有 CA 签发的客户端证书
```

`client-auth` 有三个取值：`none`（默认）、`want`（有证书就验，没有也放行）、`need`（没有有效证书就拒绝）。零信任场景用 `need`。

一个能看到调用方身份的接口：

```java
package com.aqin.inventory;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.security.cert.X509Certificate;

@RestController
public class StockController {

    public record StockResponse(String sku, int qty, String caller) {}

    @GetMapping("/stock/{sku}")
    public StockResponse stock(@PathVariable String sku, HttpServletRequest request) {
        X509Certificate[] chain =
                (X509Certificate[]) request.getAttribute("jakarta.servlet.request.X509Certificate");
        String caller = chain[0].getSubjectX500Principal().getName();
        return new StockResponse(sku, 42, caller);
    }
}
```

若使用 Spring Security，可以用 `http.x509(x509 -> x509.subjectPrincipalRegex("CN=(.*?)(?:,|$)"))` 从证书中提取主体名，再配合 `authorizeHttpRequests` 做“哪个服务能调哪个接口”的授权。

**第 4 步：配置客户端 order-service。**

```yaml
spring:
  ssl:
    bundle:
      pem:
        order-client:
          keystore:
            certificate: "file:certs/order.crt"
            private-key: "file:certs/order.key"
          truststore:
            certificate: "file:certs/ca.crt"   # 用来验证 inventory 的服务端证书
```

```java
package com.aqin.order;

import org.springframework.boot.ssl.SslBundles;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;

@Configuration
public class InventoryClientConfig {

    @Bean
    RestClient inventoryClient(SslBundles sslBundles) {
        HttpClient http = HttpClient.newBuilder()
                .sslContext(sslBundles.getBundle("order-client").createSslContext())
                .build();
        return RestClient.builder()
                .requestFactory(new JdkClientHttpRequestFactory(http))
                .baseUrl("https://localhost:8443")
                .build();
    }
}
```

调用：`inventoryClient.get().uri("/stock/{sku}", "A100").retrieve().body(String.class)`。

**第 5 步：验证。** 用 curl 分别模拟“没有客户端证书的攻击者”和“持证的 order-service”：

```bash
curl --cacert pki/ca.crt https://localhost:8443/stock/A100
curl --cacert pki/ca.crt --cert pki/order.crt --key pki/order.key https://localhost:8443/stock/A100
curl https://localhost:8443/stock/A100
```

```
curl: (56) LibreSSL SSL_read: LibreSSL/3.3.6: error:1404C45C:SSL routines:ST_OK:reason(1116), errno 0
{"sku":"A100","qty":42,"caller":"CN=order-service"}
curl: (60) SSL certificate problem: self signed certificate in certificate chain
```

**解读**：

- 第一条：没带客户端证书，服务端在 TLS 握手阶段就发出“需要证书”的告警并断开，HTTP 请求根本没有到达 Spring MVC。以上是 macOS 自带 curl（LibreSSL）的写法；Linux 上基于 OpenSSL 的 curl 会显示类似 `alert certificate required` 的文字，具体措辞随 curl 和 TLS 库版本而不同。
- 第二条：握手成功，接口拿到的调用方身份是 `CN=order-service`，可据此做授权。
- 第三条：curl 不信任我们的私有根 CA，所以连服务端都不认可。这说明信任是双向配置的：客户端的信任库决定信任哪个服务端，服务端的信任库决定信任哪些客户端。

再做一个负面测试：用另一个 CA 自签一张 `CN=order-service` 的证书去访问，应当同样握手失败，证明“名字对了但不是我们 CA 签的”也没用。

## 攻击者视角

> 本课涉及的攻击手法只用于你自己的环境或已获授权的目标。

**问题：传统 VPN + 内网信任的模型，在攻击者进入内网后有什么问题？**

- **横向移动畅通无阻**：内网服务之间没有认证，攻击者从一台被攻破的机器（钓鱼的员工电脑、有漏洞的旧系统）可以直接调用订单、用户、支付等内部 API，直连 MySQL / Redis / EMQX 管理端口。
- **明文流量可被窃听和篡改**：内网 HTTP、Redis 协议明文传输，攻击者在同网段做 ARP 欺骗就能看到 token 和密码。
- **IP 白名单失效**：很多内部接口“只允许 10.0.0.0/8 访问”，攻击者此时就在 10.x 网段里。SSRF 同理：服务器替攻击者发起的请求天然来自内网。
- **VPN 本身成为单点**：VPN 账号被撞库或 VPN 设备有漏洞，一次认证就拿到整个网段；登录后不会再持续验证。
- **难以发现**：内部流量没有身份，日志里只有 IP，出了事分不清是哪个服务、哪个人。

有了 mTLS 之后，攻击者还有哪些路：

- **偷私钥**：私钥以文件形式放在容器里，拿到 RCE 就能读取并冒充该服务（所以要短期证书、私钥文件权限收紧、最好放在只有 sidecar 能访问的地方）。
- **偷 CA 私钥**：可以签任意身份，这是最严重的情况（根 CA 离线、中间 CA 放 HSM / KMS）。
- **利用授权过宽**：“只要是我们 CA 签的证书就能访问一切”等于没有授权。
- **用合法服务当跳板**：攻陷 order-service 后，以它的身份调用它被允许调用的接口。所以还需要最小权限的服务间授权，以及对异常调用模式的检测。

## 防御与最佳实践

- **所有服务间通信 mTLS**，服务端 `client-auth: need`；有 K8s 就考虑服务网格自动签发、自动轮换。
- **身份 ≠ 授权**：在网关 / sidecar / Spring Security 中配置“谁能调谁的哪个接口”，默认拒绝。
- **CA 分层**：根 CA 离线，中间 CA 放 HSM / 云 KMS 或使用 step-ca 等专门的 CA 软件；叶子证书短期、自动轮换。
- **证书内容规范**：身份放在 SAN；叶子证书 `CA:FALSE`；服务端证书 `serverAuth`、客户端证书 `clientAuth`。
- **吊销能力**：至少要有 CRL 或 OCSP 方案，或者证书足够短期。
- **私钥保护**：私钥在服务本地生成、不出服务；文件权限 `600`；不进镜像、不进 Git（与 [[cloud-secrets]] 一致）。
- **入口统一**：外部流量经 API Gateway（鉴权、限流）和 WAF；后端服务不对外暴露，安全组只允许网关访问。
- **持续评估**：结合设备状态、异常行为检测（见 [[cloud-detect]]），高风险时要求重新认证。

## 常见误区

- **“上了 VPN / 在 VPC 里就是零信任”**：这正是零信任要否定的“位置即信任”。
- **“零信任是一款产品”**：它是架构原则，需要身份、设备、策略、网络、监控多方面配合，逐步演进。
- **“有了 mTLS 就不需要应用层鉴权”**：mTLS 认证的是服务，不是最终用户；用户身份仍需通过 token 传递并在后端校验。
- **“主机名放在 CN 就行”**：现代 TLS 客户端按 SAN 校验主机名。
- **“自签名证书加 `trust all` 也算加密了”**：`TrustAllCerts`、关闭主机名校验等于没有认证，中间人可以轻松冒充。
- **“网关做了鉴权，后端就不用做了”**：只要后端能被绕过网关直接访问，网关鉴权就是摆设。

## 自测

:::details 1. 为什么 PKI 通常采用“离线根 CA + 中间 CA”的两级结构？
根 CA 私钥一旦泄露整个信任体系崩溃，所以离线保存、极少使用；日常签发由中间 CA 完成，中间 CA 出问题时可以由根 CA 吊销并重建，不需要更换所有客户端信任库里的根证书。
:::

:::details 2. CRL 和 OCSP 的区别是什么？服务网格为什么更偏好短期证书？
CRL 是 CA 定期发布的吊销序列号列表，客户端下载比对，有延迟且列表会变大；OCSP 是实时查询单张证书状态，但增加延迟、依赖响应器可用性。服务网格用几小时到一天级别的短期证书并自动轮换，证书很快自然过期，减少对吊销机制的依赖。
:::

:::details 3. 用自己的话说出 NIST SP 800-207 零信任的至少四条原则。
所有数据源和计算服务都是资源；不论网络位置，所有通信都要保护；访问按会话授予且最小权限；访问由动态策略决定；持续监测资产完整性与安全状态；认证授权动态、严格、先于访问执行；持续收集信息改进安全态势。
:::

:::details 4. Spring Boot 的 `server.ssl.client-auth` 取 want 和 need 有什么区别？
want：客户端有证书就验证，没有也允许连接；need：客户端必须提供由信任库中 CA 签发的有效证书，否则 TLS 握手失败，请求到不了应用。零信任的服务间调用应使用 need。
:::

:::details 5. 传统 VPN + 内网信任的模型，在攻击者进入内网后有什么问题？
内网服务互相不认证，攻击者可以横向移动、直接调用内部 API 和数据库；明文流量可被窃听篡改；基于 IP 的白名单失效；VPN 一次认证就放行整个网段且不再持续验证；日志中没有服务身份，难以溯源。
:::

:::details 6. Istio 中工作负载的身份是什么？如何限制只有 order 服务能访问 inventory？
身份是由 istiod 签发在证书中的 SPIFFE ID，形如 `spiffe://cluster.local/ns/shop/sa/order`，绑定 K8s ServiceAccount。用 PeerAuthentication 设置 STRICT 强制 mTLS，再用 AuthorizationPolicy 在 inventory 上 ALLOW `principals: ["cluster.local/ns/shop/sa/order"]` 的请求。
:::

:::details 7. 有了 API Gateway 的 JWT 鉴权，为什么后端服务还需要验证？
因为攻击者一旦进入内网（或利用 SSRF），可以绕过网关直接访问后端。后端应通过 mTLS 只接受网关 / 合法服务的连接，并自行校验 token 和业务级权限。
:::

## 一句话总结

零信任就是“不看你在哪、只看你是谁、每次都验证”：用私有 CA 给服务发短期证书做 mTLS，用网关和策略做最小权限授权，并持续监测。
