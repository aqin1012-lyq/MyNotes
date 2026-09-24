## 为什么要学

在 [[net-trace]] 里我们画出了一次请求的全链路，TCP 是其中“建立连接”那一环。你做 Java 后端 6 年，天天和 TCP 打交道：HikariCP 连 MySQL、Lettuce 连 Redis、EMQX 上成千上万的 MQTT 长连接、Feign/RestTemplate 调下游，全部跑在 TCP 上。只是框架把它藏得太好，平时只有在“连接超时”“Connection reset by peer”“CLOSE_WAIT 堆积导致句柄耗尽”时才会想起它。

这一课**不重学大学课本**（拥塞控制、滑动窗口的数学细节都跳过），只抓对**排障和安全**有用的部分：地址与端口、三次握手、四次挥手、连接状态，以及利用 TCP 状态做的攻击（SYN Flood）和侦察（端口扫描）。安全方向后面的很多内容都建立在这里：Nmap 扫描结果怎么读、防火墙为什么“丢弃”和“拒绝”效果不同、Linux 内核参数加固、K8s NetworkPolicy、IoT 设备长连接的保活与抗 DoS。

学完之后你应该能：

- 看懂 `tcpdump` 抓到的握手/挥手报文，说出每个标志位的含义。
- 用 `ss -tan` 看一眼服务器，判断连接是否健康，大量 `CLOSE_WAIT` / `TIME_WAIT` 分别该找谁。
- 解释 SYN Flood 的原理和 SYN Cookie 为什么有效，解释端口扫描如何区分 open / closed / filtered。

## 核心概念

### 1. IP、子网、路由、端口，以及私有地址段

**IP 地址**标识“哪台主机（的哪块网卡）”，**端口**标识“这台主机上的哪个进程”。一个 TCP 连接由**四元组**唯一确定：`源IP:源端口 → 目的IP:目的端口`。所以同一个客户端可以同时开很多条到 `mysql:3306` 的连接（源端口不同），连接池就是这么工作的。

**子网**用 CIDR 表示：`192.168.1.0/24` 表示前 24 位是网络号，后 8 位是主机号，共 256 个地址（可分配给主机的一般是 `.1`～`.254`，`.0` 是网络地址，`.255` 是广播地址）。`/16` 就是 65536 个地址，`/32` 表示单个 IP。目的地址在同一子网内，直接在二层（ARP 找 MAC）发送；不在同一子网，就交给**默认网关**（路由器）。路由器根据**路由表**按“最长前缀匹配”决定下一跳。

```
$ ip route              # Linux 查看路由表（macOS 用 netstat -rn）
default via 192.168.1.1 dev eth0            <- 不认识的目的地都交给网关
10.8.0.0/16 via 10.0.0.254 dev eth1         <- 去 10.8.x.x 走专线
192.168.1.0/24 dev eth0 proto kernel        <- 本子网，直接发
```

**私有地址段**（RFC 1918）不在公网路由，只能在内网用，出公网要经过 NAT（见 [[net-infra]]）：

| 地址段 | CIDR | 范围 | 常见场景 |
|---|---|---|---|
| A 类私有 | `10.0.0.0/8` | 10.0.0.0 – 10.255.255.255 | 大型企业内网、云 VPC、K8s Pod 网段 |
| B 类私有 | `172.16.0.0/12` | 172.16.0.0 – 172.31.255.255 | Docker 默认网桥（172.17.0.0/16） |
| C 类私有 | `192.168.0.0/16` | 192.168.0.0 – 192.168.255.255 | 家用路由器、车间/门店小网络 |

另外几个安全上必须认识的特殊地址：`127.0.0.0/8`（回环，本机）、`0.0.0.0`（监听时表示“所有网卡”）、`169.254.0.0/16`（链路本地，云厂商的元数据服务 `169.254.169.254` 就在这里）、`100.64.0.0/10`（运营商级 NAT 共享地址）。IPv6 中 `::1` 是回环，`fc00::/7` 是唯一本地地址，`fe80::/10` 是链路本地。

