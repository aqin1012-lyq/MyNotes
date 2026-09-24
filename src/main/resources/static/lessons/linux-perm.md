## 为什么要学

在应用层，你用 Spring Security 决定“谁能调用哪个接口”；在操作系统层，决定“谁能读写哪个文件、能执行什么”的就是用户、用户组和文件权限。两者是同一个思想：**最小权限原则**。应用层的鉴权再完美，只要进程本身以 root 运行，一个 RCE 就能让攻击者拿下整台机器。

对攻击者来说，拿到一个低权限 Shell 只是开始，下一步几乎总是**提权**（privilege escalation）：找配置错误的 SUID 程序、宽松的 sudo 规则、可写的脚本和配置文件、泄露在文件里的密码。本课讲的每个概念，都对应一类常见的提权路径。

对你的日常工作，这一课能回答这些问题：为什么 SSH 私钥权限太宽时 ssh 会拒绝使用？为什么 Spring Boot 以非 root 用户运行时不能监听 80 端口？部署时 `chmod 777` 到底错在哪？学完后，你应该能为一个 Spring Boot 服务设计一套从用户、目录权限到 sudo 规则的最小权限方案。

## 核心概念

### 1. 用户 / 用户组 / /etc/passwd 与 /etc/shadow

Linux 用数字识别身份：每个用户有一个 **UID**，每个组有一个 **GID**。用户名只是给人看的别名。

- **UID 0 是 root**：内核只看 UID 是否为 0，而不看名字叫不叫 root。
- **系统用户**：给服务用的账号（如 `nginx`、`mysql`），通常不能登录，UID 较小（许多发行版在 1000 以下）。
- **普通用户**：给人用的账号，许多发行版从 1000 开始分配。
- 每个用户有一个**主组**，还可以属于多个**附加组**。

```
$ id
uid=1000(aqin) gid=1000(aqin) groups=1000(aqin),27(sudo),998(docker)
```

这一行信息量很大：`aqin` 在 `sudo` 组里（在 Ubuntu 上意味着可以 sudo 执行任意命令），还在 `docker` 组里。注意：**docker 组成员实际上等同于 root**，因为能操作 Docker 守护进程就能把宿主机根目录挂进一个容器（见 [[docker-isolation]]）。

**/etc/passwd**：每行一个用户，七个字段用冒号分隔，**所有用户可读**：

```
$ grep -E '^(root|app|aqin):' /etc/passwd
root:x:0:0:root:/root:/bin/bash
aqin:x:1000:1000:AQin:/home/aqin:/bin/bash
app:x:999:999::/opt/app:/usr/sbin/nologin
```

| 字段 | 例子 | 含义 |
|---|---|---|
| 1 用户名 | `app` | |
| 2 密码占位 | `x` | `x` 表示真正的密码哈希在 /etc/shadow |
| 3 UID | `999` | |
| 4 GID | `999` | 主组 |
| 5 描述 | 空 | GECOS 字段，全名等 |
| 6 家目录 | `/opt/app` | |
| 7 登录 Shell | `/usr/sbin/nologin` | 服务账号不允许交互式登录 |

**/etc/shadow**：存放密码哈希和密码策略，**只有 root 可读**（权限通常是 `640 root:shadow` 或 `600`/`000`，依发行版而定）：

```
$ sudo grep '^aqin:' /etc/shadow
aqin:$y$j9T$Q1wz...$Hx8...:20355:0:99999:7:::
```

第二个字段是哈希：`$y$` 表示 yescrypt，`$6$` 表示 SHA-512 crypt，中间是盐。`!` 或 `*` 开头表示账号被锁定或不能用密码登录。后面是上次修改日期（从 1970-01-01 起的天数）、最短/最长有效期、提前警告天数等。

把密码哈希从 passwd 挪到 shadow，就是一次“最小权限”的实践：很多程序需要读用户名和 UID，但只有认证程序需要读哈希。这和你在数据库里把 `password_hash` 列与普通用户信息分开、查询接口不返回哈希是一个道理。

安全关注点：

- `/etc/passwd` 如果变成**可写**，攻击者可以加一行 UID 为 0 的用户，直接获得 root。
- `/etc/shadow` 如果变成**可读**，攻击者可以把哈希拿去离线爆破。
- 常用命令：`useradd`/`usermod`/`userdel`、`groupadd`、`passwd`、`id`、`groups`、`getent passwd app`。

### 2. rwx 与八进制权限，chmod / chown / umask

`ls -l` 的第一列：

