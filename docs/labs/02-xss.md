# Lab 02 - XSS

代码：`src/main/java/com/aqin/mynotes/lab/l02xss/`

## 1. 攻击复现

```bash
# 存储型：bob 写一条"笔记"，谁打开审核页谁中招
curl -X POST -H 'X-User-Id: 2' 'localhost:8080/vuln/l02/notes' \
  --data-urlencode 'title=<img src=x onerror=alert(document.cookie)>'
open 'http://localhost:8080/vuln/l02/review'      # 浏览器里会弹窗
open 'http://localhost:8080/secure/l02/review'    # 只显示文本

# 反射型：把链接发给受害者
open 'http://localhost:8080/vuln/l02/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E'
```

## 2. 问题

- [ ] 存储型、反射型、DOM 型的区别？这里的修复能防 DOM 型吗？
- [ ] 为什么是"输出时编码"而不是"入库前过滤"？
- [ ] 同一个值写进 HTML 正文、HTML 属性、`<script>` 里、URL 里，编码方式为什么不一样？
- [ ] CSP 为什么挡得住 `onerror=`？什么情况下 CSP 会被绕过（`unsafe-inline`、JSONP、可控的同源 JS）？
- [ ] Cookie 设 `HttpOnly` 能防什么、防不了什么？
- [ ] Thymeleaf 的 `th:text` 和 `th:utext`、Vue 的 `v-html` 各是什么风险？

## 3. 心得