:::tip 和安全的关系
SSRF 防护要拦的就是这张表：回环、私有、链路本地地址。本仓库 Lab 05 的 `SsrfGuard.isInternal()` 正是用 `InetAddress` 的 `isLoopbackAddress()`、`isSiteLocalAddress()`、`isLinkLocalAddress()` 等判断。注意 `172.16/12` 是 172.16～172.31，不是整个 172.x；手写正则判断很容易写错，优先用库方法。
:::

**端口**范围 0～65535。0～1023 是“知名端口”，Linux 上普通用户默认不能监听（所以 Spring Boot 用 8080）。客户端发起连接时，操作系统从**临时端口范围**里随机挑一个源端口（Linux 看 `/proc/sys/net/ipv4/ip_local_port_range`，常见默认 32768–60999）。常用端口：22 SSH、53 DNS、80/443 HTTP(S)、1883/8883 MQTT(明文/TLS)、3306 MySQL、6379 Redis、8080 Spring Boot。

监听地址同样重要：`127.0.0.1:8080` 只有本机能连，`0.0.0.0:8080` 所有网卡都能连。本项目 `application.properties` 里的 `server.address=127.0.0.1` 就是为了让 `/vuln/**` 只在本机可达。Redis、MySQL 暴露在 `0.0.0.0` 且没有认证，是真实世界里被入侵的常见原因之一。

### 2. 三次握手：SYN、SYN-ACK、ACK，以及为什么是三次

TCP 头里有几个关键**标志位**：`SYN`（请求同步序号，建连）、`ACK`（确认号有效）、`FIN`（我没有数据要发了）、`RST`（立即重置/拒绝连接）、`PSH`（尽快交给应用）。每个方向都有自己的**序号（seq）**，用来给字节编号；对方用**确认号（ack）**告诉你“我已收到到这里为止的数据，下一个期待 x”。

```
Client (192.168.1.5:52344)              Server (10.0.0.8:8080)
  CLOSED                                  LISTEN
    |---- SYN, seq=x ----------------------->|   第 1 次：我要建连，我的初始序号是 x
  SYN_SENT                                SYN_RCVD
    |<--- SYN+ACK, seq=y, ack=x+1 -----------|   第 2 次：收到了；我的初始序号是 y
  ESTABLISHED                                |
    |---- ACK, seq=x+1, ack=y+1 ------------>|   第 3 次：收到你的 y 了
    |                                     ESTABLISHED
```

**为什么是三次，不是两次？** 核心是：**双方都要确认“对方收到了我的初始序号”**。第 2 次握手让客户端知道服务端收到了 x，第 3 次让服务端知道客户端收到了 y。只有两次的话，服务端无法确认客户端是否真的存在、是否真的想建连。RFC 9293 给出的直接理由是**防止历史重复的连接请求造成混乱**：网络里滞留的一个旧 SYN 迟到了，如果两次握手就建连，服务端会为一个客户端早已放弃的连接分配资源；三次握手时，客户端收到不认识的 SYN-ACK 会回 RST，这个旧连接就不会建立。

**初始序号（ISN）为什么要随机？** 如果 ISN 可预测，攻击者即使收不到 SYN-ACK（因为他伪造了源 IP），也能猜出 y，接着发出伪造的第 3 次 ACK 和数据，冒充受信任 IP（历史上的“TCP 序号预测攻击”）。现代操作系统的 ISN 都是随机化的。这也是 [[net-trace]] 里说“完成握手的连接，源 IP 基本可信”的原因：伪造源 IP 的人收不到 SYN-ACK，握手就完成不了。

**握手在 Java 里对应什么？** 服务端 `new ServerSocket(8080)` 之后内核就能完成握手，完成的连接进入 **accept 队列**，等 `accept()` 取走；还没完成（收到 SYN、回了 SYN-ACK、等 ACK）的在 **SYN 队列（半连接队列）**。客户端 `socket.connect(addr, timeoutMs)` 就是发 SYN 并等握手完成，`connectTimeout` 管的就是这一段。Tomcat 的 `server.tomcat.accept-count` 影响的正是 accept 队列长度（实际上限还受内核 `net.core.somaxconn` 约束）。

### 3. 四次挥手与 TIME_WAIT / CLOSE_WAIT

TCP 是全双工的，两个方向要**各自关闭**，所以是“四次”（FIN、ACK、FIN、ACK；实际中间两个有时合并成一个报文）。谁先调用 `close()`，谁就是**主动关闭方**。

