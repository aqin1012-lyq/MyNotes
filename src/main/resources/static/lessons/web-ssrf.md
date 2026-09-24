## 为什么要学

SSRF（Server-Side Request Forgery，服务端请求伪造）一句话：**攻击者给你一个 URL，你的服务器替他去请求。** 请求是从你的服务器发出的，所以它能到达攻击者自己到不了的地方：`127.0.0.1` 上的管理端口、内网里的 Redis/Elasticsearch/Actuator、以及云主机上那个只对本机开放的元数据服务 `169.254.169.254`。

这是整条路线上“贯穿性”最强的漏洞。在 [[net-trace]] 的全链路图里，SSRF 相当于让你的 Spring Boot 服务反过来当“浏览器”，把 DNS → TCP → HTTP 再走一遍，只不过这次出发点在你的内网里。往后看：到云原生阶段，SSRF 是偷云 IAM 临时凭证的头号入口（[[cloud-iam]]）；到 K8s 阶段，它能打到 kubelet 和集群内服务（[[k8s-hardening]]）；到 AI 阶段，给 Agent 一个 `fetch` 工具，本质上就是“内置 SSRF 功能”（[[ai-agent]]）。

对 Java 后端来说，你一定写过这些功能：商品图片“填 URL 自动抓取”、Webhook 回调地址、导出 PDF（HTML 里带外链图片）、车机/IoT 设备上报一个固件下载地址让服务端去校验。它们全都是 SSRF 入口。`new URL(userInput).openStream()`、`RestTemplate.getForObject(userUrl, ...)`、`WebClient.get().uri(userUrl)` 这一行，就是漏洞本身。

学完这一课你应该能：看到任何“服务端按用户给的地址去取东西”的功能，立刻说出它能打到哪、有哪些绕过；读懂并能自己写出 `SsrfGuard` 这类校验器；知道应用层校验的极限在哪（DNS rebinding），以及为什么最终要靠出网代理、NetworkPolicy、IMDSv2 这些网络层手段兜底。

## 核心概念

### 1. SSRF 的典型入口

判断标准只有一条：**服务端会根据用户可控的数据，发起一次网络请求**（或读取一个资源定位符）。常见入口：

| 入口 | 用户可控的部分 | 你熟悉的例子 |
|---|---|---|
| URL 预览 / 图片抓取 | 整个 URL | 商品图“输入网址自动上传”、笔记里贴图片链接（Lab 05） |
| Webhook | 回调地址 | 支付回调、GitLab/钉钉机器人、IoT 平台“数据转发到 HTTP 地址” |
| PDF / 截图生成 | HTML 里的 `img src`、`link href`、`iframe` | wkhtmltopdf、Headless Chrome 导出订单 PDF |
| 文档/文件解析 | XML 外部实体、Office 文档里的外链 | XXE（`<!ENTITY x SYSTEM "http://...">`）、SVG 渲染 |
| 远程配置/固件 | 下载地址 | 车机 OTA “校验这个固件 URL”、导入远程 Excel |
| AI Agent 工具 | 模型生成的 URL | Agent 的 `fetch(url)` / 浏览器工具，URL 可能来自提示注入 |

注意最后一行：在 Agent 场景里，URL 甚至不是用户直接填的，而是模型“读了一段网页后决定去访问”的，攻击者通过提示注入就能控制它。

### 2. 攻击目标：127.0.0.1、内网、云 Metadata

```
 Internet                 your VPC / IDC
+----------+   url=...   +-------------+   GET http://127.0.0.1:8080/actuator/env
| attacker | ----------> | app server  | --> GET http://10.0.3.7:6379/  (Redis)
+----------+  <-------   | (Spring)    | --> GET http://169.254.169.254/latest/meta-data/...
              response   +-------------+
```

- **本机 127.0.0.1**：只绑定 localhost 的管理端口（Actuator、Druid 监控页、H2 控制台、EMQX Dashboard 18083），开发者常认为“只有本机能访问所以不用鉴权”。
- **内网服务**：Redis、Elasticsearch、Consul、Nacos、内部 Admin 接口。很多内网服务“靠网络隔离代替认证”，SSRF 一来全部裸奔。
- **云元数据服务**：云厂商在每台虚拟机上提供一个链路本地地址 `169.254.169.254`（AWS、华为云等；阿里云用的是 `100.100.100.200`），虚拟机内部无需认证即可 GET 到实例信息，**以及绑定在实例上的 IAM 角色临时密钥**。

