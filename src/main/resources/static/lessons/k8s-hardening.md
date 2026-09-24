## 为什么要学

到这里，MyNotes 已经跑在 K8s 上（[[k8s-basics]]），也有了独立、最小权限、不挂 token 的 ServiceAccount（[[k8s-rbac]]）。但还剩两个大口子：一是 **Pod 本身**——它可能以 root 跑、根文件系统可写、保留一堆用不上的 Linux capability，一旦应用被 RCE，攻击者在容器里如鱼得水；二是**网络**——默认 K8s 里所有 Pod 互通，一个被攻破的 Pod 能横向扫描连接整个集群。这一课就是堵这两个口子，并补上 Secret 加密、镜像来源、审计这些集群级加固。

这是 S5 阶段的收官课，也是项目④最后几个里程碑：“Pod Security restricted”“NetworkPolicy 默认拒绝”“Secret 外部化”“kube-bench 报告与整改”。前面 [[docker-isolation]] 讲的 Namespace/Capabilities/seccomp、[[docker-basics]] 讲的非 root/只读根文件系统，在这一课全部变成 Pod 的 `securityContext` 和命名空间标签落地——理论到工程的闭环。

学完你要能：给命名空间打上 Pod Security Admission 标签，强制 Pod 达到 restricted 级别；写出一份满足 restricted 的 `securityContext`（runAsNonRoot、allowPrivilegeEscalation:false、drop ALL capabilities、seccompProfile RuntimeDefault、readOnlyRootFilesystem + emptyDir 给 /tmp）；用一条默认拒绝 + 一条按需放行的 NetworkPolicy 把 MyNotes 的网络锁到最小；理解 etcd 加密与外部密钥管理；跑一次 kube-bench 并读懂结果。核心问题也很实际：**没有 NetworkPolicy 的集群里，一个被攻破的 Pod 能访问哪些东西**。

:::tip 版本前提
本课以较新的 Kubernetes（1.25 及以后）为准。两点必须说清：**PodSecurityPolicy 已在 1.25 被移除**，取而代之的是内建的 Pod Security Admission（PSA）；**自 1.24 起不再自动为 ServiceAccount 创建 token Secret**，token 改为有过期、绑定 Pod 的投影 token（见 [[k8s-basics]]）。
:::

## 核心概念

### 1. Pod Security Standards：privileged / baseline / restricted

Kubernetes 把“一个 Pod 有多危险”标准化成三档 **Pod Security Standards（PSS）**，从松到紧：

| 级别 | 含义 | 典型限制 |
|---|---|---|
| privileged | 不设限 | 允许特权、hostPath、hostNetwork 等一切；只给系统组件用 |
| baseline | 挡住已知的明显提权/逃逸 | 禁止 privileged、hostPID/hostNetwork、大部分 hostPath、危险 capability |
| restricted | 当前最严的通用基线 | 在 baseline 上再要求：非 root 运行、禁止提权、drop ALL capabilities、seccomp RuntimeDefault、只允许安全的卷类型等 |

**执行这套标准的是 Pod Security Admission（PSA）**，一个内建的**准入控制器**（回忆 [[k8s-basics]] 的第 3 关）。它取代了 1.25 被移除的 PodSecurityPolicy——PSP 曾经又难用又容易配错，PSA 简单很多：**你给命名空间打标签，PSA 就在 Pod 创建时按标签校验。**

PSA 有三种模式（可对同一命名空间同时设，级别可不同）：

- `enforce`：不合规就**拒绝创建**（硬拦截）。
- `audit`：允许创建，但在审计日志里记一条（用于观测）。
- `warn`：允许创建，但给 `kubectl` 用户返回一条警告（用于开发期提醒）。

