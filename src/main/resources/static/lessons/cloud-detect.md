## 为什么要学

前面几课都在讲“怎么防”：IAM 最小权限、密钥进 KMS、服务间 mTLS。但任何防御都会有漏洞：一个没发现的 SSRF、一个同事误传到 GitHub 的 AK/SK、一个 0day。安全的另一半是**“防不住的时候要能看得见”**：入侵发生后多久能发现？能不能说清攻击者做了什么、拿走了什么？能不能在他扩大战果前把他踢出去？

对 Java 后端来说，这一课和你的日常工作直接相关：你写的每一行 `log.info` 都可能成为将来还原入侵的证据，也可能因为打印了密码和 token 成为新的泄露源。你熟悉的 ELK、Prometheus 告警，换个视角就是安全监控的基础设施。

学完这一课，你能：说出华为云 CTS / AWS CloudTrail 记录了什么、没记录什么；为自己的 Spring Boot 项目设计一份安全审计日志规范；把日志送进 Elastic 并写一条检测规则；用 MITRE ATT&CK 的语言描述云上攻击；按标准流程处置一次安全事件。

:::tip 版本约定
Spring Boot 结构化日志（`logging.structured.format`）需要 Spring Boot 3.4 及以上；Elastic 相关示例基于 8.x。华为云 CTS 的控制台路径、字段名与保留期限请以资源中的 CTS 文档为准；AWS CloudTrail 的事件结构我按其官方格式给出，便于对照。
:::

## 核心概念

### 1. 云审计服务（华为云 CTS / AWS CloudTrail）记录什么

云审计服务记录的是**对云资源的 API 调用**（控制台操作本质上也是 API 调用）。每条记录回答五个问题：**谁**（哪个账号、IAM 用户、委托、AK）、**什么时候**、**从哪里**（源 IP、User-Agent）、**做了什么**（服务、操作名、请求参数）、**结果如何**（成功 / 失败及错误码）。

一条 AWS CloudTrail 事件（精简，结构与字段名是 CloudTrail 的真实格式）：

```json
{
  "eventVersion": "1.08",
  "userIdentity": {
    "type": "IAMUser",
    "arn": "arn:aws:iam::111122223333:user/ci-deploy",
    "accountId": "111122223333",
    "accessKeyId": "AKIAEXAMPLEEXAMPLE",
    "userName": "ci-deploy"
  },
  "eventTime": "2028-04-02T03:14:07Z",
  "eventSource": "iam.amazonaws.com",
  "eventName": "CreateAccessKey",
  "awsRegion": "us-east-1",
  "sourceIPAddress": "203.0.113.50",
  "userAgent": "aws-cli/2.x",
  "requestParameters": { "userName": "backup-admin" }
}
```

**怎么读**：CI 专用的 `ci-deploy` 用户，凌晨 3 点从一个陌生 IP，用 CLI 给另一个用户 `backup-admin` 创建了新 AK。这是典型的持久化行为，应该立即告警。

CTS 的事件内容本质相同（操作用户、事件源、操作名、源 IP、资源、结果），通过**追踪器**配置记录范围和转储。需要理解的几个关键点：

| 关注点 | 说明 |
|---|---|
| 管理事件 vs 数据事件 | 管理事件：创建 / 删除 / 修改资源（建桶、改桶策略、建用户、改安全组）。数据事件：资源内部的数据操作（读写 OBS 对象）。数据事件量大，通常需要单独开启，CTS 中对应数据类追踪器 |
| 保留期 | 控制台可直接查询的时间有限（AWS 事件历史为 90 天；CTS 的期限以文档为准），长期保存必须转储到 OBS / S3 |
| 转储桶的保护 | 日志桶应放在权限最小的位置（最好是独立的安全审计账号），开启防删除 / 版本控制，普通管理员不能删 |
| **不记录**的内容 | 你的应用内部发生了什么（谁登录了商城、谁导出了订单）、ECS 主机上执行的命令、网络流量内容。这些需要应用日志、主机安全（HSS）、VPC 流日志来补 |

