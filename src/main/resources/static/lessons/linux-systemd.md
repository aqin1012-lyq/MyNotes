## 为什么要学

很多 Java 项目的上线方式还停留在 `nohup java -jar app.jar &`：进程以谁的身份运行说不清，挂了没人拉起，日志散落在 nohup.out 里，机器重启后服务不会自动起来。systemd 是当前主流 Linux 发行版的 init 系统和服务管理器，把服务托管给它，这些问题都能用一个几十行的 `.service` 文件解决。

对安全来说，systemd 还有两层意义。第一，它自带一套**进程沙箱**：用专门的低权限用户运行、禁止提权、把文件系统设为只读、隔离 /tmp、限制系统调用——即使 Java 应用出现 RCE，攻击者拿到的也只是一个被关在笼子里的 shell。第二，journald 集中收集日志，是入侵排查的主要证据来源，而“清日志”恰恰是攻击者善后的标准动作。

防火墙则是“默认拒绝”原则在网络层的落地：上一课 [[linux-net]] 教你发现不该对外的端口，[[linux-ssh]] 教你把 SSH 收紧，这一课用 nftables 把“只放行需要的端口”写成规则。

学完后你能做到：把 MyNotes 写成带安全加固的 systemd 服务，用 `systemd-analyze security` 评估加固效果，用 journalctl 快速定位日志，写一份只放行 22 和 8080 的 nftables 规则集，并能回答“攻击者会清哪些日志、怎样让日志难以篡改”。后面的 [[docker-isolation]]、[[k8s-hardening]] 里的 securityContext 与这里的沙箱选项是同一套思想。

## 核心概念

### systemctl start/stop/enable/status，编写 .service 文件

systemd 管理的对象叫**单元（unit）**，服务是 `.service`，另外还有 `.socket`、`.timer`、`.target` 等。常用命令：

| 命令 | 作用 |
|---|---|
| `systemctl start/stop/restart mynotes` | 立即启动/停止/重启 |
| `systemctl reload mynotes` | 让服务重读配置（需要单元定义了 `ExecReload=`） |
| `systemctl enable mynotes` | 开机自启（在 target 的 wants 目录里建符号链接）；`enable --now` 同时启动 |
| `systemctl disable mynotes` | 取消自启 |
| `systemctl status mynotes` | 状态、主 PID、最近几行日志 |
| `systemctl daemon-reload` | 修改单元文件后必须执行，让 systemd 重新加载定义 |
| `systemctl list-units --type=service --state=running` | 正在运行的服务 |
| `systemctl cat mynotes` | 显示单元文件及所有 drop-in 覆盖 |
| `systemctl edit mynotes` | 创建 drop-in 覆盖文件，不改原文件 |

单元文件位置：自己写的放 `/etc/systemd/system/`，软件包自带的在 `/usr/lib/systemd/system/`（部分发行版为 `/lib/systemd/system/`），前者优先。一个最小的服务文件由三段组成：

```
[Unit]
Description=MyNotes study site
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mynotes
ExecStart=/usr/bin/java -jar /opt/mynotes/MyNotes-0.0.1-SNAPSHOT.jar
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

- `[Unit]`：描述与依赖顺序。`After=` 只管顺序，`Wants=` 才表示“需要它一起启动”。
- `[Service]`：`Type=simple` 表示 ExecStart 启动的进程就是主进程（`java -jar` 在前台运行，正合适，**不要**在 ExecStart 里加 `&` 或 nohup）。`Restart=on-failure` 在非零退出或被信号杀死时自动重启。
- `[Install]`：`enable` 时挂到哪个 target 下，`multi-user.target` 相当于传统的“多用户命令行模式”。

`systemctl status` 输出怎么读：

```
● mynotes.service - MyNotes study site
     Loaded: loaded (/etc/systemd/system/mynotes.service; enabled; preset: enabled)
     Active: active (running) since Thu 2026-09-24 10:02:11 CST; 2min ago
   Main PID: 2345 (java)
      Tasks: 41 (limit: 4556)
     Memory: 212.4M
        CPU: 14.820s
     CGroup: /system.slice/mynotes.service
             └─2345 /usr/bin/java -jar /opt/mynotes/MyNotes-0.0.1-SNAPSHOT.jar
