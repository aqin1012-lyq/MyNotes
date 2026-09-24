## 为什么要学

前两课你把单个容器搞明白了：怎么造镜像、容器为什么不是虚拟机。但生产上没人手动 `docker run` 几十个容器——挂了谁重启？流量怎么分发？配置和密钥怎么下发？滚动升级怎么做？这些编排问题，就是 Kubernetes（K8s）要解决的，它也早已是云原生事实标准。你在车联网、电商项目里迟早要把 Spring Boot 服务交给 K8s 跑。

这一课是 K8s 部分的第一课，目标是认识最核心的几个对象：Pod、Deployment、Service、Ingress、ConfigMap、Secret、ServiceAccount，并亲手用 kind 或 minikube 把 MyNotes 部署起来（Deployment + Service + Ingress）。这是项目④的第二个里程碑“K8s 部署”。

安全视角贯穿始终：你要理解 **API Server 是一切的入口，任何操作都要经过认证 → 授权 → 准入控制**这条主线（它决定了后面 [[k8s-rbac]] 和 [[k8s-hardening]] 讲什么）；要知道 Secret 默认只是 Base64 编码、不是加密；还要回答一个关键问题：**Pod 里默认挂载的 ServiceAccount Token 被攻击者拿到，他能做什么**——这正是从 [[web-ssrf]]、容器逃逸接续下来的攻击路径。

学完你要能读懂并写出一套最小的 K8s 部署清单，讲清 Pod/Deployment/Service/Ingress 四者的关系，并在本地集群里访问到你部署的 MyNotes。下一课 [[k8s-rbac]] 收紧权限，再下一课 [[k8s-hardening]] 做 Pod 加固和网络隔离。

:::tip 环境约定
本课用本地单机集群：kind（Kubernetes in Docker）或 minikube 任选其一，命令行是 `kubectl`。示例镜像沿用上一课构建的 `mynotes:0.1`，命名空间统一用 `mynotes`。
:::

## 核心概念

### 1. Pod / Deployment / Service / Ingress 的关系

先建立一张全景图，四个对象层层包裹、各管一件事：

```
Internet
   |
   v
[Ingress]        规则: host/path -> Service    (L7 HTTP 路由)
   |
   v
[Service]        稳定的虚拟 IP + DNS 名, 负载均衡到一组 Pod
   |  selector: app=mynotes
   +------------------+------------------+
   v                  v                  v
[Pod]              [Pod]              [Pod]        每个 Pod 一个 IP, 会被重建
   |                                               (由 Deployment 管理副本)
   v
container: mynotes:0.1  (监听 8080)
```

逐个说：

- **Pod** 是 K8s 调度的最小单位，里面跑一个或多个共享网络和存储的容器（通常就一个业务容器）。Pod 是**临时的**：崩了、被驱逐了、节点挂了，它就没了，重建出来的是**新 Pod、新 IP、新名字**。所以你永远不该记住某个 Pod 的 IP。
- **Deployment** 管理一组同样的 Pod（通过它创建的 ReplicaSet）。你声明“我要 3 个副本、用这个镜像”，Deployment 负责让实际状态始终逼近这个期望：Pod 挂了自动拉起，改了镜像做滚动升级，出问题能回滚。你日常操作的是 Deployment，不是直接建 Pod。
- **Service** 解决“Pod 会变、IP 会变”的问题。它有一个稳定的虚拟 IP（ClusterIP）和一个集群内 DNS 名（`mynotes.mynotes.svc.cluster.local`），通过 label selector（`app=mynotes`）自动把请求负载均衡到当前健康的一组 Pod。Service 有几种类型：ClusterIP（仅集群内，默认）、NodePort（在每个节点开一个端口对外）、LoadBalancer（云上挂负载均衡器）。
- **Ingress** 是集群入口的 L7（HTTP/HTTPS）路由层，按域名和路径把外部请求转发到不同 Service，还能统一做 TLS 终止。它本身只是规则，真正干活的是 **Ingress Controller**（如 ingress-nginx），得单独装。

