## 为什么要学

你写 Spring Boot 的时候，默认请求是“浏览器直接打到 Tomcat”。但在任何一个真实的线上环境里——不管是车联网平台的 API 网关、IoT 设备接入层，还是电商大促时的负载均衡——请求到达你的 `@RestController` 之前，至少会经过一层 Nginx/SLB/网关，再往外还有 NAT 和防火墙。`request.getRemoteAddr()` 拿到的是谁的 IP？`request.getScheme()` 为什么总是 `http`？重定向为什么跳到了 `http://127.0.0.1:8080`？这些日常“坑”，根源都在这一课。

在安全路线上，这一课回答的是“**谁能访问谁**”。NAT 和防火墙决定了一台机器能不能被外网直接摸到；反向代理决定了外网请求以什么形态交给后端。很多高危漏洞恰恰不是某一方写错了，而是**代理和后端对同一个请求理解不一致**：代理以为路径是 `/public/..`，后端解析成 `/admin`；代理认为请求到此结束，后端却认为后面还有一个请求（请求走私）；应用信任了一个其实是客户端自己写的 `X-Forwarded-For`。

学完这一课，你应该能：

- 画出“客户端 → NAT/防火墙 → Nginx → Spring Boot”的链路，说清每一跳看到的源 IP 和 Host 是什么。
- 写出一份正确的 Nginx 反向代理配置，并让 Spring Boot 正确地、*只*从可信代理那里取真实 IP。
- 解释 IP 白名单、Host 头、路径规范化、请求走私这几类“代理-后端差异”问题的原理和防法。

:::tip 与其他课的关系
HTTP 报文本身的结构见 [[net-http]]，TLS 终止见 [[net-tls]]；这里专注于“中间那一层”。Linux 主机上的防火墙命令（iptables/nftables/ufw）会在 [[linux-net]] 里动手，容器网络隔离在 [[docker-isolation]]。
:::

## 核心概念

### 1. 正向代理 vs 反向代理，以及 proxy_pass 的常见头

两者的区别在于“代理替谁办事、谁知道它的存在”：

| | 正向代理 | 反向代理 |
|---|---|---|
| 代表谁 | 客户端（替客户端去访问外面） | 服务端（替后端接收外面的请求） |
| 谁需要配置 | 客户端要主动设置代理（如浏览器代理、`curl -x`） | 客户端无感知，以为自己连的就是网站 |
| 典型例子 | 公司上网代理、Burp Suite、Clash | Nginx、SLB/ELB、API 网关、Ingress |
| 安全用途 | 审计/管控出网流量；攻击者用它隐藏来源 | 隐藏后端、TLS 终止、限流、WAF |

```
Forward proxy:  [client] --(knows proxy)--> [proxy] ---> [any website]    代理替客户端出网
Reverse proxy:  [client] ---> [nginx :443] ---> [app 127.0.0.1:8080]      客户端只看到 nginx
```

你在做渗透测试时用的 Burp Suite 就是一个正向代理；你的 Spring Boot 前面挂的 Nginx 就是反向代理。

**proxy_pass 的问题**：Nginx 收到请求后，会作为一个**新的 HTTP 客户端**，重新向后端发起一个连接。于是后端看到的“客户端”变成了 Nginx：

- `request.getRemoteAddr()` → Nginx 的 IP，而不是用户的 IP。
- `Host` 头 → 默认变成 `proxy_pass` 里写的地址（Nginx 默认 `proxy_set_header Host $proxy_host;`）。
- 协议 → 如果 Nginx 做了 TLS 终止，后端看到的是 `http`。

为了把这些信息“带过去”，约定俗成地加这几个头：

| 头 | 典型 Nginx 写法 | 含义 |
|---|---|---|
| `Host` | `proxy_set_header Host $host;` | 保留用户原始请求的域名 |
| `X-Real-IP` | `proxy_set_header X-Real-IP $remote_addr;` | Nginx 看到的直接对端 IP（单值） |
| `X-Forwarded-For` | `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` | 链路 IP 列表：`原有XFF, $remote_addr` |
| `X-Forwarded-Proto` | `proxy_set_header X-Forwarded-Proto $scheme;` | 用户用的是 http 还是 https |
| `Forwarded` | 需手动拼 | RFC 7239 标准化的写法，`for=...;proto=...;host=...` |

