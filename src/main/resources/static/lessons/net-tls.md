## 为什么要学

在 [[net-trace]] 的链路里，TLS 是“加密通道”那一环。它给你的连接提供三样东西：**机密性**（别人看不到内容）、**完整性**（别人改不了内容）、**身份认证**（对面确实是这个域名的持有者）。你在工作中早就用过它：Nginx 配证书、`https://` 调第三方支付接口、MQTT 的 8883 端口、华为云 OBS 的 HTTPS 访问，也可能遇到过 `PKIX path building failed`，然后在网上搜到一段“信任所有证书”的代码粘了进去。

这一课要把这些经验串成体系：密码学基本构件、TLS 1.3 握手、证书链校验、HSTS、中间人攻击、mTLS。它是后面很多主题的地基：[[net-token]] 的签名、[[ss-oauth2]] 的 JWK、[[cloud-zerotrust]] 的服务间 mTLS、[[iot-identity]] 的设备证书与 PKI。

学完后你应该能：用 `openssl s_client` 看懂任意网站的证书链；自建一个 CA 给本地 Spring Boot 配上 HTTPS；解释为什么“信任所有证书”等于没有 TLS，并写出正确的替代代码。

## 核心概念

### 1. 对称加密、非对称加密、哈希、数字签名分别解决什么问题

| 构件 | 典型算法 | 解决什么 | 不解决什么 |
|---|---|---|---|
| 对称加密 | AES-GCM、ChaCha20-Poly1305 | 用同一把密钥高速加解密大量数据（机密性）；AEAD 模式同时保证完整性 | 双方怎么安全地得到同一把密钥 |
| 非对称加密 / 密钥交换 | RSA、ECDHE（X25519 等） | 在不安全的网络上协商出共享密钥；公钥可以公开 | 速度慢，不适合加密大量数据；公钥属于谁 |
| 哈希 | SHA-256 | 把任意数据压缩成固定长度摘要，任何改动都会使摘要改变 | 单独使用不能防篡改（攻击者改数据后可以重算哈希） |
| MAC / HMAC | HMAC-SHA256 | 持有共享密钥的一方才能生成正确的校验值（完整性 + 来源） | 双方都有密钥，无法向第三方证明是谁生成的 |
| 数字签名 | RSA、ECDSA、Ed25519 | 私钥签名、公钥验证：完整性 + 身份认证 + 不可否认 | 公钥本身是谁的，需要证书来证明 |

TLS 把它们组合起来：用**签名 + 证书**确认服务器身份，用 **ECDHE** 协商密钥，用 **AEAD 对称加密**传输数据，用**哈希**做握手记录的摘要和密钥派生。

注意哈希不等于加密：密码存储用的是慢哈希（BCrypt 等，见 [[web-authn]]），而不是 AES，也不是一次 SHA-256。

### 2. TLS 1.3 握手过程（ECDHE 密钥交换、前向保密）

TLS 1.3（RFC 8446）完整握手只需 **1 个 RTT**：

```
Client                                           Server
  |-- ClientHello -------------------------------->|   支持的套件、SNI、key_share(客户端 ECDHE 公钥)
  |      (cipher suites, SNI, ALPN, key_share)     |
  |<-- ServerHello (key_share) --------------------|   服务端 ECDHE 公钥；此后双方都能算出握手密钥
  |<-- {EncryptedExtensions} ----------------------|   以下花括号内容均已加密
  |<-- {Certificate} ------------------------------|   证书链
  |<-- {CertificateVerify} ------------------------|   用证书私钥对握手记录签名
  |<-- {Finished} ---------------------------------|
  |-- {Finished} --------------------------------->|
  |== [Application Data: HTTP] ===================>|   用应用流量密钥加密
```

逐步理解：

1. **ClientHello**：客户端列出支持的密码套件（如 `TLS_AES_128_GCM_SHA256`），在 `key_share` 中直接附上自己**临时生成**的 ECDHE 公钥；`SNI` 扩展写明要访问的域名（明文，Nginx 据此选择证书），`ALPN` 协商 `h2` 或 `http/1.1`。
2. **ServerHello**：服务端选定套件，给出自己的临时 ECDHE 公钥。双方用“自己的私钥 + 对方的公钥”算出同一个共享秘密，再经 HKDF 派生出各种密钥。从这里开始，后续握手消息全部加密（这是相对 TLS 1.2 的一大改进，证书不再明文传输）。
3. **Certificate + CertificateVerify**：服务端发送证书链，并用证书对应的**私钥**对到目前为止的握手记录签名。客户端校验证书链（第 3 节），再用证书里的公钥验证这个签名，从而确认：对方持有该证书的私钥，且握手没被篡改。
4. **Finished**：双方用握手密钥对整个握手记录计算 MAC，确认看到的握手内容完全一致（防降级、防篡改）。