### 2. 集中日志与关联分析（SIEM）

单独一份日志很难看出攻击，**关联**才能：

```
 sources                           SIEM                              output
 ---------------------------       ------------------------------   -----------------
 CTS / CloudTrail          ---+    collect -> normalize (ECS) ->     alert -> IM/phone   告警
 VPC flow logs             ---+    store  -> correlate  -> rules     dashboard           看板
 WAF / CFW logs            ---+                                      hunting (query)     狩猎
 HSS host alerts           ---+
 Nginx / app audit logs    ---+
 DB audit / EMQX logs      ---+
```

**SIEM**（Security Information and Event Management）做四件事：**收集**（各种来源）、**规范化**（统一字段名，比如 Elastic 的 ECS：`source.ip`、`user.name`、`event.action`、`event.outcome`）、**关联检测**（规则跨数据源匹配）、**告警与调查**。例子：“WAF 记录到某 IP 的 SQL 注入尝试”+“同一 IP 在应用日志里登录成功”+“随后该用户导出了 5 万条订单”，单看每条都不致命，串起来就是一次成功入侵。

常见选择：Elastic Security、Splunk、Microsoft Sentinel、开源的 Wazuh，以及各云厂商自己的安全运营中心类产品。

### 3. MITRE ATT&CK 云矩阵：攻击者在云上的常见行为

MITRE ATT&CK 是按“战术（为什么做）→ 技术（怎么做）”整理的攻击行为知识库，Cloud 矩阵覆盖 IaaS、SaaS、身份提供商等平台。它的价值是给检测规则一个**共同语言**：每条告警标上对应技术编号，就能看出自己的检测覆盖了攻击链的哪些环节、哪里是盲区。

把 [[cloud-iam]] 里“AK/SK 泄露”的剧本映射到 ATT&CK：

| 战术 | 技术（编号） | 云上的样子 | 在哪能看到 |
|---|---|---|---|
| 初始访问 | Valid Accounts: Cloud Accounts（T1078.004） | 用泄露的 AK/SK 或被盗的控制台密码登录 | CTS：陌生 IP / 陌生 UA 的调用 |
| 凭证访问 | Unsecured Credentials: Cloud Instance Metadata API（T1552.005） | 经 SSRF 读取元数据服务拿临时凭证 | 应用 / WAF 日志中访问 169.254.169.254 |
| 发现 | Cloud Infrastructure Discovery（T1580）、Cloud Service Discovery（T1526） | 大量 List / Describe 调用 | CTS：短时间大量只读 API，特别是大量失败 |
| 持久化 | Account Manipulation: Additional Cloud Credentials（T1098.001）、Create Account: Cloud Account（T1136.003） | 给用户加 AK、新建 IAM 用户 / 委托 | CTS：创建 AK、创建用户、修改委托信任 |
| 防御规避 | Impair Defenses: Disable or Modify Cloud Logs（T1562.008） | 停用 / 删除追踪器，删日志桶 | CTS：追踪器变更（要高优先级告警） |
| 收集 | Data from Cloud Storage（T1530） | 批量下载 OBS 对象 | OBS 数据事件、访问日志 |
| 渗出 | Transfer Data to Cloud Account（T1537） | 把快照 / 镜像共享给攻击者的账号 | CTS：共享 / 复制类操作 |
| 影响 | Resource Hijacking（T1496） | 各区域开大规格实例挖矿 | CTS + 账单异常 |

### 4. 安全事件响应流程：发现 → 遏制 → 根除 → 恢复 → 复盘

NIST SP 800-61 是事件响应的经典参考。Rev. 2 把生命周期分为“准备、检测与分析、遏制根除与恢复、事后活动”；Rev. 3 改为对齐 NIST CSF 2.0 的功能来组织。无论哪个版本，落到实操上都是下面这条主线，并且**准备**（有日志、有联系人、有预案、有演练）是一切的前提：