关键细节：`$proxy_add_x_forwarded_for` 的意思是“**如果客户端请求里已经有 XFF，就在它后面追加 $remote_addr**”。也就是说，XFF 最左边的值可能是客户端**自己随便写的**，只有最右边那个（由你信任的最后一跳代理追加的）才是真实的。这正是后面 IP 白名单绕过的根源。

一个多级代理的例子：

```
client 1.2.3.4 (sends "X-Forwarded-For: 9.9.9.9")
   -> SLB 10.0.0.5        XFF: 9.9.9.9, 1.2.3.4
   -> nginx 10.0.1.10     XFF: 9.9.9.9, 1.2.3.4, 10.0.0.5
   -> app                 remoteAddr = 10.0.1.10
```

正确取真实 IP 的算法：从 XFF **右边往左**看，跳过所有你**信任的代理 IP**，遇到的第一个不可信 IP 就是客户端 IP。这里是 `1.2.3.4`，而不是最左边的伪造值 `9.9.9.9`。Tomcat 的 `RemoteIpValve` 就是这么实现的。

### 2. NAT：内网地址如何访问公网

IPv4 地址不够用，于是内网用私有地址段（RFC 1918）：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`。这些地址在公网上不可路由，必须经过 **NAT（网络地址转换）** 设备（家用路由器、云上的 NAT 网关、SNAT 规则）才能出网。

最常见的是 **SNAT / NAPT（源地址+端口转换）**：

```
inside                         NAT gateway (public 203.0.113.7)             outside
192.168.1.20:51000  ------>  rewrite src -> 203.0.113.7:40001  ------>  api.example.com:443
192.168.1.20:51000  <------  lookup table 40001 -> .20:51000  <------  reply to 203.0.113.7:40001
```

NAT 设备维护一张**转换表**（连接跟踪）：`内网IP:端口 ↔ 公网IP:端口 ↔ 目标`。回包到达时查表改回内网地址。

**为什么公网默认访问不到内网？** 因为一个从外面主动进来的包（比如访问 `203.0.113.7:8080`），在转换表里**没有对应条目**，NAT 设备不知道该转给内网哪台机器，只能丢弃。这带来一个“副作用式”的安全性：内网机器天然不暴露。但要注意：

- NAT **不是**防火墙。它的设计目的是省地址，不是安全；一旦配置了 **DNAT / 端口映射**（比如路由器上把 `公网:8080 → 192.168.1.20:8080`），这台机器就直接暴露了。
- 内网机器**可以主动出网**。这正是反弹 Shell、C2 回连能穿透 NAT 的原因：攻击者让受害机器主动连出来，连接跟踪表会自动为回包放行。
- IoT 场景：车机、网关设备大多躲在运营商 NAT（CGNAT）后面，平台无法主动连设备，所以设备要**主动**连 MQTT Broker 并保持长连接，平台的下行指令走这条已建立的连接。这就是你用 EMQX 时设备“先连上来”的网络层原因。
- Docker 也在用 NAT：`docker run -p 8080:80` 本质是在宿主机上加了一条 DNAT 规则，容器出网走的是 SNAT（MASQUERADE）。

### 3. 防火墙：状态检测、白名单、默认拒绝

防火墙按规则决定包的去留。几个关键概念：

- **无状态过滤**：只看单个包的五元组（源IP、源端口、目标IP、目标端口、协议）。问题是回包也得单独写规则放行，容易写成“源端口 80 的都放行”这种大洞。
- **状态检测（stateful）**：防火墙记住已建立的连接（conntrack）。典型规则是“`ESTABLISHED,RELATED` 一律放行，`NEW` 连接按白名单判断”。这样出站连接的回包自动放行，而外部主动发起的新连接要单独批准。
- **白名单（allowlist）+ 默认拒绝（default deny）**：先把默认策略设为 DROP，再逐条放行需要的端口和来源。与之相反的“黑名单 + 默认放行”在安全上几乎总是错的，因为你永远列不全坏东西。

一台典型 Web 服务器的入站策略（概念示意，具体命令见 [[linux-net]]）：

| 顺序 | 规则 | 动作 |
|---|---|---|
| 1 | 状态为 ESTABLISHED/RELATED | ACCEPT |
| 2 | 来自 lo 回环接口 | ACCEPT |
| 3 | TCP 443/80，来自任意 | ACCEPT |
| 4 | TCP 22，只来自堡垒机 IP | ACCEPT |
| 5 | 其他所有 | DROP（默认策略） |

注意 8080、3306、6379、1883 都**不在**白名单里：Spring Boot 只让 Nginx 在本机访问，MySQL/Redis 只让内网应用访问。云上的“安全组”就是托管的状态防火墙，逻辑完全一样。另外别忘了**出站**方向：限制服务器只能访问必需的外部地址，能大幅削弱 SSRF 和反弹 Shell（见 [[web-ssrf]]）。

### 4. 代理与后端的解析差异

一个请求被两个不同的软件（Nginx 用 C 写的解析器，Tomcat 用 Java 写的解析器）各解析一次。只要两边对“路径是什么”“Host 是什么”“请求在哪结束”的理解有一丁点不同，访问控制就可能被绕过。

#### 4.1 路径规范化

假设你在 Nginx 上想挡住管理接口：

```
location /admin/ { deny all; }
location /       { proxy_pass http://127.0.0.1:8080; }
```

攻击者发 `GET /public/..;/admin/users`：

- Nginx 看到的路径段是 `public`、`..;`、`admin`。`..;` 不是 `..`，所以它认为路径在 `/public/` 下，不匹配 `/admin/`，放行。
- Tomcat 会把 `;` 之后的内容当成**路径参数**（Servlet 规范里的 `;jsessionid=` 就是这么来的）剥掉，`..;` 就变成了 `..`，最终路径解析为 `/admin/users`。

另一个经典例子是 Nginx `alias` 少写斜杠：`location /static { alias /data/static/; }`，请求 `/static../app.jar` 会被拼成 `/data/static/../app.jar`，穿越到上级目录。正确写法是 location 和 alias **都以 `/` 结尾**。

教训：**不要只在代理层按路径做访问控制**，后端（Spring Security）必须自己再判断一次。Spring Security 的 `StrictHttpFirewall` 默认会拒绝包含 `;`、编码的 `/` 和 `..` 等可疑字符的 URL，这就是它存在的意义。

#### 4.2 Host 头攻击

`Host` 头完全由客户端控制。如果应用用它来拼 URL，就会出事：

- **密码重置投毒**：应用用 `request.getServerName()` 拼出 `https://{host}/reset?token=...` 发邮件。攻击者用受害者邮箱申请重置，同时把 Host 改成 `evil.com`，受害者收到的邮件链接指向攻击者，点击即泄露 token。
- **缓存投毒**：CDN/Nginx 缓存键里不含 Host（或 `X-Forwarded-Host`），而页面里的资源地址是按 Host 生成的，一次恶意请求就污染所有用户看到的缓存。
- **基于路由的 SSRF**：某些代理按 Host 决定转发到哪台后端，攻击者把 Host 改成内网地址，就能让代理替他访问内网。

防法：Nginx 写明确的 `server_name`，再加一个兜底的 `default_server` 直接拒绝未知 Host；应用里需要绝对 URL 时，用**配置里写死的域名**，不要从请求里取。

#### 4.3 HTTP 请求走私（Request Smuggling）

HTTP/1.1 有两种方式表示 body 长度：`Content-Length`（CL）和 `Transfer-Encoding: chunked`（TE）。规范（RFC 9112）要求两者同时出现时以 TE 为准，并且应当把这种请求视为可疑。如果前端代理和后端对同一个请求用了**不同的**头来判断长度，就会对“这个请求到哪里结束”产生分歧：

```
POST / HTTP/1.1
Host: shop.example.com
Content-Length: 13
Transfer-Encoding: chunked

0

SMUGGLED
```

如果前端按 CL（13 字节，包含到 `SMUGGLED` 为止）整体转发，而后端按 TE 读到 `0\r\n\r\n` 就认为请求结束，那么剩下的 `SMUGGLED` 会留在前端和后端之间**复用的那条 TCP 连接**里，被当作**下一个用户请求的开头**。这就是 CL.TE 型走私；反过来是 TE.CL 型。后果包括：绕过前端的访问控制、劫持其他用户的请求、缓存投毒。

走私的前提是前后端之间的连接会被多个用户的请求**复用**。Nginx 的 `proxy_http_version` 默认是 1.0、每个请求一条新连接，风险较小；一旦你为了性能改成 `1.1` 并配置 upstream `keepalive`，就要确认前后端对畸形请求的处理一致。

## 动手实践

### 实践：Docker 里的 Nginx 反向代理到本机 Spring Boot，并打印所有请求头

目标链路：

```
curl (mac) --> 127.0.0.1:8081 --> [nginx container :80] --> host.docker.internal:8080 --> Spring Boot
```

#### 第 1 步：在应用里加一个打印请求头的接口

新建 `src/main/java/com/aqin/mynotes/debug/HeaderEchoController.java`（放在 `com.aqin.mynotes` 包下，才会被组件扫描到）：

```java
package com.aqin.mynotes.debug;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class HeaderEchoController {

    private static final Logger log = LoggerFactory.getLogger(HeaderEchoController.class);

    @GetMapping("/debug/headers")
    Map<String, Object> headers(HttpServletRequest req) {
        Map<String, String> headers = new LinkedHashMap<>();
        for (String name : Collections.list(req.getHeaderNames())) {
            headers.put(name, String.join(" | ", Collections.list(req.getHeaders(name))));
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("remoteAddr", req.getRemoteAddr());
        result.put("scheme", req.getScheme());
        result.put("serverName", req.getServerName());
        result.put("serverPort", req.getServerPort());
        result.put("headers", headers);
        log.info("debug/headers {}", result);
        return result;
    }
}
```

`remoteAddr`、`scheme`、`serverName` 是 Servlet 容器“认为”的值，`headers` 是原始请求头。后面我们会看到这两者什么时候会不一致。

#### 第 2 步：让应用能被容器访问

本项目在 `application.properties` 里写了 `server.address=127.0.0.1`，只监听本机回环地址。容器里的 Nginx 通过 `host.docker.internal`（Docker Desktop for Mac 提供的、指向宿主机的域名）访问宿主机，这个连接**不是**从宿主机的 127.0.0.1 进来的，所以默认会连不上（Nginx 返回 502）。启动时临时覆盖监听地址：

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.address=0.0.0.0
```

:::warn 0.0.0.0 会把 /vuln/** 暴露到局域网
监听 `0.0.0.0` 后，同一 Wi-Fi 下的其他机器也能访问你故意留洞的 `/vuln/**` 接口。只在可信网络下做这个实验，做完立刻 Ctrl+C 停掉并恢复默认启动方式；不要把这个参数写进配置文件。
:::

确认监听地址变了（`*.8080` 表示所有地址）：

```
$ lsof -nP -iTCP:8080 -sTCP:LISTEN
COMMAND   PID  USER   FD   TYPE   DEVICE SIZE/OFF NODE NAME
java    12345  aqin   45u  IPv6  0x...        0t0  TCP *:8080 (LISTEN)
```

如果看到的是 `127.0.0.1:8080`，说明参数没生效。

#### 第 3 步：写 nginx.conf 并启动容器

在任意目录（比如 `~/lab/nginx`）新建 `nginx.conf`，这是一份完整的、可以直接替换镜像默认配置的文件：

```nginx
worker_processes 1;

events {
    worker_connections 1024;
}

http {
    # 自定义日志格式：把 XFF 和 Host 也记下来，方便对照
    log_format proxied '$remote_addr "$request" $status '
                       'host="$host" xff="$http_x_forwarded_for" '
                       'upstream=$upstream_addr';
    access_log /dev/stdout proxied;
    error_log  /dev/stderr warn;

    # 兜底：不认识的 Host 直接断开连接（444 是 Nginx 特有的“不响应直接关连接”）
    server {
        listen 80 default_server;
        return 444;
    }

    server {
        listen 80;
        server_name localhost 127.0.0.1;

        location / {
            proxy_pass http://host.docker.internal:8080;

            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

启动（端口只绑定到本机 127.0.0.1，避免 Nginx 本身也暴露到局域网）：

```bash
cd ~/lab/nginx
docker run --rm --name lab-nginx \
  -p 127.0.0.1:8081:80 \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  nginx:stable
```

前台运行，Nginx 的访问日志会直接打在这个终端里。启动报错时先检查配置语法：`docker run --rm -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:stable nginx -t`，正常输出以 `syntax is ok` 和 `test is successful` 结尾。如果你在 Linux 上做实验，`host.docker.internal` 默认不存在，需要给 `docker run` 加 `--add-host=host.docker.internal:host-gateway`。

#### 第 4 步：发请求，读结果

另开一个终端，故意带上一个伪造的 XFF：

```bash
curl -s http://127.0.0.1:8081/debug/headers -H 'X-Forwarded-For: 9.9.9.9' | python3 -m json.tool
```

输出类似（IP 值取决于你的 Docker Desktop 版本和网络，形态一致即可）：

```json
{
    "remoteAddr": "192.168.65.1",
    "scheme": "http",
    "serverName": "127.0.0.1",
    "serverPort": 8080,
    "headers": {
        "Host": "127.0.0.1",
        "X-Real-IP": "192.168.65.1",
        "X-Forwarded-For": "9.9.9.9, 192.168.65.1",
        "X-Forwarded-Proto": "http",
        "Connection": "close",
        "User-Agent": "curl/8.7.1",
        "Accept": "*/*"
    }
}
```

逐项解读：

- `remoteAddr`：应用看到的直接对端，是 Nginx 所在的网络路径（Docker 虚拟网络的某个地址），**不是**你的 curl。所以不配置的话，所有访问日志里的 IP 都是代理的。
- `Host: 127.0.0.1`：来自 `proxy_set_header Host $host`。`$host` 不含端口，所以 `serverPort` 仍是 8080。如果去掉这行，你会看到 `Host: host.docker.internal:8080`（Nginx 默认用 `$proxy_host`）。
- `X-Real-IP`：Nginx 看到的对端地址，单值，客户端无法伪造（除非前面还有一层代理把它改了）。
- `X-Forwarded-For: 9.9.9.9, 192.168.65.1`：**左边的 `9.9.9.9` 是你自己写的**，Nginx 只是在后面追加了它看到的地址。任何只读 XFF 第一个值的代码都会被骗。
- `Connection: close`：Nginx 默认用 HTTP/1.0 语义连后端、每个请求一条连接（见 4.3 节）。
- `User-Agent`/`Accept`：curl 发来的其他头，Nginx 原样透传。注意客户端发来的**任何**头（包括 `X-Real-IP`、`X-Forwarded-Host`）只要 Nginx 没有用 `proxy_set_header` 覆盖，都会原样到达应用。

同时看 Nginx 那个终端的日志，一行类似：

```
192.168.65.1 "GET /debug/headers HTTP/1.1" 200 host="127.0.0.1" xff="9.9.9.9" upstream=192.168.65.254:8080
```

`xff=` 是客户端发来的原始值，`upstream=` 是 `host.docker.internal` 实际解析到的地址。

再试一个未知 Host：`curl -v http://127.0.0.1:8081/debug/headers -H 'Host: evil.com'`，会看到 `Empty reply from server`，这就是兜底 `default_server` 的 444 在起作用，恶意 Host 根本到不了应用。

