## 为什么要学

上一课 [[docker-basics]] 你已经会造镜像、跑容器，也听我反复说“容器不是虚拟机、默认 root 很危险”。这一课就把这层窗户纸捅破：容器到底是用内核的哪些机制拼出来的？为什么同样一句 `docker run`，有的隔离得很好，有的一挂载就能逃到宿主机？

这是你从“会用 Docker”走向“懂容器安全”的分水岭。搞懂 Namespace（隔离视图）、Cgroup（资源限制）、Capabilities（拆分 root 特权）、seccomp/LSM（限制系统调用与访问）这四组机制，你就能自己判断一个容器配置是松是紧，也能看懂几乎所有“容器逃逸”漏洞的原理——它们无非是把上面某一层的隔离捅穿了。这直接服务于项目④里 Pod 的 `securityContext` 加固：`runAsNonRoot`、`drop ALL capabilities`、`readOnlyRootFilesystem`、seccomp，全都是这一课概念在 Kubernetes 里的落地。

对你这样的 Java 后端来说还有个现实好处：线上排障时你会更从容。“为什么容器里 `top` 看到的内存和实际不一样”“为什么 JVM 在容器里 OOM 被 kill”“为什么 `ping` 在容器里用不了”，答案都在这一课。

学完你要能用自己的话回答本阶段的核心问题：**一个 Docker 容器到底为什么不是虚拟机**，并亲手用 `unshare` 造一个“迷你容器”，亲眼看到“容器只是一个视图被隔离、资源被限制的普通进程”。

## 核心概念

### 0. 先回答：一个 Docker 容器到底为什么不是虚拟机

一句话：**虚拟机虚拟的是“硬件”，容器虚拟的是“视图”；虚拟机各有各的内核，容器共用宿主机同一个内核。**

虚拟机（VM）里跑着 Hypervisor（如 KVM）虚拟出来的一套“假硬件”——虚拟 CPU、虚拟内存、虚拟磁盘、虚拟网卡。每台 VM 装自己的操作系统，有**自己独立的内核**。Guest 里的程序发起系统调用，是进入 Guest 自己的内核，再由 Hypervisor 转译到物理硬件。隔离边界是硬件虚拟化，非常强，代价是每台 VM 都要一份完整 OS、启动以秒/十秒计、内存开销大。

容器里没有第二个内核。容器里的进程就是**宿主机内核上的普通进程**，和你在宿主机 `ps` 里看到的其他进程排排坐。它发起的系统调用直接进入**宿主机内核**。所谓“隔离”，是内核给这个进程套了几层机制，让它“看到的世界”被裁剪、被限制：

```
        Virtual Machine                         Container
   +----------------------+            +--------------------------+
   |  App                 |            |  App (just a process)    |
   |  Guest libc          |            |  libc (in image)         |
   |  Guest Kernel        |  <-own     |                          |
   +----------------------+   kernel   +--------------------------+
   |  Virtual HW (KVM)    |            |  Namespaces / Cgroups /  |  <- kernel features
   +----------------------+            |  Capabilities / seccomp  |
   |  Host Kernel         |            +--------------------------+
   +----------------------+            |  Host Kernel (SHARED)    |  <- 唯一一个内核
   |  Physical HW         |            +--------------------------+
   +----------------------+            |  Physical HW             |
```

隔离的四组机制，也是本课的主线：

- **Namespace**：隔离“你能看见什么”——进程号、网络、挂载点、主机名、用户、IPC。让容器以为自己独占一台机器。
- **Cgroup**：限制“你能用多少”——CPU、内存、PID 数、IO。
- **Capabilities + seccomp + LSM（AppArmor/SELinux）**：限制“你能做什么”——即使你在容器里是 root，也只有内核允许的那部分特权和系统调用。

这带来三个和安全直接相关的结论：