```

`Loaded` 行的 `enabled` 表示开机自启；`Active` 为 `failed` 时往下看日志；`CGroup` 列出服务的所有进程——如果 Java 进程下面多出了 `sh`、`curl`、`bash`，那就很可疑了。

### systemd 的安全选项：User=、NoNewPrivileges=、ProtectSystem=

这些选项在 `systemd.exec(5)` 中定义，本质是让 systemd 在 exec 你的程序之前，先用命名空间、capabilities、seccomp 等内核机制把进程“装进笼子”。不同 systemd 版本支持的选项不同，下表的选项在较新的主流发行版（如 Ubuntu 22.04+/Debian 12/RHEL 9 自带的 systemd）上都可用；旧版本遇到不认识的选项会在日志里警告并忽略。

| 选项 | 作用 | 防的是什么 |
|---|---|---|
| `User=` / `Group=` | 以指定用户运行 | RCE 后拿到的不是 root |
| `DynamicUser=yes` | 每次启动分配临时 UID | 不用手动建用户，但持久文件需配合 `StateDirectory=` |
| `NoNewPrivileges=yes` | 进程及子进程不能通过 setuid/setgid 程序或文件 capabilities 获得更多权限 | 拿到 shell 后执行 `sudo`、setuid 程序提权 |
| `ProtectSystem=strict` | 整个文件系统只读（`full` 只读 /usr、/boot、/etc；`true` 只读 /usr、/boot） | 篡改系统文件、写入持久化后门 |
| `ReadWritePaths=` | 在 strict 下开放特定可写目录 | 精确授权 |
| `ProtectHome=yes` | /home、/root、/run/user 不可见 | 偷其他用户的 SSH 私钥等 |
| `PrivateTmp=yes` | 独立的 /tmp 和 /var/tmp | 与其他服务通过 /tmp 互相干扰 |
| `PrivateDevices=yes` | 只暴露最少的 /dev 设备 | 直接访问磁盘等设备 |
| `ProtectKernelTunables=yes`、`ProtectKernelModules=yes`、`ProtectControlGroups=yes` | 禁止改 /proc/sys、加载内核模块、改 cgroup | 内核级持久化与逃逸 |
| `CapabilityBoundingSet=` | 限制可拥有的 capabilities，留空即全部去除 | 即使是 root 也做不了特权操作 |
| `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX` | 只允许这些套接字类型 | 利用罕见协议族的内核漏洞 |
| `SystemCallFilter=@system-service` | seccomp 系统调用白名单（预定义组） | 缩小内核攻击面 |
| `LockPersonality=yes`、`RestrictRealtime=yes`、`RestrictSUIDSGID=yes` | 其他小的收紧项 | 减少可利用的内核接口 |

两点提醒：

- **`MemoryDenyWriteExecute=yes` 不要给 Java 用。** 它禁止可写又可执行的内存映射，而 JVM 的 JIT 编译器正需要这种内存，开启后 JVM 可能无法正常运行。
- `NoNewPrivileges=yes` 意味着即使服务用户在 sudoers 里，它启动的子进程也无法通过 sudo 提权。这正是我们想要的：业务进程本就不该 sudo。

`systemd-analyze security mynotes.service` 会逐项列出单元的暴露面并给出 0–10 的“暴露分”（越低越好），可以用它衡量加固效果。

### journalctl -u / -f / --since；/var/log 下的关键日志

systemd 托管的服务，其 stdout/stderr 默认被 journald 收集，所以 Spring Boot 默认输出到控制台的日志直接就能用 journalctl 查。

| 命令 | 作用 |
|---|---|
| `journalctl -u mynotes` | 某个单元的日志 |
| `journalctl -u mynotes -f` | 实时跟踪，相当于 `tail -f` |
| `journalctl -u mynotes --since "2026-09-24 10:00" --until "10:30"` | 时间范围；也支持 `--since "1 hour ago"`、`--since today` |
| `journalctl -u mynotes -n 100 --no-pager` | 最近 100 行，不分页 |
| `journalctl -b` / `-b -1` | 本次启动 / 上次启动以来的日志 |
| `journalctl -p err` | 只看 err 及更高级别 |
| `journalctl _UID=0 --since today` | 按字段过滤，例如 root 产生的日志 |
| `journalctl -o json-pretty -n 1` | 查看一条日志的全部结构化字段 |
| `journalctl --disk-usage` | 日志占用空间 |

journald 默认是否持久化取决于发行版：`/var/log/journal/` 目录存在时写盘，否则只在内存（`/run/log/journal/`），重启就丢。在 `/etc/systemd/journald.conf` 中设 `Storage=persistent` 可以确保持久化。

`/var/log` 下安全相关的关键日志（Debian/Ubuntu 名称，RHEL 系在括号中）：

| 文件 | 内容 |
|---|---|
| `auth.log`（`secure`） | SSH 登录、sudo、su、PAM 认证 |
| `syslog`（`messages`） | 通用系统日志 |
| `kern.log` | 内核日志，防火墙的 log 规则输出也在这里 |
| `wtmp` / `btmp` / `lastlog` | 二进制文件：登录历史、失败登录、每个用户最后登录，分别用 `last`、`lastb`、`lastlog` 读 |
| `audit/audit.log` | auditd 审计记录（安装并启用 auditd 时） |
| `nginx/access.log`、应用日志 | Web 攻击的第一手证据 |

注意：较新的发行版（如 Debian 12）默认可能不装 rsyslog，此时没有 auth.log/syslog 这些文本文件，一切都在 journal 里，用 `journalctl -u ssh`、`journalctl _COMM=sudo` 查。

### iptables / nftables 基本规则：默认拒绝、放行 22/80/443

Linux 防火墙的内核部分是 netfilter，用户态工具有两代：老的 `iptables`（IPv4）/`ip6tables`（IPv6）分开两套命令，新的 `nftables`（命令 `nft`）一套规则同时管 IPv4 和 IPv6（`inet` 族）。新发行版上的 `iptables` 命令常常已经是 `iptables-nft`，底层也写进 nftables。ufw、firewalld 则是它们之上的前端。

入站包在 nftables 里的处理：

```
packet in --> [table inet filter] --> chain input (hook input, policy drop)
                                        |-- rule 1: ct state established,related -> accept   已建立连接的回包
                                        |-- rule 2: iif lo -> accept                         本地回环
                                        |-- rule 3: tcp dport {22,80,443} -> accept          放行的服务
                                        `-- no match -> policy drop                          默认拒绝
```

