## 为什么要学

上一课 [[k8s-basics]] 你把 MyNotes 跑起来了，但也看到一个刺眼的问题：Pod 里默认挂着一张 ServiceAccount token，攻击者拿下容器就能拿它去问 API Server。它到底能干多少事，取决于**授权**——也就是 RBAC（Role-Based Access Control）。这一课就是把 API Server 三道关里的第 2 关（授权）讲透并落地。

好消息是：RBAC 的思想你早就懂。在 Spring Security 里你写过“角色 → 权限 → 谁绑定这个角色”（见 [[ss-authz]]），K8s 的 RBAC 是同一套思想，只是把“权限”换成了“对集群资源做某个动作”，把“用户”换成了 ServiceAccount 或人。学会它，你不仅能给自己的服务配最小权限，也能审计一个集群“谁能读 Secret、谁能创建 Pod”这些致命权限。

这一课直接对应项目④的里程碑“最小权限 ServiceAccount + RBAC”。你要能：分清 Role/ClusterRole、RoleBinding/ClusterRoleBinding；认出几类**危险权限**（读 secrets、pods/exec、create pods、escalate/bind/impersonate）为什么危险；用 `kubectl auth can-i` 审计任意身份的权限；给 MyNotes 建一个独立的、最小权限的 ServiceAccount 并验证它“只能做该做的，做不了不该做的”。下一课 [[k8s-hardening]] 再从 Pod 本体和网络层加固。

学完你会明白一句在攻防两边都成立的话：**在 K8s 里，“能创建 Pod”几乎等价于“能拿到节点权限”**——这也是本课要回答的核心问题。

## 核心概念

### 1. Role vs ClusterRole，RoleBinding vs ClusterRoleBinding

RBAC 由两类对象组成，一类定义“权限”，一类定义“把权限给谁”。

**权限的定义**（一组规则，只描述能做什么，不涉及给谁）：

- **Role**：命名空间级。它列出的权限只在**它所在的那个命名空间**里有效。比如“在 mynotes 命名空间里能 get pods”。
- **ClusterRole**：集群级。同样是一组规则，但可用于集群范围的资源（如 nodes、persistentvolumes）、跨所有命名空间的资源，以及非资源型 URL（如 `/healthz`）。

**权限的授予**（把某个 Role/ClusterRole 绑给某些主体）：

- **RoleBinding**：把权限授予在**某一个命名空间**内生效。它可以引用同命名空间的 Role，**也可以引用一个 ClusterRole**——这时 ClusterRole 里的规则被“限定”到这个命名空间使用（很常用：用一个通用 ClusterRole，在各命名空间分别 RoleBinding）。
- **ClusterRoleBinding**：把 ClusterRole 的权限授予到**整个集群、所有命名空间**。权力最大，最该谨慎。

主体（subjects）有三种：`ServiceAccount`（程序身份，本课主角）、`User`、`Group`（人，由证书/OIDC 决定，K8s 不内建存储）。

一张记忆表：

| 组合 | 权限范围 | 典型用途 |
|---|---|---|
| Role + RoleBinding | 单命名空间 | 给某应用在自己命名空间的最小权限（推荐默认） |
| ClusterRole + RoleBinding | 单命名空间（借用通用角色） | 复用一份通用只读角色到某命名空间 |
| ClusterRole + ClusterRoleBinding | 全集群 | 集群组件、管理员；应用几乎永远不该用 |
| Role + ClusterRoleBinding | 不允许 | Role 是命名空间级，不能被 ClusterRoleBinding 引用 |

一条规则（rule）的结构：

```yaml
rules:
  - apiGroups: [""]              # "" 表示核心组(core), 如 pods/services/secrets
    resources: ["pods"]         # 资源类型
    verbs: ["get", "list"]      # 允许的动作
    # resourceNames: ["x"]      # 可选: 只针对具体某个对象名
```

