## 为什么要学

回想一下你做过的项目：MySQL 密码、Redis 密码、EMQX 的认证密钥、OBS 的 AK/SK、支付回调的签名密钥……它们都放在哪里？大概率是 `application.yml`、`application-prod.yml`、Jenkins 的环境变量，或者直接写在 Dockerfile 里。只要其中一个文件进了 Git、一个镜像被推到了公开仓库、一台跳板机被攻破，这些密钥就全部暴露。本课的核心口号是：**密钥不进代码、不进镜像、不进 Git**。

上一课 [[cloud-iam]] 解决了“云 API 的身份”，这一课解决“应用自己的秘密”（数据库口令、第三方 API key、加密用的密钥）以及“数据加密用的密钥怎么管”。在华为云上对应的是 **DEW 数据加密服务**，它包括 **KMS 密钥管理** 和 **凭据管理（CSMS）**；开源世界里最常用的是 **HashiCorp Vault**。

学完这一课，你能：用信封加密在 Java 里正确地加密敏感字段（手机号、身份证、车架号 VIN）；让 Spring Boot 在启动时从 Vault 或 DEW 读取数据库密码；理解动态凭据和租约；设计密钥轮换与审计；在 CI 中用 gitleaks 拦截泄露。

:::tip 版本约定
Java 代码基于 Java 17 标准库 `javax.crypto`，无第三方依赖。Vault 命令基于 KV v2 引擎与 Vault 开发模式；gitleaks 命令基于 v8 系列（新版本使用 `gitleaks git` / `gitleaks dir` 子命令，老版本是 `gitleaks detect`）。华为云 DEW 的 API 名称和 SDK 类名请以资源中的 DEW 文档为准。
:::

## 核心概念

### 1. KMS 与信封加密（CMK / DEK）

**KMS（Key Management Service）** 是一个托管的“密钥保险箱”：主密钥（CMK，Customer Master Key；华为云文档里常称用户主密钥，AWS 现在叫 KMS key）生成后**永远不离开 KMS**（底层通常由硬件安全模块 HSM 保护）。你不能把它下载下来，只能调用 API 让 KMS 用它做加密 / 解密，每次调用都经过 IAM 鉴权并被审计。

问题来了：KMS 的加解密接口有请求大小限制，而且每次都走网络，不可能用它直接加密 1 GB 的文件或者每秒上万次的字段加密。于是有了**信封加密**（envelope encryption）：

```
 encrypt:
   app --GenerateDataKey(CMK)--> KMS
   app <-- DEK plaintext + DEK encrypted by CMK --
   app: ciphertext = AES-GCM(DEK plaintext, data)          本地加密，速度快
   app: store {encrypted DEK, iv, ciphertext}; wipe DEK    明文 DEK 用完即丢

 decrypt:
   app --Decrypt(encrypted DEK)--> KMS
   app <-- DEK plaintext --
   app: data = AES-GCM-decrypt(DEK, iv, ciphertext)
```

- **CMK**：在 KMS 里，只用来加密 / 解密 DEK。
- **DEK（Data Encryption Key）**：真正加密数据的对称密钥（如 AES-256），**明文只在内存中短暂存在**，密文和数据存在一起（就像信封里装着信，信封被 CMK 封口）。

好处：大数据量在本地加密，性能好；数据库被拖库只能拿到密文和“被封口的 DEK”，没有 KMS 权限就解不开；轮换 CMK 时不需要重新加密所有数据；每次解密 DEK 都会在审计日志里留下记录。AWS 对应 API 是 `GenerateDataKey` 和 `Decrypt`；华为云 KMS 也提供“创建数据密钥”“解密数据密钥”这类接口，确切名称和参数以 DEW 文档为准。

对称加密算法选 **AES-GCM**：它是认证加密（AEAD），同时保证机密性和完整性，被篡改的密文解密时会直接抛异常。使用规则：IV（nonce）12 字节、**同一个密钥下绝不能重复**（用 `SecureRandom` 随机生成），认证标签 128 位。不要用 ECB 模式，也不要用 CBC 不加 MAC。

### 2. 凭据管理服务 / HashiCorp Vault：动态凭据、租约

KMS 管的是“加密用的密钥”，**凭据管理**管的是“应用要用的秘密值”：数据库密码、API token 等。华为云 DEW 中的凭据管理（CSMS）让你把凭据存进去（底层用 KMS 加密），应用运行时凭 IAM 身份（最好是委托）调用接口取出，并支持版本和轮换。