“默认拒绝”就是把链的 `policy` 设成 `drop`，然后只加白名单。规则的顺序很重要，第一条几乎总是放行 `established,related`：你的服务器主动连出去（比如连 MySQL、调第三方 API）后，对方的回包对 input 链而言是“入站”，没有这条就全被丢了。

```
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        ct state invalid drop
        iif "lo" accept
        meta l4proto { icmp, ipv6-icmp } accept
        tcp dport { 22, 80, 443 } accept
    }
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    chain output {
        type filter hook output priority 0; policy accept;
    }
}
```

同样效果的 iptables 写法（仅 IPv4，IPv6 需用 ip6tables 再写一遍）：

```
iptables -P INPUT DROP
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
iptables -A INPUT -p icmp -j ACCEPT
iptables -A INPUT -p tcp -m multiport --dports 22,80,443 -j ACCEPT
```

放行 ICMP 是为了 ping 诊断和 IPv6 正常工作（IPv6 的邻居发现依赖 ICMPv6，全部丢弃会导致 IPv6 不通）；如果对 ping 敏感，可以只放行必要的类型。

:::warn 远程操作防火墙先留后路
在远程服务器上设默认 drop 前，确认 22 的放行规则在同一个原子操作里（`nft -f` 整体加载就是原子的），或者先设置一个计划任务在几分钟后自动 `nft flush ruleset`，确认能登录后再取消。Docker 主机要注意：`flush ruleset` 会清掉 Docker 自己的规则，需要重启 Docker 让它重建。
:::