用你熟悉的话类比：Deployment ≈ 一份“我要几个实例、什么版本”的期望声明；Service ≈ 一个带健康检查和负载均衡的稳定入口（像 Nginx upstream，但 upstream 成员自动维护）；Ingress ≈ 那台对外的 Nginx 反向代理配置。请求路径：Ingress → Service → Pod → 容器。

### 2. ConfigMap vs Secret（Secret 默认只是 Base64）

把配置和密钥从镜像里剥离出来（回忆上一课：密钥绝不进镜像），K8s 提供两种对象：

- **ConfigMap**：存非敏感的配置——环境变量、配置文件片段、命令行参数。比如 MyNotes 的 `SERVER_ADDRESS=0.0.0.0`、`MYNOTES_STUDY_DIR=/data/study` 就适合放这里。
- **Secret**：存敏感数据——数据库密码、API key、TLS 私钥。用法和 ConfigMap 几乎一样，可以作为环境变量或文件挂进 Pod。

**关键安全事实：Secret 默认只是 Base64 编码，不是加密。** Base64 是编码，任何人 `base64 -d` 一下就还原了：

```
$ kubectl -n mynotes get secret db-cred -o jsonpath='{.data.password}'
czNjcjN0UEBzcw==
$ echo czNjcjN0UEBzcw== | base64 -d
s3cr3tP@ss
```

所以 Secret 的“保密”不靠编码本身，而靠三件事：一是 **RBAC**——谁能 `get`/`list` 这个命名空间的 secrets（下一课重点，能读 secrets 几乎等于能读所有密码）；二是 **etcd 静态加密**（encryption at rest）——API Server 把 Secret 写进 etcd 前先加密，否则拿到 etcd 备份就拿到所有密钥（[[k8s-hardening]] 详述）；三是**外部密钥管理**——用 Vault、云 KMS/SWR 凭据管理，K8s 里只放引用。相比之下 ConfigMap 里则**绝不能**放密码。

用法示意（作为环境变量注入，Secret 部分下一课再收紧权限）：

```
env:
  - name: SERVER_ADDRESS
    valueFrom:
      configMapKeyRef: { name: mynotes-config, key: SERVER_ADDRESS }
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef: { name: db-cred, key: password }
```

### 3. ServiceAccount 与自动挂载的 Token

Pod 里的程序如果要调用 K8s API Server（比如查自己所在命名空间的其它资源），需要一个身份，这个身份就是 **ServiceAccount（SA）**。每个命名空间都有一个 `default` SA，Pod 不指定就用它。

历史与现状很重要（版本相关，这里说清楚）：

- **1.24 之前**：创建一个 ServiceAccount，控制器会自动为它生成一个长期有效的 Secret（里面是 JWT token），并把这个 Secret 挂进用它的 Pod。这种 token 不过期、可被复制带走，风险大。
- **1.24 起（含）**：**不再自动为 ServiceAccount 创建 token Secret**。Pod 用的 token 改为 **projected（投影）+ 绑定（bound）token**：由 kubelet 通过投影卷注入，有**过期时间**、**绑定到具体 Pod 和 SA**，Pod 没了 token 即失效，安全性大幅提升。默认仍然会把这个投影 token 挂到 Pod 的 `/var/run/secrets/kubernetes.io/serviceaccount/token`。

即便如此，**如果应用根本不需要访问 API Server（MyNotes 就不需要），最好干脆别挂**。关闭方式（下一课会用它做最小权限）：

```
spec:
  automountServiceAccountToken: false   # 可写在 ServiceAccount 上或 Pod 的 spec 上
```

Pod spec 上的设置优先级高于 SA 上的。关掉之后，Pod 里就不会出现那个 token 文件，攻击者即使拿下容器也偷不到集群身份——这直接削弱了下面问答里描述的攻击链。

