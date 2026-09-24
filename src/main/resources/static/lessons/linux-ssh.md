## 为什么要学

SSH 是你进入服务器的大门，也是攻击者最想进的大门。任何一台有公网 IP、开放 22 端口的主机，上线几分钟内 auth 日志里就会出现来自世界各地的密码爆破尝试。一台服务器的 SSH 配置得好不好，直接决定了“弱口令被猜中 → 主机沦陷 → 被拿去挖矿或当跳板”这条链路能不能走通。

作为 Java 后端，你大概率已经每天用 `ssh`、`scp` 上线看日志，也许用过堡垒机，或者用 `ssh -L` 把线上的 MySQL 映射到本地用 Navicat 连。这一课把这些“会用”升级成“懂原理、会加固”：知道公钥认证为什么比密码安全，知道第一次连接时让你输入 yes 的那个指纹是干什么的，知道端口转发既是运维利器也是攻击者的内网穿透工具。

这一课在路线里属于“网络/Linux”阶段，接在 [[linux-net]]（看端口）和 [[linux-perm]]（文件权限）之后，下一课 [[linux-systemd]] 会用防火墙把 22 端口进一步收紧。公钥密码学的基础在 [[net-tls]] 里也会用到——SSH 和 TLS 解决的是同一类问题：确认对方身份、协商密钥、加密通道。

学完后你能做到：在一台新云主机上 10 分钟内完成 SSH 加固（仅密钥、禁 root、限制用户、fail2ban），用 ProxyJump 通过跳板机访问内网机器，用 `-L` 安全地访问只监听 127.0.0.1 的服务（比如本项目的 MyNotes），并在日志里找出爆破记录。

## 核心概念

### 密钥对认证原理，authorized_keys，known_hosts 的作用

SSH 连接里有**两次身份验证**，方向相反：

```
client (your laptop)                        server (sshd)
--------------------                        -------------
1. TCP connect :22            ------------>
2. key exchange (ECDH)        <----------->  both derive a session key         协商会话密钥
3. verify HOST key            <------------  server proves it owns host key    客户端验证服务器
   (check ~/.ssh/known_hosts)
4. USER auth: sign challenge  ------------>  server checks ~/.ssh/authorized_keys  服务器验证用户
5. encrypted shell / tunnel   <----------->
```

**用户公钥认证：** 你本地有一对密钥：私钥 `~/.ssh/id_ed25519`（绝不离开本机）和公钥 `id_ed25519.pub`。你把公钥追加到服务器上 `~/.ssh/authorized_keys` 里。登录时客户端用私钥对一段包含本次会话标识的数据做签名，服务器用 authorized_keys 里的公钥验签。私钥从不在网络上传输，签名每次会话都不同，所以即使被抓包也无法重放；服务器被攻破也只会泄露公钥，而公钥本来就是公开的。

**主机密钥与 known_hosts：** 服务器也有自己的密钥对（`/etc/ssh/ssh_host_ed25519_key` 等）。首次连接时客户端显示服务器公钥的指纹，你输入 yes 后，它被记录到本地 `~/.ssh/known_hosts`。之后每次连接都比对，不一致就报 `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` 并拒绝连接。

**本课问题：第一次连接时“确认主机指纹”这一步防的是什么攻击？** 防的是**中间人攻击（MITM）**。如果有人在你和服务器之间（公共 Wi-Fi、被劫持的 DNS、ARP 欺骗）冒充服务器，他拿不到真服务器的主机私钥，只能出示自己的主机公钥，指纹就会不同。你若不核对就输入 yes，你的会话就是和攻击者建立的：用密码登录时密码直接被拿走；用公钥登录时攻击者拿不到私钥，但仍可以冒充服务器骗你输入的内容。这是“首次使用即信任”（TOFU）模型，第一次的核对是它唯一的薄弱点。正确做法是通过可信渠道（云控制台的 VNC 登录、装机脚本输出）拿到指纹再比对：

