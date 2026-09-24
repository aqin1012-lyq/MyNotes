## 为什么要学

在机房时代，安全边界是防火墙：进了内网就基本“可信”。上了云之后，几乎所有资源都能通过公网 API 管理：只要拿着一对 AK/SK 调 API，就能删 OBS 桶、开 ECS、改安全组。所以云上最核心的安全边界是**身份**，而不是网络。谁（身份）能对什么（资源）做什么（操作）、在什么条件下，这就是 IAM（Identity and Access Management，华为云叫“统一身份认证”）要回答的问题。

你之前在项目里用过华为云 OBS，很可能写过类似 `ObsClient obsClient = new ObsClient(ak, sk, endpoint)` 的代码。那对 AK/SK 从哪来？权限有多大？是不是主账号的？放在 `application.yml` 里还是环境变量里？这些正是本课要系统解决的。它也承接 [[ss-authz]]（应用内的授权）和 [[k8s-rbac]]（集群内的授权）：思路完全一样，都是“主体 + 动作 + 资源 + 条件”，只是换到了云控制面上。

学完这一课，你应该能：读懂和编写华为云 / AWS 的 IAM 策略，按最小权限给应用分配权限；知道为什么应该用委托 / AssumeRole 拿临时凭证而不是长期 AK/SK；以及在 AK/SK 泄露时按流程应急。

:::tip 参考平台约定
本课以华为云为主、AWS 为概念参照。AWS 的策略语法我会写得很精确；华为云的具体 JSON 字段、action 名称、控制台路径以你操作时的官方文档为准（见资源链接“华为云：统一身份认证 IAM 文档”），文中标注了“请以官方文档确认”的地方务必自己核对。
:::

## 核心概念

### 1. 用户 / 用户组 / 角色 / 策略 / 委托（AssumeRole）

先把名词对齐。两家云的模型大同小异：

| 概念 | 华为云 | AWS | 说明 |
|---|---|---|---|
| 根身份 | 账号（主账号） | root user | 拥有一切权限，日常绝不使用，开 MFA 后锁起来 |
| 人或程序的长期身份 | IAM 用户 | IAM user | 可以有登录密码（控制台）和/或 AK/SK（API） |
| 身份的集合 | 用户组 | IAM group | 权限挂在组上，人进组即得权限，便于管理 |
| 权限声明 | 权限 / 策略（系统策略 + 自定义策略） | policy（AWS managed / customer managed / inline） | JSON 文档：Effect + Action + Resource + Condition |
| 可被“扮演”的身份 | 委托（agency） | IAM role + AssumeRole | 没有长期密钥，扮演后拿到**临时凭证** |

**策略**是核心。AWS 策略的结构（这是精确语法）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOrders",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::order-export/*"],
      "Condition": { "Bool": { "aws:SecureTransport": "true" } }
    }
  ]
}
```

华为云自定义策略的结构思路相同：`Version` + `Statement` 数组，每条有 `Effect`、`Action`、可选 `Resource` 和 `Condition`；action 名称形如 `服务:资源类型:操作`（例如 OBS 的 `obs:object:GetObject`）。具体版本号取值、Resource 的书写格式请以华为云 IAM 文档“自定义策略”一节为准。

**求值规则**（两家一致的核心思想）：默认拒绝 → 任何一条显式 `Deny` 命中则拒绝 → 否则有 `Allow` 命中才允许。所以“显式拒绝永远优先”，这和 Spring Security 的 `authorizeHttpRequests` 不同：那里是按规则顺序“第一条匹配的生效”，而云上的显式 Deny 与顺序无关，跨所有策略生效。

**委托 / AssumeRole** 是第二个核心。它解决的问题是：“某个主体需要临时获得一组权限，但不应该持有长期密钥”。典型场景：

- **ECS 上的应用访问 OBS**：给 ECS 绑定一个委托（AWS 叫给 EC2 挂 instance profile），应用通过实例元数据服务拿到临时 AK/SK + securitytoken，SDK 自动刷新。代码里不再出现任何密钥。
- **跨账号**：A 账号的运维要管理 B 账号的资源，B 创建一个委托给 A，A 的用户“切换角色”进入。
- **云服务代你操作**：比如某个云服务需要读你的 OBS，你给该服务创建委托。

AWS 的 AssumeRole 需要两份策略同时成立：角色的**信任策略**（trust policy，谁可以扮演我）和角色的**权限策略**（扮演后能做什么）。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
    "Action": "sts:AssumeRole",
    "Condition": { "Bool": { "aws:MultiFactorAuthPresent": "true" } }
  }]
}
```