### 4. API Server 是一切的入口：认证 → 授权 → 准入控制

理解 K8s 安全，最重要的一句话：**所有对集群的操作，无论是你敲 `kubectl`、还是 Pod 里的程序用 token，都是在向 kube-apiserver 发 HTTP 请求；apiserver 是唯一改写集群状态（etcd）的组件。** 守住 apiserver，就守住了大半个集群。

每个到达 apiserver 的请求，依次过三道关：

```
request --> [1 Authentication] --> [2 Authorization] --> [3 Admission] --> etcd
             who are you?          allowed?              mutate/validate    persist
             cert/token/SA         RBAC rules            e.g. PSA
```

- **认证（Authentication，你是谁）**：apiserver 通过客户端证书、Bearer token（含 ServiceAccount token）、或外部 OIDC 等方式确认调用者身份。认不出来就 401。注意 K8s **没有“用户”这种内建对象**——普通用户由证书/OIDC 表示，程序身份才是 ServiceAccount。
- **授权（Authorization，你能不能做）**：确认身份后，检查“这个身份能不能对这个资源做这个动作”。生产集群主要用 **RBAC**（Role/RoleBinding），匹配不上就 403。这是下一课 [[k8s-rbac]] 的全部内容。
- **准入控制（Admission Control，改一改/拦一拦）**：请求通过授权后、写入 etcd 前，一串准入控制器可以**校验**（拒绝不合规对象）或**修改**（补默认值）它。**Pod Security Admission（PSA）** 就是内建的准入控制器，按命名空间的标签强制 Pod 的 securityContext 达到 baseline/restricted 级别（[[k8s-hardening]] 详述）。它取代了 1.25 中被移除的 PodSecurityPolicy。

这条“认证→授权→准入”的链，就是后面两课的地图：k8s-rbac 收紧第 2 关，k8s-hardening 用第 3 关（PSA）+ NetworkPolicy 收紧 Pod 本身。

:::warn 问答：Pod 里默认挂载的 ServiceAccount Token 被拿到，攻击者能做什么？
攻击者拿下容器（比如通过应用 RCE 或 SSRF）后，会去读 `/var/run/secrets/kubernetes.io/serviceaccount/` 下的 `token`、`ca.crt`、`namespace`。**这个 token 就是一张对 API Server 的身份凭证**，能做多少事，完全取决于这个 ServiceAccount 被授予的 RBAC 权限：
- 如果这个 SA（哪怕是 default）被人图省事绑了大权限，甚至 `cluster-admin`，那攻击者就等于拿到集群管理员——可以读所有命名空间的 Secret（数据库密码、云凭据全暴露）、创建特权 Pod、部署挖矿或后门。
- 即使只是普通权限，能 `list secrets` 就能拖走本命名空间所有密码；能 `create pods` 几乎等于能拿节点权限（下一课解释为什么）；能 `pods/exec` 就能进别的 Pod。
- 就算这个 SA 几乎没有任何权限，token 本身也告诉了攻击者命名空间名、集群 CA，便于进一步探测。
**防御四连**：① 应用不需要就 `automountServiceAccountToken: false`，根本不挂 token；② 每个应用用独立、最小权限的 SA，绝不用 default、绝不给 cluster-admin；③ 1.24+ 的 bound token 会过期、随 Pod 失效，别再手工创建长期 token Secret；④ 用 NetworkPolicy 限制 Pod 能不能访问到 apiserver。这几条正是下一课和 [[k8s-hardening]] 要落地的。
:::

## 动手实践

:::warn 声明
本系列里的攻击手法只用于你自己的环境或获得授权的目标。
:::

### 实践：用 kind 或 minikube 部署 MyNotes（Deployment + Service + Ingress）

**第 0 步：装工具、起集群。** 推荐 minikube：Ingress 用 addon 一键开启；启动时直接带上 Calico 网络插件，这样 [[k8s-hardening]] 里的 NetworkPolicy 才会真正生效，不用重建集群：

