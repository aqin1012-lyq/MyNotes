# Lab 04 - 越权（练习）

代码：`src/main/java/com/aqin/mynotes/lab/l04idor/`
测试：`src/test/java/com/aqin/mynotes/lab/l04idor/AccessControlTests.java`

漏洞版已写好，**修复版由你实现**。

## 1. 先打一遍

```bash
# 水平越权：alice 读 admin 的笔记
curl -H 'X-User-Id: 1' localhost:8080/vuln/l04/notes/4

# 垂直越权：alice 调管理员接口，还顺便拿到所有人的密码
curl -H 'X-User-Id: 1' localhost:8080/vuln/l04/admin/users

# 还有一个更根本的问题：
curl -H 'X-User-Id: 3' localhost:8080/vuln/l04/admin/users
```

## 2. 你的任务

实现 `SecureAccessController`，然后删掉测试里的 4 个 `@Disabled`，全部跑绿：

1. `/secure/l04/notes/{id}`：只能读自己的，别人的返回 **404**
2. `/secure/l04/admin/users`：非 ADMIN 返回 **403**；ADMIN 能拿到列表，但**不能有密码字段**

提示：`NoteRepository.findById` 已经有了；用户表的查询和返回类型自己写。

## 3. 问题

- [ ] 为什么别人的笔记返回 404 而不是 403？
- [ ] 把 owner 校验写成 `WHERE id = ? AND owner_id = ?`，和先查出来再在 Java 里比较，哪个更好？
- [ ] 自增 id 换成 UUID 能不能"修复"越权？
- [ ] `SELECT *` + 直接返回 Map 除了泄露密码，还有什么隐患？（提示：以后加字段）
- [ ] 第三条 curl 说明了什么？为什么所有 `X-User-Id` 相关的"修复"都只是暂时的？（→ Lab 09/10）

## 4. 心得