- **共享内核 = 共享攻击面**。一个内核漏洞（提权类）可能让容器里的进程直接攻击宿主机内核，从而逃逸。VM 要逃逸得先攻破 Hypervisor，通常更难。
- **默认容器里的 root，在内核眼里就是 UID 0**（未开 user namespace 时），只是被 Capabilities、seccomp、Namespace 限制住。限制一旦被削弱（`--privileged`、危险挂载、`--cap-add`），它就接近真正的 root。
- **隔离是“可调节”的，不是全有或全无**。同一个 docker，配置得当接近“较强隔离”，配置糟糕（特权 + 挂 docker.sock）几乎等于把宿主机交出去。这正是容器安全存在的意义。

所以标准答案不是“容器更轻所以更弱”，而是：**容器与宿主共享内核、用内核特性做隔离而非硬件虚拟化，因此隔离边界更薄、随配置浮动，这既是它快、省的原因，也是容器逃逸这一整类漏洞存在的根源。** 需要更强隔离时，可以用带轻量虚拟化的运行时（如 Kata Containers、gVisor）把这层边界补强，但那已经不是“普通 Docker”了。

### 1. 七类 Namespace：pid / net / mnt / uts / ipc / user / cgroup

Namespace 是内核提供的“视图隔离”。每一类 namespace 隔离一种全局资源，让处于其中的进程以为自己独占它。容器就是“一个进程被放进一整套新的 namespace 里”。

| Namespace | 隔离什么 | 容器里的效果 |
|---|---|---|
| pid | 进程号空间 | 容器内自成一套 PID，主进程是 PID 1，看不到宿主机进程 |
| net | 网卡、路由、iptables、端口 | 容器有自己的 eth0、自己的端口空间 |
| mnt | 挂载点（文件系统视图） | 容器有自己的 `/`，看不到宿主机文件系统 |
| uts | 主机名、域名 | 容器能有独立 hostname |
| ipc | System V IPC、POSIX 消息队列 | 容器间共享内存互不可见 |
| user | UID/GID 映射 | 容器内的 root（UID 0）可映射为宿主机上的普通用户 |
| cgroup | cgroup 层级的视图 | 容器看不到宿主机真实的 cgroup 路径 |

关键点：

- **PID namespace 揭穿了“容器只是进程”**：在宿主机上，容器主进程有一个普通的大 PID（如 3862），在容器里同一个进程是 PID 1。同一个进程，两个视图，这就是隔离的本质。
- **user namespace 是最重要的安全机制，但默认没开**。它能把“容器内 UID 0”映射成“宿主机上某个无特权 UID（如 100000）”，这样即使容器 root 逃出来，在宿主机上也只是个普通用户。Docker 默认不开启（需要配置 `userns-remap`），所以默认情况下容器 root == 宿主机 UID 0。Kubernetes 从 1.25 起把 user namespace 作为逐步成熟的特性引入（`hostUsers: false`），但很多集群仍未启用。
- 想在宿主机上看一个容器用了哪些 namespace：`ls -l /proc/<宿主机PID>/ns/`，每个链接后面的编号相同即同一个 namespace。

### 2. Cgroup：CPU、内存限制

Namespace 管“看见什么”，Cgroup（control group）管“用多少”。它把一组进程的 CPU 时间、内存、PID 数量、块设备 IO 等做量化限制和统计。`docker run --memory=512m --cpus=1.5 --pids-limit=200` 背后就是往 cgroup 的控制文件里写数值。

和 Java 后端强相关的三件事：

- **内存超限会被 OOM Killer 杀掉**。容器内存达到 cgroup 上限，内核直接 kill 进程（宿主机 `dmesg` 里能看到 oom-kill 记录，容器退出码常见 137 = 128+9/SIGKILL）。所以给 JVM 配 `-XX:MaxRAMPercentage`，让堆 + 元空间 + 线程栈 + 直接内存的总和留在容器上限之内。
- **Java 17 默认感知 cgroup**。现代 JVM 会读 cgroup 的限制来决定默认堆大小和 `Runtime.availableProcessors()`，所以容器里的线程池、`ForkJoinPool` 大小是按“限额的 CPU”而不是宿主机总核数算的。老版本 JDK（8 早期）不感知，会误以为有整台机器的资源，是经典事故。
- **`--pids-limit` 能挡 fork 炸弹**。限制进程数，防止一个失控容器把宿主机 PID 耗尽。