标签形如 `pod-security.kubernetes.io/<mode>: <level>`，还能用 `<mode>-version` 固定标准版本。给 MyNotes 命名空间上 restricted：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: mynotes
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/audit: restricted
```

打上之后，任何不满足 restricted 的 Pod 会被直接拒绝。注意 PSA 作用在**命名空间**粒度、按 Pod 的字段判断；它不改 Pod，只放行或拒绝。想要“自动改写不合规 Pod”得用外部策略引擎（如 Kyverno、OPA Gatekeeper），那是进阶话题。

### 2. securityContext：runAsNonRoot、readOnlyRootFilesystem、drop ALL capabilities

命名空间的 PSA 标签是“考试要求”，Pod 的 `securityContext` 是“答卷”。要通过 restricted，MyNotes 的 Pod 必须逐条满足下面这些字段——它们正好是前几课概念的落地：

| securityContext 字段 | 值 | 对应前面哪一课的概念 |
|---|---|---|
| runAsNonRoot | true | [[docker-basics]] 非 root 用户；PSA 会校验容器不以 UID 0 运行 |
| runAsUser / runAsGroup | 10001 | 镜像里那个数字 UID，确保确实是非 root |
| allowPrivilegeEscalation | false | [[docker-isolation]] 的 no-new-privileges |
| capabilities.drop | ["ALL"] | [[docker-isolation]] 最小能力；Web 服务一个都不用加回 |
| seccompProfile.type | RuntimeDefault | [[docker-isolation]] 默认 seccomp，缩小 syscall 攻击面 |
| readOnlyRootFilesystem | true | [[docker-basics]] 只读根文件系统 |

几个容易踩的点：

- **`runAsNonRoot: true` 要有数字 UID 才好使**。它只是要求“不是 root”，具体是谁由镜像的 `USER 10001` 或 `runAsUser: 10001` 提供。这也是上一阶段强调 `USER` 用数字 UID 的原因——PSA/K8s 只能可靠判断数字 UID 是否为 0。
- **`readOnlyRootFilesystem: true` 会让一切写盘失败**，除非你给需要写的路径单独挂可写卷。MyNotes 至少要写两处：JVM/系统要写的 `/tmp`，以及 `StudyStore` 的数据目录 `/data/study`。解决办法是用 **emptyDir** 卷挂到这些路径（见下节）。
- **`securityContext` 分两层**：`pod.spec.securityContext`（作用于 Pod 内所有容器，如 `runAsNonRoot`、`fsGroup`、`seccompProfile`）和 `container.securityContext`（单容器，如 `capabilities`、`readOnlyRootFilesystem`、`allowPrivilegeEscalation`）。restricted 需要的字段要放对层级，容器级会覆盖 Pod 级。

### 3. readOnlyRootFilesystem 与 emptyDir：为什么 /tmp 要单挂

只读根文件系统是一条性价比极高的加固：应用被 RCE 后，攻击者**没法在容器里落地文件**——写不了 webshell、下不了工具、改不了二进制、装不了持久化。回忆 [[docker-basics]]：程序文件本就该只读，现在把整个 `/` 都设成只读，只给必须写的地方开口。

但 JVM 和很多库要写临时文件（`/tmp`），Spring Boot、Tomcat 也可能用到临时目录，MyNotes 的 `StudyStore` 还要在数据目录里 `createDirectories` 和写文件。根只读后这些都会 `Permission denied` 或 `Read-only file system` 而启动失败。正确姿势是用 **emptyDir** 卷：

- `emptyDir` 是随 Pod 生命周期存在的临时卷，Pod 删了就没了，正好用于 `/tmp` 这种不需要持久化的临时空间；挂上去的路径就变成可写。
- 它是 restricted **允许**的卷类型之一（hostPath 这类不安全卷则被禁止），所以用它不会破坏 PSS 合规。
- MyNotes 的数据目录 `/data/study` 上一课已用 emptyDir 挂过（本例仍用 emptyDir，若要持久化再换 PVC）。

一句话：**根只读 + 精确地给 /tmp 和数据目录挂 emptyDir**，既满足 restricted，又不影响应用运行，还大幅削弱了 RCE 后的可利用性。

### 4. NetworkPolicy：默认拒绝 + 按需放行

回答本课核心问题：**没有 NetworkPolicy 的集群里，一个被攻破的 Pod 能访问哪些东西？** 答案是——几乎一切。K8s 默认网络是“扁平全通”：任意 Pod 能直连任意其它 Pod 的任意端口，跨命名空间也通；还能访问集群里的数据库、内部 API、缓存，通常也能访问 API Server 和云元数据地址。所以攻破一个不起眼的前端 Pod，攻击者就能在集群内部随意横向扫描、连接 MySQL/Redis、探测内部服务——**东西向（Pod 到 Pod）流量完全没有边界**。

**NetworkPolicy** 是 K8s 的“Pod 级防火墙”，用 label 选中一组 Pod，声明允许的入站（ingress）和出站（egress）流量。关键机制：

- **一旦有一条 NetworkPolicy 选中了某 Pod，该 Pod 在对应方向就从“默认全通”变成“默认全拒”**，只放行策略里明确允许的。没被任何策略选中的 Pod 仍是全通。
- 所以标准做法是先下一条**默认拒绝**策略（选中命名空间内所有 Pod，不放行任何 ingress/egress），把基线拉到“全关”，再对每个应用**按需放行**必要流量。这就是“默认拒绝 + 按需放行”。
- **NetworkPolicy 需要 CNI 插件支持才生效**（Calico、Cilium 等支持；有的默认 CNI 不支持）。这点务必确认——写了策略但 CNI 不执行，等于没写。kind/minikube 的默认网络可能不强制执行 NetworkPolicy，练习时需装支持的 CNI（如 Calico）。

默认拒绝全部（对整个命名空间）：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: mynotes
spec:
  podSelector: {}                 # 空 = 选中命名空间内所有 Pod
  policyTypes: ["Ingress", "Egress"]
  # 不写 ingress/egress 规则 = 两个方向都不放行任何流量
```