```
# 在服务器上（通过控制台）查看主机公钥指纹
$ ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
256 SHA256:3fK9vQ7x...Zq2c root@web01 (ED25519)

# 客户端首次连接时的提示
The authenticity of host 'web01 (192.168.0.23)' can't be established.
ED25519 key fingerprint is SHA256:3fK9vQ7x...Zq2c.
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

两边的 `SHA256:...` 完全一致才输入 yes。批量场景可以用 SSH 证书（`@cert-authority`）或把主机公钥预先分发到 known_hosts。

生成与部署用户密钥：

```
ssh-keygen -t ed25519 -C "aqin@laptop"      # 设置口令短语（passphrase）保护私钥
ssh-copy-id -i ~/.ssh/id_ed25519.pub aqin@web01
# 服务器端权限必须严格，否则 sshd（StrictModes yes）会拒绝使用：
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

authorized_keys 每行前面还可以加选项做限制，例如 `from="10.0.0.0/8",no-port-forwarding,no-agent-forwarding ssh-ed25519 AAAA...`，适合给 CI 部署用的专用密钥。

### 禁用密码登录与 root 登录，限制用户

服务端配置在 `/etc/ssh/sshd_config`。较新的 OpenSSH 支持 `Include /etc/ssh/sshd_config.d/*.conf`（Ubuntu 22.04 等默认就有这一行），推荐把自己的加固项写进单独文件，便于管理。注意 sshd 对同一个关键字**以第一次出现的值为准**，所以放在靠前被 Include 的文件里的值会生效。

```
# /etc/ssh/sshd_config.d/00-hardening.conf
PermitRootLogin no                 # 禁止 root 直接登录，先用普通用户再 sudo
PasswordAuthentication no          # 禁用密码，只允许密钥
KbdInteractiveAuthentication no    # 旧版本叫 ChallengeResponseAuthentication
PubkeyAuthentication yes
PermitEmptyPasswords no
AllowUsers aqin deploy             # 白名单用户；也可用 AllowGroups sshusers
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no              # 如果需要 -L 隧道，对特定用户用 Match 放开
```

需要给某个用户开转发时用 `Match`：

```
Match User aqin
    AllowTcpForwarding local
```

关键点：

- `PermitRootLogin no`：root 用户名是固定已知的，爆破只需猜密码；禁用后攻击者还得先猜用户名，且审计里能看出是谁 sudo 的。
- `PasswordAuthentication no` 是最有效的一条：只要没有密码登录，所有口令爆破都会失败。云厂商的某些镜像会在 `sshd_config.d/` 里放一个 `PasswordAuthentication yes` 的文件（比如 cloud-init 生成的），要检查有没有被覆盖。
- 修改后先检查语法，再重载，并且**保持当前会话不断开**，另开一个终端测试登录成功后再关闭旧会话，防止把自己锁在门外。

```
sudo sshd -t && sudo systemctl reload ssh    # Debian/Ubuntu 服务名是 ssh，RHEL 系是 sshd
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|allowusers'
```

`sshd -T` 打印最终生效的配置，是验证加固结果最可靠的方法。

### 本地/远程端口转发（-L / -R）与跳板机（ProxyJump）

**本地转发 `-L 本地端口:目标主机:目标端口`**：在你本机开一个端口，流量经 SSH 隧道到服务器，再由服务器去连“目标主机:目标端口”（目标地址是从服务器的角度解析的）。

```
laptop:18080  ==ssh tunnel==>  web01  --->  127.0.0.1:8080 (MyNotes on web01)
```

```
ssh -N -L 18080:127.0.0.1:8080 aqin@web01
# 浏览器打开 http://127.0.0.1:18080 就访问到了 web01 上只监听本地的 MyNotes
ssh -N -L 13306:10.0.1.20:3306 aqin@web01    # 通过 web01 访问内网数据库
```

`-N` 表示不执行远程命令只做转发。本地监听默认只绑定 127.0.0.1，这是好事。

**远程转发 `-R 远端端口:目标主机:目标端口`**：方向相反，在服务器上开端口，流量回到你这边再去连目标。常用于把本机开发中的服务临时暴露给服务器（比如让测试环境回调你本机）。

```
ssh -N -R 9000:127.0.0.1:8080 aqin@web01
# web01 上访问 127.0.0.1:9000 即访问到你笔记本上的 8080
```

默认 `GatewayPorts no`，远端只监听 127.0.0.1；改成 yes 会把你的本机服务暴露到服务器所在网络，一般不要开。