**RBAC 是纯累加、默认拒绝**：没有任何一条规则允许，就是不允许；RBAC 里没有“拒绝”规则，收权靠“不授予”，不是靠写 deny。多个绑定的权限取并集。

### 2. 危险权限：secrets 的 get/list、pods/exec、create pods、escalate/bind/impersonate

不是所有权限都一样重。有几类权限一旦授予，几乎等于交出集群，审计时要重点盯。

- **`get`/`list` secrets**：能读 Secret 就能读到里面的数据库密码、云 AK/SK、TLS 私钥、甚至其它 ServiceAccount 的 token。**能 list 一个命名空间的 secrets ≈ 拿到该命名空间所有密码。** 若是 ClusterRole 级则是全集群。这是最常被“图省事”授予的致命权限。
- **`create`/`get` pods/exec、pods/attach**：`pods/exec` 能在**已有 Pod 里执行命令**，等于进入别人的容器，可读它的环境变量、挂载的 Secret、内存。攻击者常借此从一个低权限 Pod 跳到高权限 Pod。
- **`create` pods（含 deployments/jobs/daemonsets 等能间接创建 Pod 的资源）**：这是本课核心问题的答案——见下节，几乎等价于节点权限。
- **`escalate`（对 roles/clusterroles）**：正常情况下，你不能创建一个权限比自己还大的 Role（否则就能自我提权）。但拥有 `escalate` 动词就能绕过这个限制，造出超过自己权限的角色再绑给自己。等于自助提权到任意权限。
- **`bind`（对 roles/clusterroles）**：能创建引用某个 Role 的 RoleBinding。若能 bind 一个高权限（如 cluster-admin）ClusterRole，就能把它绑给自己或自己的 SA，同样是提权。
- **`impersonate`（users/groups/serviceaccounts）**：能“扮演”别的身份发请求。能 impersonate 一个管理员，就等于是管理员。
- **通配符 `*`**：`verbs: ["*"]`、`resources: ["*"]`、`apiGroups: ["*"]` 等于把门全开，等价于该范围内的 admin。审计时看到 `*` 要高度警惕。

一句话记：**读密钥、进别人容器、造 Pod、以及任何能改 RBAC 或换身份的权限（escalate/bind/impersonate/通配符），都是“接近管理员”的信号。**

### 3. 为什么“能创建 Pod”几乎等价于“能拿到节点权限”

这是本课要写进笔记的核心结论。表面上“创建 Pod”只是起个容器，听起来无害。但 Pod 的 spec 里能写的东西太多了，攻击者只要能 `create pods`（或能创建 Deployment/Job/CronJob/DaemonSet 这些会替他造 Pod 的对象），就能造一个**专门用来突破隔离**的 Pod：

- **挂载宿主机根目录**：`volumes` 里写 `hostPath: { path: / }`，把节点的整个文件系统挂进 Pod，直接读写节点上的文件——包括其它容器的数据、kubelet 的凭据、节点上的 SSH key。
- **特权 / hostPID / hostNetwork**：`securityContext.privileged: true`、`hostPID: true`、`hostNetwork: true`，回忆 [[docker-isolation]]——特权容器基本等于节点 root，hostPID 能看到并操作节点上所有进程。
- **指定调度到某节点、用节点的身份**：Pod 跑在节点上，能访问该节点 kubelet 可及的资源、云元数据地址（拿节点的云角色凭据）。
- **借别的 ServiceAccount 起 Pod**：如果能指定 `serviceAccountName` 为一个高权限 SA，新 Pod 就带着那个 SA 的 token，相当于间接获得了它的权限。

所以在威胁建模里，`create pods` 被视为**接近 root-on-node**的权限。这也解释了两件事：为什么 [[k8s-hardening]] 要用 Pod Security Admission 从准入层禁止 hostPath/privileged 这类字段（光靠 RBAC 不够）；为什么给应用 SA 授权时，`create pods` 这种动词绝不能随手给——MyNotes 这样的业务服务，根本不需要对集群 API 有任何写权限。