| 阶段 | 目标 | 以“AK/SK 泄露 + 挖矿”为例 |
|---|---|---|
| 发现 | 确认是真实事件，判断范围与严重度 | 告警：`ci-deploy` 在不常用区域创建了 20 台实例；账单突增 |
| 遏制 | 阻止继续扩大，同时保留证据 | 停用该 AK、给该用户挂全拒绝策略；隔离可疑实例（安全组全拒绝），先做快照再处理 |
| 根除 | 清除攻击者的一切立足点 | 删除攻击者创建的用户、AK、委托、实例；修复泄露源（Git 中的密钥、SSRF 漏洞） |
| 恢复 | 安全地恢复业务并加强监控 | 用新凭据重新部署；观察一段时间有无复现 |
| 复盘 | 找根因、改流程，不追责个人 | 为什么是长期 AK？为什么权限包含创建实例？为什么没有区域限制？输出改进项并跟踪 |

一个常犯的错误是**先删后查**：慌乱中直接删掉实例和用户，结果证据没了，也说不清攻击者还动了什么。遏制优先用“停用、隔离、拒绝”，而不是“删除”。

## 动手实践

### 练习：设计安全审计日志规范，接入 Elastic 并做一条告警规则

**第 1 步：写规范。** 审计日志（audit log）和调试日志不同：它是给安全和合规看的，要求字段固定、不可随意删改、长期保留。一份最小规范：

| 要素 | 规范 |
|---|---|
| 记录哪些事件 | 登录成功 / 失败、登出、改密码、MFA 变更；权限 / 角色变更；敏感数据访问与导出（订单导出、用户信息查询）；管理后台操作；授权失败（403）；配置与密钥变更 |
| 必填字段（ECS 命名） | `@timestamp`（UTC）、`event.action`、`event.outcome`（success / failure）、`user.id`、`source.ip`、`user_agent.original`、`trace.id`、`url.path`、`service.name` |
| 可选字段 | `event.reason`（失败原因）、`resource.type` / `resource.id`（操作对象）、`http.response.status_code` |
| 绝不记录 | 密码、token、Cookie、AK/SK、完整身份证 / 银行卡号（必要时脱敏） |
| 存储与保留 | JSON 单行，写独立文件或独立 logger；采集到 SIEM；保留期按合规要求确定；应用服务器上的账号不能删除 SIEM 中的日志 |
| 时间 | 所有服务器 NTP 同步，统一 UTC，否则跨系统关联会错位 |

**第 2 步：在 Spring Boot 中输出结构化审计日志。** Spring Boot 3.4+ 内置结构化日志，支持 ECS 格式：

```yaml
spring:
  application:
    name: order-service
logging:
  file:
    name: logs/order-service.json
  structured:
    format:
      file: ecs
```

监听 Spring Security 的认证事件（Spring Boot 会自动配置 `AuthenticationEventPublisher`，登录成功 / 失败时发布事件）：

```java
package com.aqin.order.audit;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.context.event.EventListener;
import org.springframework.security.authentication.event.AbstractAuthenticationFailureEvent;
import org.springframework.security.authentication.event.AuthenticationSuccessEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

@Component
public class SecurityAuditListener {

    private static final Logger AUDIT = LoggerFactory.getLogger("security.audit");

    @EventListener
    public void onSuccess(AuthenticationSuccessEvent e) {
        audit("login", "success", e.getAuthentication().getName(), null);
    }

    @EventListener
    public void onFailure(AbstractAuthenticationFailureEvent e) {
        audit("login", "failure", e.getAuthentication().getName(),
                e.getException().getClass().getSimpleName());
    }

    private void audit(String action, String outcome, String user, String reason) {
        try {
            MDC.put("event.action", action);
            MDC.put("event.outcome", outcome);
            MDC.put("user.name", user);   // 用户名可以记，密码绝不能记
            if (reason != null) {
                MDC.put("event.reason", reason);
            }
            if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs) {
                HttpServletRequest req = attrs.getRequest();
                MDC.put("source.ip", req.getRemoteAddr()); // 在 Nginx 后面需正确配置 forward-headers-strategy
                MDC.put("user_agent.original", String.valueOf(req.getHeader("User-Agent")));
            }
            AUDIT.info("{} {}", action, outcome);
        } finally {
            MDC.remove("event.action");
            MDC.remove("event.outcome");
            MDC.remove("user.name");
            MDC.remove("event.reason");
            MDC.remove("source.ip");
            MDC.remove("user_agent.original");
        }
    }
}
```