#### 第 5 步：让 Spring Boot 识别代理头，并观察一个真实的坑

停掉应用，这次多加一个参数，让 Tomcat 启用 `RemoteIpValve` 处理 `X-Forwarded-*`：

```bash
./mvnw spring-boot:run -Dspring-boot.run.arguments="--server.address=0.0.0.0 --server.forward-headers-strategy=native"
```

再发同样的请求，你会看到：

```json
{
    "remoteAddr": "9.9.9.9",
    "scheme": "http",
    ...
}
```

应用把**伪造的** `9.9.9.9` 当成了客户端 IP！原因是 `RemoteIpValve` 从 XFF 右边往左走，跳过“内部代理”，而它默认信任的内部代理正则覆盖了 `10/8`、`192.168/16`、`172.16/12`、`127/8` 等所有私有地址段。实验里你的 curl 经过 Docker 网络后本身就是一个私有地址，被当成了“可信代理”跳过，于是伪造值胜出。在生产上，只要攻击者能从内网（或另一个私网地址的跳板）发请求，就会出现同样的情况。

两处修复，各做一次再验证：

1. 在**面向客户端的第一层**代理上，不要追加，而是直接覆盖：把 Nginx 里那行改为 `proxy_set_header X-Forwarded-For $remote_addr;`，然后 `docker restart lab-nginx`（或 Ctrl+C 后重新 run）。
2. 在应用里把可信代理收窄到真正的 Nginx 地址，例如启动参数加 `--server.tomcat.remoteip.internal-proxies=192\\.168\\.65\\.1`（值是正则，按你实际看到的 `remoteAddr` 填）。