以 AWS 为例（IMDSv1 风格），攻击者只需两次 GET：

```
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/
-> mynotes-role
GET http://169.254.169.254/latest/meta-data/iam/security-credentials/mynotes-role
-> {"AccessKeyId":"ASIA...","SecretAccessKey":"...","Token":"...","Expiration":"..."}
```

拿到这三件套，攻击者就能在自己电脑上用 AWS CLI 以你的实例身份调用云 API：列 S3 桶、读数据库快照……这就是 Lab 05 里 `FakeMetadataController` 模拟的场景：它只信任回环地址（`isLoopbackAddress()`），外网直连拿不到，只能“借”服务器之手。

### 3. 绕过手法：为什么“字符串里查 127.0.0.1”一定失败

新手的第一反应是 `if (url.contains("127.0.0.1") || url.contains("localhost")) reject()`。这是黑名单里最脆弱的一种——它在“字符串”层面判断，而真正决定连到哪的是**解析之后的 IP**。同一个 `127.0.0.1` 有无数写法：

| 写法 | 实际指向 | 原理 |
|---|---|---|
| `http://2130706433/` | 127.0.0.1 | 32 位整数形式的 IPv4（Lab 05 的 curl ② 就用它） |
| `http://0x7f.0.0.1/` | 127.0.0.1 | 十六进制 |
| `http://0177.0.0.1/` | 127.0.0.1 | 八进制 |
| `http://127.1/` | 127.0.0.1 | 省略中间段 |
| `http://[::1]/` `http://[::ffff:127.0.0.1]/` | 环回 | IPv6 与 IPv4-mapped IPv6 |
| `http://localtest.me/` | 127.0.0.1 | 攻击者把域名 A 记录解析到环回 |
| `http://169.254.169.254.nip.io/` | 元数据地址 | 用公共泛解析域名指向任意 IP |

还有两类“解析差异”绕过，和字符串写法无关：

- **重定向**：URL 是合法的公网地址 `http://evil.com/img.png`，但服务器返回 `302 Location: http://169.254.169.254/...`。如果你只在第一步校验、却让 HTTP 客户端自动跟随重定向，就前功尽弃。
- **userinfo 混淆**：`http://169.254.169.254@trusted.com/` 与 `http://trusted.com@169.254.169.254/`。`@` 前是用户名，真正的主机在 `@` 后——人眼常看错，不同解析库有时也不一致。

结论：**校验必须发生在“解析成 IP 之后”，判断这个 IP 属不属于内网段**，而不是在 URL 字符串上做文本匹配。这正是下一节 `SsrfGuard` 的核心思路。

### 4. 应用层校验的极限：DNS rebinding

即使你“解析后校验 IP”，仍有一道缝：**校验时解析一次，真正发请求时 HTTP 客户端又解析一次，两次之间域名的解析结果可能变了。**

```
t0  guard: resolve attacker.com  -> 93.184.x.x (public)   校验通过
t1  client: resolve attacker.com -> 127.0.0.1  (rebind)   实际连到了本机
```

攻击者控制自己域名的权威 DNS，把 TTL 设成 0：第一次查询答一个公网 IP 骗过校验，紧接着第二次查询答 `127.0.0.1`。这就是 **DNS rebinding**（DNS 重绑定）。Lab 05 的 `SecurePreviewController` 注释里明确写了这是**故意留下的缺口**：`SsrfGuard.check()` 解析一次，随后 `HttpClient.send()` 连接时 JDK 又解析一次，两次之间无法保证一致。

补充一个细节：HotSpot 的 `InetAddress` 默认会把成功的解析结果缓存一段时间（未启用 SecurityManager 时通常是 30 秒，可用安全属性 `networkaddress.cache.ttl` 调整），所以在本 Lab 里第二次解析常会命中缓存，rebinding 不一定好复现。但这只是实现细节，不是安全保证：缓存可能被调成 0、可能过期，经过代理时代理还会自己再解析一次。

为什么应用层难以彻底修？因为 JDK 的 `HttpClient`/`HttpURLConnection` 不会把“我校验过的那个 IP”交给你去连接——它自己拿主机名重新解析。要真正堵住，得让“校验 IP”和“连接 IP”是**同一个**：要么自定义 DNS 解析并锁定，要么干脆把这件事交给网络层（见“防御”一节的出网代理/NetworkPolicy/IMDSv2）。

## 动手实践

> 攻击载荷只能打你自己的实验环境或已获授权的目标，切勿用于他人系统。