**前向保密（Forward Secrecy）**：每次连接的 ECDHE 密钥对都是临时生成、用完即丢的，证书私钥只用于**签名**，不参与加密会话密钥。所以即使服务器私钥将来泄露，攻击者也无法解密过去录下来的流量。TLS 1.2 中的静态 RSA 密钥交换（客户端用服务器 RSA 公钥加密预主密钥）没有这个性质，**TLS 1.3 已移除静态 RSA 密钥交换**，所有握手都具备前向保密。TLS 1.3 还移除了 CBC 模式、RC4、SHA-1 签名等过时算法，只保留 AEAD 套件。

另有会话恢复（PSK）和 0-RTT 模式：0-RTT 数据可能被**重放**，因此只应用于幂等请求，很多服务默认不开启。

### 3. 证书链：叶子证书 → 中间 CA → 根 CA，浏览器如何校验

证书（X.509）就是“CA 用自己的私钥签名的一份声明”：**这个公钥属于这个域名**，有效期从某日到某日。

```
Root CA        (self-signed, in OS/browser/JDK trust store)   <- 根证书，离线保管
  | signs
Intermediate CA (sent by server)                              <- 中间证书，日常签发用
  | signs
Leaf: shop.example.com (SAN: shop.example.com, *.example.com) <- 服务器证书
```

客户端收到证书链后，大致做这些检查（任何一步失败都应中止连接）：

1. **构建路径**：从叶子证书沿“签发者（Issuer）”找到中间 CA，再到一个**本地信任库中的根 CA**。服务端应发送叶子 + 中间证书；根证书不必发，发了也没用，因为信任只来自本地信任库。
2. **验签**：每一级证书的签名都用上一级的公钥验证。
3. **有效期**：当前时间在 `notBefore` 与 `notAfter` 之间。
4. **主机名匹配**：访问的域名必须出现在叶子证书的 **SAN（Subject Alternative Name）**扩展中。现代客户端只看 SAN，不再看 CN。通配符 `*.example.com` 只匹配一级子域（匹配 `a.example.com`，不匹配 `a.b.example.com` 和 `example.com`）。
5. **用途和约束**：中间证书必须是 CA（`basicConstraints: CA:TRUE`），叶子证书的扩展用途包含服务器认证。
6. **吊销状态**：通过 CRL 或 OCSP 查询证书是否被吊销（各客户端实现差异很大）。

**信任库**决定了你信任谁：浏览器和操作系统有各自的根证书列表，Java 用 JDK 自带的 `$JAVA_HOME/lib/security/cacerts`（默认密码 `changeit`）。最常见的 `PKIX path building failed` 错误，就是在 cacerts 中找不到能连到的根，原因通常是**服务端没发中间证书**，或对方用的是公司内部 CA / 自签名证书。

CA 在签发前要验证你确实控制该域名（例如 Let's Encrypt 的 ACME HTTP-01、DNS-01 挑战）。另外，公开信任的 CA 签发的证书会被记录到**证书透明度（CT）日志**中，域名所有者可以监控是否有人为自己的域名签发了证书。

### 4. HSTS、证书固定、中间人攻击与“忽略证书错误”的风险

**中间人攻击（MITM）**：攻击者位于通信路径上（恶意 Wi-Fi、ARP 欺骗、被控路由器、DNS 劫持），冒充服务器与你握手，同时冒充你与真服务器握手，在中间解密、查看、修改所有流量。TLS 挡住它靠的就是**证书校验**：攻击者拿不到 `shop.example.com` 的合法证书和私钥，只能出示自签名或域名不符的证书，客户端就会报错。所以：

> **忽略证书错误 = 把 TLS 的身份认证关掉。** 加密仍在，但你不知道在和谁加密通信，攻击者就是那个“谁”。