**跳板机（ProxyJump）**：内网机器不对公网开放 SSH，只能先登录堡垒机再跳。`-J` 会让流量经过跳板机转发，且**认证在你本机完成**，私钥不需要放到跳板机上，也不需要 Agent 转发。

```
ssh -J aqin@bastion.example.com aqin@10.0.1.30
```

写进 `~/.ssh/config` 更方便：

```
Host bastion
    HostName bastion.example.com
    User aqin
    IdentityFile ~/.ssh/id_ed25519

Host app-*
    User aqin
    ProxyJump bastion

Host app-1
    HostName 10.0.1.30
```

之后 `ssh app-1` 即可。与 `ssh -A`（Agent 转发）相比，ProxyJump 更安全：Agent 转发时，跳板机上的 root 可以借用你的 agent 套接字，以你的身份登录其他机器。

### fail2ban 与暴力破解日志

sshd 的认证日志位置因发行版而异：Debian/Ubuntu 在 `/var/log/auth.log`，RHEL/CentOS/Rocky 在 `/var/log/secure`；使用 journald 的系统都可以用 `journalctl -u ssh`（或 `-u sshd`）查看。典型的爆破记录：

```
Sep 24 03:12:07 web01 sshd[40211]: Invalid user admin from 203.0.113.45 port 51122
Sep 24 03:12:09 web01 sshd[40211]: Failed password for invalid user admin from 203.0.113.45 port 51122 ssh2
Sep 24 03:12:15 web01 sshd[40215]: Failed password for root from 203.0.113.45 port 51190 ssh2
Sep 24 03:13:02 web01 sshd[40230]: Connection closed by authenticating user root 198.51.100.7 port 40022 [preauth]
Sep 24 09:01:44 web01 sshd[41002]: Accepted publickey for aqin from 192.0.2.10 port 60211 ssh2: ED25519 SHA256:Hq...
```

读法：`Invalid user` 表示用户名不存在（攻击者在猜用户名）；`Failed password` 是密码错误；`[preauth]` 表示在认证完成前断开；`Accepted publickey` 是成功登录，并带有所用密钥的指纹——**成功登录记录比失败记录更值得关注**，要确认每一条都是你自己。禁用密码登录后，这类日志会变成 `Connection closed ... [preauth]` 或提示没有可用的认证方式。

**fail2ban** 的工作方式：持续读取日志，用正则匹配失败记录，某个 IP 在 `findtime` 时间窗内失败达到 `maxretry` 次，就调用防火墙封禁它 `bantime` 时长。

```
sudo apt install fail2ban
# /etc/fail2ban/jail.local（不要改 jail.conf，升级时会被覆盖）
[sshd]
enabled  = true
maxretry = 5
findtime = 10m
bantime  = 1h
```

在使用 journald 而没有 auth.log 的系统上，可能需要在 jail 里加 `backend = systemd`。

```
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

示例输出：

```
Status for the jail: sshd
|- Filter
|  |- Currently failed: 2
|  |- Total failed:     137
|  `- File list:        /var/log/auth.log
`- Actions
   |- Currently banned: 4
   |- Total banned:     19
   `- Banned IP list:   203.0.113.45 198.51.100.7 ...
```

误封自己时用 `sudo fail2ban-client set sshd unbanip <ip>` 解封。要清楚 fail2ban 的定位：它降低日志噪音和爆破速度，**不能替代禁用密码登录**；分布式爆破（每个 IP 只试几次）它也拦不住。

## 动手实践

### 练习：在云主机或虚拟机上完成 SSH 加固，并在 auth 日志里找到失败的登录尝试

以一台 Ubuntu 云主机为例（RHEL 系把服务名换成 `sshd`、日志换成 `/var/log/secure`）。全程**保留一个已登录的会话**不要关。

第 1 步：建普通用户并部署公钥（在服务器上以 root 执行）。

```
adduser aqin
usermod -aG sudo aqin
install -d -m 700 -o aqin -g aqin /home/aqin/.ssh
# 把本机 ~/.ssh/id_ed25519.pub 的内容写入：
vi /home/aqin/.ssh/authorized_keys
chown aqin:aqin /home/aqin/.ssh/authorized_keys && chmod 600 /home/aqin/.ssh/authorized_keys
```