cgroup 有 v1 和 v2 两代，新系统基本是 v2（统一层级）。它既是资源治理手段，也是可用性安全（DoS 防护）的一环：没有限制的容器，一个内存泄漏就能拖垮整台宿主机上的所有邻居。

### 3. Linux Capabilities 与 --privileged 的危害

传统 Unix 只有“root 全能 / 普通用户受限”两档。**Capabilities** 把 root 的特权拆成了几十个独立的小权限，可以单独授予或剥夺。这样一个进程即使 UID 是 0，也只拥有它真正需要的那几项能力。

几个你该认识的：

| Capability | 允许做什么 | 危险点 |
|---|---|---|
| CAP_NET_BIND_SERVICE | 绑定 1024 以下端口 | 较温和 |
| CAP_NET_RAW | 发原始包（ping 用它） | 可做 ARP 欺骗、嗅探 |
| CAP_SYS_ADMIN | 巨量特权：mount、部分 namespace 操作等 | 几乎等于半个 root，逃逸常用 |
| CAP_SYS_PTRACE | ptrace 其它进程 | 可注入/读其它进程内存 |
| CAP_SYS_MODULE | 加载内核模块 | 直接改内核 = 完全逃逸 |
| CAP_DAC_READ_SEARCH | 绕过文件读权限检查 | 曾被用于逃逸（配合文件句柄） |

Docker 默认给容器保留一小组 capability（如 CAP_NET_BIND_SERVICE、CAP_CHOWN 等），并丢弃危险的。所以容器里的 root 是“阉割版 root”。

**`--privileged` 的危害**：它几乎把所有限制一次性关掉——授予全部 capability、放开 seccomp/AppArmor、允许访问所有宿主机设备（`/dev` 直通）。特权容器里的 root 基本就是宿主机 root：可以 mount 宿主机磁盘、加载内核模块、访问 `/dev/mem`。**特权容器逃逸几乎是必然的，不是“会不会”而是“怎么逃”。** 除了极少数需要操作硬件的场景（如某些 CI、存储驱动），永远不要用 `--privileged`。

安全的做法是反过来做“最小能力”：

```
docker run --cap-drop ALL --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges ...
```

先丢光所有 capability，再按需加回极少数。`no-new-privileges` 阻止进程通过 setuid 程序等方式获得新特权（对应 K8s 的 `allowPrivilegeEscalation: false`）。对 MyNotes 这种纯 Web 服务，`--cap-drop ALL` 通常什么都不用加回来——它不需要任何特权（用 8080 端口，>1024，连 NET_BIND_SERVICE 都不需要）。

### 4. seccomp、AppArmor/SELinux

Capabilities 管“特权动作”，还有两道正交的防线：

**seccomp（secure computing）** 过滤**系统调用**。容器里的进程本质是靠系统调用请内核干活，seccomp 用一份白/黑名单决定哪些 syscall 允许、哪些直接拒绝或杀进程。Docker 有一个**默认 seccomp profile**，屏蔽了几十个危险且容器几乎用不到的 syscall（如 `mount`、`reboot`、`kexec_load`、`init_module`、老的 `ptrace` 组合等），大幅缩小内核攻击面。**`--privileged` 会关掉这个默认 profile**，这是特权容器危险的原因之一。对应 K8s 里应显式设 `seccompProfile: type: RuntimeDefault` 来启用运行时的默认 profile（K8s 早期版本默认是 Unconfined）。