```
$ ls -l /opt/app
-rw-r-----  1 root app  1234 Sep 24 10:00 application.yml
-r--r--r--  1 root root 52M  Sep 24 10:00 app.jar
drwxr-x---  2 app  app  4096 Sep 24 10:00 logs
```

```
 -   rw-   r--   ---
 |    |     |     |
type owner group other
```

第一个字符是类型：`-` 普通文件、`d` 目录、`l` 符号链接。后面每三位一组，分别对应**属主（u）**、**属组（g）**、**其他人（o）**。

`r`、`w`、`x` 对文件和目录的含义不同，这是最容易混淆的地方：

| | 文件 | 目录 |
|---|---|---|
| `r` | 读取内容 | 列出目录里的文件名（`ls`） |
| `w` | 修改内容 | 在目录里创建、删除、重命名文件（**与文件本身的权限无关**） |
| `x` | 作为程序执行 | 进入目录、访问其中的文件（`cd`、按路径打开） |

一个反直觉的结论：**能不能删除一个文件，取决于它所在目录的 w 权限**，而不是文件自己的权限。所以即使 `app.jar` 是只读的，只要 `/opt/app` 目录对 app 用户可写，app 用户就能删掉它、换成一个恶意的 jar。

**八进制表示**：r=4、w=2、x=1，每组相加：

| 八进制 | 符号 | 常见用途 |
|---|---|---|
| `644` | `rw-r--r--` | 普通文件 |
| `640` | `rw-r-----` | 含密码的配置文件，属组可读 |
| `600` | `rw-------` | SSH 私钥、只有属主能读的密钥 |
| `755` | `rwxr-xr-x` | 目录、可执行程序 |
| `750` | `rwxr-x---` | 应用目录，只让属主和属组进入 |
| `777` | `rwxrwxrwx` | 任何人可读写执行，几乎总是错的 |

常用命令：

```
chmod 640 application.yml         # 八进制写法
chmod u+x start.sh                # 符号写法：给属主加执行权限
chmod -R g-w,o-rwx /opt/app       # 递归：去掉属组写、去掉其他人全部权限
chown root:app application.yml    # 改属主和属组（通常需要 root）
chown -R app:app /opt/app/logs
```

**umask：新建文件的默认权限掩码**。新文件的权限不是你直接指定的，而是由一个“基准值”减去 umask 里置位的权限得到。基准值：文件是 666、目录是 777（文件默认不给执行位）。umask 常见值是 022：

```
$ umask
022
$ touch f; mkdir d; ls -ld f d
-rw-r--r--  1 aqin aqin ... f       # 666 去掉 022 -> 644
drwxr-xr-x  2 aqin aqin ... d       # 777 去掉 022 -> 755
```

含义：022 表示“去掉属组和其他人的写权限”。如果希望新文件默认更严格（其他人完全无权），设 `umask 027`（新文件 640、新目录 750），这对运行服务的账号是个好习惯。umask 是**进程属性**、会被子进程继承，所以服务启动脚本或 systemd 单元里可以显式设置 `UMask=0027`，避免应用创建出人人可读的日志或上传文件。

### 3. SUID / SGID / Sticky bit

除了 rwx，还有三个特殊位，正是提权的主战场。

**SUID（Set User ID，数字 4000）**：一个带 SUID 位的可执行文件，运行时进程的**有效用户变成文件的属主**，而不是运行它的人。经典例子是 `passwd`：

```
$ ls -l /usr/bin/passwd
-rwsr-xr-x 1 root root 68208 ... /usr/bin/passwd
```

属主那组的 `x` 变成了 `s`，这就是 SUID。普通用户运行 `passwd` 修改自己的密码时，进程以 root 身份运行，才能写受保护的 `/etc/shadow`。这是一种“受控的、临时的提权”。

**为什么 SUID 程序是提权目标？** 因为它让普通用户以属主（常是 root）的身份执行代码。如果一个 SUID root 程序有下面任何一种问题，普通用户就能借它成为 root：

- 程序本身能执行命令或读写任意文件（比如 `find`、`vim`、`cp`、某些自研工具）。GTFOBins 网站专门收录了各种常见程序被赋予 SUID 或 sudo 权限后如何被滥用。
- 程序调用外部命令却不写绝对路径、且信任 `PATH`（攻击者把恶意的同名程序放在 PATH 前面）。
- 程序有缓冲区溢出等内存漏洞。

所以给自研程序设 SUID 要极其谨慎；能不用就不用。