**HSTS**：服务器返回 `Strict-Transport-Security: max-age=31536000; includeSubDomains`，浏览器在有效期内对该域名**只用 HTTPS**：输入 `http://` 也会在本地直接改成 `https://`，并且证书出错时**不给用户“继续访问”的选项**。它防的是 **SSL Stripping**（攻击者在用户第一次以明文 HTTP 访问时截住，让用户一直停留在 HTTP 上）。HSTS 的缺口是“第一次访问”，所以有 **HSTS 预加载列表**，内置在浏览器里。`includeSubDomains` 要求所有子域都支持 HTTPS，开启前要确认。

**证书固定（Pinning）**：客户端不只信任“任何受信 CA 签发的证书”，而是只接受特定的证书或公钥（通常固定公钥的哈希）。它能防住“某个 CA 被攻破或被迫签发”和“设备上被装了恶意根证书”的情况。代价是运维风险高：证书轮换时忘了更新固定值，客户端就全部连不上。浏览器领域的 HTTP 公钥固定（HPKP）已被主流浏览器弃用；固定现在主要用于自己能控制发版的客户端：移动 App、IoT 设备固件、车机。对 IoT 更常见也更好维护的做法是**固定到自己的私有 CA**（信任库里只放自家根证书），而不是固定叶子证书。

### 5. 问题：Java 里“信任所有证书”的 TrustManager 会带来什么后果？

网上流传最广的“解决 PKIX 报错”代码长这样，**不要使用**：

```java
// 反面教材：信任所有证书 + 不校验主机名
TrustManager[] trustAll = { new X509TrustManager() {
    public void checkClientTrusted(X509Certificate[] chain, String authType) { }
    public void checkServerTrusted(X509Certificate[] chain, String authType) { } // 什么都不检查
    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
}};
SSLContext ctx = SSLContext.getInstance("TLS");
ctx.init(null, trustAll, new SecureRandom());
HttpsURLConnection.setDefaultSSLSocketFactory(ctx.getSocketFactory());  // 影响整个 JVM
HttpsURLConnection.setDefaultHostnameVerifier((host, session) -> true); // 任何域名都算匹配
```

后果：

- `checkServerTrusted` 空实现意味着**任何证书都通过**，包括攻击者现场生成的自签名证书。任何能站到网络路径上的人都可以做中间人，解密并篡改流量，而代码不会有任何报错。连接依然是“加密的”，只是在和攻击者加密。
- 被泄露的是这条连接上的一切：调用支付、短信、OBS 等接口时带的 AccessKey/签名、用户的个人信息、返回给你的数据（攻击者可以篡改响应，比如把“支付失败”改成“成功”，或在下载的固件/配置中植入内容）。
- `setDefault...` 是**全局**的：一处为了连某个测试环境而写的代码，会让同一个 JVM 里所有 `HttpsURLConnection` 都失去保护。这种代码经常从测试环境一路带到生产环境，且很难被发现，因为它“能用”。
- 对车联网/IoT 尤其危险：车机和设备经常连公共或运营商网络，关闭校验后，冒充云平台下发指令或 OTA 包就成为可能。

**正确做法**：报错说明“你的信任库里没有能验证这张证书的根”，应该**把正确的 CA 加入一个信任库**，而不是关掉校验。

1. 先确认原因：如果是公网网站，多半是对方没发中间证书，应让对方修复（用实践 1 的方法验证）。
2. 如果对方使用内部 CA，拿到该 **CA 证书**（通过可信渠道获取，不要从连接中直接“抓一张”就信任），导入一个专用信任库，只让需要的客户端使用它：

```java
// Java 17：只信任指定信任库中的 CA，主机名校验保持默认开启
KeyStore trustStore = KeyStore.getInstance("PKCS12");
try (InputStream in = Files.newInputStream(Path.of("internal-truststore.p12"))) {
    trustStore.load(in, "changeit".toCharArray());
}
TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
tmf.init(trustStore);
SSLContext ctx = SSLContext.getInstance("TLS");
ctx.init(null, tmf.getTrustManagers(), null);

HttpClient client = HttpClient.newBuilder().sslContext(ctx).build(); // java.net.http 默认校验主机名
HttpResponse<String> resp = client.send(
        HttpRequest.newBuilder(URI.create("https://internal-api.example.com/health")).build(),
        HttpResponse.BodyHandlers.ofString());
```