### 4. kubectl auth can-i 审计权限

`kubectl auth can-i` 是你最常用的 RBAC 审计工具，它直接问 API Server“这个身份能不能做这件事”，返回 `yes`/`no`。

基本用法（问“我自己”能不能）：

```
$ kubectl auth can-i create pods -n mynotes
yes
$ kubectl auth can-i get secrets -n mynotes
no
```

审计**别的身份**（关键：加 `--as` 冒充，需要你自己有 impersonate 权限，管理员通常有）：

```
# 问某个 ServiceAccount 能不能做某事
$ kubectl auth can-i list secrets -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
no
```

`--as=system:serviceaccount:<命名空间>:<SA名>` 是 ServiceAccount 的规范身份写法，务必记住。

列出一个身份的**全部**权限，一次看清：

```
$ kubectl auth can-i --list -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
Resources        Non-Resource URLs   Resource Names   Verbs
selfsubjectreviews.authorization.k8s.io   []   []   [create]
...                                       (只剩系统默认的自省权限, 说明它几乎没权限)
```

审计一个集群时，最该跑的几条“红线检查”：

```
$ kubectl auth can-i '*' '*' --all-namespaces --as=system:serviceaccount:mynotes:default
$ kubectl auth can-i create pods -n kube-system --as=...
$ kubectl auth can-i list secrets --all-namespaces --as=...
```

任何一个应用 SA 对这些返回 `yes`，都是需要立刻整改的信号。配合 `kubectl get rolebinding,clusterrolebinding -A` 看谁绑了什么，就能快速定位过度授权。

### 5. 为每个应用使用独立 ServiceAccount，关闭不需要的 Token 自动挂载

三条原则，直接决定了下面的实践：

- **绝不用 `default` SA 承载业务**：default 在每个命名空间都存在、被容易误绑权限，且多个应用共用它会让权限无法收敛。给每个应用建自己的 SA，在 Pod 的 `spec.serviceAccountName` 指定它。
- **最小权限**：先给零权限，跑起来看缺什么再逐条加。MyNotes 是普通 Web 服务，不调用 K8s API，所以它需要的集群权限是**零**——一条 Role 都不用给。
- **不需要 token 就别挂**：`automountServiceAccountToken: false`。这样 Pod 里根本不出现 `/var/run/secrets/.../token`，上一课那条“偷 token”的攻击链直接断掉。既写在 SA 上（默认对用它的 Pod 生效），也可在 Pod spec 上覆盖。

## 动手实践

:::warn 声明
本系列里的攻击手法只用于你自己的环境或获得授权的目标。
:::

### 实践 1：给 MyNotes 创建最小权限 ServiceAccount，并用 can-i 验证

沿用上一课的集群和 `mynotes` 命名空间。新建 `k8s/mynotes-sa.yaml`：

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: mynotes-sa
  namespace: mynotes
automountServiceAccountToken: false    # 默认不给用它的 Pod 挂 token
```

MyNotes 不需要任何集群权限，所以这里**不创建任何 Role/RoleBinding**——这本身就是最小权限。把 Deployment 改成用这个 SA（在上一课 `k8s/mynotes.yaml` 的 Pod `spec` 里加两行）：

```yaml
    spec:
      serviceAccountName: mynotes-sa
      automountServiceAccountToken: false   # Pod 级再显式声明一次, 双保险
      containers:
        - name: mynotes
          ...
```

应用并验证 token 真的消失了：

```
$ kubectl apply -f k8s/mynotes-sa.yaml
$ kubectl apply -f k8s/mynotes.yaml
$ kubectl -n mynotes rollout status deploy/mynotes
deployment "mynotes" successfully rolled out
$ kubectl -n mynotes exec deploy/mynotes -- \
    ls /var/run/secrets/kubernetes.io/serviceaccount/ 2>&1