华为云委托的“委托方账号 / 云服务”和“被授予的权限”分别对应信任策略与权限策略这两部分，创建委托时在控制台分两步填写。

```
  caller (user/ECS/service)
        |  1. AssumeRole / use agency
        v
  STS / IAM token service  ----> checks trust policy        信任策略：谁能扮演
        |  2. temp AK + SK + token (expires)
        v
  API call to OBS/S3  ----> checks permission policy        权限策略：能做什么
```

### 2. 最小权限策略编写与条件键

最小权限（least privilege）= 只给完成任务**必需**的动作、只作用在**必需**的资源上、只在**必需**的条件下生效。写策略时按四个维度逐一收紧：

| 维度 | 宽松写法（坏） | 收紧写法（好） |
|---|---|---|
| Action | `obs:*:*` / `s3:*` | 只列 `GetObject`、`ListBucket` 等具体操作 |
| Resource | `*` | 具体桶，甚至具体前缀 `bucket/reports/*` |
| Condition | 无 | 限定来源 IP / VPC、要求 HTTPS、要求 MFA |
| 主体 | 所有人共用一个 AK/SK | 每个应用、每个环境一个身份 |

**条件键**（Condition key）是把策略从“能不能”细化到“在什么情况下能”的工具。AWS 常用的全局条件键（精确名称）：

| 条件键 | 作用 | 典型用法 |
|---|---|---|
| `aws:SourceIp` | 请求来源公网 IP | 只允许公司出口 IP 调用 |
| `aws:SourceVpce` / `aws:SourceVpc` | 请求经过的 VPC 终端节点 / VPC | 数据只允许从内网访问 |
| `aws:SecureTransport` | 是否 HTTPS | 拒绝明文请求 |
| `aws:MultiFactorAuthPresent` | 是否用 MFA 登录 | 高危操作要求 MFA |
| `aws:RequestedRegion` | 目标区域 | 禁止在不用的区域开资源（防挖矿） |
| `aws:PrincipalTag/...` | 调用者身上的标签 | 基于属性的访问控制（ABAC） |
| `s3:prefix` | ListBucket 时的前缀 | 只能列出某个目录 |

