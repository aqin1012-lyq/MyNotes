## 为什么要学

在 [[linux-process]] 里你学会了“机器上跑着哪些进程”，这一课把视角换成网络：哪个进程在监听哪个端口、它对谁开放、此刻连向了哪里。这是入侵排查的第一现场——挖矿木马要连矿池、反弹 shell 要连攻击者、后门要监听端口，它们都会在 `ss` 和 `lsof` 的输出里留下痕迹。

对 Java 后端来说，这组命令你其实天天在用：服务起不来报 `Address already in use`，要查是谁占了 8080；微服务调用超时，要看连接是卡在 `SYN-SENT` 还是大量 `TIME-WAIT`；Redis 连接池打满，要数一数到 6379 的 ESTAB 连接有多少。学安全以后，同样的命令多了一层意义：**每一个对外监听的端口都是攻击面**。

这一课属于路线中的“网络/Linux”阶段，它衔接 [[net-tcp]] 的 TCP 状态机和 [[net-dns]] 的域名解析，也为后面的 [[linux-ssh]]、[[linux-systemd]]（防火墙）以及 [[web-ssrf]]（服务端能访问到哪些内网地址）打基础。

学完后你应该能做到：拿到一台陌生服务器，3 分钟内列出它所有监听端口和对应进程，判断哪些“不该对外”；看到一个可疑进程，能说出它打开了哪些文件、连向哪些 IP；看懂 `ip addr`、`ip route`、`/etc/hosts`、`/etc/resolv.conf`，知道一个请求从这台机器出去时走哪张网卡、用哪个 DNS。

## 核心概念

### ss -tlnp / netstat -tlnp：监听端口与所属进程

`ss` 来自 iproute2 包，是 `netstat`（net-tools 包，已不再积极维护，很多新发行版默认不装）的替代品。两者参数几乎一样，记住字母含义即可：

| 参数 | 含义 |
|---|---|
| `-t` / `-u` | TCP / UDP |
| `-l` | 只看监听（LISTEN）的套接字；不加则看已建立的连接 |
| `-n` | 不把端口和 IP 解析成名字（`:8080` 而不是 `:http-alt`），更快也更准确 |
| `-p` | 显示所属进程（进程名、PID、fd）。**看别人的进程需要 root**，否则这一列为空 |
| `-a` | 所有状态（监听 + 非监听） |
| `-4` / `-6` | 只看 IPv4 / IPv6 |

典型输出（在一台装了 Nginx、MySQL、Redis 和 MyNotes 的机器上 `sudo ss -tlnp`）：

```
State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port  Process
LISTEN  0       128     0.0.0.0:22           0.0.0.0:*          users:(("sshd",pid=812,fd=3))
LISTEN  0       511     0.0.0.0:80           0.0.0.0:*          users:(("nginx",pid=1201,fd=6),("nginx",pid=1200,fd=6))
LISTEN  0       151     127.0.0.1:3306       0.0.0.0:*          users:(("mysqld",pid=990,fd=23))
LISTEN  0       511     127.0.0.1:6379       0.0.0.0:*          users:(("redis-server",pid=955,fd=6))
LISTEN  0       100     [::ffff:127.0.0.1]:8080  *:*            users:(("java",pid=2345,fd=12))
LISTEN  0       128     [::]:22              [::]:*             users:(("sshd",pid=812,fd=4))
```

怎么读：

- `Local Address:Port` 是最关键的一列：**绑在哪个地址上决定了谁能连进来**（下一节细讲）。
- 对 LISTEN 状态，`Send-Q` 是 backlog 上限（Java 里 `ServerSocket` 的 backlog、Tomcat 的 `accept-count`），`Recv-Q` 是当前在全连接队列里等待 accept 的数量。`Recv-Q` 持续接近 `Send-Q` 说明应用 accept 不过来。
- `users:(("nginx",pid=1201,fd=6),...)` 表示多个进程共享同一个监听 fd（Nginx master/worker 就是这样）。
- 同一端口出现 `0.0.0.0:22` 和 `[::]:22` 两行，是 IPv4 和 IPv6 各一个套接字。Java 默认创建 IPv6 双栈套接字，所以 IPv4 地址会显示成 `[::ffff:127.0.0.1]` 这种“IPv4 映射地址”，本质仍是 127.0.0.1。

