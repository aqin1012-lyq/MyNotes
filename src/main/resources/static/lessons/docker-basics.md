## 为什么要学

前面几个阶段你一直在“应用层”打转：SQL 注入、XSS、越权、SSRF，再到 Spring Security。但今天的 Java 服务几乎都不是直接 `java -jar` 跑在物理机上，而是打成镜像、跑在容器里、由 Kubernetes 调度。你在车联网或电商项目里见过的 Jenkins 流水线最后一步，多半就是 `docker build` + `docker push`。**镜像就是你的交付物**，镜像里多带了一个 shell、一个过期的 OpenSSL、一个写死的密码，都会跟着上线。

这一课是第 5 阶段（容器与 Kubernetes 安全）的第一课，目标是“先会用，再看安全”：搞清楚镜像、容器、仓库、层、网络、卷这些基本对象，然后把 MyNotes 做成一个**多阶段构建、以非 root 用户运行、扫描过漏洞**的镜像。这正是项目④（Kubernetes 安全平台）的第一个里程碑：“多阶段镜像 + 非 root + Trivy 扫描”。

学完之后你应该能：写出一个生产可用的 Spring Boot Dockerfile 并解释每一行的安全含义；看懂 `docker history`、`docker inspect` 的输出；用 Trivy 扫描镜像并生成 SBOM；回答“把 `/var/run/docker.sock` 挂进容器等于给了什么权限”。下一课 [[docker-isolation]] 会拆开容器的底层（Namespace / Cgroup / Capabilities），再往后是 [[k8s-basics]]、[[k8s-rbac]]、[[k8s-hardening]]。

:::tip 环境约定
本课假设你在 macOS 上用 Docker Desktop（或 OrbStack、Colima 等兼容方案），命令行是 `docker` CLI。Linux 上命令完全一样。文中的镜像名统一用 `mynotes:0.1`。
:::

## 核心概念

### 1. Image / Container / Registry / Layer

用 Java 的类比最好记：**镜像（Image）像 class 文件，容器（Container）像 new 出来的对象**。镜像是只读的模板（文件系统 + 元数据：默认命令、环境变量、用户、暴露端口），容器是镜像的一次运行实例，在只读层之上加一个可写层。**仓库（Registry）** 是存放镜像的服务器，好比 Maven 私服：Docker Hub、Harbor、华为云 SWR 都是 Registry。

```
Dockerfile --build--> Image (layers, read-only) --push--> Registry
                          |
                          +--run--> Container = image layers + thin writable layer + process
```

**层（Layer）** 是理解镜像安全的关键。Dockerfile 里每条改变文件系统的指令（`RUN`、`COPY`、`ADD`）都会产生一层，层是按内容寻址（sha256 摘要）的 tar 包，叠在一起就是最终文件系统。两个推论：

- 缓存：层没变就复用，所以要把“不常变的”（依赖下载）放前面，“常变的”（源码）放后面。
- **删不掉的秘密**：在第 3 层 `COPY id_rsa`、在第 4 层 `RUN rm id_rsa`，最终文件系统里看不到它，但第 3 层的 tar 包仍在镜像里，任何能 pull 镜像的人都能把它解出来。

查看层和元数据：

```
$ docker history mynotes:0.1
IMAGE          CREATED        CREATED BY                                      SIZE
3f1c...        2 minutes ago  ENTRYPOINT ["java" "-jar" "/app/app.jar"]       0B
<missing>      2 minutes ago  USER 10001:10001                                0B
<missing>      2 minutes ago  COPY /app.jar /app/app.jar # buildkit           ...
...
$ docker image inspect mynotes:0.1 --format '{{.Config.User}} {{.Config.Env}}'
10001:10001 [PATH=... SERVER_ADDRESS=0.0.0.0 MYNOTES_STUDY_DIR=/data/study ...]
```

`docker history` 会暴露每一层的构建命令，所以 `ENV DB_PASSWORD=xxx`、`ARG TOKEN=xxx` 这种写法等于把密码印在镜像上。