```
Active closer (A)                      Passive closer (B)
  ESTABLISHED                            ESTABLISHED
    |---- FIN ------------------------------>|   A 调用 close()
  FIN_WAIT_1                             CLOSE_WAIT   <- B 内核自动回 ACK，等 B 的应用 close()
    |<--- ACK -------------------------------|
  FIN_WAIT_2                                 |        <- B 还可以继续发数据
    |<--- FIN -------------------------------|   B 的应用调用 close()
  TIME_WAIT                              LAST_ACK
    |---- ACK ------------------------------>|
  (wait 2*MSL)                           CLOSED
  CLOSED
```

**TIME_WAIT 出现在主动关闭方**，要等 2×MSL（MSL 是报文在网络中的最大生存时间；Linux 的 TIME_WAIT 固定约 60 秒）。它存在的两个理由：一是如果最后那个 ACK 丢了，B 会重发 FIN，A 还在 TIME_WAIT 就能再回 ACK；二是让这条四元组上迟到的旧报文在网络中消失，避免被下一条复用相同四元组的新连接误收。

大量 TIME_WAIT 通常出现在**频繁发起短连接的一方**：比如每次调用都 `new` 一个 HTTP 客户端、不复用连接，或者压测机。它一般不是 bug，但可能耗尽临时端口，导致 `Cannot assign requested address`。正确的解决是**用连接池/keep-alive 复用连接**（HttpClient、OkHttp、HikariCP 都有），而不是一上来就调内核参数。

**CLOSE_WAIT 出现在被动关闭方**：对方已经发了 FIN，内核也回了 ACK，**但你的应用一直没调用 `close()`**。内核不会替你关，这个状态可以一直保持下去，占着文件描述符。所以：

> 线上大量 CLOSE_WAIT，几乎总是**自己这一端的代码问题**：连接/流没关、连接池泄漏、线程卡住没走到 close。

Java 里常见的原因：

- 用 `HttpURLConnection` / Apache HttpClient 拿到响应后没有读完并关闭 `InputStream` / `CloseableHttpResponse`，连接既没回到池里也没关闭。
- 没用 try-with-resources，异常路径跳过了 `close()`。
- 下游（MySQL、Redis）因空闲超时主动断开了连接，但连接池里的连接没被检测和回收（需要合理的空闲超时和存活检测，例如 HikariCP 的 `maxLifetime` 要小于数据库端的超时）。
- 业务线程被阻塞（死锁、等锁、等下游），走不到关闭连接的代码。可以用 `jstack` 看线程卡在哪里。

```java
// 正确：try-with-resources 保证异常时也会关闭（Apache HttpClient 5）
try (CloseableHttpResponse resp = client.execute(new HttpGet(url))) {
    String body = EntityUtils.toString(resp.getEntity()); // 读完实体，连接才能复用
    return body;
}
```

### 4. TCP 状态机、SYN Flood 与 SYN Cookie

把上面两张图合起来就是 TCP 状态机。排障时最常看的状态：

| 状态 | 在哪一方 | 含义 | 大量出现时怀疑 |
|---|---|---|---|
| `LISTEN` | 服务端 | 在监听端口 | 检查监听地址是否过宽（0.0.0.0） |
| `SYN-SENT` | 客户端 | 发了 SYN 在等回应 | 目标不可达、被防火墙丢弃 |
| `SYN-RECV` | 服务端 | 回了 SYN-ACK 在等 ACK | SYN Flood，或客户端网络差 |
| `ESTABLISHED` | 双方 | 连接正常 | 连接数是否超出预期（连接池配置、泄漏） |
| `CLOSE-WAIT` | 被动关闭方 | 对方关了，我还没关 | **自己的代码没 close** |
| `TIME-WAIT` | 主动关闭方 | 等待 2MSL | 短连接太多，没复用连接 |
| `FIN-WAIT-2` | 主动关闭方 | 等对方的 FIN | 对方一直处于 CLOSE_WAIT |

**SYN Flood**：攻击者大量发送 SYN（通常伪造随机源 IP），却从不完成第 3 次握手。服务端每收到一个 SYN 就在半连接队列里记一条、回一个 SYN-ACK 并重传几次，队列被占满后，正常用户的 SYN 就被丢弃，表现为“连不上”。它利用的正是“服务端在握手完成前就要为连接保存状态”这一点。