## 动手实践

### 练习 1：把 MyNotes 注册成 systemd 服务

在一台 Linux 虚拟机里操作（假设已安装 JDK 17，`java` 位于 `/usr/bin/java`，用 `readlink -f $(which java)` 确认）。在开发机上先打包：`./mvnw -DskipTests package`，得到 `target/MyNotes-0.0.1-SNAPSHOT.jar`，拷贝到虚拟机。

第 1 步：建专用系统用户和目录。MyNotes 的学习数据写在相对路径 `study/`（`mynotes.study.dir=study`），所以工作目录设为 `/opt/mynotes`，只有 `study/` 可写。

```
sudo useradd --system --no-create-home --shell /usr/sbin/nologin mynotes
sudo mkdir -p /opt/mynotes/study
sudo cp MyNotes-0.0.1-SNAPSHOT.jar /opt/mynotes/
sudo chown root:root /opt/mynotes /opt/mynotes/MyNotes-0.0.1-SNAPSHOT.jar
sudo chmod 755 /opt/mynotes && sudo chmod 644 /opt/mynotes/MyNotes-0.0.1-SNAPSHOT.jar
sudo chown mynotes:mynotes /opt/mynotes/study
```

jar 归 root 所有且服务用户只读：即使应用被 RCE，攻击者也无法替换 jar 留后门。`nologin` shell 让这个账号无法交互登录。

第 2 步：写单元文件 `/etc/systemd/system/mynotes.service`：

```
[Unit]
Description=MyNotes study site (Spring Boot)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=mynotes
Group=mynotes
WorkingDirectory=/opt/mynotes
ExecStart=/usr/bin/java -Xmx512m -jar /opt/mynotes/MyNotes-0.0.1-SNAPSHOT.jar
SuccessExitStatus=143
Restart=on-failure
RestartSec=5
UMask=0027

# --- hardening ---
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/opt/mynotes/study
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
```

几个非显然的点：`SuccessExitStatus=143`——JVM 收到 SIGTERM 正常退出时退出码是 143（128+15），声明为成功，`systemctl stop` 后状态才不会显示 failed。`CapabilityBoundingSet=` 留空表示去掉全部 capabilities，8080 不是特权端口，不需要 `CAP_NET_BIND_SERVICE`。`PrivateTmp=yes` 在 strict 下仍提供可写的私有 /tmp，Tomcat 的临时目录要用。**没有**加 `MemoryDenyWriteExecute`，原因见前文（JIT）。

第 3 步：加载、启动、验证。

```
sudo systemctl daemon-reload
sudo systemctl enable --now mynotes
systemctl status mynotes --no-pager
journalctl -u mynotes -f          # 看到 "Tomcat started on port 8080" 与 "Started MyNotesApplication" 即成功
curl -sI http://127.0.0.1:8080/ | head -1
ps -o user,pid,cmd -C java
```

期望：`Active: active (running)`；curl 返回 `HTTP/1.1 200`；ps 显示用户为 `mynotes`。如果启动失败，`journalctl -u mynotes -n 50` 里常见原因是：java 路径不对（`status=203/EXEC`）、`study/` 不可写（`Read-only file system` 或 `AccessDeniedException`）、系统调用被 seccomp 拒绝（`Operation not permitted`，可暂时注释 `SystemCallFilter=` 定位）。