ls: cannot access '/var/run/secrets/kubernetes.io/serviceaccount/': No such file or directory
```

对比上一课那次能列出 `token`、`ca.crt`、`namespace`，现在整个目录都不存在了——攻击者拿下容器也偷不到集群身份。

再用 `can-i` 确认这个 SA“什么都干不了”：

```
$ kubectl auth can-i list secrets -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
no
$ kubectl auth can-i create pods -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
no
$ kubectl auth can-i --list -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
Resources                                  Verbs
selfsubjectreviews.authorization.k8s.io    [create]
selfsubjectrulesreviews.authorization...   [create]
```

怎么读：两个 `no` 说明它读不了 Secret、建不了 Pod；`--list` 只剩下“查询我自己权限”这类系统自省权限，等于零业务权限。这就是最小权限的样子。

**加分实验：如果某天 MyNotes 真需要读自己命名空间的一个 ConfigMap**，才按需加一条最小 Role（只读、只针对那个对象）：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata: { name: mynotes-read-config, namespace: mynotes }
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    resourceNames: ["mynotes-config"]   # 只这一个, 不是所有 configmap
    verbs: ["get"]                       # 只读, 不给 list/watch/write
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata: { name: mynotes-read-config, namespace: mynotes }
subjects:
  - kind: ServiceAccount
    name: mynotes-sa
    namespace: mynotes
roleRef:
  kind: Role
  name: mynotes-read-config
  apiGroup: rbac.authorization.k8s.io
```

绑定后再验证，能看到权限精确地只多了这一项：

```
$ kubectl auth can-i get configmap mynotes-config -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
yes
$ kubectl auth can-i list configmaps -n mynotes \
    --as=system:serviceaccount:mynotes:mynotes-sa
no
```

`get` 具体那个对象是 `yes`，`list`（列出全部）是 `no`——`resourceNames` 把权限收到了单个对象，这就是最小权限的手感。注意需要挂 token 时要把 `automountServiceAccountToken` 打开（或只在该 Pod 上开）。

### 实践 2：完成 Kubernetes Goat 中与 RBAC 相关的场景