**SYN Cookie** 的思路是：**队列满了就不保存状态**。服务端把连接的关键信息（四元组、时间计数、MSS 编码）经过带密钥的哈希编进 SYN-ACK 的初始序号 y 里发出去。真实客户端回 ACK 时带回 `ack=y+1`，服务端据此校验并还原信息，再建立连接；伪造源 IP 的攻击者根本收不到 y，也就无法完成握手，却也不再占用服务端内存。代价是部分 TCP 选项（例如窗口缩放）信息可能丢失或受限。Linux 用 `net.ipv4.tcp_syncookies` 控制，常见发行版默认值为 1（仅在半连接队列溢出时启用）。

```
$ sysctl net.ipv4.tcp_syncookies net.ipv4.tcp_max_syn_backlog
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 1024       <- 具体数值因内核和内存而异
```

SYN Cookie 缓解的是**状态耗尽**；如果攻击流量大到把带宽打满，就只能靠上游清洗（云厂商 DDoS 防护、CDN）了。

### 5. UDP 与 TCP 的差异，为什么 DNS 主要走 UDP

| 对比项 | TCP | UDP |
|---|---|---|
| 连接 | 先握手，有状态 | 无连接，直接发 |
| 可靠性 | 确认、重传、按序、流量/拥塞控制 | 不保证到达、不保证顺序 |
| 边界 | 字节流（应用自己分帧，比如 MQTT 的剩余长度字段） | 保留报文边界，一个 datagram 一条消息 |
| 开销 | 首包前至少 1 个 RTT 握手 | 无握手，头部仅 8 字节 |
| 源 IP 伪造 | 伪造者无法完成握手 | 很容易伪造，因此被用于**反射放大攻击** |
| 典型协议 | HTTP/1.1、HTTP/2、MySQL、MQTT、SSH | DNS、NTP、DHCP、QUIC（HTTP/3）、CoAP |

**DNS 主要走 UDP**，因为典型查询就是“一问一答”，请求和响应都很小：用 UDP 一个来回就结束，不需要握手，解析器能用很少的资源服务海量客户端。丢了就由客户端超时重试。当响应超过 UDP 能承载的大小（响应里会置 TC 截断位），或者做区域传送（AXFR）时，改用 **TCP 53**。

UDP 无握手也带来安全问题：攻击者伪造受害者 IP 向开放的 DNS/NTP/Memcached 等服务发小请求，服务端把大得多的响应发给受害者，这就是**反射放大 DDoS**。所以不要对公网开放递归 DNS 或 UDP 服务。

### 6. 问题：大量 CLOSE_WAIT 是谁的问题？端口扫描如何判断端口状态？

**CLOSE_WAIT**：见第 3 节。CLOSE_WAIT 处在**被动关闭方**，意思是“对方已经关了，我方应用还没关”。对方主动断开是正常行为（空闲超时、对方重启都会这样），真正的问题是**自己代码没有 close**。所以大量 CLOSE_WAIT 出现在哪台机器上，就先查那台机器上的程序：用 `ss -tanp state close-wait` 找到进程和对端地址，再用 `jstack` 看线程，检查对应客户端的资源释放。

**端口扫描的判断依据**就是 TCP 对不同情况的**不同响应**。以最常见的 SYN 扫描（Nmap `-sS`，也叫半开扫描）为例：

| 扫描器发 SYN 后收到 | 说明 | Nmap 判定 |
|---|---|---|
| `SYN-ACK` | 有进程在监听，内核愿意握手 | `open`（扫描器随后发 RST，不完成握手） |
| `RST`（RST-ACK） | 主机可达，但该端口没有进程监听 | `closed` |
| 没有任何响应（重试后仍无） | 包被防火墙静默丢弃（DROP） | `filtered` |
| ICMP 目的不可达（如 administratively prohibited） | 防火墙 REJECT 或路由器拒绝 | `filtered` |