```
$ brew install minikube kubectl
$ minikube start --cni=calico
$ minikube addons enable ingress
$ kubectl get nodes
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane   1m    v1.xx.x
```

`STATUS Ready` 说明集群可用。minikube 的 ingress addon 会把 Ingress Controller（ingress-nginx）装在 `ingress-nginx` 命名空间，后面写 NetworkPolicy 时会用到这个名字。

也可以用 kind（Kubernetes in Docker，更轻）：`brew install kind`，然后 `kind create cluster --name mynotes`。但 kind 默认不带 Ingress Controller，要把 80 端口映射到宿主机并单独安装 Controller。这几步请按 kind 官方文档的 Ingress 页面做，文档里给出了专门的集群配置和安装清单。另外，上游已宣布 ingress-nginx 项目停止维护，新集群可以考虑其他 Ingress Controller 或 Gateway API；具体状态以 Kubernetes 官方文档为准。本课的 Ingress YAML 是标准的 `networking.k8s.io/v1`，换别的 Controller 时通常只需要改 `ingressClassName`。

**第 1 步：把镜像送进集群。** 本地 build 的 `mynotes:0.1` 不在任何 registry，集群拉不到，要手动导入：

```
# minikube:
$ minikube image load mynotes:0.1
# kind:
$ kind load docker-image mynotes:0.1 --name mynotes
```

**第 2 步：确认 Ingress Controller 已就绪。**

```
$ kubectl -n ingress-nginx wait --for=condition=Ready pod \
    -l app.kubernetes.io/component=controller --timeout=120s
pod/ingress-nginx-controller-xxxxx condition met
```

**第 3 步：写清单。** 新建 `k8s/mynotes.yaml`，一个文件里放命名空间、ConfigMap、Deployment、Service、Ingress（用 `---` 分隔）：

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: mynotes
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: mynotes-config
  namespace: mynotes
data:
  SERVER_ADDRESS: "0.0.0.0"
  MYNOTES_STUDY_DIR: "/data/study"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mynotes
  namespace: mynotes
spec:
  replicas: 2
  selector:
    matchLabels: { app: mynotes }
  template:
    metadata:
      labels: { app: mynotes }
    spec:
      containers:
        - name: mynotes
          image: mynotes:0.1
          imagePullPolicy: IfNotPresent   # 用本地导入的镜像, 别去远端拉
          ports:
            - containerPort: 8080
          envFrom:
            - configMapRef: { name: mynotes-config }
          readinessProbe:
            httpGet: { path: /, port: 8080 }
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /, port: 8080 }
            initialDelaySeconds: 20
            periodSeconds: 10
          volumeMounts:
            - name: data
              mountPath: /data/study
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: mynotes
  namespace: mynotes
spec:
  selector: { app: mynotes }
  ports:
    - port: 80          # Service 对外端口
      targetPort: 8080  # 转到 Pod 的 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mynotes
  namespace: mynotes
spec:
  ingressClassName: nginx
  rules:
    - host: mynotes.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: mynotes
                port: { number: 80 }
```

几处要点：`envFrom` 把 ConfigMap 整个变成环境变量，`SERVER_ADDRESS=0.0.0.0` 就是这样注入的（回忆容器里必须监听 0.0.0.0）；`readinessProbe` 决定 Pod 何时被 Service 纳入负载均衡，`livenessProbe` 决定卡死时是否重启；`emptyDir` 给数据目录一个可写卷（下一课根文件系统只读后，`/tmp` 也要这样处理）。这里还**没做安全加固**（没有 securityContext、用了默认 SA），那是后两课的事，先让它跑起来。

**第 4 步：部署并观察。**

```
$ kubectl apply -f k8s/mynotes.yaml
namespace/mynotes created
configmap/mynotes-config created
deployment.apps/mynotes created
service/mynotes created
ingress.networking.k8s.io/mynotes created