第 2 步：新开终端验证密钥登录成功：`ssh -v aqin@<ip>`。`-v` 输出里看到下面这行说明走的是公钥：

```
debug1: Authenticated to 203.0.113.10 ([203.0.113.10]:22) using "publickey".
```

第 3 步：写入上文的 `00-hardening.conf`，检查所有配置文件里是否还有打开密码登录的项，再重载。

```
grep -rn 'PasswordAuthentication' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/
sudo sshd -t && sudo systemctl reload ssh
sudo sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|allowusers)'
```

期望输出：

```
permitrootlogin no
passwordauthentication no
allowusers aqin
allowusers deploy
```

第 4 步：验证效果。在本机强制使用密码方式登录：

```
$ ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password aqin@<ip>
aqin@203.0.113.10: Permission denied (publickey).
$ ssh root@<ip>
root@203.0.113.10: Permission denied (publickey).
```

括号里只剩 `publickey`，说明服务器已不再提供密码认证。

第 5 步：安装 fail2ban（上一节配置），并在安全组里把 22 端口的来源限制为你的办公/家庭出口 IP。

第 6 步：在日志里找失败尝试。公网主机通常不用等就有：

```
sudo grep -E 'Failed password|Invalid user' /var/log/auth.log | tail -5
sudo grep 'Invalid user' /var/log/auth.log | awk '{print $8}' | sort | uniq -c | sort -rn | head
sudo journalctl -u ssh --since "1 hour ago" | grep -c 'preauth'
sudo grep 'Accepted' /var/log/auth.log     # 核对每一次成功登录
last -a | head                              # 登录历史（来自 /var/log/wtmp）
lastb | head                                # 失败登录（来自 /var/log/btmp，需 root）
```

第二条命令的示例输出：

```
     42 admin
     31 ubuntu
     18 test
      9 oracle
```

怎么读：这是攻击者字典里最常见的用户名排行。若在虚拟机里做实验看不到攻击，就自己在加固前从另一台机器故意输错几次密码制造记录。注意 `Invalid user` 行里用户名所在的列可能因日志格式不同而偏移，用 `grep -o 'Invalid user [^ ]*'` 更稳。

## 攻击者视角

> 本课的爆破、隧道等手法只能用于你自己的环境或已获授权的目标。

- **口令爆破：** 自动化工具拿常见用户名（root、admin、ubuntu、git、oracle）和弱口令字典轮番尝试。大量来源 IP 来自已被控制的肉鸡，所以单纯封 IP 效果有限。
- **私钥窃取：** 开发者笔记本、CI 服务器、Git 仓库里泄露的 `id_rsa` 是高价值目标。没有 passphrase 的私钥被拿到就等于拿到登录权限。攻击者入侵一台机器后也会翻 `~/.ssh/`：`known_hosts` 和 `config` 告诉他你还登录过哪些机器，`authorized_keys` 可以被**追加攻击者的公钥做持久化**——这比留一个后门进程隐蔽得多。
- **Agent 劫持：** 你用 `ssh -A` 登录了一台已被控制的机器，攻击者用 root 权限找到 `SSH_AUTH_SOCK` 指向的套接字，就能在你连接期间以你的身份登录其他服务器。
- **隧道做内网穿透：** 拿到一台边界机器的 SSH 后，`ssh -D 1080`（动态 SOCKS 代理）或 `-L` 可以把整个内网变成可达；`-R` 可以从内网往外建反向隧道，绕过“只允许出站”的防火墙。所以 `AllowTcpForwarding` 在不需要时应关闭。
- **中间人：** 用户习惯性地对 `REMOTE HOST IDENTIFICATION HAS CHANGED` 执行 `ssh-keygen -R` 然后重新 yes，就给了中间人机会。

## 防御与最佳实践