**Vault** 功能更丰富，关键概念：

| 概念 | 含义 |
|---|---|
| 静态秘密（KV 引擎） | 你存进去的键值对，如 `spring.datasource.password` |
| 动态凭据（Database 引擎等） | 应用来要时，Vault **现场**在 MySQL 里创建一个临时账号返回 |
| 租约（lease） | 每个动态凭据都有 TTL；到期 Vault 自动删除该账号，可续租（renew）或提前撤销（revoke） |
| 认证方法（auth method） | 应用如何向 Vault 证明身份：Token、AppRole、Kubernetes ServiceAccount、云 IAM 等 |
| 策略（policy） | 某个身份能读哪些路径 |

动态凭据的意义：每个应用实例拿到的数据库账号都不同、都会过期。泄露一个，影响只有一个实例、只有几小时；从 MySQL 的连接日志还能直接定位到是哪个实例。对比一下传统做法：所有实例共用一个 `shop_app` 账号，密码三年没改。

### 3. 密钥轮换与访问审计

**轮换**分两种：

- **KMS 主密钥轮换**：KMS 生成新的密钥材料作为新版本，之后的加密用新版本；旧版本保留用于解密老数据（密文里带着版本信息）。所以开启轮换**不会**让老数据解不开。华为云 KMS 和 AWS KMS 都支持自动轮换，周期设置以文档为准。
- **凭据轮换**：数据库密码定期更换。关键是**双凭据过渡**：先创建新密码（或新账号）→ 应用切换 → 确认没有旧密码的连接 → 再作废旧密码。凭据管理服务通常会帮你做这件事。

**审计**：每一次 KMS 的 `Decrypt`、每一次读取凭据，都应该出现在 CTS（AWS 为 CloudTrail）或 Vault 的 audit device 日志里。审计能回答：“凌晨 3 点谁解密了 5 万次？”这正是拖库后批量解密的信号（见 [[cloud-detect]]）。

### 4. Git 泄露扫描（gitleaks 等）

gitleaks 用正则 + 熵值规则扫描 Git 历史或目录，发现 AWS key、私钥、JWT、通用高熵字符串等。三个使用位置：

- 开发者本机 **pre-commit** 钩子：提交前就拦下。
- **CI 流水线**：每次 PR 全量或增量扫描，发现即失败。
- **存量仓库**：对全部历史扫一遍，找出早就泄露过的。

同类工具还有 trufflehog、git-secrets，以及 GitHub 自带的 secret scanning。注意扫描器是**最后一道防线**，不是方案本身：根本解决是让密钥根本没有机会被写进代码。

## 动手实践

### 练习 A：Java 实现 AES-GCM 信封加密

先定义一个 KMS 抽象接口，业务代码只依赖它。开发 / 测试环境用本地实现，生产环境换成调用华为云 KMS（或 AWS KMS）的实现。

```java
package com.aqin.mynotes.crypto;

import java.security.GeneralSecurityException;

/** 对 KMS 的最小抽象：CMK 永远在 KMS 内部，调用方只见到 DEK。 */
public interface KmsClient {

    /** 生成一个新的 256 位 DEK，同时返回明文和被 CMK 加密后的密文。 */
    DataKey generateDataKey(String cmkId) throws GeneralSecurityException;

    /** 用 CMK 解密被封装的 DEK。 */
    byte[] decryptDataKey(String cmkId, byte[] encryptedDataKey) throws GeneralSecurityException;

    record DataKey(byte[] plaintext, byte[] encrypted) {}
}
```

本地实现（**仅用于开发测试**：主密钥在进程内存里，没有 HSM、没有审计）：