**LSM（Linux Security Module）：AppArmor / SELinux** 做**强制访问控制（MAC）**。普通权限是自主访问控制（DAC，属主说了算），MAC 则由系统策略强制约束进程能访问哪些文件、路径、能力，即使你是 root 也越不过策略。Docker 在支持的系统上会给容器套一个默认 AppArmor profile（`docker-default`），限制对 `/proc`、`/sys` 等敏感路径的写入。Ubuntu/Debian 系常用 AppArmor，RHEL/CentOS/Fedora 系常用 SELinux（`--security-opt label=...`）。

四道防线合起来是纵深防御：**Namespace 让你看不到，Cgroup 让你用不多，Capabilities 让你（即使是 root）做不了特权动作，seccomp 让你调不了危险 syscall，LSM 再兜底限制你能碰的资源。** 容器逃逸，通常就是想办法削弱或绕过其中一层或几层。

### 5. 容器逃逸的常见路径：特权容器、docker.sock、内核漏洞、敏感挂载

“容器逃逸”= 从容器里获得宿主机上的执行能力或读写能力。既然隔离是几层内核机制，逃逸就是把某一层捅穿。常见四类：

- **特权容器（`--privileged`）**：拥有全部 capability、无 seccomp、可访问宿主机设备。典型手法是把宿主机磁盘设备 `mount` 到容器里直接读写整块盘，或 `insmod` 加载恶意内核模块。见到 `--privileged` 基本可判定“可逃逸”。
- **挂载 docker.sock（或 containerd sock）**：上一课讲过——能跟这个 socket 说话就能命令守护进程新建一个挂了宿主机根目录的特权容器，等于宿主机 root。CI runner 里最常见。
- **内核漏洞**：因为共享内核，一个本地提权类内核漏洞（如历史上的 Dirty COW、Dirty Pipe 一类覆盖文件/提权的漏洞）在容器里同样能打，打穿内核就等于打穿了隔离。这类是“容器 vs VM”差别最本质的地方：VM 得先攻破 Hypervisor。防御靠及时打内核补丁 + seccomp 缩小可达 syscall + user namespace 降低影响面。
- **敏感挂载（bind mount）**：把宿主机敏感路径挂进容器就等于自废隔离。常见危险挂载：
- 　↳ `-v /:/host` 或挂 `/etc`、`/root`：直接读写宿主机文件，写 crontab、加 SSH key、改 `/etc/passwd`。
- 　↳ 挂 `/var/run/docker.sock`：见上。
- 　↳ 挂 `/proc`、`/sys` 或用 `--pid=host`：能看到并操作宿主机进程/内核参数，配合特权可写 `core_pattern` 等实现逃逸。
- 　↳ 挂宿主机设备 `/dev`：直接访问磁盘、内存设备。

统一的防御思路，也正是下面几课要在 K8s 里落地的：非 root 运行、`--cap-drop ALL`、`no-new-privileges`、启用默认 seccomp、只读根文件系统、绝不 `--privileged`、绝不挂 docker.sock 和宿主机敏感目录、尽量开 user namespace、及时打内核补丁。

## 动手实践

:::warn 声明
本系列里的攻击手法只用于你自己的环境或获得授权的目标。
:::

### 实践：用 unshare 手工造一个 PID + mount namespace 的“迷你容器”

**这个实验必须在 Linux 上做**（`unshare` 是 Linux 特有的系统调用/命令，macOS 没有）。你在 Mac 上有两个选择：一是启动一台 Linux 虚拟机（Multipass、UTM、VirtualBox 里装 Ubuntu，或云上开一台），二是进入任意一个 Linux 容器里做（`docker run --rm -it --privileged ubuntu:22.04 bash`，这里加 `--privileged` 只是为了让容器内还能再创建 namespace，仅用于本地学习）。下面命令假设你已在一台 Linux 上、且有 root（或用 `sudo`）。推荐用 Multipass 开一台 Ubuntu 虚拟机，干净，不会和容器的概念混在一起：

```
$ brew install --cask multipass
$ multipass launch --name lab
$ multipass shell lab
ubuntu@lab:~$ which unshare
/usr/bin/unshare
```

`unshare` 属于 util-linux 包，Ubuntu 默认就装了。做完实验后用 `multipass delete --purge lab` 删除虚拟机。