在 Spring Boot 里更简单的方式是 **SSL Bundle**（Spring Boot 3.1 引入，下面用到的 `RestClientSsl` 需要 3.2 及以上；本项目 4.1 均可用），只对指定的客户端生效：

```
spring.ssl.bundle.jks.internal.truststore.location=classpath:internal-truststore.p12
spring.ssl.bundle.jks.internal.truststore.password=changeit
spring.ssl.bundle.jks.internal.truststore.type=PKCS12
```

```java
@Bean
RestClient internalClient(RestClient.Builder builder, RestClientSsl ssl) {
    return builder.baseUrl("https://internal-api.example.com").apply(ssl.fromBundle("internal")).build();
}
```

原则：只把**必要的 CA** 加入**专用**信任库；不要修改全局默认值；不要关闭主机名校验；密码放在配置中心或环境变量中，不要硬编码（上面为演示写死）。代码审查时，可以全局搜索 `X509TrustManager`、`HostnameVerifier`、`setDefaultSSLSocketFactory`、`TrustAllStrategy`、`NoopHostnameVerifier`（后两个出自 Apache HttpClient）。

### 6. mTLS（双向认证）：服务端也校验客户端证书

普通 TLS 只有客户端验证服务端。**mTLS** 中，服务端在握手时发送 `CertificateRequest`，客户端也要出示证书，并用私钥签名证明自己持有它；服务端用**自己信任的 CA**（通常是私有 CA）校验客户端证书。

- 典型场景：服务间调用（服务网格、零信任，见 [[cloud-zerotrust]]）、银行/支付的开放接口、**IoT 设备接入**：每台设备或每辆车在产线烧录唯一的证书和私钥，EMQX 在 8883 端口开启客户端证书校验后，没有合法证书的设备连 TCP 之后的握手都过不去（见 [[iot-identity]]）。
- 与 AccessKey/密码相比：私钥不在网络上传输，可以存放在安全芯片中，且可以按设备单独吊销。
- 注意：mTLS 只证明“是谁”，**不负责授权**。一台合法设备仍然只能发布/订阅自己的主题（见 [[iot-acl]]）。应用可以从客户端证书中取出身份（如 CN 或 SAN）再做授权。

Spring Boot 中开启：`server.ssl.client-auth=need`（`want` 表示可选），并用 `server.ssl.trust-store` 指定用于校验客户端证书的 CA。

### 7. 问题：为什么 TLS 保护不了已经被攻陷的服务端？

因为 TLS 保护的是**传输过程**，它的保护在连接的两个端点就结束了。数据到达服务端后会被解密，然后以明文形式存在于内存、日志、数据库和下游调用中。如果服务端已经被攻陷（RCE、后门、恶意依赖、内部人员），攻击者：

- 直接在进程里读到解密后的请求，包括密码、Token、个人数据；
- 可以拿走证书私钥，冒充该服务器（在证书吊销前）；
- 可以篡改响应，比如给页面插入恶意脚本，而浏览器看到的依然是“有效证书、绿色小锁”。

小锁只表示“你在和持有这个域名证书的服务器通信，且内容在路上没被看和改”，**不表示对方可信、安全、没有被入侵**。钓鱼网站同样可以申请到合法证书。所以服务端安全要依靠其他层次：输入校验、最小权限、密钥管理、入侵检测、敏感数据落地加密。

## 动手实践

:::warn 授权
中间人、抓包解密等实验只能在自己的设备、自己的环境或获得授权的目标上进行。
:::

macOS 自带的 `openssl` 实际上是 LibreSSL，部分参数不同。建议 `brew install openssl@3`，用 `$(brew --prefix openssl@3)/bin/openssl` 运行下面的命令（以下假设 OpenSSL 3.x）。

### 实践 1：用 openssl s_client 查看网站证书链

```
openssl s_client -connect www.example.com:443 -servername www.example.com -showcerts </dev/null
```

`-servername` 设置 SNI（不设置时，同一 IP 上有多个站点的服务器可能返回默认证书），`</dev/null` 让命令握手后立即退出。示例输出（节选，CA 名称和时间仅作示意）：