看已建立的连接和过滤：

```
ss -tnp state established '( dport = :6379 )'   # 本机连出去到 Redis 的连接
ss -tn state time-wait | wc -l                    # TIME-WAIT 数量
ss -s                                             # 各状态汇总
```

老系统上等价的 `netstat -tlnp` 输出列名略不同（`Local Address`、`Foreign Address`、`PID/Program name`），读法一样。

### lsof -i / lsof -p：进程打开的文件和连接

Linux 上“一切皆文件”，套接字也是文件描述符（fd）。`lsof`（list open files）从进程角度看：它打开了哪些文件、哪些网络连接。

| 命令 | 作用 |
|---|---|
| `lsof -i` | 所有网络连接（需要 root 才能看全） |
| `lsof -i :8080` | 谁在用 8080（监听或连接） |
| `lsof -i TCP -s TCP:LISTEN -nP` | 只看 TCP 监听；`-n` 不解析 IP，`-P` 不把端口转成服务名 |
| `lsof -p 2345` | PID 2345 打开的所有文件：jar、日志、so 库、socket |
| `lsof -u mynotes` | 某个用户打开的文件 |
| `lsof +L1` | 已被删除但仍被打开的文件（链接数 < 1） |

示例：`sudo lsof -nP -i :8080`

```
COMMAND  PID    USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME
java    2345 mynotes   12u  IPv6  31337      0t0  TCP 127.0.0.1:8080 (LISTEN)
java    2345 mynotes   57u  IPv6  31990      0t0  TCP 127.0.0.1:8080->127.0.0.1:51514 (ESTABLISHED)
curl    3001    aqin    5u  IPv4  31989      0t0  TCP 127.0.0.1:51514->127.0.0.1:8080 (ESTABLISHED)
```

读法：`FD` 列的 `12u` 表示 fd 编号 12、以读写（u）方式打开；`NAME` 里 `A->B` 是本端到对端。同一条连接会从两端各出现一次（java 与 curl）。

`lsof -p` 在排查时非常有用，比如 `sudo lsof -p 2345 | grep -E 'REG|DEL'` 能看出 Java 进程实际加载的是哪个 jar、写的是哪个日志文件。`lsof +L1` 常用来解释“磁盘满了但 `du` 找不到大文件”：文件被删了但进程还开着，空间不释放——攻击者也可能运行一个自身已被删除的程序来躲避文件检查，这时 `ls -l /proc/<pid>/exe` 会显示 `(deleted)`。

没有 lsof 时的替代：`ls -l /proc/<pid>/fd` 能看到 `socket:[31337]` 这样的条目，方括号里的 inode 可以和 `ss -tnpe` 输出里的 `ino:` 对上。

### 0.0.0.0 vs 127.0.0.1 监听的区别

监听地址决定了“从哪些网卡进来的连接能被接受”：

```
bind address       who can connect
-----------------  --------------------------------------------
127.0.0.1:6379     only processes on this host (loopback)         只能本机访问
10.0.1.5:6379      clients that reach the 10.0.1.5 interface      内网网卡可达的机器
0.0.0.0:6379       any interface: lo, LAN, public NIC             所有网卡，公网 IP 也算
[::]:6379          any IPv6 (often IPv4 too, dual-stack)          注意 IPv6 也是一条暴露路径
```