镜像的引用有两种：**标签（tag）** 如 `eclipse-temurin:17-jre`，是可变的，今天和明天拉到的可能不是同一个东西；**摘要（digest）** 如 `eclipse-temurin@sha256:...`，是不可变的。生产环境追求可复现和防篡改时，用 digest 固定基础镜像。

### 2. Dockerfile 最佳实践：多阶段构建、最小基础镜像、非 root 用户

**多阶段构建（multi-stage build）**：一个 Dockerfile 里写多个 `FROM`。前面的阶段用 JDK + Maven 编译，最后一个阶段只从前面 `COPY --from=build` 拿走 jar。编译器、Maven 本地仓库、源码、测试资源统统留在构建阶段，不进入最终镜像。好处是镜像更小、攻击面更小（运行时没有 `javac`、`mvn`，也没有你的源码）。

**最小基础镜像**：运行 Spring Boot 只需要 JRE，不需要 JDK。常见选择从“大”到“小”：

| 基础镜像 | 特点 | 适合 |
|---|---|---|
| `eclipse-temurin:17-jdk` | 完整 JDK + Ubuntu 用户态 | 只用于构建阶段 |
| `eclipse-temurin:17-jre` | 只有 JRE + Ubuntu 用户态，有 shell 和包管理器 | 入门首选，排障方便 |
| distroless Java 镜像 | 没有 shell、没有包管理器 | 更硬，但排障要靠 debug 容器 |
| 自己用 `jlink` 裁剪的运行时 | 只含用到的模块 | 进阶玩法 |

基础镜像里每多一个包，就多一份 CVE 扫描告警和一份被利用的可能。没有 shell 的镜像，攻击者拿到 RCE 后连 `sh -c` 都执行不了（当然他仍能在 JVM 里做很多事，这不是银弹）。

**非 root 用户**：Docker 默认以镜像里的 root（UID 0）运行进程。而在默认配置下（没开 user namespace），**容器里的 root 就是宿主机内核眼里的 UID 0**，只是被 Namespace 和 Capabilities 限制住了。一旦出现逃逸漏洞或危险挂载，root 进程的破坏力远大于普通用户。所以要在 Dockerfile 里创建专用用户，并用 `USER 10001:10001` 这种**数字 UID** 切换过去。用数字而不是用户名，是因为 Kubernetes 的 `runAsNonRoot: true` 只能校验数字 UID，用户名它无法确认是不是 root。

其他要点（逐条都能在下面的 MyNotes Dockerfile 里找到对应）：

- 用 `.dockerignore` 排除 `target/`、`.git/`、`study/`、IDE 文件，防止把本地数据和 Git 历史打进镜像。
- 用 exec 形式 `ENTRYPOINT ["java","-jar","/app/app.jar"]`，让 JVM 成为 PID 1，能直接收到 `docker stop` 发的 SIGTERM，Spring Boot 才能优雅停机。
- jar 文件归 root 所有、运行用户只读：应用被攻破也改不了自己的程序文件。
- 不在镜像里放任何密钥，密钥在运行时通过环境变量、挂载文件或密钥服务注入（见 [[cloud-secrets]]）。
- 设置 `-XX:MaxRAMPercentage`：Java 17 默认能感知容器内存限制，但默认堆上限只占容器内存的 25%，偏保守。

### 3. Docker Network（bridge / host）与 Volume

**bridge（默认）**：Docker 在宿主机上建一个虚拟网桥（`docker0`），每个容器有自己的网络命名空间和一块虚拟网卡，拿到一个内网 IP（常见 `172.17.0.x`）。容器访问外网靠宿主机 NAT；外部访问容器要靠端口映射 `-p`。用户自定义的 bridge 网络（`docker network create`）还自带按容器名的 DNS 解析，docker compose 就是这样让 `app` 连上 `mysql` 的。

```
host: 127.0.0.1:8080 --(-p mapping, NAT)--> docker0 bridge --> container eth0 172.17.0.2:8080
```

**host**：容器不创建自己的网络命名空间，直接用宿主机的网卡和端口。性能好，但隔离没了：容器里监听 `0.0.0.0:8080` 就是宿主机的 8080，容器也能直接访问宿主机上只监听 `127.0.0.1` 的服务（比如本机的 Redis、MySQL 管理端口）。注意在 macOS 的 Docker Desktop 上，“宿主机”其实是 Docker 背后的那台 Linux 虚拟机，不是你的 Mac。