- 只允许密钥登录，私钥设 passphrase，配合 `ssh-agent` 使用；推荐 Ed25519 密钥。
- 禁止 root 登录，`AllowUsers`/`AllowGroups` 白名单；每人一个账号、一把钥匙，离职即删对应公钥行。
- 网络层收紧：安全组/防火墙只放行固定来源 IP，或者 SSH 完全不对公网开放，只通过堡垒机 / VPN / 云厂商的会话管理进入。改非 22 端口只能减少日志噪音，不算真正的安全措施。
- 关闭不需要的功能：`X11Forwarding`、`AllowAgentForwarding`、`AllowTcpForwarding`；跨跳板机用 ProxyJump 替代 `-A`。
- 监控 `authorized_keys` 的变更（auditd 或文件完整性监控），告警所有 `Accepted` 登录，尤其是非工作时间或陌生 IP。
- 主机指纹通过可信渠道核对；规模化用 SSH 证书（CA 签发短期证书）替代到处分发公钥。
- 及时更新 OpenSSH；定期用 `sshd -T` 对照 [Mozilla OpenSSH 指南](https://infosec.mozilla.org/guidelines/openssh) 或 CIS 基线检查配置。

## 常见误区

| 误区 | 实际情况 |
|---|---|
| “改了 sshd_config 就生效了” | 需要 `sshd -t` 后 reload；而且 `sshd_config.d/` 中先出现的同名项优先，要用 `sshd -T` 确认最终值 |
| “把端口改成 2222 就安全了” | 端口扫描很快能找到它；这只能减少日志噪音 |
| “有了 fail2ban 就可以继续用密码” | fail2ban 挡不住低频分布式爆破和泄露的密码，真正的解法是禁用密码 |
| “提示主机密钥变了，删掉 known_hosts 那行就好” | 先确认原因（重装系统、换 IP 复用）；无法解释时应视为中间人攻击 |
| “公钥泄露了很危险” | 公钥本就是公开的，危险的是私钥；但 authorized_keys 被**写入**才是真正的威胁 |
| “`ssh -A` 很方便，到处开” | 目标机器上的 root 能在你在线期间借用你的身份，跳板场景用 ProxyJump |

## 自测

:::details 1. 公钥认证中，私钥会在网络上传输吗？服务器凭什么相信你？
不会。客户端用私钥对包含会话标识的数据签名，服务器用 authorized_keys 中的公钥验签。签名与会话绑定，无法被重放。
:::

:::details 2. 第一次连接时“确认主机指纹”防的是什么攻击？应该怎么正确确认？
防中间人攻击：冒充者没有真实服务器的主机私钥，指纹必然不同。应通过控制台等可信渠道执行 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`，与客户端显示的 SHA256 指纹比对一致后再输入 yes。
:::

:::details 3. 加固 SSH 时最容易把自己锁在外面的操作是什么？如何避免？
禁用密码或限制用户后，新密钥又没配好。避免方法：先确认密钥登录成功，`sshd -t` 检查语法，保留旧会话，另开终端测试成功后再断开；云主机还可以用控制台 VNC 兜底。
:::

:::details 4. 线上 MyNotes 只监听 127.0.0.1:8080，你想在本机浏览器访问它，怎么做？
`ssh -N -L 18080:127.0.0.1:8080 aqin@web01`，然后访问 `http://127.0.0.1:18080`。服务无需对外开放。
:::

:::details 5. `-L` 与 `-R` 的区别是什么？攻击者为什么喜欢 `-R`？
`-L` 在客户端开端口，流量由服务器去连目标；`-R` 在服务器开端口，流量回到客户端去连目标。`-R` 由内网主动向外建立连接，能绕过只限制入站的防火墙，把内网服务反向暴露给攻击者。
:::

:::details 6. 为什么 ProxyJump 比 Agent 转发（-A）安全？
ProxyJump 只让跳板机转发加密的 TCP 流，认证在本机完成；-A 把 agent 套接字暴露在跳板机上，跳板机的 root 可借用它以你的身份认证。
:::

:::details 7. 在 auth 日志里，哪类记录最需要人工核对？
`Accepted publickey/password` 的成功登录记录：核对用户、来源 IP、时间、密钥指纹是否都属于你，陌生的成功登录意味着可能已被入侵。
:::

## 一句话总结

SSH 加固的核心是“只认钥匙、不认密码、不给 root、只放行该放的人和 IP”，同时认真对待主机指纹、慎用 Agent 转发，并盯住成功登录和 authorized_keys 的变化。