- `0.0.0.0` 不是一个真实地址，而是“通配”：所有本机 IPv4 地址。云主机如果有公网 IP（或绑定了 EIP 做 NAT），且安全组/防火墙放行，全世界都能连。
- `127.0.0.1` 是回环地址，数据包根本不经过物理网卡，外部机器无论如何都连不到（除非本机有进程帮忙转发，比如 Nginx 反向代理、SSH `-L` 隧道，或者存在 [[web-ssrf]] 漏洞让服务端替攻击者去访问）。
- 这正是本项目在 `application.properties` 里写 `server.address=127.0.0.1` 的原因：靶场里故意有漏洞，绝不能对局域网开放。Spring Boot 默认不设置时绑定所有地址，等价于 0.0.0.0。

对应到常见组件的配置项：MySQL 是 `bind-address`，Redis 是 `bind`（并配合 `protected-mode`），EMQX 在 listener 配置里写 `bind`，Docker 的 `-p 6379:6379` 默认绑定 0.0.0.0，写成 `-p 127.0.0.1:6379:6379` 才是只对本机。

:::warn Docker 端口映射与防火墙
Docker 通过自己插入的 iptables 规则做端口映射，这些规则可能绕过你在 ufw 等前端里写的放行/拒绝规则。所以“防火墙拦住了”不能替代“绑定到 127.0.0.1”。
:::

### ip addr / ip route，/etc/hosts 与 /etc/resolv.conf

`ip` 命令（iproute2）替代了老的 `ifconfig` 和 `route`。

`ip addr`（简写 `ip a`）看本机有哪些网卡和地址：

```
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN
    inet 127.0.0.1/8 scope host lo
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP
    link/ether fa:16:3e:12:34:56 brd ff:ff:ff:ff:ff:ff
    inet 192.168.0.23/24 brd 192.168.0.255 scope global dynamic eth0
3: docker0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc noqueue state DOWN
    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0
```

读法：`inet 192.168.0.23/24` 是地址和前缀长度；`UP,LOWER_UP` 表示网卡启用且物理链路通；`docker0` 是 Docker 建的网桥。注意云主机的网卡上通常只有私网地址，公网 IP（EIP）是在云平台侧做 NAT 映射的，所以 `ip a` 看不到公网 IP 不代表机器不暴露在公网。

`ip route`（`ip r`）看路由表，决定发往某个目的地址的包从哪张网卡、经哪个网关出去：

```
default via 192.168.0.1 dev eth0 proto dhcp metric 100
172.17.0.0/16 dev docker0 proto kernel scope link src 172.17.0.1
192.168.0.0/24 dev eth0 proto kernel scope link src 192.168.0.23
```

`default via` 是默认网关，其余是直连网段。想知道某个具体地址怎么走，用 `ip route get`：

```
$ ip route get 100.100.2.136
100.100.2.136 via 192.168.0.1 dev eth0 src 192.168.0.23 uid 1000
```

**`/etc/hosts`**：静态的“主机名 → IP”表，一行一条，如 `127.0.0.1 localhost`、`10.0.1.20 mysql.internal`。**`/etc/resolv.conf`**：DNS 客户端配置，`nameserver` 指定 DNS 服务器，`search` 指定短域名补全后缀。查询顺序由 `/etc/nsswitch.conf` 的 `hosts:` 行决定，常见是 `files dns`，即先查 hosts 再查 DNS。

```
# /etc/resolv.conf（使用 systemd-resolved 的系统上常见）
nameserver 127.0.0.53
options edns0 trust-ad
search example.internal
```

`127.0.0.53` 是 systemd-resolved 的本地监听，真正的上游用 `resolvectl status` 查看。Java 的 `InetAddress.getByName()` 走的就是系统解析器（它也读 hosts），而且 JVM 自己还会缓存解析结果（`networkaddress.cache.ttl`）。

安全意义：`/etc/hosts` 被改写可以把 `api.payment.com` 劫持到攻击者 IP，属于常见的持久化/劫持手段；`resolv.conf` 被改则所有解析都被接管。排查时要把这两个文件列入“看一眼”清单，并用文件完整性监控（如 AIDE、auditd 的写监控）盯住它们。更多 DNS 原理见 [[net-dns]]。

## 动手实践