**SGID（Set Group ID，数字 2000）**：加在可执行文件上，运行时有效组变成文件属组；加在**目录**上更常用——目录里新建的文件会自动继承该目录的属组，方便团队协作共享目录。

**Sticky bit（数字 1000）**：加在目录上，表示“只有文件的属主（或目录属主、root）才能删除该目录里的文件”。最典型的是 `/tmp`：

```
$ ls -ld /tmp
drwxrwxrwt 10 root root ... /tmp
```

其他人那组的 `x` 变成了 `t`，就是 sticky bit。`/tmp` 对所有人可写，如果没有 sticky bit，任何用户都能删掉别人的临时文件。设置：`chmod +t dir` 或 `chmod 1777 dir`。

三个特殊位在符号里的显示：SUID 占属主的 x 位（`s`/`S`），SGID 占属组的 x 位（`s`/`S`），sticky 占其他人的 x 位（`t`/`T`）；大写表示对应的 x 权限本身没有。八进制时它们是第四位，如 `chmod 4755`、`chmod 2775`、`chmod 1777`。

### 4. sudo 与 /etc/sudoers，最小权限

`sudo` 让指定用户以另一个用户（默认 root）的身份执行**特定命令**，同时留下审计日志。它比“把 root 密码给所有人”或“大家都用 root”安全得多，因为可以精确到“谁、能在哪台机器、以谁的身份、运行哪些命令”。

规则写在 `/etc/sudoers`（用 `visudo` 编辑，它会做语法检查，避免写错把自己锁死）和 `/etc/sudoers.d/` 下。几个例子：

```
# 用户  主机 = (可切换到的用户)  命令
aqin    ALL = (ALL:ALL) ALL                      # 能以任何身份运行任何命令（很大的权力）
%deploy ALL = (root) /bin/systemctl restart app  # deploy 组只能以 root 重启 app 服务
ops     ALL = (root) NOPASSWD: /usr/bin/journalctl   # ops 看日志不用输密码
```

`%` 开头是组。`NOPASSWD` 表示免密码。最小权限的做法是：只授予**具体命令**，而不是 `ALL`。

但“限定命令”并不等于安全，有几个经典陷阱：

- **命令能派生 Shell**：如果允许 `sudo vim`、`sudo less`、`sudo find`、`sudo awk`，用户可以在这些程序内部执行 `:!sh` 之类的命令拿到 root Shell（同样见 GTFOBins）。
- **通配符太宽**：`sudo /bin/systemctl restart *` 里的 `*` 可能被利用去操作别的单元。
- **可写脚本**：`sudo /opt/app/deploy.sh`，如果 `deploy.sh` 对普通用户可写，用户改写脚本内容就等于以 root 运行任意代码。授权的脚本必须 root 属主、其他人不可写。
- **保留环境变量**：某些配置 `env_keep` 保留了 `LD_PRELOAD`、`PYTHONPATH` 等，可能被用来注入代码。默认的 `env_reset` 会清理环境，不要轻易关掉。

排查自己有哪些 sudo 权限：`sudo -l` 会列出当前用户被允许的命令，这也是攻击者拿到账号后必做的第一步。

### 5. 应用为什么不应该以 root 运行

把这些概念合起来，就能回答本课最重要的实践问题。以 root 运行一个 Spring Boot 应用，意味着**应用进程的权限 = 整台机器的权限**。一旦应用被攻破（RCE、反序列化、SSRF 打到本地等），攻击者获得的就是 root：

- 可以读写任意文件：`/etc/shadow`、其他应用的配置和数据、别的用户的家目录。
- 可以安装持久化后门、加载内核模块、修改系统服务、清除日志。
- 可以监听任意端口、抓取所有网络流量。
- 容器场景下，root 进程更容易结合内核漏洞或错误配置逃逸到宿主机（见 [[docker-isolation]]）。

而以专用低权限用户（如 `app`）运行，同样的 RCE 只能得到 `app` 的权限：只能动 `app` 有权访问的那几个目录，读不了 `/etc/shadow`，改不了系统服务，装不了后门。攻击者还需要**再完成一次提权**才能拿到 root，这就给了检测和阻断的机会。这正是“纵深防御”：不指望应用永不被攻破，而是让被攻破的代价尽可能小。

一个常见顾虑是端口：Linux 上绑定 1024 以下的端口需要特权。让应用监听 8080 之类的高端口、由前面的 Nginx（[[net-infra]]）或 iptables 转发 80/443 过来，是标准做法；也可以给 Java 可执行文件设置 `CAP_NET_BIND_SERVICE` 能力，而不必给整个进程 root 权限。