### 实践一：Lab 05 攻击复现

先跑起来（本机需要 JDK 17）：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw spring-boot:run
```

① 借服务器之手偷“云凭证”——漏洞版泄露，修复版拒绝：

```bash
curl 'localhost:8080/vuln/l05/preview?url=http://127.0.0.1:8080/internal/l05/latest/meta-data/iam/security-credentials/mynotes-role'
# {"AccessKeyId":"AKIAFAKEFORLAB05","SecretAccessKey":"lab05/fake/secret/do-not-use","Token":"fake-session-token"}
curl 'localhost:8080/secure/l05/preview?url=http://127.0.0.1:8080/internal/l05/...'
# {"timestamp":...,"status":400,"error":"Bad Request"}  <- url rejected: internal address 127.0.0.1
```

怎么读：漏洞接口把本机才能访问的元数据原样回显给了外部调用者——一次典型的 SSRF 数据泄露。你直接 `curl` 那个 `/internal/...` 地址其实也能通（因为你就是本机），但在真实云环境里你不是本机，只有服务器是；这里用 `127.0.0.1` 是在本机模拟“只有服务器够得着”的位置。

② 十进制 IP 绕过字符串黑名单：

```bash
curl 'localhost:8080/vuln/l05/preview?url=http://2130706433:8080/internal/l05/.../mynotes-role'
# 一样泄露：2130706433 == 127.0.0.1
```

怎么读：如果修复代码写的是 `host.equals("127.0.0.1")`，这一条就绕过去了。`secure` 接口因为是“解析成 IP 再判断”，照样返回 400。

③ 换协议读本地文件：

```bash
curl 'localhost:8080/vuln/l05/preview?url=file:///etc/hosts'   # 打印出 /etc/hosts 内容
curl 'localhost:8080/secure/l05/preview?url=file:///etc/hosts' # 400 url rejected: only http/https
```

怎么读：漏洞版用 `URI.create(url).toURL().openStream()`，`URL` 支持 `file:`/`jar:`/`ftp:` 等协议，于是 SSRF 顺带变成了任意文件读取。

> 若本机开了系统代理（Clash 等），② 可能返回 502：请求被 JDK 交给了代理而非直连本机。`SsrfTests` 在 `@BeforeAll` 里临时清掉了 `http.proxyHost` 等属性，就是为此。这现象本身值得记住：**服务端出网流量经过谁，SSRF 就能打到谁**——这正是“出网代理”既是隐患也是解法的原因。

### 实践二：跑测试看攻防对照

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw test -Dtest=SsrfTests
```

怎么读：`SsrfTests` 的每个用例都是“同一个攻击打两个接口”——`/vuln` 必须被打穿（断言泄露了 `SECRET`），`/secure` 必须挡住（断言 `isBadRequest()`）。`guardRejectsInternalAndOddUrls` 一次性列出了十几种应被拒绝的写法（`localhost`、`[::1]`、`[::ffff:127.0.0.1]`、`2130706433`、`10/172/192` 内网段、`100.100.100.200` 阿里云元数据段、非 80/443 端口、userinfo、`ftp:`/`gopher:`/`jar:`），`guardAllowsPublicHttpUrls` 则确认公网地址放行。全绿说明修复既挡住了攻击，也没误伤正常图片。

### 实践三：逐行读懂 SsrfGuard

`SsrfGuard.check(url)` 的思路是先“限定 URL 的形状”，再“看它到底解析到哪个 IP”。逐段看：

```java
uri = URI.create(url.strip());            // 解析失败 -> 400 malformed url
String scheme = uri.getScheme()==null ? "" : uri.getScheme().toLowerCase();
if (!SCHEMES.contains(scheme)) reject("only http/https");   // 挡 file:/jar:/ftp:/gopher:
if (uri.getRawUserInfo() != null) reject("userinfo not allowed"); // 挡 http://a@b/ 混淆
if (!PORTS.contains(uri.getPort())) reject("only ports 80/443");  // 否则=内网端口扫描器
if (uri.getHost() == null) reject("missing host");
```