先看清楚“隔离前”的世界：

```
$ hostname
mybox
$ ps -e | wc -l
243
$ readlink /proc/$$/ns/pid
pid:[4026531836]
```

`$$` 是当前 shell 的 PID，`readlink .../ns/pid` 打印它所属 PID namespace 的编号，记住这个数。

现在用一条命令创建新的 PID + mount + UTS namespace，并在里面开一个 bash：

```
$ sudo unshare --pid --mount --uts --fork --mount-proc bash
```

参数逐个解释：`--pid` 新建 PID namespace；`--mount` 新建 mount namespace；`--uts` 新建 UTS namespace（这样改 hostname 不影响宿主机）；`--fork` 让 unshare fork 出子进程再执行 bash（PID namespace 的规则要求第一个进程成为 PID 1，必须 fork）；`--mount-proc` 在新 mount namespace 里重新挂载一个 `/proc`，让 `ps` 看到的是**新** PID namespace 的进程，而不是宿主机的。

进去以后验证隔离：

```
# echo $$
1
# ps -e
    PID TTY          TIME CMD
      1 pts/0    00:00:00 bash
      9 pts/0    00:00:00 ps
# readlink /proc/1/ns/pid
pid:[4026532778]
# hostname mini-container
# hostname
mini-container
```

怎么读：

- `$$` 现在是 **1**——这个 bash 成了新 PID namespace 里的 PID 1（就像容器主进程）。
- `ps -e` 只看到两个进程（bash 和 ps 自己），宿主机上那 200 多个进程全都不可见了。这就是 PID + mount(`/proc`) namespace 的效果：**同一个内核、同一批真实进程，只是视图被裁剪。**
- `/proc/1/ns/pid` 的编号和刚才宿主机记下的**不一样**，证明确实进了新的 namespace。
- 改 hostname 只在这里生效，退出后宿主机 hostname 不变（UTS namespace）。

最关键的一步——**在另一个终端**（宿主机上，不要退出上面的 shell）看同一个进程的“另一副面孔”：

```
$ ps -ef | grep '[b]ash' | grep -v grep
root      50124  50110  0 10:22 pts/0  00:00:00 unshare --pid --mount ...
root      50125  50124  0 10:22 pts/0  00:00:00 bash
```

那个在容器里自称 PID 1 的 bash，在宿主机上其实是 PID **50125** 的普通进程，有父进程、能被宿主机 `kill 50125` 直接杀掉。**一个进程，两个 PID，两个视图——这就是“容器只是进程”最直观的证据。**

退出：在迷你容器里 `exit` 即可，namespace 随第一个进程退出自动销毁，`/proc` 也恢复。你没有用到任何 Docker，却已经手工搭出了容器隔离的核心。真实的容器无非是把七类 namespace 都建好、套上 cgroup 限额、丢弃多余 capability、挂上 seccomp、再用镜像的文件系统做根，一次性帮你做完。

:::tip 想再进一步
`unshare --user --map-root-user` 可以体验 user namespace：普通用户就能造出一个“容器内是 root”的环境，而它在宿主机上仍是你这个普通用户——这正是 rootless 容器和 K8s user namespace 的原理。加 `--net` 会得到一个只有 lo 的空网络 namespace，`ip addr` 里连 eth0 都没有，对应容器的 net namespace。
:::

## 攻击者视角

攻击者攻破容器里的应用（比如通过一个 RCE）后，第一件事往往是“探测隔离有多松”，判断能不能逃到宿主机：