## 动手实践

下面两个练习最好在一台 Linux 环境里做（本地 Linux、云主机，或 `docker run --rm -it eclipse-temurin:17-jdk bash` 起一个容器；容器里默认就是 root，方便演示建用户）。macOS 的用户/权限模型不同，命令不完全通用。

### 实践 1：新建一个 app 用户，让 Spring Boot jar 以该用户运行

目标：不用 root 跑应用，并用最小权限组织目录。

#### 第 1 步：建一个不能登录的服务账号

```bash
# -r 系统账号；-s nologin 禁止交互登录；-d 指定家目录（服务账号常指向应用目录）
sudo useradd -r -s /usr/sbin/nologin -d /opt/app app
id app
```

预期输出：

```
uid=999(app) gid=999(app) groups=999(app)
```

`-s /usr/sbin/nologin` 很关键：即使这个账号被利用，也无法直接开一个交互式 Shell 登录进来。

#### 第 2 步：放好文件并收紧权限

```bash
sudo mkdir -p /opt/app/logs
sudo cp target/mynotes-0.0.1-SNAPSHOT.jar /opt/app/app.jar
sudo cp application.yml /opt/app/application.yml

sudo chown -R root:app /opt/app        # 属主 root，属组 app
sudo chmod 750 /opt/app                # 只有 root 和 app 组能进入
sudo chmod 640 /opt/app/app.jar        # app 组可读，其他人不可读
sudo chmod 640 /opt/app/application.yml # 配置里有密码：绝不给 other 读
sudo chown app:app /opt/app/logs
sudo chmod 750 /opt/app/logs           # 只有 app 能写日志
```

设计意图：jar 和配置由 root 拥有、app 只读，**app 用户即使被攻破也改不了自己的程序**（回忆第 2 节：删除/替换文件取决于目录权限，所以 `/opt/app` 目录也不给 app 写）；只有 `logs` 目录允许 app 写。验证：

```
$ ls -ld /opt/app /opt/app/logs; ls -l /opt/app
drwxr-x--- 3 root app  ... /opt/app
drwxr-x--- 2 app  app  ... /opt/app/logs
-rw-r----- 1 root app  ... app.jar
-rw-r----- 1 root app  ... application.yml
```

#### 第 3 步：以 app 用户运行，并确认身份

临时手动运行（`runuser`/`su` 需要 root）：

```bash
$ sudo runuser -u app -- java -jar /opt/app/app.jar --spring.config.location=/opt/app/application.yml
```

另开一个终端确认进程身份：

```
$ ps -o pid,user,cmd -C java
  PID USER     CMD
 7012 app      java -jar /opt/app/app.jar ...
```

`USER` 是 `app` 而不是 `root`，就成功了。生产上不要这样手动跑，而是交给 systemd（见 [[linux-systemd]]），在单元文件里写 `User=app`、`Group=app`、`UMask=0027`，并可加 `ProtectSystem=strict`、`NoNewPrivileges=true` 等加固项，让 systemd 负责以正确身份启动、崩溃重启、管理日志。

一个自测：以 app 身份尝试读 `/etc/shadow`，应当被拒绝，这证明权限收敛生效：

```
$ sudo runuser -u app -- cat /etc/shadow
cat: /etc/shadow: Permission denied
```

### 实践 2：用 find 找出系统里的 SUID 程序

```bash
$ find / -perm -4000 -type f 2>/dev/null
/usr/bin/passwd
/usr/bin/sudo
/usr/bin/su
/usr/bin/chsh
/usr/bin/chfn
/usr/bin/newgrp
/usr/bin/mount
/usr/bin/umount
```

（具体列表因发行版而异，以你机器上的实际输出为准。）读法：

- `-perm -4000` 里的**前导减号**表示“**至少包含**这些权限位”（这里是 SUID 位），而不是“权限正好等于 4000”。写 `-perm 4000` 会只匹配权限恰好是 4000 的文件，几乎匹配不到。
- `-type f` 只找普通文件；`2>/dev/null` 把大量“Permission denied”的错误丢掉，让结果干净。
- 找 SGID 用 `-perm -2000`；两者一起：`find / -perm -6000 -type f 2>/dev/null`。
- 更实用的排查写法，连权限和属主一起列出：`find / -perm -4000 -type f -printf '%M %u %p\n' 2>/dev/null`（GNU find；BSD/macOS 用 `find ... -exec ls -l {} +`）。