故意输错几次密码后，`logs/order-service.json` 中会出现类似下面的一行（这里为了阅读折行显示；实际是单行，字段的具体展开方式随 Spring Boot 版本略有不同）：

```json
{"@timestamp":"2028-04-10T02:31:05.123Z","log.level":"INFO","service.name":"order-service",
 "log.logger":"security.audit","message":"login failure","event.action":"login",
 "event.outcome":"failure","user.name":"admin","event.reason":"BadCredentialsException",
 "source.ip":"203.0.113.9","user_agent.original":"python-requests/2.31","ecs.version":"8.11"}
```

**解读**：`user.name=admin` + `python-requests` 的 UA + 失败，是典型的脚本爆破特征。注意 `source.ip`：如果应用在 Nginx 之后而没配置 `server.forward-headers-strategy` 和可信代理，这里记到的永远是 Nginx 的地址，日志就失去了溯源价值；反过来，如果无条件信任 `X-Forwarded-For`，攻击者可以伪造 IP。

**第 3 步：采集进 Elasticsearch。** 按 Elastic 官方文档用 Docker 启动 8.x 的单节点 Elasticsearch + Kibana（保持安全功能开启，Kibana 的告警功能依赖它）。然后用 Filebeat 读取 JSON 日志文件（`filebeat.yml`，8.x 的 filestream 输入）：

```yaml
filebeat.inputs:
  - type: filestream
    id: order-service-audit
    paths:
      - /path/to/logs/order-service.json
    parsers:
      - ndjson:
          target: ""
          overwrite_keys: true

output.elasticsearch:
  hosts: ["https://localhost:9200"]
  username: "elastic"
  password: "${ES_PASSWORD}"
  ssl.certificate_authorities: ["/path/to/http_ca.crt"]
```

在 Kibana 的 Discover 里选中 Filebeat 的数据视图，搜索 `log.logger : "security.audit"`，能看到刚才的登录失败事件，并且 `event.outcome`、`source.ip` 已经是可以筛选的字段，说明解析成功。如果整条 JSON 都挤在 `message` 字段里，说明 ndjson 解析没生效。

**第 4 步：写检测规则“同一 IP 5 分钟内登录失败 ≥ 10 次”。** 先在 Discover 中用 ES|QL 验证查询逻辑：

```
FROM filebeat-*
| WHERE event.action == "login" AND event.outcome == "failure"
| STATS failures = COUNT(*), users = COUNT_DISTINCT(user.name) BY source.ip
| WHERE failures >= 10
| SORT failures DESC
```

用脚本对登录接口打 30 次错误密码后，结果类似：

```
failures | users | source.ip
---------+-------+-------------
30       | 1     | 203.0.113.9
```

**解读**：`users = 1` 表示对一个账号爆破；如果 `users` 很大而每个用户只失败一两次，那是**密码喷洒**（password spraying：用少量常见密码试大量账号），需要另一条按 IP 统计不同用户数的规则。