```java
package com.aqin.mynotes.crypto;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;

public final class LocalKmsClient implements KmsClient {

    private final SecretKey masterKey;
    private final SecureRandom random = new SecureRandom();

    public LocalKmsClient() throws GeneralSecurityException {
        KeyGenerator kg = KeyGenerator.getInstance("AES");
        kg.init(256);
        this.masterKey = kg.generateKey();
    }

    @Override
    public DataKey generateDataKey(String cmkId) throws GeneralSecurityException {
        byte[] dek = new byte[32];
        random.nextBytes(dek);
        byte[] iv = new byte[12];
        random.nextBytes(iv);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, masterKey, new GCMParameterSpec(128, iv));
        c.updateAAD(cmkId.getBytes(StandardCharsets.UTF_8));
        byte[] wrapped = c.doFinal(dek);
        byte[] out = ByteBuffer.allocate(iv.length + wrapped.length).put(iv).put(wrapped).array();
        return new DataKey(dek, out);
    }

    @Override
    public byte[] decryptDataKey(String cmkId, byte[] encryptedDataKey) throws GeneralSecurityException {
        byte[] iv = Arrays.copyOfRange(encryptedDataKey, 0, 12);
        byte[] wrapped = Arrays.copyOfRange(encryptedDataKey, 12, encryptedDataKey.length);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, masterKey, new GCMParameterSpec(128, iv));
        c.updateAAD(cmkId.getBytes(StandardCharsets.UTF_8));
        return c.doFinal(wrapped);
    }
}
```

信封加密本体：每次加密都生成新的 DEK 和新的随机 12 字节 IV，认证标签 128 位；可选的 AAD（附加认证数据）用来绑定上下文，例如“这是 user 表 id=42 的 phone 字段”，防止攻击者把 A 行的密文挪到 B 行。

```java
package com.aqin.mynotes.crypto;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

public final class EnvelopeEncryptor {

    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    /** 需要持久化的三样东西：被封装的 DEK、IV、密文（密文末尾自带 16 字节认证标签）。 */
    public record Envelope(byte[] encryptedDataKey, byte[] iv, byte[] ciphertext) {}

    private final KmsClient kms;
    private final String cmkId;
    private final SecureRandom random = new SecureRandom();

    public EnvelopeEncryptor(KmsClient kms, String cmkId) {
        this.kms = kms;
        this.cmkId = cmkId;
    }

    public Envelope encrypt(byte[] plaintext, byte[] aad) throws GeneralSecurityException {
        KmsClient.DataKey dataKey = kms.generateDataKey(cmkId);
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(dataKey.plaintext(), "AES"),
                    new GCMParameterSpec(TAG_BITS, iv));
            c.updateAAD(aad);
            return new Envelope(dataKey.encrypted(), iv, c.doFinal(plaintext));
        } finally {
            Arrays.fill(dataKey.plaintext(), (byte) 0); // 明文 DEK 用完即清零
        }
    }

    public byte[] decrypt(Envelope env, byte[] aad) throws GeneralSecurityException {
        byte[] dek = kms.decryptDataKey(cmkId, env.encryptedDataKey());
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(dek, "AES"),
                    new GCMParameterSpec(TAG_BITS, env.iv()));
            c.updateAAD(aad);
            return c.doFinal(env.ciphertext()); // 被篡改时抛 AEADBadTagException
        } finally {
            Arrays.fill(dek, (byte) 0);
        }
    }

    public static void main(String[] args) throws Exception {
        EnvelopeEncryptor enc = new EnvelopeEncryptor(new LocalKmsClient(), "cmk-user-pii");
        byte[] aad = "user:42:phone".getBytes(StandardCharsets.UTF_8);
        Envelope env = enc.encrypt("13800138000".getBytes(StandardCharsets.UTF_8), aad);

        Base64.Encoder b64 = Base64.getEncoder();
        System.out.println("encryptedDEK(" + env.encryptedDataKey().length + "B) = " + b64.encodeToString(env.encryptedDataKey()));
        System.out.println("iv(" + env.iv().length + "B) = " + b64.encodeToString(env.iv()));
        System.out.println("ciphertext(" + env.ciphertext().length + "B) = " + b64.encodeToString(env.ciphertext()));
        System.out.println("decrypted = " + new String(enc.decrypt(env, aad), StandardCharsets.UTF_8));

        env.ciphertext()[0] ^= 1; // 翻转一个比特，模拟篡改
        try {
            enc.decrypt(env, aad);
        } catch (javax.crypto.AEADBadTagException e) {
            System.out.println("tampered -> " + e.getClass().getSimpleName());
        }
    }
}
```

运行 `EnvelopeEncryptor.main`，输出类似（Base64 每次都不同）：