**怎么判断哪些是危险的？** 把找到的列表和你熟悉的“正常 SUID 程序”（`passwd`、`sudo`、`su`、`mount` 等系统自带的）对比，**重点关注意料之外的条目**：出现在 `/tmp`、`/home`、`/opt`、`/var` 下的 SUID 文件，或 `find`、`vim`、`nmap`、`python`、`bash`、`cp`、自研工具带了 SUID——这些几乎都是提权入口，可以在 GTFOBins 上查到利用方式。这正是入侵排查和自查加固都会跑一遍这条命令的原因。

发现可疑 SUID 后，确认无用就去掉 SUID 位：`sudo chmod u-s <file>`（保留文件本身）。

## 攻击者视角

> 以下手法只能用于你自己的实验环境或已获授权的目标。

拿到一个低权限 Shell 后，攻击者的提权枚举清单几乎是固定的，每一项都对应本课的一个概念：

- **看自己是谁、能干什么**：`id`、`sudo -l`（有没有可滥用的 sudo 规则）、`groups`（是否在 `docker`、`sudo`、`disk` 等高危组里）。
- **找 SUID/SGID**：`find / -perm -4000 -type f 2>/dev/null`，对照 GTFOBins。
- **找可写的敏感文件**：可写的 `/etc/passwd`、`/etc/shadow`、`/etc/sudoers.d/*`、别人 sudo 会执行的脚本、systemd 单元文件、cron 任务文件。`find / -writable -type f 2>/dev/null` 加过滤。
- **翻密码和密钥**：配置文件里的数据库密码、`.env`、`~/.bash_history`、`~/.ssh/` 下的私钥、备份文件。这也是为什么应用配置要 640 且不给 other 读。
- **看进程和命令行**：`ps auxww` 里其他用户（尤其 root）进程命令行中的密码（呼应 [[linux-process]] 的 `/proc/<pid>/cmdline`）。
- **写权限的 PATH 与相对路径**：如果某个 root 定时任务或 SUID 程序调用命令时不写绝对路径，攻击者把恶意同名程序放进可控目录并劫持 PATH。

自动化工具（如 LinPEAS 一类枚举脚本）本质上就是把上面这些检查跑一遍并高亮异常。防守方定期自己跑同样的检查，就能先一步发现问题。

一个完整的提权链示例（说明危害，不含具体 payload）：Spring Boot 以 `app` 用户运行 → 通过反序列化 RCE 拿到 `app` Shell → `sudo -l` 发现 `app` 被允许 `sudo /opt/app/deploy.sh` 且该脚本对 app 组可写 → 改写脚本内容 → `sudo /opt/app/deploy.sh` 以 root 执行 → 拿到 root。链条上任何一环（不给 sudo、脚本不可写、脚本 root 属主）配置正确，提权就断了。

## 防御与最佳实践

- **最小权限运行应用**：专用系统账号、`nologin`、jar 与配置 root 属主 app 只读、日志目录单独授权；用 systemd 的 `User=`/`Group=`/`NoNewPrivileges=`/`ProtectSystem=` 加固。绝不用 root 跑业务应用。
- **配置文件权限收紧**：含密码/密钥的文件 `640` 或 `600`，属组设为应用组，其他人无权；`umask 027` 让新文件默认不给 other。更进一步用密钥管理服务（[[cloud-secrets]]）。
- **谨慎使用 SUID**：不给自研程序设 SUID；定期 `find / -perm -4000` 审计，去掉不需要的 SUID 位。
- **sudo 精细化**：只授权具体命令、避免能派生 Shell 的程序、被授权的脚本必须 root 属主且 other/组不可写、保持 `env_reset`。用 `sudo -l` 定期复查。
- **保护关键文件**：确认 `/etc/passwd`(644)、`/etc/shadow`(640 或更严)、`/etc/sudoers`(440) 权限正确；对它们的变更做监控告警。
- **绑定低端口用能力而非 root**：`setcap 'cap_net_bind_service=+ep'` 或交给前端代理转发，不要为了监听 80 而给整个进程 root。
- **容器里也用非 root**：Dockerfile 里 `USER app`，配合只读根文件系统、丢弃多余 capabilities（见 [[docker-isolation]]）。
- **审计**：开启 sudo 日志、auditd 监控对敏感文件和 SUID 文件的改动；定期跑一遍提权枚举检查。

## 常见误区