$ kubectl -n mynotes get deploy,pod,svc,ingress
NAME                      READY   UP-TO-DATE   AVAILABLE
deployment.apps/mynotes   2/2     2            2

NAME                           READY   STATUS    RESTARTS
pod/mynotes-6c9f7d8b5-abcde    1/1     Running   0
pod/mynotes-6c9f7d8b5-fghij    1/1     Running   0

NAME              TYPE        CLUSTER-IP      PORT(S)
service/mynotes   ClusterIP   10.96.140.21    80/TCP

NAME                                CLASS   HOSTS           ADDRESS
ingress.networking.k8s.io/mynotes   nginx   mynotes.local   ...
```

怎么读：Deployment `READY 2/2` 表示期望 2 个、就绪 2 个；两个 Pod `Running` 且 `READY 1/1`（readinessProbe 通过）；Service 拿到一个 ClusterIP；Ingress 绑定了 host。如果 Pod 卡在 `ErrImagePull`，多半是镜像没导进集群（回第 1 步）或 `imagePullPolicy` 没设 `IfNotPresent`；卡在 `CrashLoopBackOff` 用 `kubectl -n mynotes logs <pod>` 看日志，常见就是忘了 `SERVER_ADDRESS=0.0.0.0` 或数据目录不可写。

**第 5 步：访问。** 在 macOS 上用 minikube 的 Docker 驱动时，集群节点的 IP（`minikube ip`）从 Mac 上通常访问不到，要开一个隧道把 Ingress 暴露到 `127.0.0.1`。另开一个终端，保持运行：

```
$ minikube tunnel
```

Ingress 按 host 路由，再让 `mynotes.local` 解析到 127.0.0.1：

```
$ echo "127.0.0.1 mynotes.local" | sudo tee -a /etc/hosts
$ curl -s -o /dev/null -w '%{http_code}\n' http://mynotes.local/
200
```

不想改 hosts 文件的话，也可以直接带 Host 头：`curl -H 'Host: mynotes.local' http://127.0.0.1/`。在 Linux 上直接用 minikube 时，把 hosts 里的 127.0.0.1 换成 `minikube ip` 的输出即可，不需要 tunnel。

:::warn 别把靶场暴露出去
MyNotes 带着故意留洞的 `/vuln/**` 接口。本地集群的 Ingress 只在本机可达，这没问题；千万不要把这个镜像部署到有公网入口的集群。
:::

拿到 200 就说明整条链通了：`curl` → /etc/hosts 解析 → Ingress Controller → Ingress 规则匹配 host/path → Service（ClusterIP）→ 负载均衡到某个 Pod:8080 → MyNotes。绕开 Ingress 直接测 Service 也可以：

```
$ kubectl -n mynotes port-forward svc/mynotes 8080:80
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/
200
```

**第 6 步：看一眼默认挂载的 token（体会上面的安全问答）。**

```
$ kubectl -n mynotes exec deploy/mynotes -- \
    ls /var/run/secrets/kubernetes.io/serviceaccount/
ca.crt
namespace
token
```

这就是攻击者拿下容器后能读到的东西。下一课我们会用独立 SA + `automountServiceAccountToken: false` 让这个目录彻底消失。

后面两课（[[k8s-rbac]]、[[k8s-hardening]]）会接着用这个集群和命名空间，先别删。全部学完后再清理：`minikube delete`（kind 则是 `kind delete cluster --name mynotes`）。

## 攻击者视角

站在攻破了一个 Pod 的攻击者角度，K8s 环境提供了一批“下一步”：