```
encryptedDEK(60B) = YiZD1PFaWVWeb9FuLFLKtMLWqoC13yl9gTE1b8GvY0zncAsQPtrw7RYgZCd/qI+TYZTirVxCZpWBsFFl
iv(12B) = 9JkFL0HiUmFeJPst
ciphertext(27B) = j5EM0U+JGRqt/GdZRTOfOUAnLEOgWBaP7+YF
decrypted = 13800138000
tampered -> AEADBadTagException
```

**如何解读**：

- `encryptedDEK` 60 字节 = 本地 KMS 的 12 字节 IV + 32 字节 DEK 密文 + 16 字节标签。真实 KMS 返回的密文格式由 KMS 决定，你只需原样保存。
- `ciphertext` 27 字节 = 11 字节手机号 + 16 字节 GCM 标签。GCM 是流式模式，密文与明文等长，没有填充。
- 最后一行说明篡改一个比特就无法解密，这就是 AEAD 的完整性保护。如果解密时 AAD 不同（比如把这段密文拷到 `user:43:phone`），同样会抛这个异常。
- 落库时可以存成三列（`dek_cipher`, `iv`, `phone_cipher`），或者拼成一个带版本前缀的字符串。生产中为了性能，常常一个 DEK 缓存一段时间、加密多条记录（每条仍用新的随机 IV），而不是每条记录都调一次 KMS。

生产实现就是写一个 `HuaweiKmsClient implements KmsClient`，在两个方法里分别调用华为云 KMS 的“创建数据密钥”和“解密数据密钥”接口（使用华为云 Java SDK 的 KMS 模块，类名与参数以 DEW 文档为准），并用委托授予应用这两个操作的权限，且只针对这一把 CMK。

### 练习 B：让 Spring Boot 从 Vault 读取数据库密码

**第 1 步：启动开发模式 Vault 并写入秘密**（开发模式数据只在内存、自动解封，**只能用于学习**）：

```bash
vault server -dev -dev-root-token-id=dev-only-token
# 另开一个终端
export VAULT_ADDR=http://127.0.0.1:8200
export VAULT_TOKEN=dev-only-token
vault kv put secret/order-service spring.datasource.password='S3cure!Pass'
vault kv get secret/order-service
```

`vault kv get` 的输出大致如下：

```
======= Secret Path =======
secret/data/order-service

======= Metadata =======
Key                Value
---                -----
created_time       2028-02-03T08:00:00.000000Z
version            1

============ Data ============
Key                           Value
---                           -----
spring.datasource.password    S3cure!Pass
```

**解读**：`secret/` 是开发模式默认挂载的 KV v2 引擎，实际 API 路径多了一段 `data/`；`version 1` 说明 KV v2 自带版本，改密码后可以回看历史版本。

**第 2 步：Spring Boot 接入 Spring Cloud Vault。** 依赖 `org.springframework.cloud:spring-cloud-starter-vault-config`，版本由与你的 Spring Boot 版本匹配的 Spring Cloud BOM 管理（请在 Spring Cloud 官网确认兼容关系）。`application.yml`：

```yaml
spring:
  application:
    name: order-service
  config:
    import: "vault://"
  cloud:
    vault:
      uri: http://127.0.0.1:8200
      authentication: TOKEN
      token: ${VAULT_TOKEN}
      kv:
        enabled: true
        backend: secret
        default-context: order-service
  datasource:
    url: jdbc:mysql://127.0.0.1:3306/shop
    username: shop_app
    # password 不写：由 Vault 中 secret/order-service 的同名键提供
```

启动后 `spring.datasource.password` 就来自 Vault。验证方法：启动日志里数据源正常初始化；故意停掉 Vault 再启动，应用会因为无法加载配置而启动失败（这是期望行为：宁可起不来，也不用错误的配置）。生产环境不要用 TOKEN 认证把 token 塞进环境变量，而应在 K8s 中用 `KUBERNETES` 认证（ServiceAccount），或 AppRole。

**第 3 步（进阶）：动态数据库凭据。**

```bash
vault secrets enable database
vault write database/config/shop-mysql \
    plugin_name=mysql-database-plugin \
    connection_url="{{username}}:{{password}}@tcp(127.0.0.1:3306)/" \
    allowed_roles="order-app" username="vault_admin" password="vault_admin_pw"
vault write database/roles/order-app db_name=shop-mysql \
    creation_statements="CREATE USER '{{name}}'@'%' IDENTIFIED BY '{{password}}'; GRANT SELECT, INSERT, UPDATE ON shop.* TO '{{name}}'@'%';" \
    default_ttl=1h max_ttl=24h
vault read database/creds/order-app
```