- `SCHEMES = {"http","https"}`：**协议白名单**。只允许两种协议，`file:`（读文件）、`gopher:`（能构造任意 TCP 报文打 Redis）、`jar:` 全部出局。白名单永远比“黑名单列禁止协议”可靠。
- `getRawUserInfo() != null`：URL 里出现 `@` 就拒。堵掉 `http://trusted.com@169.254.169.254/` 这类人机理解不一致的混淆。
- `PORTS = {-1, 80, 443}`：**端口白名单**（`-1` 表示 URL 没写端口，用协议默认）。不限端口的话，这个预览功能就成了内网端口扫描器——填 `http://10.0.0.5:6379` 探活 Redis。
- 注意：**协议、端口、userinfo 都是对 URL 字符串结构的校验，还没碰网络。**

核心在最后这段——**解析域名后校验每一个 IP**：

```java
for (InetAddress address : InetAddress.getAllByName(uri.getHost())) {
    if (isInternal(address)) reject("internal address " + address.getHostAddress());
}
```

- `getAllByName` 会做真正的 DNS 解析，且返回**所有** A/AAAA 记录——攻击者可能给一个域名配多条记录，只要有一条是内网就拒。
- `isInternal()` 先用 JDK 自带的判断覆盖大类：`isLoopbackAddress()`（127/8）、`isLinkLocalAddress()`（169.254/16，**云元数据就在这里**）、`isSiteLocalAddress()`（10/8、172.16/12、192.168/16）、`isAnyLocalAddress()`（0.0.0.0）、`isMulticastAddress()`。
- 再手工补 JDK 没覆盖的保留段：`0/8`、`100.64/10`（运营商级 NAT，**阿里云元数据 100.100.100.200 落在这里**）、`198.18/15`（基准测试）、`240/4`（保留），IPv6 的 `fc00::/7`（唯一本地地址）。位运算 `(second & 0xc0)==64` 就是判断“高两位是 01”即 64–127，用来匹配 `100.64/10` 这种非整字节边界的网段。

`SecurePreviewController` 里还有两道校验，配合 `SsrfGuard` 才完整：

```java
HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)  // 不跟随重定向
if (!type.startsWith("image/")) reject;   // Content-Type 必须是 image/*
byte[] bytes = body.readNBytes(MAX_BYTES + 1);  // 限制 5MB，再返回也只回元数据不回内容
```

- **不跟随重定向**是关键的一环：否则一个通过校验的公网 URL 用 302 跳到 `169.254.169.254`，`SsrfGuard` 完全看不到。这也回答了“为什么不重定向后再校验一次”——最省事、最不易出错的做法是干脆禁止，让业务在应用层拿到 302 自己决定。
- 只返回 `Preview(url, contentType, bytes)` 这三个字段，**绝不把抓回来的字节当文本回显**。这样即便有盲 SSRF，也拿不到响应体内容。

### 实践四：PortSwigger SSRF（Apprentice）

到 PortSwigger 的 SSRF 靶场做两个入门实验（需注册，免费）：一是“Basic SSRF against the local server”——把商品库存查询接口的 `stockApi` 参数改成 `http://localhost/admin`，再 `http://localhost/admin/delete?username=carlos` 删掉用户；二是“Basic SSRF against another back-end system”——把参数指向 `http://192.168.0.X:8080/admin`，需要先爆破内网网段的最后一段找到管理主机。

怎么读：这两个实验对应本课两个目标——**打本机 127.0.0.1/localhost** 和**打内网另一台主机**。做完你会发现，漏洞点和 Lab 05 一模一样：一个“服务端按参数去请求”的功能，没有对目标地址做任何限制。

## 攻击者视角

一次 SSRF 利用通常按这个顺序展开，收益递增：

```
1. 探测有没有出网/内网可达  ->  url 指向自己控制的服务器，看有没有回连（含盲 SSRF）
2. 扫本机与内网              ->  改端口/IP，看响应时间与状态码差异判断端口开放
3. 打无认证的内网服务        ->  Actuator /env /heapdump、Redis、ES、Nacos
4. 偷云元数据凭证            ->  169.254.169.254 / 100.100.100.200 拿 IAM 临时密钥
5. 用凭证横向移动            ->  在自己机器上用 AWS/华为云 CLI 以你的身份调云 API
```

- **盲 SSRF**：响应不回显时，用带外（OAST/DNS 日志）确认请求真的发出去了——服务器去解析了 `attacker.oast.site`，你的 DNS 日志就有记录。
- **协议花招**：`gopher://` 能构造任意字节的 TCP 载荷，向 Redis 发 `SET`/`CONFIG` 命令写计划任务或 SSH key，把“只读 SSRF”升级成 RCE。这也是为什么协议白名单如此重要。
- **和其他漏洞的联动**：XXE（XML 外部实体）本质上也能发起 SSRF；反序列化里的 gadget（[[web-deser]]）常借 JNDI 发起 SSRF/远程加载；Log4Shell（[[web-rce]]）也是先由一个 JNDI lookup 发起外连。SSRF 常是攻击链的“第一跳”。