一个常用的“护栏”写法：用显式 Deny + 条件，把整个账号的风险面压下去。

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "DenyNonHttps",
    "Effect": "Deny",
    "Action": "s3:*",
    "Resource": ["arn:aws:s3:::order-export", "arn:aws:s3:::order-export/*"],
    "Condition": { "Bool": { "aws:SecureTransport": "false" } }
  }]
}
```

华为云 IAM 自定义策略同样支持 Condition，也有 `g:` 前缀的全局条件键（如与来源 IP、MFA 相关的键）以及各服务自己的条件键。可用的条件键名称和运算符请在 IAM 文档的“策略语法 / 条件键”部分查证后使用，不要照抄 AWS 的键名。

:::warn 写策略的两个坑
1. S3 / OBS 的“桶”和“桶里的对象”是两类资源：`ListBucket` 作用在桶上，`GetObject` 作用在对象（`bucket/*`）上。只写一个 Resource，另一个操作就会被拒绝，初学者常在这里卡半天。
2. 不要为了“先跑起来”给 `*`，以后几乎没人会回来收紧。先给窄的，报错了看拒绝的是哪个 action，再精准补上。
:::

### 3. 临时凭证 vs 长期 AK/SK，泄露应急流程

| | 长期 AK/SK | 临时凭证（委托 / STS） |
|---|---|---|
| 有效期 | 直到手动删除 | 分钟到小时级，自动过期 |
| 组成 | AK + SK | AK + SK + securitytoken（AWS 叫 session token） |
| 存放 | 容易被写进配置文件、镜像、Git | 运行时从元数据服务 / STS 获取，SDK 自动刷新 |
| 泄露影响 | 攻击者可长期使用 | 窗口有限，过期即失效 |
| 适用 | 云外的系统（本地 CI、自建机房）且无法联邦时 | 云内一切负载、人员登录 |

原则：**人用 SSO / 控制台 + MFA，程序用委托**；只有实在跑在云外、又没有联邦身份能力的程序，才发长期 AK/SK，并且单独用户、最小权限、定期轮换。

在 Java 里，好的写法是让 SDK 从环境获取凭证，而不是在代码里 `new ObsClient(ak, sk, ...)`。华为云 OBS Java SDK 提供了从环境变量、从 ECS 元数据获取凭证的 provider 类，具体类名请以 OBS Java SDK 文档为准；AWS SDK v2 的对应物是默认凭证链 `DefaultCredentialsProvider`，它会依次尝试环境变量、配置文件、容器 / 实例元数据。

**AK/SK 泄露应急流程**（发现 GitHub 告警或 CTS 里出现异常调用时）：

1. **遏制**：立即在 IAM 中**停用**该 AK（先停用、不要先删除，保留证据），同时给该用户挂一条全拒绝策略。
2. **替换**：生成新 AK/SK，更新到应用的密钥存储（见 [[cloud-secrets]]），滚动重启，确认业务恢复。
3. **取证**：在 CTS（AWS 为 CloudTrail）中按该 AK 过滤泄露时间点之后的所有调用：谁、从哪个 IP、调了什么。
4. **清理**：删除攻击者可能创建的东西：新 IAM 用户、新 AK、新委托、各区域的 ECS（挖矿）、被修改的桶策略、安全组规则。
5. **根除**：从 Git 历史中清除密钥（注意：仓库已公开过，就必须假设已被拿走，清历史不能替代轮换）。
6. **复盘**：为什么会泄露？为什么是长期密钥？为什么权限这么大？落实改进。

### 4. 云上共享责任模型

一句话：**云厂商负责“云本身”的安全，你负责“云里面”的安全**。边界随服务形态移动：

```
                 IaaS (ECS)     PaaS (RDS)     SaaS / OBS
data & access    customer       customer       customer          数据与访问控制永远是你
application      customer       customer       provider
OS / patch       customer       provider       provider
network config   customer       shared         provider
physical / hw    provider       provider       provider
```

实际事故里，大量云上数据泄露都在“customer”那一栏：桶设成公开读、AK/SK 进了 Git、安全组 0.0.0.0/0 开 22 和 3306、IAM 给了 `*`。云厂商的物理机房再安全，也挡不住你亲手把门打开。

## 动手实践

### 练习：为 OBS 创建一个“只读某个桶”的最小权限策略

目标：应用 `report-service` 只能读取桶 `order-export` 下 `reports/` 前缀的对象，不能写、不能删、不能看其他桶。

**第 1 步：建身份。** 在 IAM 控制台创建用户组 `report-readers`，创建 IAM 用户 `report-service`，访问方式只勾选“编程访问”（不要控制台密码），加入该组。如果应用跑在华为云 ECS 上，更好的做法是创建一个委托并绑定到 ECS，跳过 AK/SK。

**第 2 步：写自定义策略。** 华为云 IAM 自定义策略大致如下（**以下 JSON 的 `Version` 取值、Resource 格式和 action 名称请以华为云 IAM / OBS 文档中“OBS 自定义策略”示例为准后再使用**）：

```json
{
  "Version": "1.1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["obs:bucket:ListBucket"],
      "Resource": ["OBS:*:*:bucket:order-export"]
    },
    {
      "Effect": "Allow",
      "Action": ["obs:object:GetObject"],
      "Resource": ["OBS:*:*:object:order-export/reports/*"]
    }
  ]
}
```

同样意图的 AWS 版本（精确语法），可以对照理解每一行：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOnlyReportsPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::order-export",
      "Condition": { "StringLike": { "s3:prefix": ["reports/*"] } }
    },
    {
      "Sid": "ReadReports",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::order-export/reports/*"
    }
  ]
}
```

**第 3 步：授权。** 把策略授权给用户组 `report-readers`。注意 OBS 是全局级服务还是区域级服务在授权范围上的差异，控制台会提示；按提示选择。

**第 4 步：验证。** 用华为云的 OBS 命令行工具 obsutil（参数格式以 obsutil 文档为准）配置该用户的 AK/SK，然后分别做“应该成功”和“应该失败”的操作：

```bash
obsutil config -i=<AK> -k=<SK> -e=obs.cn-north-4.myhuaweicloud.com
obsutil ls obs://order-export/reports/
obsutil cp obs://order-export/reports/2028-01.csv ./
obsutil cp ./x.txt obs://order-export/reports/x.txt
obsutil ls obs://other-bucket
```

预期结果（输出为示意，具体格式以你的 obsutil 版本为准）：

```
ls  obs://order-export/reports/   -> lists objects, OK
cp  download 2028-01.csv          -> succeed
cp  upload x.txt                  -> 403 AccessDenied
ls  obs://other-bucket            -> 403 AccessDenied
```

**如何解读**：两个 403 正是我们想要的，说明写权限和其他桶都被默认拒绝挡住了。如果第一条 `ls` 就 403，多半是漏了桶级别的 `ListBucket`，或者 Resource 写成了对象格式；如果下载 403，检查对象 Resource 的前缀是否和实际路径一致。每次策略修改后可能有短暂的生效延迟，稍等再试。

:::tip 桶策略 vs IAM 策略
OBS 还有**桶策略**（挂在桶上，写“谁能访问我”），IAM 策略挂在人身上（写“我能访问什么”）。在 AWS 中，同账号内两者任一允许、且任何一处都没有显式拒绝，即可访问；OBS 中二者如何组合生效请以 OBS 权限控制文档为准。本练习用 IAM 策略；[[cloud-huawei]] 会专门练桶策略与公开桶。
:::

## 攻击者视角

> 本课的攻击手法只用于你自己的云账号或已获授权的目标。

**问题：GitHub 上泄露一对 AK/SK，攻击者最先会做什么？**

公开仓库会被自动化程序持续扫描，密钥推上去后可能很快就被发现并利用。拿到密钥后的典型顺序：

1. **确认身份和权限**（不产生资源、动静小）。AWS 上第一条命令几乎总是：

```bash
aws sts get-caller-identity
```

```json
{
    "UserId": "AIDAEXAMPLEEXAMPLE",
    "Account": "111122223333",
    "Arn": "arn:aws:iam::111122223333:user/ci-deploy"
}
```

从 `Arn` 就知道这是哪个账号的哪个用户。接着尝试列策略（`aws iam list-attached-user-policies --user-name ci-deploy`）或直接挨个试探 API，看哪些能成功。华为云上思路相同：调用 IAM / OBS 等 API 看哪些返回成功。

2. **直接变现**：列出所有桶并下载数据（用户数据、订单导出、备份）；在所有区域开大规格实例挖矿（这也是为什么要用条件键限制区域）。
3. **持久化**：新建 IAM 用户、给现有用户再创建一对 AK、新建委托 / 角色信任攻击者自己的账号。这样即使你删掉泄露的那对 AK，攻击者仍在。
4. **扩大权限**：如果有 `iam:*` 或能修改策略、能把角色传给计算资源（AWS 的 `iam:PassRole`），就可以把自己升到管理员。
5. **抹痕迹**：有权限的话关闭或删除审计跟踪（CloudTrail / CTS 追踪器）。

另一条常见路径和你做过的 [[web-ssrf]]（Lab 05）直接相关：应用存在 SSRF 且跑在绑定了委托的云主机上，攻击者让服务器去请求实例元数据地址 `169.254.169.254`，读出临时 AK/SK/token。这就是“委托虽然好，但仍要防 SSRF”的原因。AWS 的 IMDSv2 要求先 PUT 拿会话 token 才能读元数据，专门用来削弱这类 SSRF；华为云元数据服务的对应防护能力请查 ECS 文档。

## 防御与最佳实践

- **根账号**：开 MFA，不创建 AK/SK，只用于极少数必须根账号的操作。
- **人**：每人一个 IAM 用户（或通过 SSO 联邦登录），加入用户组拿权限，强制 MFA，高危操作用条件键要求 MFA。
- **程序**：云内负载一律用委托（ECS 委托 / 云服务委托），代码里不出现 AK/SK；云外程序单独 IAM 用户、仅编程访问、最小权限、定期轮换。
- **策略**：禁止 `*:*`；按服务 + 资源 + 前缀收紧；用显式 Deny 做护栏（要求 HTTPS、限制区域、禁止关闭审计）。
- **检测**：开启 CTS 并把日志转存到单独的、权限受限的 OBS 桶；对“创建 AK”“创建用户”“修改策略”“关闭追踪器”等事件告警（见 [[cloud-detect]]）。
- **预防泄露**：pre-commit 和 CI 中跑 gitleaks（见 [[cloud-secrets]]）；`.gitignore` 忽略本地配置；Spring Boot 从环境变量或密钥服务读取凭证。
- **定期审查**：找出长期未使用的用户和 AK，停用；找出权限过大的策略，收紧。

在 Spring Boot 里，不要这样：

```yaml
huawei:
  obs:
    ak: HPUAXXXXXXXXXXXXXXXX
    sk: abcdEXAMPLEsecretkey
```

改成只引用环境变量（或 [[cloud-secrets]] 里讲的密钥服务），跑在 ECS 上时则完全不配置 AK/SK，交给委托：

```yaml
huawei:
  obs:
    endpoint: https://obs.cn-north-4.myhuaweicloud.com
    ak: ${OBS_AK:}
    sk: ${OBS_SK:}
```

## 常见误区

- **“内网部署就不用管 IAM”**：云 API 是公网可达的，AK/SK 在哪里被用都一样有效（除非你用条件键限制了来源）。
- **“给个管理员权限先跑起来”**：临时的权限通常会永久存在。
- **“删了 Git 提交就安全了”**：fork、克隆、缓存、扫描器早已拿走，必须轮换。
- **“用委托就绝对安全”**：SSRF、容器逃逸、应用 RCE 都能拿到实例上的临时凭证，只是窗口变短。
- **“所有服务共用一个 AK 方便”**：一处泄露全盘皆失，审计时也分不清是谁干的。
- **“云厂商负责安全”**：共享责任模型下，配置错误永远是客户的责任。

## 自测

:::details 1. IAM 策略求值时，Allow 和 Deny 同时命中，结果是什么？没有任何策略命中呢？
显式 Deny 优先，结果是拒绝。没有任何策略命中时是默认拒绝（隐式拒绝）。只有“至少一条 Allow 命中、且没有任何 Deny 命中”才允许。
:::

:::details 2. 委托 / AssumeRole 相比给应用发 AK/SK，好在哪里？
委托不持有长期密钥，扮演后拿到的是会过期的临时 AK/SK + token，由 SDK 自动获取和刷新，代码、配置、镜像里都不需要出现密钥；泄露的影响窗口很短。另外权限挂在委托上，统一管理、易审计。
:::

:::details 3. 为 OBS 写只读某个桶的策略时，为什么需要两条 Statement？
因为桶和对象是两类资源：列出对象（ListBucket）作用在桶上，读取对象（GetObject）作用在 `bucket/*` 对象上。只写一种 Resource，另一个操作会被拒绝。
:::

:::details 4. GitHub 上泄露一对 AK/SK，攻击者最先会做什么？你应该最先做什么？
攻击者先确认身份和权限（如 AWS 的 `sts get-caller-identity`、试探各类 API），然后下载数据、开机器挖矿、创建新用户 / 新 AK / 新委托做持久化。你应该最先停用该 AK（遏制），再替换凭证、用 CTS 取证、清理攻击者创建的资源和后门身份，最后复盘。
:::

:::details 5. 列举三个常用的条件键用法。
限制来源 IP 或 VPC（数据只能从内网访问）；要求 HTTPS（`aws:SecureTransport`）；要求 MFA（`aws:MultiFactorAuthPresent`）；限制区域（`aws:RequestedRegion`）防止在不用的区域开资源。华为云有对应的全局条件键，名称以文档为准。
:::

:::details 6. 在共享责任模型下，使用 OBS 时哪些安全事项属于你？
数据本身、谁能访问（IAM 策略、桶策略、ACL、是否公开）、是否加密、访问凭证的管理、访问日志与审计的开启。云厂商负责存储基础设施、物理与硬件、服务本身的可用性和安全。
:::

:::details 7. 应用跑在 ECS 上并已使用委托，为什么还要重视 SSRF？
因为委托的临时凭证是从实例元数据服务（169.254.169.254）获取的，SSRF 能让服务器替攻击者请求这个地址，从而拿到临时 AK/SK/token。防御要结合 SSRF 过滤（见 Lab 05）、元数据服务加固和委托最小权限。
:::

## 一句话总结

云上身份就是边界：人用 MFA、程序用委托、策略按最小权限加条件键收紧，长期 AK/SK 能不用就不用，泄露时先停用再取证。