所以防火墙策略会直接影响攻击者能拿到的信息：`DROP` 让扫描变慢并只能得到 `filtered`；`REJECT` 回应更快，对内网排障更友好，但也明确告诉对方“这里有防火墙”。另外，“closed”也有价值：它说明**这台主机是活的**。不需要 root 权限时 Nmap 会退回 `-sT`（完整 connect 扫描），判定逻辑相同，但会完成握手，更容易被应用日志记录。UDP 扫描（`-sU`）更难判断：没有响应既可能是 open 也可能是 filtered，只有收到 ICMP 端口不可达才能判定 closed。

## 动手实践

:::warn 授权
本课的抓包和扫描只能针对你自己的机器、自己的环境或获得授权的目标。
:::

### 实践 1：用 tcpdump 抓一次三次握手和四次挥手

先在一个终端启动本项目（`./mvnw spring-boot:run`，监听 `127.0.0.1:8080`），另一个终端开始抓包。macOS 回环网卡叫 `lo0`，Linux 叫 `lo`：

```
sudo tcpdump -i lo0 -nn 'tcp port 8080'
```

`-nn` 表示不把 IP 和端口解析成名字。第三个终端发一个请求，并让 curl 不复用连接：

```
curl -s -o /dev/null -H 'Connection: close' http://127.0.0.1:8080/
```

示例输出（时间戳和部分字段已省略，数值每次不同）：

```
127.0.0.1.52344 > 127.0.0.1.8080: Flags [S], seq 1776931121, win 65535, options [mss 16344,...]
127.0.0.1.8080 > 127.0.0.1.52344: Flags [S.], seq 2403216950, ack 1776931122, win 65535, ...
127.0.0.1.52344 > 127.0.0.1.8080: Flags [.], ack 1, win 6379
127.0.0.1.52344 > 127.0.0.1.8080: Flags [P.], seq 1:79, ack 1, length 78: HTTP: GET / HTTP/1.1
127.0.0.1.8080 > 127.0.0.1.52344: Flags [.], ack 79, win 6378
127.0.0.1.8080 > 127.0.0.1.52344: Flags [P.], seq 1:1024, ack 79, length 1023: HTTP: HTTP/1.1 200
127.0.0.1.52344 > 127.0.0.1.8080: Flags [.], ack 1024, win 6363
127.0.0.1.8080 > 127.0.0.1.52344: Flags [F.], seq 1024, ack 79
127.0.0.1.52344 > 127.0.0.1.8080: Flags [.], ack 1025
127.0.0.1.52344 > 127.0.0.1.8080: Flags [F.], seq 79, ack 1025
127.0.0.1.8080 > 127.0.0.1.52344: Flags [.], ack 80
```

怎么读：

- 标志位缩写：`S`=SYN，`.`=ACK，`P`=PSH，`F`=FIN，`R`=RST。`[S.]` 就是 SYN-ACK。
- 前三行是三次握手。注意第 2 行 `ack 1776931122` 正好是客户端 seq + 1。握手之后 tcpdump 默认显示**相对序号**（`ack 1`、`seq 1:79`），加 `-S` 可显示绝对序号。
- `seq 1:79, length 78` 是客户端发出的 78 字节 HTTP 请求；服务端 `ack 79` 表示“收到 78 字节，下一个期待第 79 字节”。
- 后四行是挥手。这里 `Connection: close` 让**服务端（Tomcat）先发 FIN**，所以服务端是主动关闭方，TIME_WAIT 会留在服务端的 `8080 ↔ 52344` 这条连接上；去掉这个头时，curl 退出时通常由客户端先关。顺序和谁先关取决于实现，读图时以 `F` 出现的方向为准。
- FIN 本身占一个序号，所以对 `seq 1024` 的 FIN 回的是 `ack 1025`。

同样的包用 Wireshark 打开（`tcpdump -w hs.pcap` 保存后打开），过滤器输入 `tcp.port == 8080`，右键选 “Follow → TCP Stream” 可以看到完整的 HTTP 内容。全链路抓包的方法见 [[net-trace]]，这里不再重复。

### 实践 2：用 ss -tan 观察 Spring Boot 连接的各种状态

`ss` 是 Linux 命令（iproute2），macOS 上没有，可以用 `netstat -an -p tcp` 代替，或在 Docker 里跑一个 Linux 容器练习。在 Linux 上启动 Spring Boot 后：

```
$ ss -tanl 'sport = :8080'          # -t TCP, -a 全部, -n 数字, -l 只看监听
State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port
LISTEN  0       100     127.0.0.1:8080       0.0.0.0:*
```