```
Key                Value
---                -----
lease_id           database/creds/order-app/2f6a...
lease_duration     1h
lease_renewable    true
password           A1b-xxxxxxxxxxxxxxxx
username           v-token-order-app-xxxxxxxx
```

**解读**：每次 `read` 都会在 MySQL 中新建一个用户，1 小时后租约到期 Vault 自动 `DROP USER`。`lease_id` 可用于 `vault lease revoke` 提前吊销。在 MySQL 里执行 `SELECT user FROM mysql.user;` 能看到这些 `v-` 开头的临时账号。

### 练习 C（华为云 DEW 版）

思路与 Vault 相同：在 DEW 的凭据管理中创建凭据 `order-service-db`，值为 JSON（如 `{"password":"..."}`）；给 ECS 委托授予“读取该凭据”的权限；应用启动时通过华为云 Java SDK 的 CSMS 模块读取凭据的当前版本，再设置到数据源。具体的 API 名称、SDK 依赖坐标以及是否有现成的 Spring 集成，请以 DEW 文档为准。一个与云无关的接入点是 Spring 的 `EnvironmentPostProcessor`：在上下文刷新前读取凭据，作为一个高优先级的 `PropertySource` 加入 `Environment`。

### 练习 D：用 gitleaks 扫描仓库

```bash
# 扫描整个 Git 历史（v8 新版子命令；老版本用：gitleaks detect --source . -v）
gitleaks git -v .
# 只扫描当前目录的文件（不看历史）
gitleaks dir -v .
```

发现泄露时的输出大致如下：

```
Finding:     aws_access_key_id = "REDACTED"
Secret:      REDACTED
RuleID:      aws-access-token
Entropy:     4.62
File:        src/main/resources/application-prod.yml
Line:        14
Commit:      3f2c9a1...
Author:      aqin
Date:        2026-05-10T09:12:44Z
Fingerprint: 3f2c9a1...:src/main/resources/application-prod.yml:aws-access-token:14

leaks found: 1
```

**解读**：`RuleID` 说明是哪条规则命中；`Commit` 和 `File:Line` 告诉你是哪次提交引入的——即使当前版本已删掉，历史里仍在，所以必须**轮换**。有泄露时命令退出码非 0，CI 据此失败。误报可以写进 `.gitleaksignore`（按 Fingerprint）。

## 攻击者视角

> 本课涉及的攻击手法只用于你自己的环境或已获授权的目标。

攻击者找秘密的常见地方：

- **Git 历史**：`git log -p | grep -i password`，或直接跑 gitleaks / trufflehog。被删除的提交在历史里依然存在。
- **镜像层**：`docker history --no-trunc 镜像` 能看到构建命令里的 `ENV DB_PASSWORD=...`；即使后一层删掉了文件，前一层的文件仍可被提取。
- **运行中的进程**：拿到容器 shell 后 `env`、`cat /proc/1/environ`，环境变量里的密码一览无余。
- **Spring Boot Actuator**：`/actuator/env`、`/actuator/heapdump` 暴露给外网时，配置和内存里的密码都能被拿到。
- **日志**：把整个配置对象或请求头打印到日志里，日志又进了 ELK，所有人可见。
- **拖库后的密文**：如果加密密钥就放在同一台应用服务器的配置文件里，攻击者拿到代码和库就能解密；信封加密 + KMS 让攻击者还必须拿到 KMS 的调用权限，并且这些调用会被审计。

**问题：数据库密码放在 K8s Secret 里就安全了吗？**

不够。K8s Secret 默认只是 **base64 编码**，不是加密：

- etcd 中默认明文存储，除非配置了静态加密（EncryptionConfiguration，最好用 KMS provider）。
- 在该命名空间有 `get secrets` 权限、或者**能创建 Pod** 的人（把 Secret 挂进自己的 Pod）都能读到。
- 以环境变量注入时，会出现在进程环境、崩溃转储、调试输出中。
- Secret 的 YAML 如果提交到 Git，就等于把密码提交到 Git。

所以 K8s Secret 是一个“分发机制”，要配合：etcd 静态加密、严格 RBAC（见 [[k8s-rbac]]）、以文件挂载代替环境变量、以及外部密钥系统（Vault、云凭据管理，通过 External Secrets Operator 或 Secrets Store CSI Driver 同步）一起使用。