**none**：只有回环网卡，完全不联网，适合只做计算的任务。

两个与 MyNotes 直接相关的坑：

- **`server.address=127.0.0.1` 在容器里会让应用“不可达”**。MyNotes 的 `application.properties` 把监听地址绑在 `127.0.0.1`（因为 `/vuln/**` 是故意留的漏洞）。在 bridge 网络里，端口映射的流量是从容器的 `eth0` 进来的，不是从容器自己的回环进来的，所以只监听容器内 `127.0.0.1` 的应用收不到任何请求。解决办法是在容器里用环境变量 `SERVER_ADDRESS=0.0.0.0` 覆盖（Spring Boot 的宽松绑定会把它映射到 `server.address`），然后**在宿主机这一侧**用 `-p 127.0.0.1:8080:8080` 把暴露面收回到本机。
- **`-p 8080:8080` 默认绑定宿主机所有网卡**。在 Linux 上 Docker 直接写 iptables 规则，可能绕过你以为生效的 ufw/firewalld 规则。对含有漏洞靶场的镜像，一定写成 `-p 127.0.0.1:8080:8080`。

**Volume 与 bind mount**：容器的可写层随容器删除而消失，需要持久化的数据放到卷里。

| 类型 | 写法 | 说明 |
|---|---|---|
| named volume | `-v mynotes-data:/data` | Docker 管理存储位置，推荐用于数据 |
| bind mount | `-v "$PWD/study":/data/study` | 把宿主机目录挂进去，方便开发，但把宿主机文件暴露给容器 |
| tmpfs | `--tmpfs /tmp` | 内存文件系统，容器停止即消失 |

安全上，bind mount 是容器逃逸的常见入口：挂了 `/`、`/etc`、`/proc`、`/var/run/docker.sock` 的容器，隔离基本就形同虚设（下一课详述）。挂载时尽量加 `:ro` 只读。

### 4. 镜像漏洞扫描与 SBOM

