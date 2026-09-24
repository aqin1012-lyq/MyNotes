# MyNotes

我的 4 年成长路线：**Java 后端 → 网络/系统 → Web 安全 → 云原生安全 → AI Security**。
包含两部分：

1. **学习站**（`http://localhost:8080/`）：路线图、每个主题的知识点 / 思考题 / 实践 / 权威资料、进度统计、Markdown 笔记、学习打卡。
2. **安全实验室**（项目①）：`/vuln/**` 与 `/secure/**` 成对的漏洞与修复，见 [docs/labs/README.md](docs/labs/README.md)。

## 启动

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
./mvnw spring-boot:run      # 打开 http://localhost:8080/
./mvnw test
```

应用只监听 `127.0.0.1`，因为 `/vuln/**` 是故意留的漏洞。

## 数据放在哪里

学习数据都是纯文本文件，放在 `study/` 下，**提交到 git 就是备份**：

| 文件 | 内容 |
|------|------|
| `study/progress.tsv` | 已勾选的条目与完成日期 |
| `study/log.tsv` | 学习日志（日期、分钟、主题、内容） |
| `study/notes/*.md` | 笔记。主题笔记以主题 id 命名，如 `net-tcp.md` |

## 修改学习内容

路线、主题和资料都在 [`src/main/resources/static/curriculum.js`](src/main/resources/static/curriculum.js)。
进度按列表下标记录，所以**新增条目请加在列表末尾**，不要插在中间或调整顺序。

每个主题的讲义在 [`src/main/resources/static/lessons/<topic-id>.md`](src/main/resources/static/lessons/)，用的是站内精简版 Markdown（`:::tip` / `:::warn` / `:::details` 容器，不支持嵌套列表），`LessonsTests` 会检查每个主题都有格式正确的讲义。

笔记里可以用 `[[topic-id]]` 链接到其他主题。