- **查身份和能力**：`id` 看是不是 root；`capsh --print` 或读 `/proc/self/status` 的 `CapEff` 看有哪些 capability。如果是 root 且 CapEff 很满，逃逸希望大增。
- **找特权标志**：读 `/proc/1/status`、看能不能 `mount`、`/proc/self/status` 里 `Seccomp:` 字段是否为 0（0 = 没开 seccomp，常见于特权容器）。存在 `/dev/sda` 之类块设备说明可能有设备直通。
- **翻挂载点**：`mount`、`cat /proc/mounts` 找有没有把宿主机目录、docker.sock、`/proc`、`/sys` 挂进来。看到 `docker.sock` 基本就能拿宿主机。
- **判断是否在容器里**：看 `/.dockerenv` 文件、`/proc/1/cgroup` 里的路径、PID 1 是不是自己的应用。
- **打内核**：确认内核版本 `uname -r`，找匹配的本地提权 EXP。
- **抢 ServiceAccount / 元数据**：在 K8s 里还会去读 `/var/run/secrets/kubernetes.io/serviceaccount/token`，或访问云元数据地址（和 [[web-ssrf]] 的 Lab 05 同一个套路）——这些是下一阶段 [[k8s-basics]]、[[k8s-rbac]] 的主题。

一句话：攻击者的逃逸能力，几乎完全取决于你把上面四层隔离配置得多松。

## 防御与最佳实践

- **绝不 `--privileged`**，绝不挂 `docker.sock`、宿主机 `/`、`/etc`、`/proc`、`/sys` 到不可信容器；挂载尽量 `:ro`。
- **非 root 运行**：镜像里 `USER` 数字 UID；有条件就开 user namespace（Docker 的 `userns-remap`、K8s 的 `hostUsers: false`），把容器 root 映射成宿主机无特权用户。
- **最小能力**：`--cap-drop ALL` 再按需 `--cap-add`；MyNotes 这类 Web 服务通常一个都不用加。加 `--security-opt no-new-privileges`。
- **保留默认 seccomp 与 LSM**：别随手关掉；K8s 里显式设 `seccompProfile: RuntimeDefault`，系统上启用 AppArmor/SELinux。
- **资源限额**：`--memory`、`--cpus`、`--pids-limit`，防 DoS 和拖垮邻居；JVM 配 `MaxRAMPercentage` 匹配内存上限。
- **只读根文件系统**：`--read-only` + 给必要目录挂 tmpfs（MyNotes 需要 `/tmp` 和数据目录），对应 K8s 的 `readOnlyRootFilesystem: true` + emptyDir。
- **打补丁**：宿主机内核和运行时（Docker/containerd）及时更新，堵内核逃逸。
- **需要强隔离时换运行时**：多租户或跑不可信代码，考虑 gVisor、Kata Containers 这类沙箱化运行时，把“共享内核”这条根本弱点补上。

## 常见误区

- **“容器是轻量虚拟机。”** 本课主线：VM 各有内核、靠硬件虚拟化隔离；容器共享宿主内核、靠 namespace/cgroup/capabilities/seccomp 隔离。二者隔离强度和攻击面根本不同。
- **“容器里是 root 没关系，反正出不去。”** 默认没开 user namespace 时，容器 root 就是宿主机 UID 0，只被 capabilities/seccomp 挡着。一旦有危险挂载、特权或内核漏洞，它就是宿主机 root。
- **“`--privileged` 只是方便，加了也没事。”** 特权容器几乎必然可逃逸，等于把宿主机交出去。它同时关掉了 seccomp、放开了所有 capability 和设备。
- **“namespace 提供了强安全边界。”** namespace 主要是“视图隔离”，不是为对抗恶意提权设计的强安全边界；真正的纵深防御要靠 capabilities + seccomp + LSM + user namespace 叠加，加上内核补丁。
- **“容器里看到 8 核 16G，我的线程池就按这个配。”** 那可能是宿主机的规格。要按 cgroup 限额配；老 JDK 不感知 cgroup 会误判，Java 17 默认感知但仍要显式设内存百分比。
- **“seccomp/AppArmor 是运维的事，跟我无关。”** 它们默认就在保护你的容器，随手关掉（或用了 privileged）就等于自己拆了防线。

## 自测