第 4 步：验证沙箱真的生效。

```
sudo systemd-analyze security mynotes.service | tail -1
# → Overall exposure level for mynotes.service: 2.x OK      （具体分数取决于 systemd 版本）
sudo systemd-analyze security | grep -E 'mynotes|sshd'    # 对比：大多数未加固服务是 9.x UNSAFE
sudo -u mynotes touch /opt/mynotes/x                         # Permission denied（jar 目录不可写）
sudo nsenter -t $(systemctl show -p MainPID --value mynotes) -m touch /etc/pwned
# → touch: cannot touch '/etc/pwned': Read-only file system   （进入服务的挂载命名空间，即使是 root 也写不了）
```

读法：`systemd-analyze security` 输出每个选项一行，前面的 ✓/✗ 表示是否已加固，最后一行是总分，你的目标是把 `UNSAFE` 降到 `OK` 或 `MEDIUM`。`nsenter` 那一步模拟了“攻击者在服务进程里执行命令”，证明 ProtectSystem=strict 在起作用。

第 5 步（可选）：体会重启策略。`sudo kill -9 $(systemctl show -p MainPID --value mynotes)`，5 秒后 `systemctl status` 显示新的 PID，journal 里有 `Scheduled restart job`。

### 练习 2：用 nftables 只放行 22 和 8080

先想清楚一件事：MyNotes 配置了 `server.address=127.0.0.1`，外部本来就连不上 8080，防火墙放行 8080 也不会让它对外。这恰好是“两层防护”：监听地址是第一层，防火墙是第二层。本练习的目的是写对规则；如果你想在**隔离的虚拟机网络**里从宿主机访问，可以在 ExecStart 末尾临时加 `--server.address=0.0.0.0` 做实验，但带漏洞的靶场绝不能在公网或共享局域网上这样做，正常情况下用 [[linux-ssh]] 里的 `ssh -L` 访问。

第 1 步：写 `/etc/nftables.conf`（Debian/Ubuntu 的 nftables 服务开机加载这个文件；RHEL 系默认用 firewalld，如需改用 nftables 服务，其配置路径不同，请以发行版文档为准）：

```
#!/usr/sbin/nft -f
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        ct state established,related accept
        ct state invalid drop
        iif "lo" accept
        meta l4proto { icmp, ipv6-icmp } accept
        tcp dport 22 ct state new limit rate 10/minute accept
        tcp dport 8080 accept
        limit rate 5/minute log prefix "nft-drop: " level info
        counter drop
    }
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    chain output {
        type filter hook output priority 0; policy accept;
    }
}
```

说明：22 端口加了新建连接速率限制，减轻爆破；被丢弃的包以限速方式记日志（前缀 `nft-drop:`，在 `journalctl -k` 或 kern.log 中查看）；`counter` 用来统计丢弃的包数。

第 2 步：先检查语法，再加载并设为开机启用。

```
sudo nft -c -f /etc/nftables.conf      # -c 只检查不应用，没有输出即通过
sudo nft -f /etc/nftables.conf
sudo systemctl enable nftables
sudo nft list ruleset
```

`nft list ruleset` 会打印出规则，`counter` 处显示 `counter packets 37 bytes 2220` 这样的计数。

注意这里的 `limit rate` 是对所有来源合计的，爆破高峰时可能让你自己也连不上；生产上更常用 fail2ban 或 nftables 的 meter（按源 IP 限速），或者直接只放行固定来源 IP：`ip saddr 203.0.113.0/24 tcp dport 22 accept`。

第 3 步：从宿主机验证（VM 地址假设为 192.168.56.10）：

```
$ nc -vz -w 3 192.168.56.10 22
Connection to 192.168.56.10 22 port [tcp/ssh] succeeded!
$ nc -vz -w 3 192.168.56.10 3306
nc: connect to 192.168.56.10 port 3306 (tcp) timed out: Operation now in progress
$ nc -vz -w 3 192.168.56.10 8080
nc: connect to 192.168.56.10 port 8080 (tcp) failed: Connection refused
```