然后在 Kibana 的 Security → Rules 中新建检测规则，类型选 **Threshold**：查询 `event.action : "login" and event.outcome : "failure"`，Group by `source.ip`，阈值 10，每 5 分钟运行一次、回看 5 分钟，严重度 Medium，并在规则中标注 ATT&CK 技术 Brute Force（T1110）。触发后在 Alerts 页面可以看到告警；再配置一个动作（邮件 / Webhook 到企业微信、钉钉、飞书）。菜单名称在不同的 8.x 小版本中可能略有差异。

**第 5 步：为云审计也加一条。** 把 CTS 转储到 OBS 的日志也采集进来后，最值得优先配置的规则：追踪器被停用 / 删除、创建 AK、创建 IAM 用户、修改委托、修改 OBS 桶策略为公开、在非常用区域创建实例。

## 攻击者视角

> 本课涉及的攻击手法只用于你自己的环境或已获授权的目标。

攻击者非常清楚日志的价值，常见手法：

- **关闭或删除审计**：停用追踪器、删除日志桶、缩短保留期（ATT&CK T1562.008）。所以“追踪器变更”必须是最高优先级告警，日志桶最好在别的账号里。
- **在噪声中隐藏**：用正常的 User-Agent（伪装成 SDK / 浏览器）、低频慢速操作、在业务高峰期行动，避免触发阈值规则。
- **利用没有记录的地方**：CTS 默认不记录 OBS 对象级读取（数据事件需另开），应用层也可能没有导出审计，那么“批量下载数据”就无从查起。
- **日志注入**：如果应用把用户输入原样写进文本日志，攻击者可以在用户名里塞入换行符伪造一条假日志（`admin\n2028-04-10 INFO login success user=root`）。结构化 JSON 日志会把换行转义，天然缓解这个问题。
- **利用日志系统本身的漏洞**：Log4Shell 就是通过“被记录下来的字符串”触发 RCE（见 [[web-rce]]）。日志组件也要及时升级。

**问题：哪些日志一旦缺失，你就无法还原一次入侵？**

按攻击链倒推，每一环都需要对应证据：

| 要回答的问题 | 必需的日志 | 缺失的后果 |
|---|---|---|
| 攻击者从哪进来？ | WAF / Nginx 访问日志、应用认证日志、VPN / 堡垒机登录日志 | 找不到入口，漏洞修不掉，攻击者还能再来 |
| 用了谁的身份？ | 应用审计日志（登录、授权失败）、CTS（哪个 AK / 委托） | 分不清是哪个账号、哪个密钥被盗，无法精准轮换 |
| 在主机上干了什么？ | 主机安全（HSS）告警、进程 / 命令审计（如 auditd）、登录记录 | 不知道有没有留后门，只能整机重建 |
| 在云上动了什么？ | CTS 管理事件 | 不知道新建了哪些用户 / AK / 实例，持久化清理不干净 |
| 拿走了哪些数据？ | OBS 数据事件、数据库审计、应用导出审计 | 无法评估泄露范围，无法按法规通知受影响用户 |
| 数据发到了哪里？ | VPC 流日志、云防火墙（CFW）日志、DNS 日志 | 不知道外传目的地和数据量 |

其中**最致命的是身份类日志（应用认证 + CTS）和数据访问日志**：没有前者无法定位被盗的身份，没有后者无法回答“泄露了什么”。还有一个前提：**所有日志的时间必须同步**，否则跨系统的时间线拼不起来。

## 防御与最佳实践

- **开启并保护云审计**：所有区域开启 CTS 追踪器；重要 OBS 桶开数据事件；转储到独立的、最小权限的桶或独立审计账号，开启版本控制 / 防删除。
- **应用层审计**：按上面的规范输出结构化审计日志；审计日志用独立 logger，不受调试日志级别影响。
- **日志卫生**：绝不记录密码、token、AK/SK；用结构化日志防注入；日志组件及时升级。
- **集中与关联**：云审计、网络、主机、应用日志统一进 SIEM，字段规范化（如 ECS），时间统一 UTC + NTP。
- **检测规则优先级**：先覆盖“高置信度、高危害”的：审计被关闭、创建 AK / 用户、策略变为公开、非常用区域开实例、同一 IP 大量登录失败、单用户异常大量导出。每条规则标注 ATT&CK 编号。
- **响应准备**：写好常见场景的预案（AK 泄露、数据库被拖、主机被挖矿），明确联系人和权限，定期演练；遏制时先停用和隔离，保留证据。