修复后再请求，`remoteAddr` 会变回 Nginx 实际看到的地址，`X-Forwarded-For` 里也不再有 `9.9.9.9`。这就把本课的“问题”做成了一个可复现的实验。

:::tip 做完记得收尾
`docker stop lab-nginx`（`--rm` 会自动删除容器），应用 Ctrl+C 后用默认方式重启，确认 `lsof` 里又回到 `127.0.0.1:8080`。
:::

## 攻击者视角

> 以下手法只能用于你自己的实验环境或已获授权的目标。

攻击者面对一个“Nginx + Java 应用”的目标，会系统地测试代理与后端的边界：

- **伪造来源 IP**：在请求里加 `X-Forwarded-For`、`X-Real-IP`、`X-Client-IP`、`True-Client-IP`、`Forwarded: for=127.0.0.1` 等一串头，看哪个能改变应用的行为（登录限流是否被重置、“仅内网可访问”的接口是否放开、日志里记录的 IP 是否变了）。
- **探测后端真实地址**：直接访问应用端口（8080）、云上的公网 IP 而不走域名，看能否绕过 WAF/Nginx 直达后端。
- **路径变形绕过**：对被拦截的路径尝试 `/admin;/`、`/public/..;/admin`、`/%61dmin`、`//admin`、`/admin/.`、大小写变化，找代理与后端的规范化差异。
- **Host 头操纵**：改 `Host`、加 `X-Forwarded-Host`，观察响应里生成的链接、重定向地址、密码重置邮件。
- **请求走私**：用 Burp 的 HTTP Request Smuggler 类工具探测 CL.TE / TE.CL，重点关注前端做鉴权、后端信任前端的架构。