[Kubernetes Goat](https://madhuakula.com/kubernetes-goat/) 是一个故意留洞的 K8s 靶场，按官方文档在你自己的集群里部署后，专门做和 RBAC / ServiceAccount 相关的关卡（如“容器里读取挂载的 SA token 并用它访问 API”“利用过大权限的 SA 列 Secret / 创建 Pod”一类场景；关卡编号和名称以你部署的版本为准，我不臆造）。练习时把这条链走一遍，正好复盘本课：

```
# 1. 在被攻破的 Pod 里拿到 token(若该 Pod 挂了 token)
$ TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
$ APISERVER=https://kubernetes.default.svc
$ CA=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
# 2. 用它问自己能干什么
$ curl -s --cacert $CA -H "Authorization: Bearer $TOKEN" \
    $APISERVER/api/v1/namespaces/<ns>/secrets | head
```

如果这个 SA 权限过大，第 2 步就能列出 Secret（拿到密码）；如果它被绑了 `create pods`，就能 POST 一个挂 `hostPath: /` 的 Pod 落到节点。做完你会对“为什么要关 token、为什么要最小权限”有肌肉记忆。练完记得清理靶场，别把带洞环境留着。

## 攻击者视角

拿下一个 Pod 后，攻击者围绕 RBAC 的标准流程：

- **拿 token 探权限**：读 `/var/run/secrets/.../token`，用它（或用你偷到的 kubeconfig）跑 `kubectl auth can-i --list`，一次看清这张身份能干什么。
- **顺权限扩大**：能 `list secrets` → 拖走所有密码，从中可能拿到别的 SA token、云凭据、数据库口令，再横向移动。能 `pods/exec` → 进权限更高的 Pod。能 `create pods` → 造特权/hostPath Pod 拿节点。
- **找提权原语**：专门找 `escalate`、`bind`、`impersonate`、通配符 `*`——这些能让攻击者把自己提到 cluster-admin。一个绑了 `bind` + 存在 cluster-admin ClusterRole 的普通 SA，就是一条完整提权链。
- **盯 default 和跨命名空间绑定**：很多事故源于给 default SA 或某个 SA 绑了 ClusterRoleBinding，攻击者拿下任意一个用它的 Pod 就获得全集群权限。
- **利用 automount**：如果目标 Pod 挂了 token（默认行为），偷取成本极低。这就是关掉自动挂载能显著抬高攻击门槛的原因。

## 防御与最佳实践

- **每应用一个独立 SA，最小权限起步**：先给零权限，缺什么按需加；绝不用 default 承载业务。
- **不需要就关 token 自动挂载**：`automountServiceAccountToken: false`，业务不调 API 时首选。
- **优先 Role + RoleBinding（命名空间级）**，尽量不用 ClusterRole/ClusterRoleBinding；确需集群角色时优先“ClusterRole + 各命名空间 RoleBinding”而非 ClusterRoleBinding。
- **精确到动词和对象**：只给需要的 verbs（读就别给 write/list），用 `resourceNames` 收到具体对象；避免 `*`。
- **重点看守危险权限**：secrets 的 get/list、pods/exec、create pods、escalate/bind/impersonate。授予前问“真的需要吗”。
- **定期审计**：`kubectl auth can-i --list --as=...` 巡检各 SA；`kubectl get clusterrolebinding -A` 找危险的集群级绑定；把红线检查（能否 list secrets / create pods / `*` `*`）做成 CI 或定时任务。
- **绝不把 cluster-admin 绑给应用 SA**；人也用最小角色 + 短期证书/OIDC，避免长期 kubeconfig 到处传。
- **RBAC 只是授权层**：它管不住“Pod 里能写什么危险字段”（hostPath、privileged），那要靠准入层的 Pod Security（下一课）。两层要一起上。

## 常见误区

- **“RBAC 里可以写 deny 规则来收权。”** 不能。RBAC 只有 allow、默认拒绝、纯累加。收权靠不授予或删绑定，不是写 deny。
- **“给 default SA 绑权限最省事。”** 这会让该命名空间所有用 default 的 Pod 都继承，权限失控。每应用独立 SA。
- **“能 create pods 只是能起容器，没什么。”** 它能起挂 hostPath/特权/hostPID 的 Pod，几乎等于拿节点 root。属于最高危权限之一。
- **“只给了 get/list secrets，只读而已很安全。”** 读到密码就是最严重的泄露之一，等于交出该范围所有凭据。
- **“RoleBinding 只能绑 Role。”** RoleBinding 也能绑 ClusterRole，把集群角色限定到某命名空间使用，这是常见且推荐的复用方式。
- **“配了严格 RBAC 就不用管 Pod 加固了。”** RBAC 管 API 授权，管不了 Pod spec 的危险字段和东西向网络，Pod Security + NetworkPolicy 是另一层（下一课）。
- **“ServiceAccount 就是用户。”** K8s 无内建 User 对象；SA 是程序身份，人由证书/OIDC 表示。审计冒充身份要用 `system:serviceaccount:ns:name` 格式。

## 自测

:::details 1. Role/ClusterRole 和 RoleBinding/ClusterRoleBinding 各是什么？四种组合分别用在哪？
Role/ClusterRole 定义权限（能对什么资源做什么动作），Role 是命名空间级、ClusterRole 是集群级。RoleBinding/ClusterRoleBinding 把权限授予主体，前者在单命名空间生效、后者全集群生效。组合：Role+RoleBinding 给某应用单命名空间最小权限（推荐）；ClusterRole+RoleBinding 把通用角色复用到某命名空间；ClusterRole+ClusterRoleBinding 授予全集群（仅集群组件/管理员）；Role 不能被 ClusterRoleBinding 引用。
:::

:::details 2. 为什么“能创建 Pod”几乎等价于“能拿到节点权限”？
因为 Pod spec 能写很多突破隔离的字段：hostPath 挂宿主机根目录直接读写节点文件（含 kubelet 凭据、其它容器数据），privileged/hostPID/hostNetwork 让容器接近节点 root、看到节点所有进程和网络，指定 serviceAccountName 借用高权限 SA，调度到节点后还能访问云元数据拿节点云凭据。所以只要能 create pods（或 Deployment/Job 等间接创建 Pod 的资源），攻击者就能造一个专门用来拿节点的 Pod。这也是 Pod Security 要从准入层禁这些字段的原因。
:::

:::details 3. 哪些是需要重点看守的危险权限？为什么？
get/list secrets（读到所有密码和 token）；pods/exec、pods/attach（进别人容器读其密钥/内存）；create pods（≈拿节点，见上）；escalate（绕过限制造出超过自己权限的角色）；bind（把高权限角色绑给自己）；impersonate（扮演管理员）；以及通配符 `*`。它们要么直接泄露凭据，要么能自我提权到接近 cluster-admin。
:::

:::details 4. 怎么用 kubectl auth can-i 审计一个 ServiceAccount 的权限？
用 `--as=system:serviceaccount:<命名空间>:<SA名>` 冒充该 SA 提问。例如 `kubectl auth can-i list secrets -n mynotes --as=system:serviceaccount:mynotes:mynotes-sa` 返回 yes/no；`kubectl auth can-i --list --as=...` 列出它的全部权限。审计集群时对每个应用 SA 跑红线检查：能否 `* *` all-namespaces、create pods、list secrets，返回 yes 即需整改。（冒充需要调用者自己有 impersonate 权限。）
:::

:::details 5. 为什么要给每个应用独立 SA 并关闭 token 自动挂载？MyNotes 该给什么权限？
独立 SA 让权限可收敛、可审计，避免共用 default 导致权限失控。关闭 automountServiceAccountToken 让 Pod 里不出现 token 文件，攻击者拿下容器也偷不到集群身份，直接切断“偷 token→打 API”的攻击链。MyNotes 是普通 Web 服务、不调用 K8s API，应给零集群权限（不建任何 Role/RoleBinding），并 automountServiceAccountToken: false。
:::

:::details 6. RBAC 能不能防住“Pod 里挂 hostPath、开 privileged”？
不能。RBAC 只做 API 层授权，管的是“能不能创建/修改某类对象”，管不了对象内容里的危险字段。要阻止 hostPath、privileged、hostPID 这类字段，需要准入控制层的 Pod Security Admission（按命名空间标签强制 baseline/restricted）。RBAC 限制“谁能创建 Pod”，Pod Security 限制“Pod 能长什么样”，两层配合。
:::

:::details 7. RBAC 里能写拒绝规则吗？多个绑定的权限如何合并？
不能写拒绝规则。RBAC 是默认拒绝 + 纯累加：没有规则允许就是不允许；一个主体的最终权限是它所有绑定所引用角色权限的并集。要收权只能不授予或删除绑定，没有 deny 来覆盖 allow。
:::

## 一句话总结

RBAC 是 API Server 的授权关：用 Role/ClusterRole 定义“能做什么”、用 RoleBinding/ClusterRoleBinding 定义“给谁”，默认拒绝、纯累加；给每个应用独立且最小权限的 ServiceAccount、关掉不需要的 token 挂载、用 `kubectl auth can-i` 持续审计危险权限（读 secrets、pods/exec、create pods、escalate/bind/impersonate），就能让“偷到 token 也几乎没用”——而 Pod 本身的加固，交给下一课 [[k8s-hardening]]。