## 防御与最佳实践

分两层：应用层尽力，网络层兜底。

**应用层（就是 `SsrfGuard` 的做法）：**

- 协议白名单（只 http/https）、端口白名单（只 80/443）、禁止 userinfo。
- **解析成 IP 后**校验每个 IP 是否属于内网/保留段，而不是对 URL 字符串做文本匹配。
- 禁止跟随重定向（或每一跳都重新用同样规则校验）。
- 校验 `Content-Type`、限制大小与超时，不回显抓取内容。
- 能用**域名白名单**就别用黑名单：如果图片只可能来自自家 CDN，直接 `host.endsWith(".mycdn.com")`，比“禁止所有内网段”安全得多。白名单适合来源固定的场景（CDN、指定合作方 Webhook）；黑名单适合来源开放、只能排除已知危险的场景。

**网络层（应对 DNS rebinding 等应用层堵不住的情况）：**

- **出网统一走代理**（如 Smokescreen）：应用不直接连外网，代理在**建立连接的那一刻**校验真实目标 IP。因为“校验”和“连接”是同一次解析、同一个 IP，DNS rebinding 就失效了。
- **容器/K8s NetworkPolicy、云安全组**：直接从网络上禁止业务 Pod 访问内网管理段和 `169.254.169.254`。攻击者即使绕过应用校验，数据包也出不去。
- **云上开启 IMDSv2**：把元数据服务从“一个 GET 就返回凭证”改成“先 `PUT /latest/api/token`（带 `X-aws-ec2-metadata-token-ttl-seconds` 头）拿 token，再在 GET 时带上 `X-aws-ec2-metadata-token` 头”。简单的 GET 型 SSRF 发不出 PUT、也带不上自定义头，自然拿不到凭证。这就是为什么“IMDSv2 挡住了偷凭证这一步”。AWS 上的开启方式：`aws ec2 modify-instance-metadata-options --instance-id i-xxx --http-tokens required --http-put-response-hop-limit 1`（hop limit 限制 token 响应能经过的网络跳数；容器场景常需设为 2，以 AWS 文档为准）。华为云等其他云是否有同类机制、如何开启，请查对应官方文档。

K8s 里用 NetworkPolicy 禁止 Pod 访问元数据与内网（前提：CNI 插件支持 NetworkPolicy，如 Calico/Cilium）：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: app-egress
  namespace: mynotes