## 防御与最佳实践

- **分层存放**：加密用密钥放 KMS（CMK 不出 KMS）；应用秘密放凭据管理 / Vault；应用通过委托 / 工作负载身份获取，而不是靠另一个秘密去取秘密。
- **最小权限**：每个应用只能读自己的凭据路径、只能用自己的 CMK；解密权限和加密权限分开。
- **短生命周期**：优先动态凭据和临时凭证；静态凭据定期轮换，轮换流程演练过。
- **审计与告警**：KMS 解密、凭据读取全部进审计日志；对异常频率、异常身份、异常时间告警。
- **防泄露**：pre-commit + CI 跑 gitleaks；Actuator 只暴露 `health`，其余端点关闭或放在内网并鉴权；日志脱敏。
- **正确使用加密**：AES-GCM、随机 12 字节 IV 不重复、128 位标签、使用 AAD 绑定上下文；不要自己设计算法，也不要把密钥硬编码在 Java 常量里。

## 常见误区

- **“Base64 / 放在 K8s Secret 里就是加密了”**：Base64 只是编码。
- **“把密钥放到 Jasypt 加密的配置里就安全”**：解密用的主密码仍需放在某个地方，只是把问题挪了一步；可以作为过渡，但不能代替 KMS / 凭据管理。
- **“删了那次提交就没事”**：历史、fork、镜像缓存都在，必须轮换。
- **“开启 CMK 轮换会让老数据解不开”**：KMS 保留旧版本密钥材料用于解密。
- **“GCM 的 IV 用固定值或计数器从 0 开始没关系”**：同一密钥下 IV 重复会严重破坏 GCM 的机密性和完整性。
- **“用 KMS 直接加密所有数据”**：性能差且有大小限制，应使用信封加密。

## 自测

:::details 1. 信封加密中 CMK 和 DEK 各自在哪里、做什么？
CMK 始终在 KMS 内部，只用于加密 / 解密 DEK；DEK 是真正加密数据的对称密钥，明文只在应用内存中短暂存在，用完清零，被 CMK 加密后的 DEK 与数据密文一起存储。
:::

:::details 2. AES-GCM 使用时的三个关键参数要求是什么？违反会怎样？
IV 12 字节，同一密钥下绝不重复（用 SecureRandom 随机）；认证标签 128 位；解密时密文、IV、AAD 任一被改都会抛 AEADBadTagException。IV 重复会让攻击者推出明文异或关系并可能伪造密文。
:::

:::details 3. 什么是动态凭据和租约？相比静态数据库密码好在哪里？
动态凭据是应用请求时由 Vault 现场在数据库中创建的临时账号，附带租约（TTL），到期自动删除，可续租或提前吊销。好处：每个实例凭据不同、会过期，泄露影响范围和时间都受限，并且能从数据库日志定位到具体实例。
:::

:::details 4. 数据库密码放在 K8s Secret 里就安全了吗？
不够。Secret 默认只是 base64，etcd 默认未加密；有 get secrets 权限或能在该命名空间创建 Pod 的人都能读到；以环境变量注入会暴露在进程环境中。需要 etcd 静态加密、严格 RBAC、文件挂载、以及 Vault / 云凭据管理等外部系统配合。
:::

:::details 5. 开启 KMS 主密钥自动轮换后，旧数据还能解密吗？为什么？
能。轮换只是生成新版本的密钥材料用于之后的加密，旧版本材料保留用于解密旧密文。
:::

:::details 6. gitleaks 在历史中发现一个半年前提交、现在已删除的密码，应该怎么处理？
立即轮换该密码（假设已被拿走）；检查审计日志有无被滥用；然后视情况清理 Git 历史；最后把 gitleaks 加到 pre-commit 和 CI 防止再次发生。
:::

:::details 7. 为什么加密时要用 AAD，比如 “user:42:phone”？
AAD 不会被加密但参与认证。绑定记录上下文后，攻击者即使能写数据库，也无法把 A 用户的密文复制到 B 用户那一行冒充使用，因为 AAD 不同会导致解密失败。
:::

## 一句话总结

密钥进 KMS、秘密进凭据管理 / Vault，应用凭委托身份去取；数据用 AES-GCM 信封加密，凭据尽量动态、短期、可轮换、可审计，gitleaks 兜底。