怎么读：22 成功；3306 是 **timed out**——包被防火墙静默丢弃（drop 的特征）；8080 是 **refused**——防火墙放行了，但 MyNotes 只监听 127.0.0.1，内核回了 RST。如果你按上文加了 `--server.address=0.0.0.0`，8080 就会 succeeded。再在 VM 上看丢包日志：

```
$ sudo journalctl -k --since "5 min ago" | grep nft-drop
Sep 24 10:31:02 vm kernel: nft-drop: IN=enp0s8 OUT= SRC=192.168.56.1 DST=192.168.56.10 ... PROTO=TCP SPT=53122 DPT=3306 ...
```

`SRC`/`DPT` 告诉你谁在试哪个端口，这是发现扫描行为的简单手段。

## 攻击者视角

> 本课涉及的提权、清痕迹手法只用于理解防御，只能在你自己的环境或授权目标上验证。

- **利用服务身份：** `nohup java -jar` 常以 root 或开发者个人账号运行，Java 应用一旦 RCE（反序列化、SpEL/表达式注入、文件上传，见 [[web-rce]]），攻击者直接获得这个身份，写 crontab、写 `authorized_keys`、装 systemd 服务做持久化都不费力。
- **用 systemd 做持久化：** 在 `/etc/systemd/system/` 下放一个名字像系统组件的 `.service`（或 `.timer`）并 enable，重启后后门自动复活。排查时用 `systemctl list-unit-files --state=enabled` 和查看 `/etc/systemd/system/` 下最近修改的文件。
- **绕过防火墙：** 入站被拦就走出站，反弹 shell 连向攻击者的 443 端口，所以只限制入站是不够的。

**本课问题（上半）：入侵后攻击者常会清理哪些日志？**

| 目标 | 为什么 | 常见手法 |
|---|---|---|
| `auth.log` / `secure` | 暴露登录来源 IP、sudo 记录 | 删除含自己 IP 的行，或整个清空 |
| `wtmp` / `btmp` / `lastlog` | `last`、`lastb` 能看出登录历史 | 用工具改写二进制记录，或清空 |
| `~/.bash_history` | 暴露执行过的命令 | `unset HISTFILE`、`history -c`、链接到 /dev/null |
| journald 日志 | 集中记录了几乎所有服务 | `journalctl --vacuum-time=1s`、删 `/var/log/journal/` 下的文件 |
| Web/应用日志 | 暴露攻击请求（payload） | 删除相关行 |
| `audit.log` | 详细审计 | 停掉 auditd 或删除 |

清空本身也是一种痕迹：一个本该持续增长的日志突然变小、出现时间断档、`wtmp` 被截断，都是强烈的入侵信号。

## 防御与最佳实践

**本课问题（下半）：如何让日志更难被篡改？** 核心思想是**让日志尽快离开这台机器**，因为攻击者一旦拿到 root，本机上的任何东西都可以改：

- **实时远程转发：** rsyslog 转发到集中日志服务器（`*.* @@logserver:514`，`@@` 表示 TCP），或用 Filebeat/Fluent Bit/云厂商日志服务 Agent 采集到 ELK/Loki/云日志服务。日志在被清理之前就已经送走了。日志服务器要单独管理，业务机的凭据不能删改它。
- **journald 前向安全密封：** 持久化存储下 `journalctl --setup-keys` 生成密封密钥，之后可用 `journalctl --verify` 检测日志是否被篡改（只能发现篡改，不能阻止删除）。
- **auditd：** 对关键文件设监视规则，例如 `-w /var/log/ -p wa -k logtamper`、`-w /etc/ssh/sshd_config -p wa -k sshd`；同样把 audit 日志远程发走。
- **文件属性：** `chattr +a` 让日志文件只能追加（root 可以去掉该属性，但需要多一步且会被审计到），这是加分项，不是保障。
- **最小权限与沙箱：** 用本课的 systemd 选项运行服务，攻击者进来时不是 root，就碰不到 /var/log。
- **告警断档：** 日志平台对“某主机日志停止上报”设告警。