### 练习：列出本机所有监听端口，逐一说出它是什么服务、是否应该对外

第 1 步：列出 TCP 和 UDP 监听，带进程。

```
sudo ss -tulnp
```

示例输出（一台 Ubuntu 云主机，已部署 MyNotes）：

```
Netid State  Recv-Q Send-Q  Local Address:Port    Peer Address:Port Process
udp   UNCONN 0      0       127.0.0.53%lo:53      0.0.0.0:*         users:(("systemd-resolve",pid=520,fd=13))
udp   UNCONN 0      0       0.0.0.0:111           0.0.0.0:*         users:(("rpcbind",pid=480,fd=5))
tcp   LISTEN 0      4096    127.0.0.53%lo:53      0.0.0.0:*         users:(("systemd-resolve",pid=520,fd=14))
tcp   LISTEN 0      128     0.0.0.0:22            0.0.0.0:*         users:(("sshd",pid=812,fd=3))
tcp   LISTEN 0      4096    0.0.0.0:111           0.0.0.0:*         users:(("rpcbind",pid=480,fd=4))
tcp   LISTEN 0      151     127.0.0.1:3306        0.0.0.0:*         users:(("mysqld",pid=990,fd=23))
tcp   LISTEN 0      511     0.0.0.0:6379          0.0.0.0:*         users:(("redis-server",pid=955,fd=6))
tcp   LISTEN 0      100     *:8080                *:*               users:(("java",pid=2345,fd=12))
```

第 2 步：对每一个不认识的进程，查它是谁、从哪来。

```
ps -o pid,user,lstart,cmd -p 2345
ls -l /proc/2345/exe
systemctl status 2345        # 看它属于哪个 systemd 单元
dpkg -S /usr/sbin/rpcbind    # Debian/Ubuntu：属于哪个软件包（RHEL 系用 rpm -qf）
```

第 3 步：逐行填一张表，这是本练习的产出。

| 端口 | 进程 | 监听地址 | 是什么 | 该对外吗 | 处理 |
|---|---|---|---|---|---|
| 53 tcp/udp | systemd-resolved | 127.0.0.53 | 本地 DNS 缓存 | 否，已是本地 | 保持 |
| 22 | sshd | 0.0.0.0 | SSH | 需要，但应限制来源 IP | 安全组只放行办公 IP，见 [[linux-ssh]] |
| 111 | rpcbind | 0.0.0.0 | NFS 等 RPC 服务的端口映射器 | 否 | 不用 NFS 就 `systemctl disable --now rpcbind rpcbind.socket` |
| 3306 | mysqld | 127.0.0.1 | MySQL | 否 | 正确 |
| 6379 | redis-server | 0.0.0.0 | Redis | **否，高危** | 改 `bind 127.0.0.1`，设置密码/ACL |
| 8080 | java | `*`（所有地址） | MyNotes | 否（靶场有漏洞） | 设 `server.address=127.0.0.1`，前面放 Nginx 或只用 SSH 隧道访问 |

怎么读输出：先看**地址列**分成三类——`127.x`（只本机，基本安全）、内网地址（内网可达）、`0.0.0.0` / `*` / `[::]`（所有网卡，要重点审）；再看**进程列**判断是不是你认识的服务；最后结合云安全组/防火墙判断“实际能不能从外面连到”。

第 4 步：从外部验证（在另一台机器或本地电脑上）：

```
nc -vz <服务器公网IP> 6379
# Connection to x.x.x.x 6379 port [tcp/redis] succeeded!   ← 说明真的暴露了
# nc: connect to x.x.x.x port 6379 (tcp) failed: Connection refused / timed out  ← 未暴露
```

`refused` 通常表示包到了主机但没有进程监听（或被防火墙以 reject 拒绝），`timed out` 通常表示被安全组/防火墙静默丢弃。修复后重新运行 `ss -tlnp`，确认 6379 与 8080 都变成了 `127.0.0.1`。

## 攻击者视角

> 本课涉及的扫描与利用手法只能用于你自己的环境或已获授权的目标。