spec:
  podSelector:
    matchLabels:
      app: mynotes
  policyTypes: ["Egress"]
  egress:
  - to:                       # allow DNS to kube-dns
    - namespaceSelector: {}
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
    - protocol: UDP
      port: 53
  - to:                       # allow public internet only
    - ipBlock:
        cidr: 0.0.0.0/0
        except: ["169.254.169.254/32", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"]
```

一句话记法：**应用层把明显的挡掉，网络层保证即使漏了也打不出去。**

## 常见误区

- **“只有本机能访问，所以不用鉴权。”** SSRF 的全部意义就是“借服务器之手访问只有本机能访问的东西”。管理端口、Actuator、监控页一律要鉴权。
- **“我校验了 URL 里没有 127.0.0.1 / localhost。”** 见第 3 节：十进制、十六进制、IPv6、指向环回的域名全能绕过。必须解析成 IP 再判断。
- **“我解析后校验了 IP，稳了。”** 还有 DNS rebinding：校验和连接是两次解析。应用层难彻底修，要靠网络层。
- **“禁用了内网段就行。”** 别忘了 `169.254.169.254`（链路本地）和 `100.64/10`（部分云的元数据段），以及 IPv6 的环回 `::1` 和唯一本地 `fc00::/7`。
- **“跟随重定向没关系，我校验过初始 URL 了。”** 302 到元数据地址就绕过了初始校验，必须禁止重定向或每跳都校验。
- **“SSRF 顶多探探内网。”** 在云上它直接等于偷 IAM 凭证、横向进整个云账号，危害远大于机房内网。

## 自测

:::details 1. 为什么 SSRF 在云上的危害远大于在机房里？IMDSv2 挡住了哪一步？
机房里 SSRF 大多止步于“访问内网服务”，还要逐个找漏洞。云上则有一个统一的、无认证的元数据服务 `169.254.169.254`（阿里云 `100.100.100.200`），一个 GET 就能拿到绑定在实例上的 **IAM 角色临时密钥**（AccessKey/Secret/Token）。攻击者拿到后在自己机器上就能以你的实例身份调用云 API，可能横向拿下整个云账号——影响从“一台机器”放大到“整个账号的资源”。IMDSv2 把取凭证从“一次 GET”改成“先 PUT 拿 token，再带 token GET，且响应跳数受限”，简单的 GET 型 SSRF 发不出 PUT、加不上自定义请求头，于是拿不到 token，也就拿不到凭证——挡住的正是“偷凭证”这一步。
:::

:::details 2. 为什么“检查 URL 字符串里有没有 127.0.0.1”一定会被绕过？列 5 种写法。
因为决定连到哪的是 DNS/协议栈解析后的 IP，不是字符串本身。等价写法：`http://2130706433/`（十进制整数）、`http://0x7f.0.0.1/`（十六进制）、`http://0177.0.0.1/`（八进制）、`http://127.1/`（省略段）、`http://[::1]/` 或 `http://[::ffff:127.0.0.1]/`（IPv6/映射）、`http://localtest.me/`（把域名解析到环回）。正确做法是解析成 `InetAddress` 后用 `isLoopbackAddress()` 等判断。
:::

:::details 3. 解析后校验 IP 为什么还会被 DNS rebinding 绕过？怎么在连接时校验？
因为校验时 `getAllByName` 解析一次，随后 HTTP 客户端连接时又独立解析一次，两次之间攻击者的低 TTL DNS 可以把结果从公网 IP 换成 127.0.0.1（先骗过校验，再连到内网）。要在连接时校验，就得让“被校验的 IP”和“被连接的 IP”是同一个：自定义 DNS 解析并把解析结果锁定后直接连该 IP；或者更彻底地交给出网代理，由代理在建立连接的那一刻校验真实目标 IP。
:::

:::details 4. 为什么禁止重定向，而不是“重定向后再校验一次”？
`HttpURLConnection` 默认会自动跟随同协议重定向，跟随发生在库内部，你的校验代码根本看不到中间那一跳。攻击者用一个合法公网 URL 返回 `302 Location: http://169.254.169.254/...` 就绕过了初始校验。“重定向后再校验”需要你关掉自动跟随、手动拿到每个 `Location` 再逐跳套用同样规则，容易漏；直接 `followRedirects(NEVER)` 最简单可靠，Lab 05 就是这么做的。
:::

:::details 5. 白名单和黑名单各适合什么场景？
白名单（只允许自家 CDN 等固定域名）适合来源可枚举的场景，最安全，能直接杜绝内网访问；缺点是不灵活。黑名单（禁止内网段/元数据地址）适合来源开放、必须允许任意公网地址的场景（如通用的“抓取任意网页图片”），只能排除已知危险，永远可能被新写法绕过，需配合网络层兜底。能用白名单就别用黑名单。
:::

:::details 6. 这些功能的 SSRF 入口分别在哪：Webhook、PDF 生成、XXE、AI Agent 的 fetch 工具？
Webhook：用户填的回调地址，服务端 POST 过去。PDF 生成：HTML 里的 `img/link/iframe` 外链，渲染器去抓取。XXE：XML 里的外部实体 `<!ENTITY x SYSTEM "http://...">`，解析器去请求（XXE 本质就是一种 SSRF）。AI Agent：模型生成或从网页读到的 URL 传给 `fetch` 工具，URL 可能被提示注入控制。共性都是“服务端按不可信数据发起请求”。
:::

:::details 7. 回到 net-trace 全链路图，SSRF 发生在哪一环？
SSRF 让你的服务器从“服务端”角色反转为“客户端”，主动发起 DNS→TCP→(TLS)→HTTP 这一整套流程。它发生在“应用服务器对外/对内发起请求”的那一跳——本该是浏览器做的事，现在由你的 Spring Boot 服务替攻击者做，且出发点在你的内网。
:::

## 一句话总结

SSRF 就是“攻击者给 URL、服务器替他发请求”，最大威胁是偷云元数据里的 IAM 凭证；应用层要做协议/端口/域名白名单并**解析成 IP 后**校验、禁止重定向、不回显内容，但 DNS rebinding 这类缝隙最终得靠出网代理、NetworkPolicy 和 IMDSv2 在网络层兜底。