- `Local Address` 是 `127.0.0.1:8080`，说明只监听回环；如果是 `*:8080` 或 `0.0.0.0:8080` 就是所有网卡。
- 对 LISTEN 行，`Send-Q` 是 accept 队列的上限（这里 100 是 Tomcat 默认的 `accept-count`），`Recv-Q` 是当前排队、还没被 `accept()` 取走的连接数。`Recv-Q` 持续接近 `Send-Q`，说明应用处理不过来。

制造一些连接后再看各种状态（`-p` 显示进程，需要权限）：

```
$ for i in $(seq 1 20); do curl -s -o /dev/null http://127.0.0.1:8080/; done
$ ss -tan 'sport = :8080 or dport = :8080'
State      Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN     0      100    127.0.0.1:8080      0.0.0.0:*
TIME-WAIT  0      0      127.0.0.1:52360     127.0.0.1:8080
TIME-WAIT  0      0      127.0.0.1:52362     127.0.0.1:8080
...
$ ss -tan state time-wait | wc -l          # 统计某状态数量（含表头一行）
$ ss -s                                     # 汇总：estab、timewait 等总数
```

怎么读：每次 curl 都是新进程、新连接，退出时客户端先关，所以 TIME-WAIT 留在**客户端一侧**（Local 端口是随机高位端口、Peer 是 8080），大约 60 秒后消失。要亲眼看到 CLOSE-WAIT，可以写一个“故意不关”的客户端：

```java
// CloseWaitDemo.java：连上后让服务端先关，自己永远不 close
import java.net.Socket;
public class CloseWaitDemo {
    public static void main(String[] args) throws Exception {
        Socket s = new Socket("127.0.0.1", 8080);
        s.getOutputStream().write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n".getBytes());
        Thread.sleep(600_000); // 不读、不关：服务端发 FIN 后，本端就停在 CLOSE-WAIT
    }
}
```

```
$ java CloseWaitDemo.java &
$ ss -tanp state close-wait
Recv-Q Send-Q Local Address:Port  Peer Address:Port  Process
1167   0      127.0.0.1:52400     127.0.0.1:8080     users:(("java",pid=4321,fd=5))
```

这就是线上 CLOSE_WAIT 的缩影：`Recv-Q` 里还躺着没读的响应数据，进程和 fd 号都能看到，只要进程不 close，这条连接就一直占着。服务端那一侧对应的连接则停在 `FIN-WAIT-2`（Linux 会在 `tcp_fin_timeout` 后回收孤儿连接）。

## 攻击者视角

攻击者看 TCP 层，主要做两件事：**侦察**和**耗尽**。

- **端口扫描**：先用 `nmap -sS -p- target` 摸清开放端口，再用 `-sV` 识别服务版本。一个意外开放的 6379（Redis 无密码）、3306、8080（Spring Boot Actuator）、18083（EMQX Dashboard 的默认端口，以你安装的版本文档为准）往往比 Web 漏洞更致命。内网拿到一台机器后，也会用同样手法横向探测私有网段。
- **利用监听地址过宽**：开发时图方便监听 `0.0.0.0`，上到云主机后安全组又放行了，就直接暴露到公网。
- **SYN Flood / 连接耗尽**：除了 SYN Flood，还有完成握手后“占着不说话”的慢速攻击（如 Slowloris 慢速发送 HTTP 头），耗尽的是应用层的线程/连接数；IoT 场景里伪造大量设备建立 MQTT 连接也是同理。
- **RST 注入 / 连接劫持**：处在通信路径上（同一局域网、恶意 Wi-Fi）的攻击者能看到序号，就能伪造 RST 断开连接，或注入数据。这正是需要 TLS 的原因之一：TCP 本身不提供任何加密和完整性保护。
- **反射放大**：利用 UDP 服务伪造源 IP，见第 5 节。

## 防御与最佳实践