- **“出问题就 chmod 777”**：这是把权限问题“解决”成安全漏洞。任何用户都能读写甚至替换文件，含密码的配置也人人可读。应精确定位到底缺哪个权限、给哪个用户或组。
- **“文件设成只读就删不掉了”**：能否删除取决于**所在目录**的写权限，不是文件自己的权限。要防删除，收紧目录权限或用 sticky bit。
- **“root 才是 root”**：内核只认 UID 0。任何 UID 为 0 的账号都是 root；`/etc/passwd` 可写就能造一个。
- **“限定了 sudo 命令就安全了”**：如果命令能派生 Shell（vim/less/find 等）、脚本可写、通配符太宽，一样能提权。
- **“把密码放环境变量或配置文件就够安全”**：配置文件权限没收紧照样被读；环境变量能被 root 和同用户进程看到。文件权限是底线，密钥管理服务才是更好方案。
- **“SUID 是危险的东西，应该全删掉”**：`passwd`、`sudo` 等系统 SUID 程序是正常且必要的。要区分“系统自带的已知程序”和“意料之外的 SUID 文件”，删错系统程序会导致功能异常。
- **“应用必须 root 才能监听 80”**：可以用高端口 + 代理转发，或 `CAP_NET_BIND_SERVICE`，不需要整个进程 root。

## 自测

:::details 1. 为什么密码哈希放在 /etc/shadow 而不是 /etc/passwd？
`/etc/passwd` 需要对所有用户可读（很多程序要查 UID、用户名、家目录），如果哈希也放里面就人人可读、可离线爆破。`/etc/shadow` 只有 root 可读，把“需要公开的用户信息”和“必须保密的哈希”分开，是操作系统层的最小权限实践。
:::

:::details 2. 一个文件是 `-r--r--r--`（444），普通用户能删除它吗？
取决于它所在目录的权限。删除、创建、重命名文件属于对**目录**的写操作。如果目录对该用户可写（且没有 sticky bit 限制），即使文件本身只读，用户也能删掉它。反之目录不可写就删不掉。
:::

:::details 3. `chmod 640` 和 `chmod 750` 分别适合什么文件？
640（rw-r-----）适合含敏感信息、需要属组可读但其他人完全不可访问的**普通文件**，比如带密码的配置。750（rwxr-x---）适合需要执行/进入权限的**目录或可执行程序**，让属主可读写执行、属组可进入执行、其他人无权。
:::

:::details 4. SUID 位是做什么的？为什么 passwd 命令需要它，它又为什么是提权目标？
SUID 让可执行文件运行时以**文件属主**（常是 root）的身份执行，而不是运行者的身份。`passwd` 需要它才能以 root 身份写受保护的 `/etc/shadow`。它是提权目标，因为一旦某个 SUID root 程序能执行命令、读写任意文件或存在漏洞，普通用户就能借它获得 root 权限。
:::

:::details 5. 用一条 find 命令找出系统所有 SUID 程序，并解释 -perm -4000 里减号的含义。
`find / -perm -4000 -type f 2>/dev/null`。减号表示“权限位**至少包含**4000（SUID 位）”，其他位不限；不加减号的 `-perm 4000` 表示权限**恰好等于** 4000，几乎匹配不到实际文件。`2>/dev/null` 丢弃无权访问目录时的报错。
:::

:::details 6. 允许某用户 `sudo /opt/app/deploy.sh`，有什么隐患？怎么配置才安全？
如果 `deploy.sh` 对该用户（或其所在组、其他人）可写，用户改写脚本内容后再 sudo 执行，就等于以 root 运行任意代码。安全做法：脚本必须 root 属主、其属组和其他人都不可写（如 `chown root:root`、`chmod 755` 或更严），并确认脚本内部不调用可被劫持的相对路径命令。
:::

:::details 7. 一个以 root 运行的 Spring Boot 被 RCE，和以普通用户运行，危害差多少？
以 root 运行时，攻击者直接获得整台机器控制权：读写任意文件（含 /etc/shadow）、装后门、改系统服务、清日志、容器场景更易逃逸。以低权限 app 用户运行时，攻击者只得到 app 的权限，只能动 app 可访问的少数目录，还需要再完成一次提权才能拿到 root，这给了检测和阻断的窗口。这就是最小权限带来的纵深防御。
:::

## 一句话总结

Linux 用 UID/GID 和 rwx 落实最小权限：敏感文件收到 640/600、应用用专用低权限账号运行、SUID 和 sudo 只在必要处精确授予；这样即使应用被攻破，攻击者也还差一次提权才能拿到 root。