### 问题：应用只根据 X-Forwarded-For 做 IP 白名单，攻击者能怎么绕过？

假设代码是这样的：

```java
String ip = request.getHeader("X-Forwarded-For");
if (ip != null && ip.split(",")[0].trim().equals("10.0.0.8")) {
    // 管理员内网 IP，放行
}
```

绕过方法取决于部署：

1. **应用直接暴露（没有代理）**：XFF 完全由客户端写，直接发 `X-Forwarded-For: 10.0.0.8` 即可。
2. **前面有 Nginx 且用 `$proxy_add_x_forwarded_for` 追加**：客户端发 `X-Forwarded-For: 10.0.0.8`，到应用时变成 `10.0.0.8, 攻击者真实IP`，代码取第一个值，照样绕过。
3. **能绕过 Nginx 直连后端**（端口没被防火墙挡住、或者从同一内网的另一台被攻陷机器发起），那么任何头都可以任意伪造。
4. **代码取最后一个值、但前面有多层代理**：取到的是中间某层代理的 IP，白名单要么全放、要么全挡，一不小心就把代理 IP 加进了白名单，等于对所有人开放。

另外，IP 白名单本身就是**弱认证**：同一个 NAT 出口后面可能有成百上千台机器（公司、运营商 CGNAT），“来自某个 IP”不等于“是某个人”。