- **偷 ServiceAccount token**：读 `/var/run/secrets/kubernetes.io/serviceaccount/token`，拿它去问 apiserver `kubectl auth can-i --list`（或直接调 REST）看自己能干啥，再顺着权限扩大战果（见上方问答）。
- **读 Secret**：如果 token 或获得的凭据能 `get/list secrets`，本命名空间（甚至全集群）的数据库密码、云 AK/SK、TLS 私钥一次性拖走。这也是为什么 Secret 必须靠 RBAC + etcd 加密来保护，而不是靠 Base64。
- **打 apiserver 的匿名/弱认证**：配置不当的集群可能允许匿名访问某些接口，或把 apiserver/etcd/kubelet 端口暴露到公网。
- **横向移动**：能 `create pods` 就能起一个挂了宿主机根目录或特权的 Pod 落到节点上（下一课细讲）；能 `pods/exec` 就能进其它 Pod。
- **访问云元数据**：在云上的节点，Pod 若无网络限制常能访问节点元数据地址拿到节点角色的云凭据——和 [[web-ssrf]] Lab 05 同一套路，只是场景搬到了 K8s。
- **探测东西向流量**：默认 K8s 里所有 Pod 互通，被攻破的 Pod 能扫描并连接同集群其它服务（数据库、内部 API）。这正是 [[k8s-hardening]] 里 NetworkPolicy 要解决的。

## 防御与最佳实践

- **每个应用独立 ServiceAccount + 最小权限 RBAC，绝不用 default、绝不给 cluster-admin**（下一课）。
- **不需要访问 API 就 `automountServiceAccountToken: false`**，让 token 根本不出现。
- **Secret 用 RBAC 严格限制读取者 + 开 etcd 静态加密 + 尽量外部化到 Vault/云 KMS**；ConfigMap 里绝不放密码。
- **配好探针**：readiness/liveness 让升级平滑、故障自愈，也避免把流量打到没起好的 Pod。
- **用 Deployment 声明式管理**，改动走 `kubectl apply` + Git（GitOps），可审计、可回滚。
- **命名空间做边界**：按应用/团队/环境分命名空间，配合 RBAC、NetworkPolicy、Pod Security 标签逐层收紧（后两课）。
- **Ingress 统一 TLS**：对外一律 HTTPS，证书集中在 Ingress 管理。
- **保护控制面**：apiserver/etcd/kubelet 不暴露公网，关匿名访问，开审计日志（[[k8s-hardening]]）。

## 常见误区

- **“Secret 是加密的。”** 默认只是 Base64 编码，`base64 -d` 即还原。保密靠 RBAC + etcd 静态加密 + 外部密钥管理，不是靠这层编码。
- **“记住 Pod 的 IP 直接连。”** Pod 是临时的，重建就换 IP。要通过 Service 的稳定 ClusterIP/DNS 名访问。
- **“建个 Deployment 就能从外面访问了。”** Deployment 只管 Pod；对外还需要 Service（稳定入口 + 负载均衡）和 Ingress（+Ingress Controller）做 L7 路由。
- **“ServiceAccount token 现在还是永久 Secret。”** 1.24 起不再自动创建 token Secret，Pod 用的是有过期时间、绑定 Pod 的投影 token；别再手工造长期 token。
- **“default ServiceAccount 用着方便。”** 多个应用共用 default 会让权限难以收敛，一旦给它绑了权限，所有 Pod 都继承。每个应用应有独立 SA。
- **“我的服务不调 K8s API，token 挂不挂无所谓。”** 挂了就是白给攻击者一张身份凭证。不需要就 `automountServiceAccountToken: false`。
- **“ImagePullPolicy 无所谓。”** 本地导入镜像时若不是 `IfNotPresent`，集群会去远端拉一个不存在的镜像而失败（ErrImagePull）。

## 自测

:::details 1. Pod、Deployment、Service、Ingress 各解决什么问题？
Pod 是最小调度单位（跑容器），但它是临时的、IP 会变。Deployment 声明式管理一组同样的 Pod（副本数、滚动升级、自愈、回滚）。Service 提供稳定的虚拟 IP 和 DNS 名，用 label selector 把流量负载均衡到当前健康的 Pod，解决 Pod 易变问题。Ingress 是 L7 入口，按域名/路径把外部 HTTP(S) 请求路由到不同 Service 并统一做 TLS，需配合 Ingress Controller。请求路径：Ingress → Service → Pod → 容器。
:::