镜像里有三类“别人写的代码”：基础镜像的系统包（glibc、openssl、zlib……）、JRE 本身、你 jar 里 `BOOT-INF/lib` 下的几十上百个依赖。任何一个出现公开漏洞（CVE），你的镜像就“带病”。**镜像扫描器**（本课用 [Trivy](https://trivy.dev/)）做的事情是：解析镜像每一层，识别操作系统包管理器数据库和语言依赖清单（对 Java 来说就是 jar 包及其 `pom.properties`/`MANIFEST.MF`），再和漏洞数据库比对。

**SBOM（Software Bill of Materials，软件物料清单）** 是“这个镜像里到底装了什么”的机器可读清单：组件名、版本、来源、许可证。常见格式有 CycloneDX 和 SPDX。扫描是“现在有没有已知漏洞”，SBOM 是“清单本身”。有了 SBOM，下次再出一个像 Log4Shell 那样的重大依赖漏洞时，你不用重新扫描所有镜像，查清单就能回答“哪些服务用了受影响的版本”。

扫描结果怎么用：

- 按严重级别和“是否已有修复版本（Fixed Version）”排优先级；没有修复版本的，评估是否可达、能否换基础镜像。
- 在 CI 里设门禁：发现 CRITICAL 且有修复版本就让流水线失败（`--exit-code 1`）。
- 扫描是**已知**漏洞的检测，不能证明镜像安全；它也看不出你的 Dockerfile 以 root 运行、把密码写进 ENV 这类配置问题（Trivy 另有 `trivy config` 可以检查 Dockerfile 和 K8s YAML 的错误配置）。
- 漏洞库每天更新，昨天干净的镜像今天可能就不干净，所以要**定期重扫仓库里的存量镜像**，而不仅是构建时扫一次。

## 动手实践

:::warn 声明
本系列里的攻击手法只用于你自己的环境或获得授权的目标。
:::

### 实践 1：把 MyNotes 做成多阶段构建镜像，以非 root 用户运行

先注意 MyNotes 的两个特点：一是 `server.address=127.0.0.1`，容器里必须用 `SERVER_ADDRESS=0.0.0.0` 覆盖；二是 `StudyStore` 启动时会在 `mynotes.study.dir`（默认是工作目录下的 `study`）里 `createDirectories`，非 root 用户对 `/app` 没有写权限会导致启动失败，所以要把它指到一个专门属于应用用户的目录 `/data/study`（环境变量 `MYNOTES_STUDY_DIR`）。

在项目根目录新建 `.dockerignore`：

```
target/
.git/
.idea/
*.iml
study/
```

新建 `Dockerfile`：

```dockerfile
# ---------- 阶段 1：构建 ----------
FROM eclipse-temurin:17-jdk AS build
WORKDIR /src
# 先只复制构建描述文件，依赖层可以被缓存
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN chmod +x mvnw && ./mvnw -B -q dependency:go-offline
# 再复制源码并打包（测试在 CI 里单独跑）
COPY src src
RUN ./mvnw -B -q package -DskipTests \
 && cp target/MyNotes-0.0.1-SNAPSHOT.jar /app.jar

# ---------- 阶段 2：运行 ----------
FROM eclipse-temurin:17-jre
# 专用的非 root 用户（数字 UID/GID），以及它唯一可写的数据目录
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
 && mkdir -p /data/study \
 && chown -R 10001:10001 /data
WORKDIR /app
# jar 归 root 所有，应用用户只能读
COPY --from=build /app.jar /app/app.jar
ENV SERVER_ADDRESS=0.0.0.0 \
    MYNOTES_STUDY_DIR=/data/study \
    JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75"
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

jar 名来自 `pom.xml` 的 `artifactId` + `version`（`MyNotes-0.0.1-SNAPSHOT.jar`），改版本号时记得同步。`dependency:go-offline` 不一定能预取到打包时用到的全部插件，所以第二次 `mvnw` 仍可能联网下载少量东西，这不影响结果。

构建并运行：

```
$ docker build -t mynotes:0.1 .
[+] Building ...
 => [build 4/6] RUN chmod +x mvnw && ./mvnw -B -q dependency:go-offline
 => [build 6/6] RUN ./mvnw -B -q package -DskipTests && cp target/...
 => [stage-1 3/3] COPY --from=build /app.jar /app/app.jar
 => naming to docker.io/library/mynotes:0.1

$ docker run --rm -d --name mynotes -p 127.0.0.1:8080:8080 mynotes:0.1
$ docker logs mynotes | tail -2
... Tomcat started on port 8080 (http) with context path '/'
... Started MyNotesApplication in 3.1 seconds
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
200
```

验证“非 root”和“只读程序文件”：

```
$ docker exec mynotes id
uid=10001(app) gid=10001(app) groups=10001(app)
$ docker exec mynotes ls -l /app/app.jar
-rw-r--r-- 1 root root ... /app/app.jar
$ docker exec mynotes sh -c 'echo x >> /app/app.jar'
sh: 1: cannot create /app/app.jar: Permission denied
$ docker exec mynotes ls -ld /data/study
drwxr-xr-x 3 app app ... /data/study
```

怎么读：`id` 显示 UID 10001，说明 `USER` 生效；jar 属主是 root、权限 644，应用用户写不了它；只有 `/data/study` 属于 app 用户，这是应用唯一需要写的地方（后面在 K8s 里还会把整个根文件系统设为只读）。

再做一个对照实验，体会 `SERVER_ADDRESS` 的作用：

```
$ docker rm -f mynotes
$ docker run --rm -d --name mynotes -e SERVER_ADDRESS=127.0.0.1 -p 127.0.0.1:8080:8080 mynotes:0.1
$ curl -sv http://127.0.0.1:8080/ 2>&1 | tail -1
curl: (52) Empty reply from server
```

具体报错可能是 `Empty reply` 或 `Connection reset by peer`，取决于 Docker 版本和平台，本质一样：端口映射把流量送到了容器的 `eth0`，而应用只监听容器内部的回环地址。记得 `docker rm -f mynotes` 清理。

最后比较两个阶段基础镜像的体积，感受多阶段构建的收益：

```
$ docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' | grep -E 'temurin|mynotes'
```

`mynotes:0.1` 应该只比 `eclipse-temurin:17-jre` 大一个 jar 的体积，而明显小于 `17-jdk`。

### 实践 2：用 Trivy 扫描镜像漏洞

安装（macOS）并扫描：

```
$ brew install trivy
$ trivy image mynotes:0.1
```

第一次运行会先下载漏洞数据库。输出按“扫描目标”分段，示意如下（具体包名、数量和编号以你当天的结果为准，这里用占位符）：

```
mynotes:0.1 (ubuntu xx.xx)
Total: N (UNKNOWN: 0, LOW: n, MEDIUM: n, HIGH: n, CRITICAL: 0)

| Library | Vulnerability  | Severity | Status   | Installed Version | Fixed Version | Title |
|---------|----------------|----------|----------|-------------------|---------------|-------|
| libxxx  | CVE-XXXX-XXXXX | MEDIUM   | affected | 1.2.3-1ubuntu1    |               | ...   |
| libyyy  | CVE-XXXX-YYYYY | HIGH     | fixed    | 2.0.1-1           | 2.0.1-1ubuntu0.1 | ... |

Java (jar)
Total: 0 (UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0)
```

怎么读：

- 第一段是**操作系统包**（来自 `eclipse-temurin:17-jre` 底下的 Ubuntu），第二段是 **Java 依赖**（Trivy 解析了 `/app/app.jar` 里的 `BOOT-INF/lib`）。两段分别对应两种修复方式：前者靠更新基础镜像，后者靠升级 `pom.xml` 里的依赖（或升级 Spring Boot 版本让 BOM 带上新版本）。
- `Status = fixed` 且有 `Fixed Version`：有补丁可用，重新 `docker build --pull`（强制拉最新基础镜像）通常就能消掉。`affected` 且没有修复版本：上游还没修，记录在案、评估可达性。
- 数字不为 0 很正常，关键是 HIGH/CRITICAL 且可修复的有没有处理。

在 CI 里做门禁，只关心可修复的高危：

```
$ trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 mynotes:0.1
$ echo $?
0
```

返回码 0 表示没有命中条件，1 表示命中，Jenkins/GitLab CI 会据此判定失败。

生成 SBOM，并对 SBOM 再做扫描：

```
$ trivy image --format cyclonedx --output mynotes-sbom.cdx.json mynotes:0.1
$ grep -o '"name": *"spring-webmvc"' mynotes-sbom.cdx.json | head -1
"name": "spring-webmvc"
$ trivy sbom mynotes-sbom.cdx.json
```

顺手检查 Dockerfile 本身的配置问题：

```
$ trivy config .
```

如果你把 `USER` 那一行删掉再跑，会看到一条类似“image user should not be root”的告警；这说明配置扫描和漏洞扫描是互补的两件事。

## 攻击者视角

拿到你的镜像或宿主机后，攻击者会做这些事：

- **翻层找秘密**：`docker pull` 你的镜像后，用 `docker save` 导出成 tar，逐层解压翻找。写死在 `ENV`/`ARG` 的密码、被“删除”但其实留在旧层里的密钥、`application.properties` 里的数据库口令、`.git` 目录（如果没被 `.dockerignore` 排除），都是常见收获。也有专门工具（如 dive）能可视化地浏览层内容。
- **利用 root 容器**：如果容器以 root 运行且挂了敏感目录，root 权限让写 `/etc`、访问设备、加载模块等操作成为可能，逃逸门槛大大降低。这就是为什么“非 root + 只读根文件系统”是基本功。
- **打没打补丁的依赖**：先扫你的镜像（他也能用 Trivy），挑一个可远程利用的组件漏洞下手。你不扫，攻击者会替你扫。
- **滥用 `docker.sock`**：见下面的问答，这是拿容器换宿主机 root 的经典路径。
- **投毒供应链**：如果你 `FROM someuser/base:latest` 用了不可信的公共镜像，或者 CI 里 `docker build` 拉取的基础镜像被 tag 覆盖成了恶意版本，恶意代码会直接进入你的产物。用可信来源 + digest 固定。

:::warn 问答：把 /var/run/docker.sock 挂进容器等于给了什么权限？
**等于给了宿主机 root 权限。** `/var/run/docker.sock` 是 Docker 守护进程（dockerd）的 API 套接字，能访问它就等于能对 dockerd 下任何命令，而 dockerd 通常以 root 运行。攻击者在容器里只要能跟这个 socket 说话（哪怕容器内自己是非 root，只要对 socket 文件有权限），就可以让 dockerd 新建一个容器：`-v /:/host` 把宿主机根目录挂进去、加 `--privileged`、`--pid=host`，然后在这个新容器里读写宿主机任意文件、写 crontab、往 `/host/etc` 里加账号，或直接 chroot 到宿主机。整个过程绕过了原容器的所有隔离，因为发指令的是宿主机上的 root 守护进程。所以：绝不要把 docker.sock 挂进不可信容器；CI runner 确需构建镜像时，优先用 rootless 构建工具（如 BuildKit/buildah）或有权限边界的构建服务，而不是裸挂 socket。这也是下一课“容器逃逸常见路径”的第一条。
:::

## 防御与最佳实践

- **多阶段构建**：运行镜像里不要有编译器、Maven、源码、测试数据。
- **最小基础镜像 + 定期更新**：优先官方/可信的 slim 或 distroless 镜像；定期 `docker build --pull` 重建，把基础镜像的安全更新带进来。
- **非 root 运行**：`USER` 用数字 UID；根文件系统尽量只读，只给必要目录写权限（MyNotes 只需 `/data/study` 和 `/tmp`）。
- **不在镜像里放密钥**：密钥运行时注入；`docker history`、镜像层、CI 日志都可能泄露 `ENV`/`ARG`。
- **固定来源**：基础镜像用可信仓库 + digest；私有仓库（Harbor/华为云 SWR）开启镜像签名与准入校验。
- **持续扫描 + SBOM**：CI 里对 HIGH/CRITICAL 且可修复的设门禁，仓库里的存量镜像定期重扫，保留 SBOM 以便下次大漏洞时快速排查。
- **收敛暴露面**：本机跑靶场用 `-p 127.0.0.1:8080:8080`；生产用防火墙/安全组控制，别依赖 Docker 会不会绕过 ufw。
- **限制资源**：`docker run` 加 `--memory`、`--cpus`、`--pids-limit`，防止一个容器拖垮宿主机（原理见 [[docker-isolation]] 的 Cgroup）。
- **最小权限运行**：`--cap-drop ALL` 再按需 `--cap-add`，加 `--security-opt no-new-privileges`，别用 `--privileged`（同样见下一课）。

## 常见误区

- **“容器就是轻量虚拟机，天生隔离得很好。”** 容器共享宿主机内核，只是进程视图被隔离。默认 root 容器的隔离比很多人以为的弱得多。详见 [[docker-isolation]]。
- **“我在 Dockerfile 里 `RUN rm` 删掉了密钥，就安全了。”** 删除只发生在新的一层，旧层里的文件还在镜像里，能被完整还原。密钥根本就不该进构建上下文。
- **“镜像小/用了 alpine 就等于安全。”** 体积和漏洞是两码事，小镜像照样可能带高危 CVE，也照样可能以 root 运行。
- **“Trivy 扫出来 0 高危就没问题了。”** 扫描只覆盖**已知**漏洞，且漏洞库天天变；它也不查配置问题（root 运行、明文密钥）。要配合 `trivy config` 和定期重扫。
- **“`server.address` 让它监听 127.0.0.1 更安全。”** 在容器里这会让应用直接收不到端口映射的请求。安全应该由“容器里监听 0.0.0.0 + 宿主机侧 `-p 127.0.0.1:8080:8080` + 防火墙/NetworkPolicy”来保证，而不是靠应用绑回环。
- **“`-p 8080:8080` 只是本机访问。”** 它默认绑到所有网卡，可能对外网开放，且在 Linux 上可能绕过 ufw。要写全 `-p 127.0.0.1:8080:8080`。
- **“latest 标签很方便。”** latest 是可变的，破坏可复现性，也让“回滚到上一个版本”和“确认线上到底是哪个镜像”变得困难。生产用固定版本号或 digest。

## 自测

:::details 1. 镜像、容器、层、仓库分别是什么，用一句 Java 类比说清楚。
镜像像 class（只读模板），容器像 new 出来的对象（镜像 + 一个可写层 + 运行中的进程），仓库像 Maven 私服（存放和分发镜像的服务器）。层是镜像文件系统的增量单元，Dockerfile 每条改文件系统的指令生成一层，按内容摘要寻址、可缓存、可被单独还原。
:::

:::details 2. 为什么在 Dockerfile 里 `RUN rm` 删掉密钥并不能真正删掉它？
因为镜像是分层叠加的联合文件系统，删除文件只是在新的一层记录一个“白障（whiteout）”标记，让最终视图里看不到它，但写入该文件的那一层原封不动地留在镜像里。任何能 pull 到镜像的人都可以 `docker save` 导出后逐层解压，把“已删除”的密钥还原出来。正确做法是密钥从不进入构建上下文，运行时再注入。
:::

:::details 3. MyNotes 打成镜像跑在容器里，为什么必须设置 SERVER_ADDRESS=0.0.0.0？
因为 `application.properties` 里 `server.address=127.0.0.1`，应用只监听容器内部的回环地址。而 bridge 网络下 `-p` 映射的流量是从容器的 eth0 网卡进入的，不是从容器回环进入的，于是应用收不到任何外部请求（curl 会得到空回复或连接重置）。用环境变量 `SERVER_ADDRESS=0.0.0.0`（Spring Boot 宽松绑定映射到 server.address）让它监听所有网卡，暴露面则由宿主机侧的 `-p 127.0.0.1:8080:8080` 和防火墙来收敛。
:::

:::details 4. 为什么 USER 要用数字 UID 而不是用户名？
因为下游（尤其是 Kubernetes 的 `runAsNonRoot: true`）只能可靠地判断数字 UID 是否为 0 来确认“不是 root”。如果只写用户名，运行时无法确定这个名字背后是不是 UID 0，校验会失败或不可靠。用数字 UID（如 `USER 10001:10001`）语义明确、跨环境一致。
:::

:::details 5. 把 /var/run/docker.sock 挂进容器等于给了什么权限？
等于给了宿主机 root。该 socket 是 root 守护进程 dockerd 的 API，能访问它就能命令 dockerd 新建一个挂载了宿主机根目录、开了特权的容器，从而读写宿主机任意文件、创建账号、chroot 到宿主机，完全绕过原容器的隔离。所以绝不要把它挂进不可信容器。
:::

:::details 6. 镜像漏洞扫描和 SBOM 有什么区别，为什么两个都要？
扫描回答“此刻这个镜像有没有已知漏洞”，是把组件清单和当天的漏洞库比对的结果，会随漏洞库更新而变化。SBOM 是“这个镜像里装了哪些组件、什么版本、什么来源”的机器可读清单本身，相对稳定。有 SBOM，下次爆出重大依赖漏洞时可以直接查清单定位受影响的服务，而不必重扫所有镜像；扫描则保证你及时发现并修复当前的高危问题。二者互补。
:::

:::details 7. 为什么运行镜像里最好没有 shell 和包管理器？
减小攻击面：攻击者拿到 RCE 后，没有 `sh`、`curl`、`apt` 会让下载工具、横向移动、持久化都更困难；同时系统包越少，可被扫出的 CVE 也越少。代价是排障不便（要用临时 debug 容器或 `kubectl debug`）。这就是 distroless 镜像的思路。它不是银弹，攻击者仍可在 JVM 内做很多事。
:::

## 一句话总结

镜像是你真正的交付物：用多阶段构建把编译期的东西挡在门外，用最小基础镜像 + 非 root 用户 + 只读根文件系统收窄攻击面，密钥永不进镜像，再用 Trivy 持续扫描并留存 SBOM——这套“会用且安全”的镜像，就是项目④和后面所有 Kubernetes 加固的地基。