结论：XFF 只有在“**最后一个可信代理追加的那个值**”才可信，而且需要应用知道哪些是可信代理。正确做法见下一节。

## 防御与最佳实践

**网络层（NAT/防火墙/安全组）**

- 默认拒绝，入站只开 80/443（和来自堡垒机的 22）；应用端口 8080、数据库、Redis、MQTT 管理端口一律不对公网开放。
- 应用只监听 `127.0.0.1` 或内网地址（本项目的 `server.address=127.0.0.1` 就是这个思路），让“绕过 Nginx 直连后端”在网络上不可能。
- 出站也做白名单，限制 SSRF 和反弹连接的出口。
- 端口映射/DNAT 是暴露面，定期盘点；Docker 的 `-p 8080:8080` 默认绑定所有地址，只需本机访问时写成 `-p 127.0.0.1:8080:8080`。

**代理层（Nginx）**

- 最外层代理用 `proxy_set_header X-Forwarded-For $remote_addr;` **覆盖**客户端传来的 XFF；内层代理再用 `$proxy_add_x_forwarded_for` 追加。
- 显式设置 `X-Real-IP`、`X-Forwarded-Proto`、`Host`，并清掉你不打算支持的头，例如 `proxy_set_header X-Forwarded-Host "";`（Nginx 里值为空字符串的头不会被发给后端）。
- 写明确的 `server_name`，配一个 `default_server` 返回 444，拒绝未知 Host。
- `location`/`alias` 路径成对以 `/` 结尾；不要只依赖 Nginx 的 `location` 做鉴权。
- 保持 Nginx 版本更新；若启用 upstream keepalive，确认后端同样严格拒绝同时带 CL 和 TE 等畸形请求；条件允许时前后端统一使用 HTTP/2。

