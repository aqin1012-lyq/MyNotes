# 安全实验室（项目①：安全 Web 服务）

每个 Lab 一个包 `com.aqin.mynotes.lab.lXX...`，包含：

- `Vuln...Controller` —— `/vuln/lXX/...`，故意写错
- `Secure...Controller` —— `/secure/lXX/...`，修复版
- `...Tests` —— 同一个攻击分别打两个接口：vuln 必须被打穿，secure 必须挡住
- `docs/labs/XX-*.md` —— 自己写的学习笔记

> ⚠️ `/vuln/**` 只能在本机跑，永远不要部署到公网。

## 进度

| # | 主题 | 计划 | 状态 |
|---|------|------|------|
| 01 | SQL 注入 | 2027.01 | ✅ 示例已完成，笔记待写 |
| 02 | XSS（存储型/反射型）+ CSP | 2027.01 | ✅ 示例已完成，笔记待写 |
| 03 | CSRF | 2027.04 | ⬜ 需要 cookie 会话，放到 Lab 10 之后做 |
| 04 | 越权（水平 / 垂直 / 过度返回） | 2027.01 | 🟡 **练习**：漏洞版已写，修复版待你实现 |
| 05 | SSRF（笔记里放图片 URL 预览 + 模拟云元数据） | 2027.02 | ✅ 示例已完成，笔记待写 |
| 06 | 文件上传 + 路径穿越 | 2027.02 | ⬜ |
| 07 | RCE（命令注入 / SpEL 注入） | 2027.02 | ⬜ |
| 08 | Java 反序列化 | 2027.03 | ⬜ |
| 09 | JWT 漏洞（alg=none / 弱密钥 / 不校验过期） | 2027.04 | ⬜ |
| 10 | 明文密码 → BCrypt，接入 Spring Security | 2027.04 | ⬜ |

## 运行

```bash
# 项目需要 JDK 17+（本机默认是 1.8）
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw test              # 跑全部攻防测试
./mvnw spring-boot:run   # 启动后可手工 curl，H2 控制台：http://localhost:8080/h2-console
```

预置数据：alice(1) / bob(2) / admin(3)，当前用户用请求头 `X-User-Id` 模拟（这本身就是个漏洞，Lab 09/10 会换掉）。