```
CONNECTED(00000003)
depth=2 C = US, O = Example Trust, CN = Example Root CA
verify return:1
depth=1 C = US, O = Example Trust, CN = Example TLS Issuing CA 1
verify return:1
depth=0 CN = www.example.com
verify return:1
---
Certificate chain
 0 s:CN = www.example.com
   i:C = US, O = Example Trust, CN = Example TLS Issuing CA 1
   a:PKEY: id-ecPublicKey, 256 (bit); sigalg: ecdsa-with-SHA384
   v:NotBefore: Jan 15 00:00:00 2026 GMT; NotAfter: Apr 15 23:59:59 2026 GMT
-----BEGIN CERTIFICATE-----
...
 1 s:C = US, O = Example Trust, CN = Example TLS Issuing CA 1
   i:C = US, O = Example Trust, CN = Example Root CA
---
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
Verify return code: 0 (ok)
```

怎么读：

- `Certificate chain` 下编号 0 是叶子证书，1 是中间证书。`s:` 是主体（Subject），`i:` 是签发者（Issuer）。**第 n 张的 `i:` 应等于第 n+1 张的 `s:`**，最后一张的签发者应是本地信任的根。
- `depth=2/1/0` 那几行是本地的校验过程：depth 2 的根来自本机信任库，并不是服务器发来的。
- `Verify return code: 0 (ok)` 表示链校验通过。常见错误：`20 (unable to get local issuer certificate)` 通常是服务器缺中间证书或使用了私有 CA；`10 (certificate has expired)`；`18/19` 是自签名证书。注意 s_client 默认**不校验主机名**，加上 `-verify_hostname www.example.com` 才会检查。
- `New, TLSv1.3, Cipher is ...` 显示协商出的协议版本和套件。
- 查看叶子证书的 SAN 和有效期：

```
openssl s_client -connect www.example.com:443 -servername www.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

输出中的 `X509v3 Subject Alternative Name: DNS:www.example.com, DNS:example.com` 就是这张证书能用于的域名列表。还可以加 `-tls1_2` 或 `-tls1_3` 测试服务端支持哪些版本。

### 实践 2：自签一个 CA，给本地 Spring Boot 配置 HTTPS

**第 1 步：建 CA，再用 CA 签发 localhost 证书。** 在仓库**之外**建目录（私钥不要提交到 git）：

```
mkdir -p ~/mynotes-tls && cd ~/mynotes-tls
# 1) 自签根 CA（req -x509 在默认配置下会生成 CA:TRUE 的证书）
openssl req -x509 -new -newkey rsa:2048 -nodes -days 365 \
  -keyout ca.key -out ca.crt -subj "/CN=MyNotes Dev CA"
# 2) 服务器私钥和证书签名请求（CSR）
openssl req -new -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr -subj "/CN=localhost"
# 3) 用 CA 签发，写上 SAN 与用途
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 90 -extfile server.ext -out server.crt
# 4) 打包成 PKCS12 密钥库，给 Spring Boot 用
openssl pkcs12 -export -in server.crt -inkey server.key -certfile ca.crt \
  -name mynotes -out server.p12 -passout pass:changeit
```

检查结果：

```
$ openssl verify -CAfile ca.crt server.crt
server.crt: OK
$ keytool -list -keystore server.p12 -storepass changeit
Keystore type: PKCS12
Your keystore contains 1 entry

mynotes, Sep 24, 2026, PrivateKeyEntry,
Certificate fingerprint (SHA-256): 4A:1F:...
```

`PrivateKeyEntry` 表示这个条目包含私钥和证书链，Spring Boot 需要的正是它（只有证书的条目会显示为 `trustedCertEntry`）。

只想要一张最简单的自签名证书（没有 CA）时，可以只用 keytool 一条命令：

```
keytool -genkeypair -alias mynotes -keyalg RSA -keysize 2048 -validity 90 \
  -dname "CN=localhost" -ext "san=dns:localhost,ip:127.0.0.1" \
  -storetype PKCS12 -keystore quick.p12 -storepass changeit