**应用层（Spring Boot）**

- 用 `server.forward-headers-strategy=native`（Tomcat 的 `RemoteIpValve`）或 `framework`（Spring 的 `ForwardedHeaderFilter`）统一处理代理头，**不要**自己在业务代码里解析 XFF。
- 用 `server.tomcat.remoteip.internal-proxies` 收窄可信代理，只写真正的代理地址。
- 生成绝对 URL（邮件链接、OAuth 回调、支付回调）时使用配置中的固定域名，例如 `app.public-base-url=https://shop.example.com`。
- 访问控制放在 Spring Security 里做（见 [[ss-authz]]），保留默认的 `StrictHttpFirewall`，不要为了“兼容”随手放开分号和编码斜杠。
- “内网 IP 才能访问”的接口（Actuator、管理后台）要叠加真正的认证，IP 限制只作为纵深防御中的一层。

一个把 IP 白名单作为附加条件的写法（Spring Security 6 lambda DSL，前提是已正确配置可信代理，使 `remoteAddr` 可信）：

```java
@Bean
SecurityFilterChain adminChain(HttpSecurity http) throws Exception {
    http
        .securityMatcher("/admin/**")
        .authorizeHttpRequests(auth -> auth
            .anyRequest().access((authentication, ctx) -> new AuthorizationDecision(
                new IpAddressMatcher("10.0.0.0/24").matches(ctx.getRequest())
                    && authentication.get().getAuthorities().stream()
                        .anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN")))))
        .httpBasic(Customizer.withDefaults());
    return http.build();
}
```

**检测**

- Nginx 日志同时记录 `$remote_addr` 和 `$http_x_forwarded_for`（本课的 `log_format` 就是这么做的），两者差异异常的请求值得关注。
- 告警：请求路径中出现 `..;`、`%2e`、`%2f`；Host 不在白名单；同时带 `Content-Length` 和 `Transfer-Encoding` 的请求。

## 常见误区