:::details 2. 为什么说 K8s 的 Secret 默认不是加密的？该怎么真正保护它？
因为 Secret 的 data 只是 Base64 编码，任何拿到对象的人 `base64 -d` 就能还原明文。真正的保护靠：RBAC 严格限制谁能 get/list secrets；开启 etcd 静态加密（encryption at rest），使 etcd 磁盘/备份里不是明文；以及把密钥外部化到 Vault 或云 KMS，集群里只放引用。ConfigMap 则绝不能放敏感数据。
:::

:::details 3. API Server 处理一个请求要经过哪三关？分别做什么？
认证（Authentication）确认“你是谁”，通过证书、token、ServiceAccount、OIDC 等；认不出返回 401。授权（Authorization）确认“你能不能对这个资源做这个动作”，生产主要用 RBAC；不允许返回 403。准入控制（Admission Control）在写入 etcd 前对请求做校验或修改，如 Pod Security Admission 强制 securityContext 合规。通过三关后才持久化到 etcd。
:::

:::details 4. Pod 里默认挂载的 ServiceAccount Token 被攻击者拿到，他能做什么？
它是一张对 API Server 的身份凭证，能做的事取决于该 SA 的 RBAC 权限。若被绑了大权限甚至 cluster-admin，攻击者等于集群管理员，可读所有 Secret、创建特权 Pod、部署后门；即使普通权限，能 list secrets 就能拖走本命名空间密码，能 create pods 几乎等于拿节点，能 pods/exec 能进别的 Pod；再不济也泄露了命名空间和集群 CA。防御：不需要就 automountServiceAccountToken:false、每应用独立最小权限 SA、用会过期的 bound token、用 NetworkPolicy 限制到 apiserver 的访问。
:::

:::details 5. 从 1.24 起 ServiceAccount token 有什么变化？为什么更安全？
1.24 之前，创建 SA 会自动生成一个长期有效、不过期的 token Secret 并挂进 Pod，被复制走就长期可用。1.24 起不再自动创建这种 Secret，Pod 使用的是通过投影卷注入的 bound token：有过期时间、绑定到具体 Pod 和 SA，Pod 消失 token 即失效，泄露后的可用窗口和影响都小得多。
:::

:::details 6. 本地 kind/minikube 部署时，为什么 Pod 会 ErrImagePull？怎么解决？
因为本地 `docker build` 出来的镜像只在本机 Docker，不在任何 registry，集群节点默认会去远端拉取而找不到。解决办法是把镜像导入集群（kind 用 `kind load docker-image`，minikube 用 `minikube image load`），并把 `imagePullPolicy` 设为 `IfNotPresent`，让它优先用本地已有镜像。
:::

:::details 7. 部署 MyNotes 时若忘了 SERVER_ADDRESS=0.0.0.0 会怎样？
应用会沿用 application.properties 里的 server.address=127.0.0.1，只监听容器内回环。Service/Ingress 把流量从 Pod 的网络接口送进来，应用收不到，readinessProbe 的 httpGet 也会失败，Pod 迟迟不 Ready 或反复重启，从外面访问得不到响应。通过 ConfigMap 注入 SERVER_ADDRESS=0.0.0.0 即可。
:::

## 一句话总结

Deployment 声明期望副本、Service 提供稳定入口与负载均衡、Ingress 做对外 L7 路由，三者把临时的 Pod 组织成可用服务；而这一切操作都经由 API Server 的认证→授权→准入三关，Secret 默认只是 Base64、ServiceAccount token 是攻击者最想偷的身份——先把 MyNotes 跑起来，下两课再用 RBAC 和加固把它锁紧。