```

但自签名叶子证书无法像 CA 那样“签一次、信任多张”，客户端只能逐个信任，这里仍推荐 CA 方式。

**第 2 步：配置 Spring Boot。** 为了不改动主配置，新建一个 profile 文件 `src/main/resources/application-tls.properties`（练习用，练完可删）：

```
server.port=8443
server.ssl.enabled=true
server.ssl.key-store=file:${user.home}/mynotes-tls/server.p12
server.ssl.key-store-type=PKCS12
server.ssl.key-store-password=changeit
server.ssl.key-alias=mynotes
server.ssl.enabled-protocols=TLSv1.3,TLSv1.2
# mTLS 练习时再打开：
# server.ssl.client-auth=need
# server.ssl.trust-store=file:${user.home}/mynotes-tls/truststore.p12
# server.ssl.trust-store-password=changeit
```

用 `./mvnw spring-boot:run -Dspring-boot.run.profiles=tls` 启动，日志中应出现 `Tomcat started on port 8443 (https)`。真实项目中密码应来自环境变量或配置中心。

**第 3 步：验证。**

```
$ curl -sv https://localhost:8443/ -o /dev/null
* SSL certificate problem: unable to get local issuer certificate
curl: (60) SSL certificate problem: unable to get local issuer certificate

$ curl -sv --cacert ~/mynotes-tls/ca.crt https://localhost:8443/ -o /dev/null
* SSL connection using TLSv1.3 / TLS_AES_256_GCM_SHA384
* Server certificate:
*  subject: CN=localhost
*  issuer: CN=MyNotes Dev CA
*  subjectAltName: host "localhost" matched cert's "localhost"
*  SSL certificate verify ok.
< HTTP/1.1 200
```

怎么读：第一次失败是**正确的行为**，因为系统信任库里没有你的 CA，curl 拒绝连接，这正是 TLS 在保护你；第二次通过 `--cacert` 显式信任自己的 CA，链校验和主机名校验（`matched cert's "localhost"`）都通过。换成 `https://127.0.0.1:8443/` 也能通过，因为 SAN 里写了 `IP:127.0.0.1`。（curl 的输出格式随版本和 TLS 库略有不同。）

**第 4 步：让 Java 客户端信任这个 CA。** 用 keytool 生成一个专用信任库，然后按第 5 节的 `TrustManagerFactory` 或 SSL Bundle 方式使用：

```
keytool -importcert -alias mynotes-dev-ca -file ~/mynotes-tls/ca.crt \
  -keystore ~/mynotes-tls/truststore.p12 -storetype PKCS12 -storepass changeit -noprompt
keytool -list -keystore ~/mynotes-tls/truststore.p12 -storepass changeit
# 输出中应有：mynotes-dev-ca, ..., trustedCertEntry,
```

不要把开发 CA 导入 JDK 自带的 `cacerts` 或系统信任库，更不要在生产环境这么做：它的私钥就放在你的家目录里，一旦泄露，任何人都能为任何域名签发你的机器会信任的证书。

## 攻击者视角

- **找关闭校验的客户端**：在代码、反编译的 App/车机/IoT 固件中搜索空的 `checkServerTrusted`、`HostnameVerifier` 永远返回 true 等写法。找到后在同一网络下用 mitmproxy 之类的工具做中间人，就能看到并篡改全部流量。
- **SSL Stripping**：针对没有 HSTS 的站点，在用户首次以 HTTP 访问时截住，并将其降级为明文。
- **诱导安装根证书**：“安装此证书才能上网”，一旦用户照做，攻击者签发的任何证书都会被信任。
- **利用服务端弱配置**：启用过时协议（TLS 1.0/1.1）、弱套件，证书过期或域名不匹配让用户习惯“点继续”。
- **窃取私钥**：私钥被提交到 git、打进 Docker 镜像、放在权限过宽的目录中，拿到后即可冒充服务器。
- **证书信息收集**：从 CT 日志和证书 SAN 列表中找出内部或测试子域名，扩大攻击面。

## 防御与最佳实践

- 服务端：只启用 TLS 1.2 和 1.3；发送完整证书链（叶子 + 中间）；开启 HSTS；证书自动续期并监控到期时间（Let's Encrypt 等 ACME 方式）；私钥权限最小化，不进代码仓库和镜像，有条件的放在 KMS/HSM 中。
- Java 客户端：**永远不要**信任所有证书或关闭主机名校验；私有 CA 使用专用信任库或 Spring Boot SSL Bundle；在 CI 中用代码扫描规则拦截这类写法。
- 自有客户端（App、车机、IoT）：信任库只放自家 CA，必要时做公钥固定并设计好轮换方案。
- 服务间和设备接入使用 mTLS，并按证书身份做授权；准备好证书吊销和替换流程。
- 监控 CT 日志，配置 CAA 记录；在 Nginx 终止 TLS 时，注意 Nginx 到后端这一段是否在可信网络中，否则同样需要加密。
- 按 OWASP Transport Layer Security Cheat Sheet 定期检查配置。