## 常见误区

- **“日志都打了，出事再查”**：没人看的日志等于没有；没有告警，入侵可能数月后才被发现。
- **“云厂商帮我记了所有事”**：CTS 只记录云 API 调用，应用内发生了什么需要你自己记录。
- **“日志越多越好”**：无结构、无规范的海量日志既贵又查不动；关键事件的字段完整比数量重要。
- **“告警越多越安全”**：误报太多会导致告警疲劳，真告警被忽略。每条规则都要调优。
- **“出事后第一时间把机器删了重装”**：证据也一起没了，应先隔离、快照、取证。
- **“复盘就是追责”**：复盘的目标是改进系统和流程，追责文化会让大家隐瞒问题。

## 自测

:::details 1. CTS / CloudTrail 的一条事件能回答哪些问题？它不记录什么？
回答谁（账号、用户、委托、AK）、何时、从哪里（源 IP、UA）、做了什么（服务、操作、参数）、结果如何。它不记录应用内部的业务操作、主机上执行的命令、网络流量内容；OBS 对象级读写等数据事件通常需要单独开启。
:::

:::details 2. 管理事件和数据事件有什么区别？为什么数据事件常常被忽略？
管理事件是对资源本身的增删改（建桶、改策略、建用户）；数据事件是资源内部的数据操作（读写对象）。数据事件量大、费用和存储成本高，默认往往不开，于是“数据被批量下载”时没有证据。
:::

:::details 3. SIEM 的“规范化”解决什么问题？
不同来源的日志字段名不同（有的叫 client_ip，有的叫 sourceIPAddress），规范化成统一模型（如 ECS 的 source.ip）后，才能写一条规则跨多个数据源关联查询。
:::

:::details 4. 用 ATT&CK 的语言描述“攻击者用泄露的 AK 登录后，新建一个 AK 并关闭审计”。
初始访问：Valid Accounts: Cloud Accounts（T1078.004）；持久化：Account Manipulation: Additional Cloud Credentials（T1098.001）；防御规避：Impair Defenses: Disable or Modify Cloud Logs（T1562.008）。
:::

:::details 5. 事件响应中为什么强调“遏制时先停用和隔离，而不是删除”？
删除会销毁证据，导致无法判断攻击者做了什么、是否还有其他立足点；停用 AK、全拒绝策略、安全组隔离、快照等手段既能阻止扩大，又保留了取证条件。
:::

:::details 6. 哪些日志一旦缺失，你就无法还原一次入侵？
入口日志（WAF / Nginx / 认证）、身份日志（应用审计、CTS）、主机日志（HSS、命令审计）、云操作日志（CTS 管理事件）、数据访问日志（OBS 数据事件、数据库审计、导出审计）、网络日志（VPC 流日志、CFW、DNS）。其中身份日志和数据访问日志最致命，而且所有日志必须时间同步。
:::

:::details 7. 为什么应用在 Nginx 后面时，审计日志的 source.ip 需要特别注意？
不配置时记录的是 Nginx 的地址，失去溯源价值；无条件信任 X-Forwarded-For 又会让攻击者伪造 IP。应使用 `server.forward-headers-strategy` 并只信任来自自己代理的转发头。
:::

## 一句话总结

防不住时要看得见：云审计记云 API，应用审计记业务行为，统一进 SIEM 用 ATT&CK 组织检测规则，出事按“发现、遏制、根除、恢复、复盘”处置，先隔离再删除。