- **最小暴露面**：应用只监听需要的地址（`server.address`），数据库、Redis、MQTT 管理端口只对内网开放；云上用安全组做白名单，默认拒绝。定期用 `ss -tanl` 自查，用 nmap 从外部扫描自己的公网 IP 核对。
- **内核参数**：保持 `net.ipv4.tcp_syncookies=1`；按需调大 `tcp_max_syn_backlog` 和 `net.core.somaxconn`。改参数前先弄清楚问题，不要照抄网上的“优化大全”。
- **连接生命周期管理**：所有 Socket、流、HTTP 响应都用 try-with-resources；HTTP 客户端和数据库都用连接池并复用；设置 `connectTimeout`、`readTimeout`，防止线程被无响应的下游永久卡住。
- **应用层限流**：在 Nginx 用 `limit_conn` / `limit_req` 限制单 IP 的连接数和请求速率，设置合理的 `client_header_timeout` 对付慢速攻击；EMQX 等 MQTT Broker 也有连接速率限制，具体配置项以所用版本文档为准。
- **监控告警**：采集各状态的连接数（`ss -s`、node_exporter 等），CLOSE_WAIT 持续增长、SYN-RECV 突增都应告警。
- **大流量 DDoS** 靠单机扛不住，依赖云厂商的 DDoS 防护或 CDN。

## 常见误区

- “TIME_WAIT 多就是有问题，赶紧开 `tcp_tw_recycle`”：这个参数在 NAT 环境下会导致正常连接被丢弃，且已在 Linux 4.12 中被移除。先想办法复用连接。
- “CLOSE_WAIT 是对方的问题”：恰恰相反，是本端没 close。
- “端口 closed 就安全”：closed 说明主机存活，而且服务随时可能被启动；真正需要的是防火墙策略。
- “监听 127.0.0.1 就万事大吉”：它能挡住外部网络，但挡不住本机上的 SSRF。Lab 05 就是让服务器自己去访问 `127.0.0.1`。
- “TCP 能保证数据没被篡改”：TCP 校验和只防传输错误，不防恶意篡改，攻击者改了数据可以重新计算校验和。

## 自测

:::details 1. `172.20.5.9` 和 `172.40.1.1` 哪个是私有地址？为什么？
`172.20.5.9` 是私有地址，属于 `172.16.0.0/12`（172.16.0.0～172.31.255.255）。`172.40.1.1` 不在这个范围内，是公网地址。手写 `startsWith("172.")` 判断是错误的。
:::

:::details 2. 为什么 TCP 建连需要三次握手？
双方都要确认对方收到了自己的初始序号；同时防止网络中滞留的旧 SYN 让服务端建立一个客户端并不想要的连接（客户端会对不认识的 SYN-ACK 回 RST）。
:::

:::details 3. 服务端出现大量 CLOSE_WAIT，该查谁？
查服务端自己。CLOSE_WAIT 表示对方已经发送 FIN，而本端应用没有调用 close。常见原因是流或响应没关闭、连接池泄漏、线程阻塞。用 `ss -tanp state close-wait` 定位进程和对端，再用 `jstack` 查线程。
:::

:::details 4. TIME_WAIT 出现在哪一方？它有什么用？
出现在主动关闭方。它用来重发可能丢失的最后一个 ACK，并让旧报文在网络中过期，避免干扰复用相同四元组的新连接。
:::

:::details 5. SYN Cookie 为什么能缓解 SYN Flood？
在半连接队列溢出时，服务端不再为 SYN 保存状态，而是把连接信息经带密钥的哈希编码进 SYN-ACK 的序号。只有真正收到 SYN-ACK 并回 ACK 的客户端才能通过校验，伪造源 IP 的攻击者无法占用服务端内存。
:::

:::details 6. Nmap SYN 扫描收到 SYN-ACK、RST、无响应，分别判定为什么？
依次为 open、closed、filtered。收到 ICMP 不可达通常也判为 filtered。
:::

:::details 7. DNS 为什么主要用 UDP？什么时候用 TCP？
查询和响应都小，一问一答，UDP 无需握手，开销小、速度快，丢包由客户端重试。响应被截断（TC 位）或做区域传送时使用 TCP 53。
:::

## 一句话总结

TCP 用三次握手建立状态、四次挥手分别关闭两个方向：CLOSE_WAIT 查自己的代码、TIME_WAIT 靠复用连接解决，SYN Flood 攻击的是握手阶段的状态，端口扫描利用的是 TCP 对不同情况的不同回应，而 TCP 本身不提供任何保密性和防篡改能力。