## 常见误区

- “HTTPS 网站就是安全的”：小锁只说明传输安全，钓鱼网站也可以有合法证书，服务端也可能已被入侵。
- “信任所有证书只在测试环境用”：这类代码很容易带到生产环境，而且全局设置会影响整个 JVM。
- “把根证书也发给客户端更保险”：信任只来自客户端本地的信任库，服务器发的根证书不会被当作信任依据。
- “加密了就不用校验证书”：不校验身份的加密，可能正在和中间人加密通信。
- “自签名证书不安全”：问题不在自签名本身，而在于客户端如何信任它。私有 CA 通过安全渠道分发给自己的客户端，是完全正当的做法（IoT 就常这么做）。
- “私钥泄露也没关系，反正有前向保密”：前向保密只保护**过去**的会话；私钥泄露后攻击者可以冒充服务器，必须立即吊销并更换证书。

## 自测

:::details 1. 数字签名和 HMAC 都能保证完整性，它们的区别是什么？
HMAC 使用双方共享的同一把密钥，任何持有密钥的一方都能生成，无法向第三方证明是谁生成的；数字签名用私钥签、公钥验，只有私钥持有者能签名，因此还能提供身份认证和不可否认性。
:::

:::details 2. TLS 1.3 为什么能提供前向保密？
会话密钥由每次连接临时生成的 ECDHE 密钥对协商得出，用完即丢；证书私钥只用于签名握手记录，不参与会话密钥的计算。即使私钥日后泄露，也无法解密以前录下的流量。TLS 1.3 移除了没有前向保密的静态 RSA 密钥交换。
:::

:::details 3. 客户端校验服务器证书时要检查哪些内容？
能否构建到本地信任的根 CA 的路径，每一级签名是否有效，是否在有效期内，访问的域名是否在叶子证书的 SAN 中，CA 约束与密钥用途是否正确，以及（如果支持的话）吊销状态。最后还要验证 CertificateVerify 签名，确认对方持有私钥。
:::

:::details 4. Java 代码里写一个“信任所有证书”的 TrustManager 会带来什么后果？
证书校验失效，任何人都可以用自己生成的证书做中间人，解密和篡改所有流量，包括密钥、Token、个人数据和响应内容，而程序不会有任何报错；如果设置为全局默认，整个 JVM 的 HTTPS 连接都会受影响。正确做法是把所需的 CA 导入专用信任库，通过 TrustManagerFactory 或 SSL Bundle 使用，并保持主机名校验。
:::

:::details 5. 为什么 TLS 保护不了已经被攻陷的服务端？
TLS 只保护传输过程，数据到达服务端后即被解密。攻击者控制服务端后可以直接读取明文、窃取私钥、篡改响应，而客户端看到的仍然是合法证书。
:::

:::details 6. HSTS 防的是什么攻击？它的局限是什么？
防 SSL Stripping：浏览器在有效期内对该域名强制使用 HTTPS，且证书出错时不允许用户继续访问。局限是首次访问前浏览器还不知道 HSTS 策略，需要 HSTS 预加载来弥补。
:::

:::details 7. openssl s_client 返回 `Verify return code: 20 (unable to get local issuer certificate)` 通常说明什么？
无法构建到本地信任根的路径，常见原因是服务器没有发送中间证书，或证书由本机不信任的私有 CA 签发。
:::

:::details 8. mTLS 和普通 TLS 有什么区别？能替代授权吗？
mTLS 中服务端还会要求并校验客户端证书，实现双向身份认证，常用于服务间调用和 IoT 设备接入。它只解决“是谁”，不能替代授权，仍然需要根据证书身份检查访问权限。
:::

## 一句话总结

TLS 用证书和签名确认对方身份、用 ECDHE 协商具备前向保密的密钥、用 AEAD 加密传输，但它的一切保护都建立在“认真校验证书”之上：永远不要信任所有证书，私有 CA 用专用信任库，并记住小锁只保护传输过程，不代表对方可信。