**从外面看：找暴露的端口。** 攻击者对 IP 段做端口扫描（如 `nmap -sV -p- <ip>`），网络空间搜索引擎也在持续扫描整个公网并收录结果。一个监听在 0.0.0.0 且没有认证的 Redis、MongoDB、Elasticsearch、Docker API（2375）、Spring Boot Actuator，被发现往往只是时间问题。

**回答本课问题：为什么数据库、Redis 默认只应该监听 127.0.0.1 或内网？**

- 这些服务的设计前提是“处在受信任网络中”。Redis 历史上默认无密码，一旦能连上就能执行任意命令；经典利用是 `CONFIG SET dir` + `CONFIG SET dbfilename` 把数据写成文件，例如写进 `~/.ssh/authorized_keys` 或 crontab 目录，从而拿到 shell（新版本 Redis 对这类配置修改加了限制，但不能依赖它）。
- 数据库端口暴露后面临口令爆破、已知漏洞利用、数据被整库拖走或被加密勒索。
- 数据库协议本身往往没有做针对公网的加固（限速、防爆破、强制 TLS 都要额外配置）。
- 纵深防御：即使密码泄露了，只监听 127.0.0.1 也能让攻击者必须先拿到这台主机的执行权限才能利用。应用服务器和数据库分离时，就监听内网地址，并用安全组只允许应用服务器的 IP 访问。

**在里面看：入侵后的网络痕迹。** 攻击者拿到 shell 之后，会用同样的命令做侦察：`ss -tlnp` 看本机还有什么服务（比如只在 127.0.0.1 上的 Redis、Actuator），`ip a`、`ip r`、`cat /etc/hosts` 摸清内网网段和其他主机名，为横向移动做准备。这也说明“只监听 127.0.0.1”防的是外部，挡不住已经在机器上的攻击者，也挡不住 SSRF。

**常见恶意痕迹：**

- 陌生进程监听高位端口（bind shell），或进程名伪装成 `[kworker/0:1]`、`sshd` 但路径在 `/tmp`、`/dev/shm`。
- 到陌生公网 IP 的 ESTABLISHED 长连接：反弹 shell、C2 心跳、挖矿（矿池端口常见 3333、4444、5555 等，但不绝对）。
- Java 进程突然出现一条连向外部 IP 的连接，而你的应用本不该主动外联——这可能是反序列化或 JNDI 注入后的回连，见 [[web-deser]]、[[web-rce]]。

## 防御与最佳实践

- **最小暴露：** 能监听 127.0.0.1 就不监听内网，能监听内网就不监听 0.0.0.0。Spring Boot 用 `server.address`，Actuator 可以用 `management.server.port` + `management.server.address=127.0.0.1` 单独放在本地端口上。
- **多层把关：** 监听地址 + 主机防火墙（默认拒绝，见 [[linux-systemd]]）+ 云安全组，三层都收紧。任何一层配错，另外两层还能兜底。
- **必须对外的服务要认证：** Redis 设置 `requirepass` 或 ACL 并保留 `protected-mode yes`；MySQL 账号限定来源主机，如 `'app'@'10.0.1.%'`，不要用 `'%'`。
- **定期基线巡检：** 把 `ss -tulnp` 的结果和一份“预期端口清单”比对，多出来的就告警。可以写成一个定时脚本，或者用主机安全产品/osquery 做。
- **监控异常外联：** 服务器出方向也应该限制（出站白名单），Java 应用只允许连数据库、Redis、MQ 和少数第三方 API。这同时也是 SSRF 和 RCE 回连的缓解手段。
- **保护解析配置：** `/etc/hosts`、`/etc/resolv.conf` 纳入文件完整性监控；容器里也要留意这两个文件是由运行时生成的。
- **排查时先保存现场：** 发现可疑进程别急着 `kill`，先 `ss -tnp`、`lsof -p <pid>`、`cp /proc/<pid>/exe /root/evidence/`、`cat /proc/<pid>/cmdline | tr '\0' ' '`，把证据留下来。