- **“有 NAT 就安全了”**：NAT 只是没有入站映射时顺带挡住了主动连接。一条端口映射、一个 UPnP、一次反弹连接就能穿透；安全要靠防火墙规则和最小暴露面。
- **“X-Forwarded-For 第一个值就是用户 IP”**：第一个值恰恰是最容易被伪造的。可信的只有你的可信代理追加的那一段。
- **“开了 forward-headers-strategy 就万事大吉”**：默认的可信代理范围覆盖所有私有地址段，内网里的请求照样能伪造，需要收窄。
- **“Nginx 挡住了 /admin，后端就不用管了”**：路径规范化差异、直连后端都能绕过，后端必须自己鉴权。
- **“Host 头是服务器决定的”**：Host 完全由客户端控制，只能作为路由提示，不能用来拼安全相关的 URL。
- **“内网接口不用认证”**：SSRF、被攻陷的内网机器、错误的代理配置都会让“内网”变成攻击者能到达的地方，这也是零信任的出发点（见 [[cloud-zerotrust]]）。

## 自测

:::details 1. 正向代理和反向代理的根本区别是什么？Burp Suite 和 Nginx 分别属于哪种？
正向代理代表客户端，客户端需要主动配置它，替客户端访问外部；反向代理代表服务端，客户端无感知，以为直接在访问网站。Burp Suite 是正向代理（浏览器把代理设为 Burp）；挂在 Spring Boot 前面的 Nginx 是反向代理。
:::

:::details 2. `$proxy_add_x_forwarded_for` 和 `$remote_addr` 用在 X-Forwarded-For 上有什么区别？最外层代理该用哪个？
`$proxy_add_x_forwarded_for` 是“客户端传来的 XFF + 逗号 + $remote_addr”，会保留客户端写的内容；`$remote_addr` 只有 Nginx 实际看到的对端地址。最外层（直接面对客户端的）代理应该用 `$remote_addr` 覆盖，丢弃客户端伪造的值；内层代理再用追加方式保留链路。
:::

:::details 3. 为什么公网主机默认无法主动连接 NAT 后面的内网机器？这对 IoT 设备接入有什么影响？
外部主动发来的包在 NAT 的转换表中没有对应条目，NAT 不知道该转给内网哪台机器，只能丢弃。因此平台无法主动连接躲在 NAT/CGNAT 后的车机或网关，设备必须主动连接 MQTT Broker 并维持长连接，平台下行消息通过这条已建立的连接下发。
:::

:::details 4. 为什么状态检测防火墙比无状态过滤更安全、也更好配？
状态检测会跟踪连接，只需一条“ESTABLISHED/RELATED 放行”就能让所有出站连接的回包通过，外部新连接则要单独被白名单批准。无状态过滤必须为回包单独写规则，常常写成“源端口是 80 就放行”，攻击者只要把源端口设成 80 就能进来。
:::

:::details 5. `GET /public/..;/admin/users` 为什么可能绕过只在 Nginx 上配置的 `/admin/` 拦截？
Nginx 不把 `..;` 当作上级目录，认为路径在 `/public/` 下而放行；Tomcat 会把分号后的内容当路径参数去掉，`..;` 变成 `..`，最终路由到 `/admin/users`。修复：后端用 Spring Security 做鉴权，并保留 `StrictHttpFirewall` 默认拒绝分号的行为。
:::

:::details 6. 密码重置投毒是怎么发生的？Spring 应用应该怎么写？
应用用请求的 Host（或 X-Forwarded-Host）拼接重置链接，攻击者为受害者申请重置并把 Host 改成自己的域名，受害者收到的邮件链接指向攻击者，点击后 token 泄露。修复：绝对 URL 使用配置里的固定域名；Nginx 只接受已知 `server_name`，并清空不需要的 `X-Forwarded-Host`。
:::

:::details 7. 请求走私的根本原因是什么？为什么 Nginx 默认配置下风险相对较小？
前端和后端对同一个请求的结束位置判断不一致（一个看 Content-Length，一个看 Transfer-Encoding），多出来的字节留在复用的连接里，被当作下一个请求的开头。Nginx 默认用 HTTP/1.0 连接后端、每个请求一条连接，没有连接复用就难以“污染下一个请求”；开启 HTTP/1.1 + keepalive 后需要格外注意。
:::

## 一句话总结

NAT 和防火墙决定“谁能摸到谁”，反向代理决定“请求以什么面貌到达后端”；只信任可信代理追加的信息，后端永远自己再做一次鉴权。