:::details 1. 用你自己的话说：一个 Docker 容器为什么不是虚拟机？
虚拟机通过 Hypervisor 虚拟出硬件，每台 VM 有自己独立的内核，隔离边界是硬件虚拟化，强但重。容器里没有第二个内核，容器进程就是宿主机内核上的普通进程，系统调用直接进宿主机内核；所谓隔离是内核用 namespace（裁剪视图）、cgroup（限制资源）、capabilities/seccomp/LSM（限制能做什么）给这个进程套上的几层机制。因此容器与宿主共享内核、隔离边界更薄且随配置浮动——这既让它启动快、开销小，也是容器逃逸这一整类漏洞存在的根源。
:::

:::details 2. 七类 namespace 各隔离什么？哪一类对安全最关键，为什么？
pid（进程号）、net（网络）、mnt（挂载点/文件系统视图）、uts（主机名）、ipc（进程间通信）、user（UID/GID 映射）、cgroup（cgroup 视图）。安全上最关键的是 user namespace：它能把容器内的 root（UID 0）映射为宿主机上的无特权用户，即使逃逸出来在宿主机上也只是普通用户。但 Docker 默认不开启，所以默认情况下容器 root 就是宿主机 UID 0。
:::

:::details 3. 为什么 --privileged 的容器几乎可以认为一定能逃逸？
因为它一次性关掉了几乎所有隔离：授予全部 capability、关闭默认 seccomp profile、放开对宿主机所有设备的访问。这样容器里的 root 能 mount 宿主机磁盘、加载内核模块、访问 /dev/mem 等，具备直接读写宿主机、篡改内核的能力，逃逸只是操作问题。除极少数需操作硬件的场景外都不该使用。
:::

:::details 4. Capabilities、seccomp、LSM（AppArmor/SELinux）三者的分工是什么？
Capabilities 把 root 特权拆成几十个小权限，控制“能不能做某类特权动作”（如 mount、加载模块）；seccomp 过滤系统调用，控制“能不能调某个 syscall”；LSM 做强制访问控制，用系统策略约束进程能访问哪些文件/路径/能力，即使 root 也越不过。三者正交叠加形成纵深防御，容器逃逸通常要削弱或绕过其中若干层。
:::

:::details 5. unshare 实验里，容器内自称 PID 1 的进程在宿主机上是什么？说明了什么？
它在宿主机上是一个拥有普通大 PID（如 50125）的进程，有父进程，能被宿主机直接 kill。同一个进程在两个 PID namespace 里有两个不同的 PID 和两套视图，直观证明了“容器只是一个视图被隔离的普通进程”，并没有独立的操作系统或内核。
:::

:::details 6. 为什么在容器里给 JVM 配 -XX:MaxRAMPercentage 很重要？
容器的内存上限由 cgroup 设定，超限会被内核 OOM Killer 直接杀掉（退出码常见 137）。JVM 的堆、元空间、线程栈、直接内存总和必须留在这个上限内。Java 17 默认能感知 cgroup 限制来定默认堆，但默认上限偏保守（约 25%），显式设 MaxRAMPercentage 能更好利用限额又不越界，避免频繁 OOM 或资源浪费。
:::

:::details 7. 攻击者进入一个容器后，怎么判断能不能逃到宿主机？
看几件事：`id`/CapEff 判断是不是 root、有哪些 capability；`/proc/self/status` 的 Seccomp 字段是否为 0（没开 seccomp）；`mount`/`/proc/mounts` 有没有挂进 docker.sock、宿主机根目录、/proc、/sys 或设备；是否 `--privileged`；`uname -r` 找匹配的内核提权 EXP。逃逸难度基本取决于隔离被配置得多松。
:::

## 一句话总结

容器不是虚拟机——它是共享宿主内核、靠 namespace（隔离视图）+ cgroup（限制资源）+ capabilities/seccomp/LSM（限制行为）拼出来的普通进程；隔离薄而可调，配得紧就接近强隔离，配得松（特权、危险挂载）就等于把宿主机交出去，这正是容器逃逸存在的原因，也是后面 K8s 加固每一条规则的出发点。