## 常见误区

| 误区 | 实际情况 |
|---|---|
| “`ip a` 看不到公网 IP，所以服务没暴露” | 云主机公网 IP 多为 NAT 映射，0.0.0.0 监听 + 安全组放行就是公网可达 |
| “我不加 sudo 运行 `ss -tlnp`，Process 列是空的，说明没有进程” | 非 root 只能看到自己用户的进程信息，端口是有的，只是看不到归属 |
| “服务监听 127.0.0.1 就绝对安全了” | 本机上的其他进程、SSRF、Nginx 配错的反向代理、SSH 隧道都能访问到 |
| “只看 IPv4 就够了” | `[::]` 上的监听同样暴露；很多防火墙规则只写了 IPv4（iptables 与 ip6tables 是两套） |
| “用 Docker `-p 6379:6379`，主机防火墙会挡住” | Docker 自己写 iptables 规则，可能绕过 ufw；应显式绑定 `127.0.0.1:` |
| “netstat 和 ss 结果不一样，一定是被 rootkit 了” | 可能只是参数不同或输出时刻不同；但 rootkit 确实可能篡改这些工具，严重事件应从可信介质或外部抓包交叉验证 |

## 自测

:::details 1. `ss -tlnp` 里每个字母的含义是什么？为什么排查时建议加 sudo？
`-t` TCP，`-l` 只看监听，`-n` 不解析名字，`-p` 显示进程。非 root 用户看不到其他用户进程的归属信息，Process 列会是空的，容易误判。
:::

:::details 2. 同一个 Redis，监听 `0.0.0.0:6379` 和 `127.0.0.1:6379` 分别意味着什么？
前者接受来自任何网卡（包括公网映射过来的流量）的连接，是否真的可达还取决于防火墙和安全组；后者只接受本机回环连接，外部机器无法直接连上，但本机进程、SSRF、隧道仍可访问。
:::

:::details 3. 为什么数据库、Redis 默认只应该监听 127.0.0.1 或内网？
它们按“可信网络”设计，认证与防爆破能力有限，Redis 未授权访问甚至可以写文件拿 shell；缩小监听范围是纵深防御，让攻击者必须先突破应用主机才能接触数据层。
:::

:::details 4. 怎样找到 8080 端口被哪个进程占用？给出两种方法。
`sudo ss -tlnp 'sport = :8080'` 或 `sudo lsof -nP -i :8080`，再用 `ps -fp <pid>` 看完整命令行。
:::

:::details 5. 磁盘快满了，`du` 却找不到大文件，可能是什么原因？怎么确认？
文件已被删除但仍被某个进程打开，空间未释放。用 `sudo lsof +L1` 找到进程，重启该进程或截断对应 fd 即可释放。
:::

:::details 6. `/etc/hosts` 和 `/etc/resolv.conf` 分别起什么作用？攻击者改它们能达到什么目的？
hosts 是静态主机名映射，resolv.conf 指定 DNS 服务器与搜索域。改 hosts 可以把某个域名定向到恶意 IP；改 resolv.conf 可以让所有解析都经过攻击者控制的 DNS。
:::

:::details 7. 发现 Java 进程有一条连向陌生公网 IP 的 ESTABLISHED 连接，你的排查步骤是什么？
先保存现场：`ss -tnp`、`lsof -p <pid>`、`/proc/<pid>/cmdline`、线程栈（`jstack <pid>`）；查这个 IP 是否是已知的第三方依赖；查应用日志中同时段的请求，排查反序列化、JNDI、SSRF 等可能；必要时用防火墙先阻断该出站连接。
:::

## 一句话总结

`sudo ss -tulnp` 看“谁在听、听在哪”，`lsof` 看“进程开了什么、连向哪”，`ip`/hosts/resolv.conf 看“包怎么出去、名字怎么解析”——每个监听在 0.0.0.0 上的端口都要能说清为什么需要对外。