下了这条之后，MyNotes 会连 DNS 都解析不了（DNS 也是出站流量），也收不到 Ingress 的请求。所以要补一条**按需放行**：入站只允许来自 Ingress Controller，出站只允许 DNS（和它真正要访问的后端，若有）。

按需放行 MyNotes（入站放行 Ingress Controller 到 8080，出站放行 DNS）：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: mynotes-allow
  namespace: mynotes
spec:
  podSelector:
    matchLabels: { app: mynotes }   # 只作用于 MyNotes 的 Pod
  policyTypes: ["Ingress", "Egress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: ingress-nginx   # 只放行 ingress 命名空间
      ports:
        - { protocol: TCP, port: 8080 }
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system     # kube-dns 在 kube-system
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
```

含义：MyNotes 的 Pod 只接受来自 ingress-nginx 命名空间、目标端口 8080 的入站；出站只允许到 kube-system 的 53 端口（DNS）。其它一切——横向连别的 Pod、连数据库、访问 API Server、访问云元数据——全部被默认拒绝那条拦掉。攻击者攻破 MyNotes 后，网络上几乎寸步难行。`kubernetes.io/metadata.name` 是 K8s 自动给命名空间打的名字标签，可直接用来选命名空间。若 MyNotes 后续要连数据库，再加一条 egress 精确放行到数据库 Pod/端口即可。

### 5. Secret 加密（etcd encryption）与外部密钥管理

回忆 [[k8s-basics]]：Secret 默认只是 Base64，不是加密。两道加固：

- **etcd 静态加密（encryption at rest）**：K8s 所有对象（含 Secret）最终存在 etcd。默认情况下 Secret 在 etcd 磁盘上是明文（Base64），谁拿到 etcd 数据或备份就拿到所有密钥。开启 **EncryptionConfiguration** 后，API Server 在写入 etcd 前用指定算法（如 AES-GCM）加密 Secret，读取时解密。更进一步可用 **KMS provider**，把加密用的密钥托管到外部 KMS（云 KMS/HSM），实现密钥与数据分离。这是集群管理员在 API Server 配置层做的事，托管集群（如各云厂商）通常有开关。
- **外部密钥管理**：更彻底的做法是密钥根本不进 K8s Secret，而放在 HashiCorp Vault 或云 KMS/凭据管理服务里，Pod 运行时按需拉取（如通过 Secrets Store CSI Driver、External Secrets Operator，或应用启动时向 Vault 换取）。好处是集中审计、自动轮换、细粒度授权。这部分在 S6 的 [[cloud-secrets]] 深入，MyNotes 现在若有数据库密码，先用 K8s Secret + etcd 加密 + 严格 RBAC（上一课）即可。

三层配合才安全：**RBAC 限制谁能读 Secret（[[k8s-rbac]]）+ etcd 加密防 etcd 泄露 + 外部密钥管理做轮换审计**。缺一层都有短板。

### 6. CIS Kubernetes Benchmark 与 kube-bench

**CIS Kubernetes Benchmark** 是业界公认的 K8s 加固清单，逐条列出控制面（apiserver、etcd、controller-manager、scheduler）、节点（kubelet）、策略（RBAC、Pod Security、NetworkPolicy）等应有的安全配置。**kube-bench** 是 Aqua 开源的工具，自动对照 CIS Benchmark 检查你的集群，逐项给出 PASS / FAIL / WARN 和整改建议。它检查的是**集群自身的配置**（控制面参数、文件权限、认证授权开关等），和检查“镜像漏洞”的 Trivy、检查“Pod 是否合规”的 PSA 是互补的三件事。

注意：kube-bench 主要面向**自建集群**（能读到 apiserver/etcd 的配置文件和进程参数）。在托管集群（EKS/GKE/华为云 CCE 等）上，控制面由云厂商管，很多控制面项目会显示为 INFO/无法检查，这正常——那部分是云厂商的责任，你重点看节点和策略相关项。

## 动手实践

:::warn 声明
本系列里的攻击手法只用于你自己的环境或获得授权的目标。
:::

### 实践 1：给命名空间加 restricted + 满足 restricted 的 Pod

先给命名空间打 PSA 标签（可直接 `kubectl label`，也可写进 Namespace YAML 如核心概念第 1 节）：

```
$ kubectl label namespace mynotes \
    pod-security.kubernetes.io/enforce=restricted \
    pod-security.kubernetes.io/warn=restricted --overwrite
namespace/mynotes labeled
```

打标签时，如果命名空间里已有不合规的 Pod，`kubectl label` 会打印警告，但**不会删除已经在跑的 Pod**。enforce 只拦截之后新建的 Pod。

这时再 apply 上一课那个**没有 securityContext** 的 Deployment（先改个镜像标签或 `kubectl -n mynotes rollout restart deploy/mynotes` 触发新建 Pod），会看到下面的效果（下面是示意，括号里的详细说明已省略）：

```
$ kubectl apply -f k8s/mynotes.yaml
Warning: would violate PodSecurity "restricted:latest": allowPrivilegeEscalation != false (...), unrestricted capabilities (...), runAsNonRoot != true (...), seccompProfile (...)
deployment.apps/mynotes configured
$ kubectl -n mynotes get events --field-selector reason=FailedCreate
... replicaset/mynotes-7d... Error creating: pods "mynotes-7d..." is forbidden: violates PodSecurity "restricted:latest": allowPrivilegeEscalation != false (...), ...
```

怎么读：Deployment 对象本身创建成功了，`warn` 模式只在 apply 时打印警告；真正被 `enforce` 拒绝的是 ReplicaSet 创建 Pod 的请求，所以错误出现在事件（events）里，新 Pod 一个也起不来。这条消息就是一张“待办清单”，每一项对应一个要补的 securityContext 字段。按它把 Deployment 的 Pod 模板补全。

加固后的 Deployment（Pod 模板部分，整合了上一课的 SA 与本课的 securityContext、只读根 + emptyDir）：

```yaml
    spec:
      serviceAccountName: mynotes-sa
      automountServiceAccountToken: false
      securityContext:                 # Pod 级
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001                 # 让挂载的卷归 10001 组, 可写
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: mynotes
          image: mynotes:0.1
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef: { name: mynotes-config }
          securityContext:             # 容器级
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - { name: tmp, mountPath: /tmp }
            - { name: data, mountPath: /data/study }
          readinessProbe:
            httpGet: { path: /, port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 5
      volumes:
        - name: tmp
          emptyDir: {}
        - name: data
          emptyDir: {}
```

apply 后验证合规与运行：

```
$ kubectl apply -f k8s/mynotes.yaml
$ kubectl -n mynotes rollout status deploy/mynotes
deployment "mynotes" successfully rolled out
$ kubectl -n mynotes exec deploy/mynotes -- id
uid=10001(app) gid=10001(app) groups=10001(app)
$ kubectl -n mynotes exec deploy/mynotes -- sh -c 'echo x > /etc/x' 2>&1
sh: 1: cannot create /etc/x: Read-only file system
$ kubectl -n mynotes exec deploy/mynotes -- sh -c 'echo x > /tmp/x && echo ok'
ok
```

怎么读：`id` 是 10001 非 root（runAsNonRoot 生效）；往 `/etc` 写被 `Read-only file system` 拒绝（根只读生效）；往 `/tmp` 写成功（emptyDir 可写）。Pod 能正常 Ready，说明加固没有妨碍应用——这正是我们要的“最紧但能跑”的状态。

### 实践 2：默认拒绝 + 按需放行的 NetworkPolicy

前提：集群的 CNI 要支持 NetworkPolicy。如果你按 [[k8s-basics]] 用 `minikube start --cni=calico` 建的集群，这一条已经满足。否则就重建一个：`minikube delete && minikube start --cni=calico && minikube addons enable ingress`，然后重新导入镜像、apply 清单。kind 也可以在建集群时禁用默认 CNI 再装 Calico（步骤见 kind 和 Calico 的官方文档）。确认后，把核心概念第 4 节的两个 NetworkPolicy 存成 `k8s/netpol.yaml` 并应用：

```
$ kubectl apply -f k8s/netpol.yaml
networkpolicy.networking.k8s.io/default-deny-all created
networkpolicy.networking.k8s.io/mynotes-allow created
$ kubectl -n mynotes get networkpolicy
NAME               POD-SELECTOR   AGE
default-deny-all   <none>         10s
mynotes-allow      app=mynotes    10s
```

验证“默认拒绝”确实拦住了横向流量。在 **default 命名空间**起一个临时测试 Pod，模拟“集群里别处一个被攻破的 Pod”，尝试去连 MyNotes。不放在 mynotes 命名空间，是因为那里已经是 restricted，一个没写 securityContext 的 busybox 会直接被 PSA 拒绝：

```
$ kubectl -n default run probe --image=busybox:1.36 --restart=Never -it --rm -- \
    sh -c 'wget -T 3 -qO- http://mynotes.mynotes.svc/ ; echo rc=$?'
wget: download timed out
rc=1
```

作为对照，在 apply NetworkPolicy **之前**跑同一条命令，会打印出 MyNotes 首页的 HTML，`rc=0`。现在超时，说明这个 probe Pod 到 MyNotes 的入站流量被挡了：`mynotes-allow` 只放行来自 ingress-nginx 命名空间的流量。而通过正规入口 Ingress 访问仍然通：

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://mynotes.local/
200
```

再验证出站：MyNotes 只能 DNS，不能乱连外部。

```
$ kubectl -n mynotes exec deploy/mynotes -- getent hosts kubernetes.default.svc.cluster.local
10.96.0.1       kubernetes.default.svc.cluster.local
$ curl -s -m 10 -o /dev/null -w '%{http_code}\n' \
    'http://mynotes.local/vuln/l05/preview?url=http://example.com/'
000
```

第一条能解析出 API Server 的 ClusterIP，说明 egress 放行了 53 端口（镜像里没有 nslookup，所以用 glibc 自带的 `getent`）。第二条让 Lab 05 的 SSRF 接口去访问外网：出站的 TCP 包被丢弃，应用里的连接一直挂着，curl 等 10 秒后放弃，打印 `000`（不加 `-m` 的话，最后会等到 Ingress 的超时，返回 504 或 500）。在本机不加 NetworkPolicy 时，同样的请求会把 example.com 的页面内容带回来。这正好说明：NetworkPolicy 的出站限制能把 [[web-ssrf]] 这类漏洞的危害收住。怎么读整体：**从外面经 Ingress 进来正常（业务不受影响），Pod 到 Pod 的横向连接和乱七八糟的出站被默认拒绝挡死**——这就是“默认拒绝 + 按需放行”的效果。如果两条命令行为和预期相反，多半是 CNI 不执行 NetworkPolicy，回到前提检查。

### 实践 3：跑一次 kube-bench 并解读结果

在集群里以 Job 方式运行 kube-bench（按其官方仓库给出的清单部署；下面命令与输出为通用示意，具体项编号以 CIS Benchmark 与你的版本为准）：

```
$ kubectl apply -f <kube-bench 官方 job 清单>
$ kubectl logs job/kube-bench
```

输出按 CIS 章节分组，每条形如：

```
[INFO] 4 Worker Node Security Configuration
[PASS] 4.2.x Ensure that the --anonymous-auth argument is set to false
[FAIL] 4.2.x Ensure that the ... argument is set to ...
[WARN] 4.2.x Ensure ...
== Remediation node ==
4.2.x Edit the kubelet config file ... set ... then restart the kubelet service
== Summary node ==
N checks PASS
N checks FAIL
N checks WARN
N checks INFO
```

怎么读并整改：

- **FAIL** 是明确不合规、有确定整改方法的，优先处理，`Remediation` 段就是操作步骤。
- **WARN** 多是“需人工判断”或依赖环境的项，逐条评估是否适用。
- **INFO** 是提示或在托管集群上无法检查的控制面项，记录即可。
- 关注高价值项：apiserver 是否关匿名访问、是否开审计日志、etcd 是否加密与 TLS、kubelet 认证授权、RBAC 是否启用。
- 托管集群里大量控制面项会显示无法检查，那是云厂商责任，你聚焦节点（`4.x`）和策略（`5.x`）章节。

把一次基线报告存档，整改后重跑对比，就是项目④“kube-bench 报告与整改”这个里程碑的交付物。

## 攻击者视角

把本阶段的攻击链串起来，看这些加固分别断在哪一环：

- **RCE 后想落地工具/webshell** → 被 `readOnlyRootFilesystem` 挡住，写不了盘（只有 /tmp、/data 可写，且这些也可结合监控）。
- **想在容器里提权、利用 setuid、扩容器能力** → `allowPrivilegeEscalation:false` + `drop ALL` + 非 root 让容器内几乎没有可用特权；`seccompProfile:RuntimeDefault` 封了危险 syscall（呼应 [[docker-isolation]]）。
- **想造特权/hostPath Pod 逃到节点** → 即使拿到能创建 Pod 的权限，PSA 的 restricted 会在准入层拒绝这些字段（呼应 [[k8s-rbac]]：RBAC 管谁能建，PSA 管能建成什么样）。
- **想偷 ServiceAccount token 打 API** → 上一课已 `automountServiceAccountToken:false`，token 根本不在容器里。
- **想横向扫描、连数据库、访问 API Server / 云元数据** → 被默认拒绝的 NetworkPolicy 掐断东西向和多余出站。
- **想从 etcd 备份里捞 Secret** → etcd 静态加密让备份里不是明文；外部密钥管理让密钥根本不在集群。

一个 Pod 被攻破，在加固前几乎等于半个集群失守；加固后攻击者被困在一个非 root、只读、无特权、无 token、几乎不能对外通信的盒子里——这就是纵深防御的价值。

## 防御与最佳实践

- **命名空间默认上 restricted PSA 标签**（enforce+warn+audit），新建命名空间就带上，让不合规 Pod 根本建不出来。
- **每个 Deployment 写全 securityContext**：runAsNonRoot + 数字 UID、allowPrivilegeEscalation:false、drop ALL、seccomp RuntimeDefault、readOnlyRootFilesystem，可写路径用 emptyDir/PVC。
- **NetworkPolicy 默认拒绝 + 按需放行**，每个命名空间先一条 default-deny，再逐应用精确放行入站/出站；确认 CNI 支持并执行。
- **Secret 三层护**：RBAC 限读 + etcd 加密 + 外部密钥管理与轮换。
- **镜像来源控制**：只用可信仓库 + digest 固定，配合准入校验（镜像签名/来源白名单），呼应 [[docker-basics]] 的持续扫描。
- **开审计日志、护控制面**：apiserver 关匿名、开 audit、etcd 加密与 TLS，不暴露公网。
- **定期基线检查**：kube-bench 对集群、Trivy 对镜像、PSA/策略引擎对 Pod，三线并行并纳入 CI/定时任务。
- **最小化一切**：最小权限（RBAC）、最小能力（capabilities）、最小网络（NetworkPolicy）、最小镜像与写权限——纵深叠加。

## 常见误区

- **“还用 PodSecurityPolicy。”** PSP 已在 1.25 被移除，现在用内建的 Pod Security Admission（命名空间标签），或外部策略引擎（Kyverno、OPA Gatekeeper）。
- **“给命名空间打了 enforce 标签，apply Deployment 就会报错。”** PSA 校验的是 Pod。Deployment 本身会创建成功（有 warn 标签时只打印警告），真正被拒的是 ReplicaSet 创建 Pod 的请求，要去 `kubectl get events` 或 `describe rs` 才看得到 FailedCreate。
- **“restricted 要求 readOnlyRootFilesystem。”** 不要求。只读根文件系统是额外的推荐加固，restricted 不校验它；它要靠你自己写进 securityContext。
- **“写了 NetworkPolicy 就生效了。”** 必须有支持 NetworkPolicy 的 CNI（Calico、Cilium 等）。不支持的 CNI 会静默忽略策略。
- **“只写 default-deny 就好。”** 连 DNS 和 Ingress 流量都会被拦，应用立刻不可用。默认拒绝一定要配套按需放行，并逐项验证。
- **“Secret 开了 etcd 加密就万事大吉。”** etcd 加密只防 etcd 数据/备份泄露；有 get secrets 权限的人通过 API 读到的仍是明文。RBAC 仍是第一道关。
- **“kube-bench 全 PASS 集群就安全了。”** 它只检查集群配置基线，不检查你的应用漏洞、镜像 CVE、RBAC 是否过度授权、NetworkPolicy 是否写对。

## 自测

:::details 1. 没有 NetworkPolicy 的集群里，一个被攻破的 Pod 能访问哪些东西？
几乎一切。K8s 默认网络扁平全通：它能连任意命名空间里任意 Pod 的任意端口（数据库、Redis、内部 API、管理后台），通常也能访问 API Server、节点上暴露的端口，在云上还可能访问元数据地址拿节点的云凭据，并且能随意向外网出站（下载工具、回传数据）。东西向流量没有任何边界，所以要用默认拒绝 + 按需放行的 NetworkPolicy 收口。
:::

:::details 2. Pod Security Standards 的三个级别是什么？PSA 的三种模式呢？
级别：privileged（不设限，只给系统组件）、baseline（挡住明显的提权/逃逸，如 privileged、hostPID、hostNetwork、hostPath）、restricted（在 baseline 上再要求非 root、禁止提权、drop ALL、seccomp RuntimeDefault、只允许安全的卷类型）。模式：enforce（不合规拒绝创建）、audit（允许但记审计日志）、warn（允许但给用户警告）。通过命名空间标签 `pod-security.kubernetes.io/<mode>: <level>` 配置。
:::

:::details 3. 要满足 restricted，MyNotes 的 securityContext 至少要写哪些字段？
Pod 或容器级 `runAsNonRoot: true`（镜像 USER 或 runAsUser 提供数字非 0 UID）；容器级 `allowPrivilegeEscalation: false`；`capabilities.drop: ["ALL"]`；`seccompProfile.type: RuntimeDefault`（或 Localhost）；且不能用 hostPath 等不允许的卷。`readOnlyRootFilesystem: true` 不是 restricted 的要求，但推荐加，并给 /tmp 和数据目录挂 emptyDir。
:::

:::details 4. 开了 readOnlyRootFilesystem 后，为什么还要给 /tmp 挂 emptyDir？
JVM、Tomcat 和很多库会往 /tmp 写临时文件，MyNotes 的 StudyStore 还要在数据目录建目录、写文件。根文件系统只读后这些写操作会报 Read-only file system，导致启动失败或功能异常。emptyDir 是 restricted 允许的临时卷，挂到 /tmp 和 /data/study 让这两处可写，其余位置保持只读，既能运行又让攻击者难以落地文件。
:::

:::details 5. 为什么 NetworkPolicy 要“默认拒绝 + 按需放行”，而不是只给重要 Pod 写策略？
因为没被任何策略选中的 Pod 默认全通，逐个补策略容易遗漏，新加的 Pod 也会默认裸奔。先用 `podSelector: {}` 的 default-deny 把整个命名空间两个方向都关掉，再为每个应用精确放行必需流量（如 MyNotes 只放行来自 ingress-nginx 的 8080 入站和到 kube-system 的 53 出站），基线就是“全关”，漏写的后果是“不通”而不是“裸奔”。
:::

:::details 6. etcd 静态加密和外部密钥管理分别防什么？
etcd 静态加密让 API Server 在写入 etcd 前加密 Secret，防的是 etcd 数据文件或备份被拿走时直接读到明文；配 KMS provider 还能把加密密钥放到外部 KMS。外部密钥管理（Vault、云 KMS/凭据服务）让密钥根本不以 Secret 形式长期存放在集群里，提供集中审计、自动轮换和细粒度授权。两者都不能替代 RBAC：能通过 API 读 Secret 的人拿到的仍是明文。
:::

:::details 7. kube-bench 检查什么？结果里的 FAIL、WARN、INFO 怎么处理？
kube-bench 对照 CIS Kubernetes Benchmark 检查集群自身配置：控制面组件参数、etcd、kubelet、文件权限、策略等。FAIL 是明确不合规，按 Remediation 优先整改；WARN 多为需人工判断的项，逐条评估是否适用；INFO 是提示或无法自动检查的项。在托管集群上控制面项多由云厂商负责，应聚焦节点和策略部分。整改后重跑对比，形成报告。
:::

:::details 8. 为什么 PSP 被移除后，“能创建 Pod”的风险要靠 PSA 来兜？
RBAC 只能决定谁能创建 Pod，决定不了 Pod 里写什么字段。有 create pods 权限的人可以写 privileged、hostPath、hostPID 来拿节点。PSA 在准入阶段按命名空间级别校验 Pod 字段，restricted 会直接拒绝这类 Pod，把“能建 Pod”的危害限制住。PSP 过去承担这个角色，1.25 移除后由 PSA 接替。
:::

## 一句话总结

加固一个 Spring Boot 服务的 K8s 部署，就是把前几课的原则全部落到清单里：命名空间打上 restricted 的 PSA 标签，Pod 以非 root、禁止提权、drop ALL、seccomp RuntimeDefault、只读根（/tmp 用 emptyDir）运行，NetworkPolicy 默认拒绝再按需放行，Secret 靠 RBAC + etcd 加密 + 外部密钥管理保护，最后用 kube-bench 做基线检查。这样即使应用被攻破，攻击者也出不了这个 Pod。