其他实践：所有服务都交给 systemd，不用 nohup；每个服务一个专用用户；上线前跑 `systemd-analyze security`；防火墙默认拒绝，入站只放必要端口，出站也逐步收紧；规则文件纳入 Git 与变更评审。

## 常见误区

| 误区 | 实际情况 |
|---|---|
| “改完 .service 直接 restart 就行” | 必须先 `systemctl daemon-reload`，否则用的还是旧定义 |
| “`After=` 就能保证依赖服务启动” | `After=` 只管顺序，要一起拉起需要 `Wants=` 或 `Requires=` |
| “ExecStart 里写 `nohup java ... &`” | systemd 会认为主进程已退出；`Type=simple` 下直接前台运行 |
| “用 root 跑服务省事，加固选项够了” | 沙箱是第二道防线，`User=` 是第一道，两者都要 |
| “Java 服务也要开 MemoryDenyWriteExecute” | JIT 需要可写可执行内存，开启会导致 JVM 异常 |
| “默认 drop 后连接出去的请求会正常” | 没有 `ct state established,related accept` 的话，回包会被丢弃 |
| “iptables 规则写好了 IPv6 也受保护” | ip6tables 是另一套；nftables 用 `inet` 表才同时覆盖 |
| “日志在本机，出事了再看” | 攻击者拿到 root 可以删改；必须实时发往远端 |

## 自测

:::details 1. `systemctl enable` 和 `systemctl start` 的区别？
start 是立即启动，不影响开机；enable 是建立开机自启的链接，不会立刻启动。`enable --now` 两者同时做。
:::

:::details 2. `NoNewPrivileges=yes` 能防止什么？
防止服务进程及其子进程通过执行 setuid/setgid 程序（如 sudo、su）或带文件 capabilities 的程序获得比当前更高的权限，RCE 后的常规提权路径被切断。
:::

:::details 3. `ProtectSystem=strict` 下 MyNotes 的 `study/` 如何可写？/tmp 呢？
用 `ReadWritePaths=/opt/mynotes/study` 显式开放；/tmp 由 `PrivateTmp=yes` 提供独立可写的私有目录。
:::

:::details 4. 如何查看 mynotes 服务过去一小时的错误日志并实时跟踪？
`journalctl -u mynotes -p err --since "1 hour ago"`；实时跟踪用 `journalctl -u mynotes -f`。
:::

:::details 5. nftables 默认 drop 的规则集里，为什么第一条通常是 `ct state established,related accept`？
本机主动发起的连接（访问数据库、外部 API、DNS）其回包在 input 链上看也是入站流量，没有这条就会被默认策略丢弃；同时它让已建立的连接尽早命中，减少规则匹配开销。
:::

:::details 6. nc 测试时 “timed out” 和 “Connection refused” 各说明什么？
timed out 通常是被防火墙静默丢弃（drop）或网络不可达；refused 表示主机回了 RST：端口没有进程监听，或防火墙用 reject 拒绝。
:::

:::details 7. 入侵后攻击者常清理哪些日志？怎样让日志难以篡改？
auth.log/secure、wtmp/btmp/lastlog、bash_history、journal、Web 与应用日志、audit.log。防护靠实时远程转发到独立的日志平台、journald 密封与 auditd 监视、只追加属性、以低权限沙箱运行服务，并对日志断档告警。
:::

## 一句话总结

用 systemd 以专用低权限用户加沙箱选项托管 Java 服务，用 journald 并远程转发保存证据，用 nftables 默认拒绝只放行必要端口——三件事一起把一台服务器的底座做稳。
