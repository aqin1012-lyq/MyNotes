/*
 * 学习路线数据：Java 后端 → 网络/系统 → Web 安全 → 云原生安全 → AI Security
 *
 * 进度按 `${topicId}:k0` / `:p0` / `:r0`（知识点 / 实践 / 资料）的下标保存在 study/progress.tsv。
 * 修改内容时：在列表末尾追加，不要在中间插入或重排，否则已勾选的进度会错位。
 *
 * 资料类型：规范 / 官方 / 教程 / 靶场 / 书 / 工具 / 标准
 */
window.CURRICULUM = {
  mission: 'Java 后端作为根 → 网络/系统作为底座 → 安全作为纵深 → AI 作为放大器',
  identity: '懂后端的安全工程师 / 懂安全的后端工程师 → 懂后端 + 云 + IoT + AI 的安全工程师',

  stages: [
    // ------------------------------------------------------------------ S1
    {
      id: 's1', title: '网络基础', from: '2026-10', to: '2026-11',
      goal: '看到一个请求，能把它从浏览器一路追踪到后端服务器，并说出每一步可以被怎样攻击。',
      topics: [
        {
          id: 'net-trace', title: '一个请求的全链路', month: '2026-10',
          summary: '浏览器 → DNS → TCP → TLS → HTTP → Nginx → Spring Boot → MySQL。这是整个第一年的“主线图”，后面每一个漏洞都能挂在这条链上的某一环。',
          points: [
            '能画出 浏览器→DNS→TCP→TLS→HTTP→反向代理→应用→数据库 的完整时序图',
            '每一跳分别用了哪个协议、哪个端口、谁是客户端谁是服务端',
            '每一跳的信任边界在哪里：哪些数据来自不可信的一方',
            '对每一跳至少说出一种攻击（DNS 劫持、中间人、HTTP 走私、SQL 注入……）',
          ],
          questions: ['如果攻击者控制了 DNS，TLS 还能保护你吗？为什么？', 'Nginx 传给 Spring Boot 的 X-Forwarded-For 能信吗？'],
          practice: [
            '用 curl -v 访问一个 HTTPS 站点，逐行解释输出',
            '用 Wireshark 抓一次完整访问（DNS + TCP + TLS），标注每个阶段',
            '把全链路图写进本主题笔记，后面学到每个漏洞都回来标一下它在哪一环',
          ],
          resources: [
            { t: 'High Performance Browser Networking（Ilya Grigorik，免费在线）', u: 'https://hpbn.co/', type: '书' },
            { t: 'MDN：HTTP 概述', u: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Overview', type: '官方' },
            { t: 'Cloudflare Learning Center', u: 'https://www.cloudflare.com/learning/', type: '教程' },
            { t: '小林coding：图解网络', u: 'https://xiaolincoding.com/network/', type: '教程' },
            { t: 'Wireshark 用户手册', u: 'https://www.wireshark.org/docs/wsug_html_chunked/', type: '工具' },
          ],
        },
        {
          id: 'net-tcp', title: 'TCP/IP：握手、挥手、状态', month: '2026-10',
          summary: '不重学大学课本，只抓对排障和安全有用的部分：三次握手、四次挥手、TIME_WAIT、端口、以及 SYN Flood 等基于状态的攻击。',
          points: [
            'IP / 子网 / 路由 / 端口 的基本概念，私有地址段（10/8、172.16/12、192.168/16）',
            '三次握手：SYN、SYN-ACK、ACK，以及为什么是三次',
            '四次挥手与 TIME_WAIT / CLOSE_WAIT：线上大量 CLOSE_WAIT 通常说明什么',
            'TCP 状态机与 SYN Flood、SYN Cookie',
            'UDP 与 TCP 的差异，为什么 DNS 主要走 UDP',
          ],
          questions: ['服务端出现大量 CLOSE_WAIT，是客户端的问题还是自己代码的问题？', '端口扫描为什么能判断端口是开放、关闭还是被过滤？'],
          practice: [
            '用 tcpdump/Wireshark 抓到一次三次握手和四次挥手',
            '用 ss -tan 观察本机 Spring Boot 连接的各种状态',
          ],
          resources: [
            { t: 'RFC 9293：Transmission Control Protocol', u: 'https://www.rfc-editor.org/rfc/rfc9293', type: '规范' },
            { t: 'Computer Networking: A Top-Down Approach（Kurose & Ross）配套资源', u: 'https://gaia.cs.umass.edu/kurose_ross/', type: '书' },
            { t: '小林coding：TCP 篇', u: 'https://xiaolincoding.com/network/3_tcp/tcp_interview.html', type: '教程' },
          ],
        },
        {
          id: 'net-dns', title: 'DNS', month: '2026-10',
          summary: '域名解析的递归/迭代过程、记录类型、缓存与 TTL。DNS 是 SSRF 绕过（DNS rebinding）、子域名接管、钓鱼的核心。',
          points: [
            '递归解析器 vs 权威服务器，根 → TLD → 权威 的查询过程',
            '常见记录：A / AAAA / CNAME / MX / TXT / NS',
            'TTL 与缓存；DNS 投毒、DNS 劫持',
            'DNS rebinding 与子域名接管（悬空 CNAME）',
            'DoH / DoT / DNSSEC 分别解决什么问题',
          ],
          questions: ['为什么 SSRF 防护“先解析域名再判断 IP”仍然可能被绕过？'],
          practice: ['用 dig +trace 追踪一个域名的完整解析路径', '用 dig 查询 TXT 记录，找找 SPF / DMARC'],
          resources: [
            { t: 'Cloudflare：What is DNS?', u: 'https://www.cloudflare.com/learning/dns/what-is-dns/', type: '教程' },
            { t: 'RFC 1034：Domain Names - Concepts and Facilities', u: 'https://www.rfc-editor.org/rfc/rfc1034', type: '规范' },
            { t: 'How DNS Works（漫画）', u: 'https://howdns.works/', type: '教程' },
          ],
        },
        {
          id: 'net-http', title: 'HTTP / Cookie / Session / WebSocket', month: '2026-10',
          summary: 'HTTP 语义、状态码、头部、缓存；Cookie 的属性（Secure / HttpOnly / SameSite / Domain / Path）直接决定了 XSS 和 CSRF 的危害。',
          points: [
            '请求/响应结构，方法语义（安全 / 幂等），常见状态码',
            'Cookie 属性：Secure、HttpOnly、SameSite、Domain、Path、Max-Age',
            'Session 机制：服务端存状态，Cookie 只放 Session ID',
            'HTTP/1.1 keep-alive、HTTP/2 多路复用；HTTP 请求走私的成因（CL/TE 不一致）',
            'WebSocket 握手（Upgrade）及跨站 WebSocket 劫持',
            '缓存相关头：Cache-Control、ETag；Web 缓存投毒的概念',
          ],
          questions: ['SameSite=Lax 能挡住哪些 CSRF，挡不住哪些？', '为什么 GET 请求不应该修改数据？'],
          practice: ['用浏览器 DevTools 观察一次登录的 Set-Cookie', '在 Spring Boot 中设置 Session Cookie 的 SameSite / Secure 属性'],
          resources: [
            { t: 'MDN：HTTP 文档', u: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP', type: '官方' },
            { t: 'MDN：Using HTTP cookies', u: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies', type: '官方' },
            { t: 'RFC 9110：HTTP Semantics', u: 'https://www.rfc-editor.org/rfc/rfc9110', type: '规范' },
            { t: 'RFC 6265：HTTP State Management Mechanism（Cookie）', u: 'https://www.rfc-editor.org/rfc/rfc6265', type: '规范' },
            { t: 'RFC 6455：The WebSocket Protocol', u: 'https://www.rfc-editor.org/rfc/rfc6455', type: '规范' },
            { t: '《图解HTTP》（上野宣）', u: '', type: '书' },
          ],
        },
        {
          id: 'net-tls', title: 'HTTPS / TLS / 证书', month: '2026-11',
          summary: 'TLS 提供机密性、完整性和服务端身份认证。理解握手、证书链、CA 信任模型，为后面 mTLS、IoT 设备证书、PKI 打基础。',
          points: [
            '对称加密、非对称加密、哈希、数字签名分别解决什么问题',
            'TLS 1.3 握手过程（ECDHE 密钥交换、前向保密）',
            '证书链：叶子证书 → 中间 CA → 根 CA，浏览器如何校验',
            'HSTS、证书固定、中间人攻击与“忽略证书错误”的风险',
            'mTLS（双向认证）：服务端也校验客户端证书',
          ],
          questions: ['Java 代码里写一个“信任所有证书”的 TrustManager 会带来什么后果？', '为什么 TLS 保护不了已经被攻陷的服务端？'],
          practice: [
            '用 openssl s_client -connect 查看一个网站的证书链',
            '用 keytool / openssl 自签一个 CA，给本地 Spring Boot 配置 HTTPS',
          ],
          resources: [
            { t: 'The Illustrated TLS 1.3 Connection（逐字节图解）', u: 'https://tls13.xargs.org/', type: '教程' },
            { t: 'Cloudflare：What happens in a TLS handshake?', u: 'https://www.cloudflare.com/learning/ssl/what-happens-in-a-tls-handshake/', type: '教程' },
            { t: 'RFC 8446：TLS 1.3', u: 'https://www.rfc-editor.org/rfc/rfc8446', type: '规范' },
            { t: 'OWASP：Transport Layer Security Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html', type: '标准' },
            { t: 'Let\'s Encrypt：How It Works', u: 'https://letsencrypt.org/how-it-works/', type: '官方' },
            { t: 'OpenSSL Cookbook（Ivan Ristić，免费）', u: 'https://www.feistyduck.com/library/openssl-cookbook/', type: '书' },
          ],
        },
        {
          id: 'net-infra', title: '反向代理 / NAT / 防火墙', month: '2026-11',
          summary: 'Nginx 反向代理、负载均衡、NAT 和防火墙决定了“谁能访问谁”。很多漏洞来自代理与后端对请求理解不一致。',
          points: [
            '正向代理 vs 反向代理；Nginx proxy_pass 与常见头（Host、X-Forwarded-For、X-Real-IP）',
            'NAT：内网地址如何访问公网，为什么公网默认访问不到内网',
            '防火墙：状态检测、白名单、默认拒绝',
            '代理与后端解析差异导致的问题：路径规范化、Host 头攻击、请求走私',
          ],
          questions: ['应用只根据 X-Forwarded-For 做 IP 白名单，攻击者能怎么绕过？'],
          practice: ['本机用 Docker 起一个 Nginx，反向代理到 Spring Boot，并在应用里打印收到的所有头'],
          resources: [
            { t: 'NGINX 官方文档', u: 'https://nginx.org/en/docs/', type: '官方' },
            { t: 'NGINX Reverse Proxy 指南', u: 'https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/', type: '官方' },
            { t: 'PortSwigger：HTTP request smuggling', u: 'https://portswigger.net/web-security/request-smuggling', type: '教程' },
            { t: 'PortSwigger：HTTP Host header attacks', u: 'https://portswigger.net/web-security/host-header', type: '教程' },
          ],
        },
        {
          id: 'net-token', title: 'Session vs JWT', month: '2026-11',
          summary: '先建立概念：有状态会话与无状态令牌的取舍。安全细节（alg=none、弱密钥、撤销）放到 Web 安全和 Spring Security 阶段深入。',
          points: [
            'JWT 结构：Header.Payload.Signature，Base64URL ≠ 加密',
            'HS256（共享密钥）vs RS256/ES256（公私钥）',
            'Session 与 JWT 在“撤销 / 扩展 / 跨服务”上的取舍',
            'Token 放在 Cookie 还是 Authorization 头：分别对应 CSRF 与 XSS 风险',
          ],
          questions: ['JWT 泄露后，在过期前你有什么办法让它失效？'],
          practice: ['在 jwt.io 解码一个 JWT，确认 payload 是明文可读的'],
          resources: [
            { t: 'jwt.io：Introduction to JSON Web Tokens', u: 'https://jwt.io/introduction', type: '教程' },
            { t: 'RFC 7519：JSON Web Token', u: 'https://www.rfc-editor.org/rfc/rfc7519', type: '规范' },
            { t: 'OWASP：Session Management Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html', type: '标准' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S2
    {
      id: 's2', title: 'Linux', from: '2026-11', to: '2026-12',
      goal: '一台 Linux 服务器给你，你不会害怕：会看进程、端口、日志、权限，能加固 SSH 和防火墙。',
      topics: [
        {
          id: 'linux-shell', title: 'Shell 与文本三剑客', month: '2026-11',
          summary: 'grep / awk / sed / curl 是排查问题和分析日志的基本功，也是之后读攻击日志的工具。',
          points: [
            '管道、重定向、环境变量、退出码',
            'grep（-r -n -E -v）、awk（按列处理）、sed（替换）',
            'curl / wget 常用参数：-v -H -d -X -k（以及 -k 为什么危险）',
            '写一个带 set -euo pipefail 的小脚本',
          ],
          questions: ['如何用一行命令统计 Nginx 访问日志里请求最多的前 10 个 IP？'],
          practice: ['完成 OverTheWire Bandit 前 15 关', '用 awk 统计一份 access.log 的状态码分布'],
          resources: [
            { t: 'MIT：The Missing Semester of Your CS Education', u: 'https://missing.csail.mit.edu/', type: '教程' },
            { t: 'The Linux Command Line（William Shotts，免费）', u: 'https://linuxcommand.org/tlcl.php', type: '书' },
            { t: 'OverTheWire：Bandit', u: 'https://overthewire.org/wargames/bandit/', type: '靶场' },
          ],
        },
        {
          id: 'linux-process', title: '进程与线程', month: '2026-11',
          summary: '进程、线程、信号、/proc。Java 线上排障（CPU 飙高、内存泄漏）和入侵排查（可疑进程）都从这里开始。',
          points: [
            '进程 vs 线程，PID / PPID，前台/后台，守护进程',
            'ps / top / htop / pstree，读懂 load average',
            '信号：SIGTERM vs SIGKILL，kill -3 打 Java 线程栈',
            '/proc/<pid>/ 下的 cmdline、environ、fd、maps',
            '僵尸进程与孤儿进程',
          ],
          questions: ['为什么把密码放在命令行参数里是危险的？（提示：/proc/<pid>/cmdline）'],
          practice: ['找到本机 Java 进程，用 top -H -p 找出最忙的线程并与 jstack 对应'],
          resources: [
            { t: 'man7：proc(5)', u: 'https://man7.org/linux/man-pages/man5/proc.5.html', type: '官方' },
            { t: 'Brendan Gregg：Linux Performance', u: 'https://www.brendangregg.com/linuxperf.html', type: '教程' },
          ],
        },
        {
          id: 'linux-perm', title: '用户、用户组与文件权限', month: '2026-11',
          summary: 'rwx、属主属组、SUID、sudo。最小权限原则在操作系统层的体现，也是提权的主战场。',
          points: [
            '用户 / 用户组 / /etc/passwd 与 /etc/shadow',
            'rwx 与八进制权限，chmod / chown / umask',
            'SUID / SGID / Sticky bit，以及 SUID 程序为何是提权目标',
            'sudo 与 /etc/sudoers，最小权限',
            '应用为什么不应该以 root 运行',
          ],
          questions: ['一个以 root 运行的 Spring Boot 被 RCE，和以普通用户运行，危害差多少？'],
          practice: ['新建一个 app 用户，让 Spring Boot jar 以该用户运行', '用 find / -perm -4000 找出系统里的 SUID 程序'],
          resources: [
            { t: 'man7：credentials(7)', u: 'https://man7.org/linux/man-pages/man7/credentials.7.html', type: '官方' },
            { t: 'Arch Wiki：File permissions and attributes', u: 'https://wiki.archlinux.org/title/File_permissions_and_attributes', type: '官方' },
            { t: 'GTFOBins（SUID/sudo 滥用参考）', u: 'https://gtfobins.github.io/', type: '工具' },
          ],
        },
        {
          id: 'linux-net', title: '端口与进程网络', month: '2026-12',
          summary: '哪个进程监听了哪个端口、连向了哪里。入侵排查和微服务排障共用的一组命令。',
          points: [
            'ss -tlnp / netstat -tlnp：监听端口与所属进程',
            'lsof -i / lsof -p：进程打开的文件和连接',
            '0.0.0.0 vs 127.0.0.1 监听的区别',
            'ip addr / ip route，/etc/hosts 与 /etc/resolv.conf',
          ],
          questions: ['为什么数据库、Redis 默认只应该监听 127.0.0.1 或内网？'],
          practice: ['列出本机所有监听端口，逐一说出它是什么服务、是否应该对外'],
          resources: [
            { t: 'man7：ss(8)', u: 'https://man7.org/linux/man-pages/man8/ss.8.html', type: '官方' },
            { t: 'man7：lsof(8)', u: 'https://man7.org/linux/man-pages/man8/lsof.8.html', type: '官方' },
          ],
        },
        {
          id: 'linux-ssh', title: 'SSH 与加固', month: '2026-12',
          summary: '公钥认证、端口转发、跳板机，以及一台新服务器上线必做的 SSH 加固。',
          points: [
            '密钥对认证原理，authorized_keys，known_hosts 的作用',
            '禁用密码登录与 root 登录，限制用户',
            '本地/远程端口转发（-L / -R）与跳板机（ProxyJump）',
            'fail2ban 与暴力破解日志',
          ],
          questions: ['第一次连接时“确认主机指纹”这一步防的是什么攻击？'],
          practice: ['在云主机或虚拟机上完成 SSH 加固，并在 auth 日志里找到失败的登录尝试'],
          resources: [
            { t: 'OpenSSH 手册', u: 'https://www.openssh.com/manual.html', type: '官方' },
            { t: 'Mozilla：OpenSSH 安全配置指南', u: 'https://infosec.mozilla.org/guidelines/openssh', type: '标准' },
            { t: 'CIS Benchmarks（Linux 加固基线）', u: 'https://www.cisecurity.org/cis-benchmarks', type: '标准' },
          ],
        },
        {
          id: 'linux-systemd', title: 'systemd、日志与防火墙', month: '2026-12',
          summary: '把 Java 服务托管给 systemd，用 journalctl 看日志，用 nftables/iptables 做默认拒绝。',
          points: [
            'systemctl start/stop/enable/status，编写 .service 文件',
            'systemd 的安全选项：User=、NoNewPrivileges=、ProtectSystem=',
            'journalctl -u / -f / --since；/var/log 下的关键日志',
            'iptables / nftables 基本规则：默认拒绝、放行 22/80/443',
          ],
          questions: ['入侵后攻击者常会清理哪些日志？你如何让日志更难被篡改？'],
          practice: ['把 MyNotes 注册成 systemd 服务，并用 nftables 只放行 22 和 8080'],
          resources: [
            { t: 'Arch Wiki：systemd', u: 'https://wiki.archlinux.org/title/Systemd', type: '官方' },
            { t: 'man7：systemd.exec(5)（安全沙箱选项）', u: 'https://man7.org/linux/man-pages/man5/systemd.exec.5.html', type: '官方' },
            { t: 'nftables Wiki', u: 'https://wiki.nftables.org/', type: '官方' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S3
    {
      id: 's3', title: 'Web Security', from: '2026-12', to: '2027-03',
      goal: '每个漏洞都做到：能讲原理、能在自己的 Spring Boot 里复现、能写出修复并用测试证明。',
      topics: [
        {
          id: 'web-basics', title: 'Web 安全基础：同源、CORS、安全头', month: '2026-12',
          summary: '浏览器安全模型是 XSS / CSRF / CORS 漏洞的共同背景。先建立 OWASP Top 10 的全局视图。',
          points: [
            '同源策略：什么是“源”，它限制了什么、没限制什么',
            'CORS：预检请求，Access-Control-Allow-Origin 反射 Origin + Credentials 的危害',
            '安全响应头：CSP、HSTS、X-Content-Type-Options、X-Frame-Options / frame-ancestors',
            'OWASP Top 10 各项含义，信任边界与“所有输入都不可信”',
            '搭好 Burp Suite Community，会用 Proxy 与 Repeater',
          ],
          questions: ['CORS 配置成 * 为什么浏览器不允许同时携带 Cookie？'],
          practice: ['注册 PortSwigger Web Security Academy 账号', '安装 Burp Suite Community 并代理浏览器流量'],
          resources: [
            { t: 'PortSwigger Web Security Academy（免费、业界最好的 Web 安全靶场课程）', u: 'https://portswigger.net/web-security', type: '靶场' },
            { t: 'OWASP Top 10', u: 'https://owasp.org/www-project-top-ten/', type: '标准' },
            { t: 'OWASP Cheat Sheet Series', u: 'https://cheatsheetseries.owasp.org/', type: '标准' },
            { t: 'MDN：Same-origin policy', u: 'https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy', type: '官方' },
            { t: 'PortSwigger：CORS', u: 'https://portswigger.net/web-security/cors', type: '靶场' },
            { t: 'OWASP：HTTP Headers Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html', type: '标准' },
            { t: 'Burp Suite Community Edition', u: 'https://portswigger.net/burp/communitydownload', type: '工具' },
            { t: '《白帽子讲Web安全》（吴翰清）', u: '', type: '书' },
          ],
        },
        {
          id: 'web-sqli', title: 'SQL 注入', month: '2027-01', lab: '01-sql-injection.md',
          summary: '数据被当成代码执行的典型。Java 里的根因几乎都是字符串拼接 SQL（包括 MyBatis 的 ${}）。',
          points: [
            '联合查询、报错注入、布尔盲注、时间盲注',
            '预编译（PreparedStatement）为什么能根治，它挡不住哪些位置（表名、ORDER BY）',
            'MyBatis #{} vs ${}；JPA 原生查询拼接',
            'ORDER BY / 表名等动态部分用白名单',
            'LIKE 通配符转义与二次注入',
          ],
          questions: ['为什么“过滤单引号”不是 SQL 注入的解决方案？'],
          practice: ['完成 Lab 01（本项目 /vuln/l01 vs /secure/l01）并写笔记', '完成 PortSwigger SQL injection 的 Apprentice 级别实验'],
          resources: [
            { t: 'PortSwigger：SQL injection', u: 'https://portswigger.net/web-security/sql-injection', type: '靶场' },
            { t: 'OWASP：SQL Injection Prevention Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html', type: '标准' },
            { t: 'CWE-89：SQL Injection', u: 'https://cwe.mitre.org/data/definitions/89.html', type: '标准' },
          ],
        },
        {
          id: 'web-xss', title: 'XSS 与 CSP', month: '2027-01', lab: '02-xss.md',
          summary: '在别人的浏览器里执行你的脚本。核心防御是“按输出上下文编码”，CSP 是纵深防御。',
          points: [
            '反射型 / 存储型 / DOM 型 XSS',
            '输出上下文：HTML 正文、属性、JS、URL 分别如何编码',
            'innerHTML、v-html、dangerouslySetInnerHTML 等危险 sink',
            'CSP：script-src、nonce、strict-dynamic；HttpOnly Cookie 的作用与局限',
          ],
          questions: ['有了 HttpOnly，XSS 还能造成哪些危害？'],
          practice: ['完成 Lab 02 并写笔记', '完成 PortSwigger XSS 的 Apprentice 级别实验'],
          resources: [
            { t: 'PortSwigger：Cross-site scripting', u: 'https://portswigger.net/web-security/cross-site-scripting', type: '靶场' },
            { t: 'OWASP：XSS Prevention Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html', type: '标准' },
            { t: 'MDN：Content Security Policy', u: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP', type: '官方' },
            { t: 'OWASP：Content Security Policy Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html', type: '标准' },
          ],
        },
        {
          id: 'web-csrf', title: 'CSRF', month: '2027-01',
          summary: '借用户已登录的身份发请求。基于 Cookie 的会话才有 CSRF；Token + SameSite 是标准解法。',
          points: [
            'CSRF 的前提条件：Cookie 会话、可预测的请求、无额外校验',
            'Synchronizer Token / Double Submit Cookie',
            'SameSite 的三种取值与局限（子域、GET 修改状态）',
            'Spring Security 默认的 CSRF 防护，以及何时可以关闭',
          ],
          questions: ['纯 Bearer Token（放在 Authorization 头）的 API 需要防 CSRF 吗？'],
          practice: ['Lab 03：做完 Lab 10（Spring Security 登录）后实现 CSRF 攻防', '完成 PortSwigger CSRF 的 Apprentice 级别实验'],
          resources: [
            { t: 'PortSwigger：CSRF', u: 'https://portswigger.net/web-security/csrf', type: '靶场' },
            { t: 'OWASP：CSRF Prevention Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html', type: '标准' },
            { t: 'Spring Security：CSRF', u: 'https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html', type: '官方' },
          ],
        },
        {
          id: 'web-access', title: '越权（访问控制）', month: '2027-01', lab: '04-access-control.md',
          summary: 'OWASP Top 10 第一名。扫描器很难发现，只能靠设计：每个请求都要回答“你是谁、你能对这个对象做什么”。',
          points: [
            '水平越权（IDOR）与垂直越权',
            '过度返回数据（Excessive Data Exposure）',
            '“对象级”授权：查询时带上 owner 条件，而不是查完再比较',
            '默认拒绝，集中式授权检查',
          ],
          questions: ['把自增 ID 换成 UUID 能解决越权吗？'],
          practice: ['完成 Lab 04 的修复版（本项目中的练习）', '完成 PortSwigger Access control 的 Apprentice 级别实验'],
          resources: [
            { t: 'PortSwigger：Access control vulnerabilities', u: 'https://portswigger.net/web-security/access-control', type: '靶场' },
            { t: 'OWASP：Authorization Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html', type: '标准' },
            { t: 'OWASP：IDOR Prevention Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html', type: '标准' },
          ],
        },
        {
          id: 'web-ssrf', title: 'SSRF（重点）', month: '2027-02', lab: '05-ssrf.md',
          summary: '让服务器替你发请求。它连接了云环境（Metadata）、内网、微服务和 AI Agent 的工具调用——是贯穿整条路线的漏洞。',
          points: [
            'SSRF 的典型入口：URL 预览、图片下载、Webhook、PDF 生成、Agent 的 fetch 工具',
            '攻击目标：127.0.0.1、内网服务、云 Metadata（169.254.169.254）',
            '绕过手法：重定向、DNS rebinding、十进制/IPv6 地址、URL 解析差异',
            '防御：协议+域名白名单、解析后校验 IP、禁止重定向、出网代理隔离、IMDSv2',
          ],
          questions: ['为什么 SSRF 在云上的危害远大于在机房里？'],
          practice: ['Lab 05：给笔记加“图片 URL 预览”功能，实现 SSRF 攻防', '完成 PortSwigger SSRF 的 Apprentice 级别实验'],
          resources: [
            { t: 'PortSwigger：SSRF', u: 'https://portswigger.net/web-security/ssrf', type: '靶场' },
            { t: 'OWASP：SSRF Prevention Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html', type: '标准' },
            { t: 'AWS：Instance Metadata Service（IMDSv2）', u: 'https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html', type: '官方' },
          ],
        },
        {
          id: 'web-upload', title: '文件上传与路径穿越', month: '2027-02', lab: '06-upload.md',
          summary: '文件名和路径是用户输入。上传 WebShell、覆盖配置、读取任意文件都源于此。',
          points: [
            '路径穿越：../、编码绕过、Path.normalize 与 startsWith 校验',
            '上传：扩展名白名单、内容类型校验、随机文件名、存储在 Web 根目录之外',
            'Zip Slip（解压时的路径穿越）',
            '对象存储（OBS/S3）直传与预签名 URL 的权限',
          ],
          questions: ['只校验 Content-Type 为什么不够？'],
          practice: ['Lab 06：笔记附件上传 + 下载接口的攻防', '完成 PortSwigger File upload / Path traversal 的 Apprentice 实验'],
          resources: [
            { t: 'PortSwigger：File upload vulnerabilities', u: 'https://portswigger.net/web-security/file-upload', type: '靶场' },
            { t: 'PortSwigger：Path traversal', u: 'https://portswigger.net/web-security/file-path-traversal', type: '靶场' },
            { t: 'OWASP：File Upload Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html', type: '标准' },
          ],
        },
        {
          id: 'web-rce', title: 'RCE：命令注入 / 表达式注入', month: '2027-02',
          summary: 'Java 中的 RCE 常见于 Runtime.exec 拼接、SpEL/OGNL 表达式注入、模板注入（SSTI）以及反序列化。',
          points: [
            'Runtime.exec(String) vs ProcessBuilder(List)：shell 解析的差异',
            'SpEL 注入：StandardEvaluationContext vs SimpleEvaluationContext',
            '模板注入（Thymeleaf / Freemarker）',
            '历史案例：Log4Shell（JNDI 注入）、Spring4Shell',
          ],
          questions: ['Log4Shell 为什么影响面那么大？它和 SSRF、反序列化有什么联系？'],
          practice: ['Lab 07：命令注入 + SpEL 注入的攻防', '完成 PortSwigger OS command injection 实验'],
          resources: [
            { t: 'PortSwigger：OS command injection', u: 'https://portswigger.net/web-security/os-command-injection', type: '靶场' },
            { t: 'PortSwigger：Server-side template injection', u: 'https://portswigger.net/web-security/server-side-template-injection', type: '靶场' },
            { t: 'OWASP：OS Command Injection Defense Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html', type: '标准' },
            { t: 'CISA：Apache Log4j Vulnerability Guidance', u: 'https://www.cisa.gov/news-events/news/apache-log4j-vulnerability-guidance', type: '标准' },
          ],
        },
        {
          id: 'web-deser', title: 'Java 反序列化（你的主场）', month: '2027-03',
          summary: 'Java 开发者学安全的天然优势。理解 gadget chain，就理解了 Fastjson、Jackson 多态、XStream、Shiro 等一系列历史漏洞。',
          points: [
            'ObjectInputStream.readObject 为什么危险；gadget chain（如 Commons Collections）',
            'ysoserial 的原理与使用',
            'JSON 库多态反序列化：Fastjson autoType、Jackson enableDefaultTyping',
            '防御：不反序列化不可信数据、JEP 290 序列化过滤器、类白名单',
            'Oracle Java 安全编码指南中与序列化相关的章节',
          ],
          questions: ['为什么“升级 Commons Collections”并不能从根本上解决反序列化问题？'],
          practice: ['Lab 08：用 ysoserial 打本地漏洞接口，再用 ObjectInputFilter 修复', '完成 PortSwigger Insecure deserialization 实验'],
          resources: [
            { t: 'PortSwigger：Insecure deserialization', u: 'https://portswigger.net/web-security/deserialization', type: '靶场' },
            { t: 'OWASP：Deserialization Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html', type: '标准' },
            { t: 'Oracle：Secure Coding Guidelines for Java SE', u: 'https://www.oracle.com/java/technologies/javase/seccodeguide.html', type: '官方' },
            { t: 'JEP 290：Filter Incoming Serialization Data', u: 'https://openjdk.org/jeps/290', type: '规范' },
            { t: 'ysoserial', u: 'https://github.com/frohoff/ysoserial', type: '工具' },
            { t: 'OWASP：Java Security Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Java_Security_Cheat_Sheet.html', type: '标准' },
          ],
        },
        {
          id: 'web-authn', title: '认证漏洞与 JWT 安全', month: '2027-03',
          summary: '密码存储、暴力破解、会话固定、JWT 的 alg=none / 弱密钥 / 不校验过期。',
          points: [
            '密码存储：BCrypt / Argon2，为什么不能用 MD5/SHA 直接存',
            '暴力破解与撞库：限流、锁定、MFA',
            '会话固定、登录后更换 Session ID',
            'JWT 攻击：alg=none、算法混淆（RS256→HS256）、弱 HMAC 密钥、kid 注入',
            'JWT 最佳实践：固定算法、校验 exp/iss/aud、短有效期',
          ],
          questions: ['为什么“用户名不存在”和“密码错误”应该返回同样的提示？'],
          practice: ['Lab 09：JWT 漏洞攻防', 'Lab 10：明文密码 → BCrypt', '完成 PortSwigger Authentication 与 JWT 实验'],
          resources: [
            { t: 'PortSwigger：Authentication vulnerabilities', u: 'https://portswigger.net/web-security/authentication', type: '靶场' },
            { t: 'PortSwigger：JWT attacks', u: 'https://portswigger.net/web-security/jwt', type: '靶场' },
            { t: 'OWASP：Authentication Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html', type: '标准' },
            { t: 'OWASP：Password Storage Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html', type: '标准' },
            { t: 'OWASP：JSON Web Token Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html', type: '标准' },
            { t: 'RFC 8725：JSON Web Token Best Current Practices', u: 'https://www.rfc-editor.org/rfc/rfc8725', type: '规范' },
          ],
        },
        {
          id: 'web-api', title: 'API Security', month: '2027-03',
          summary: '后端工程师最直接相关的一块：REST / GraphQL 接口的对象级授权、批量赋值、限流、资源消耗。',
          points: [
            'OWASP API Security Top 10（2023）逐条理解',
            'BOLA / BFLA（对象级 / 功能级授权失效）',
            '批量赋值（Mass Assignment）：DTO 与实体分离',
            '限流、分页上限、资源消耗型攻击',
            'API 资产管理：废弃接口、影子 API',
          ],
          questions: ['直接用 JPA 实体接收 @RequestBody，会出现什么安全问题？'],
          practice: ['用 OWASP API Top 10 审计一遍你当前工作中的一个接口模块（只写笔记，不外传代码）'],
          resources: [
            { t: 'OWASP API Security Top 10 (2023)', u: 'https://owasp.org/API-Security/editions/2023/en/0x11-t10/', type: '标准' },
            { t: 'PortSwigger：API testing', u: 'https://portswigger.net/web-security/api-testing', type: '靶场' },
            { t: 'OWASP：REST Security Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html', type: '标准' },
            { t: 'OWASP Juice Shop（综合靶场）', u: 'https://owasp.org/www-project-juice-shop/', type: '靶场' },
            { t: 'OWASP Web Security Testing Guide', u: 'https://owasp.org/www-project-web-security-testing-guide/', type: '标准' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S4
    {
      id: 's4', title: 'Spring Security', from: '2027-04', to: '2027-05',
      goal: 'Java + Security 真正结合：做出一个可以写进简历的企业级认证授权中心。',
      topics: [
        {
          id: 'ss-arch', title: 'Spring Security 架构', month: '2027-04',
          summary: 'SecurityFilterChain、Authentication、SecurityContext。先搞懂一个请求在过滤器链里经历了什么。',
          points: [
            'DelegatingFilterProxy → FilterChainProxy → SecurityFilterChain',
            'Authentication / AuthenticationManager / AuthenticationProvider / UserDetailsService',
            'SecurityContextHolder 与线程模型',
            'PasswordEncoder 与 DelegatingPasswordEncoder',
            '异常处理：AuthenticationEntryPoint vs AccessDeniedHandler（401 vs 403）',
          ],
          questions: ['@Async 方法里为什么拿不到当前登录用户？'],
          practice: ['给 MyNotes 接入 Spring Security 表单登录，替换 X-User-Id 头（Lab 10）', '开启 DEBUG 日志，观察过滤器链的执行顺序'],
          resources: [
            { t: 'Spring Security Reference', u: 'https://docs.spring.io/spring-security/reference/', type: '官方' },
            { t: 'Spring Security：Servlet Architecture', u: 'https://docs.spring.io/spring-security/reference/servlet/architecture.html', type: '官方' },
            { t: 'Spring Guide：Securing a Web Application', u: 'https://spring.io/guides/gs/securing-web/', type: '官方' },
          ],
        },
        {
          id: 'ss-authz', title: '授权：RBAC / ABAC', month: '2027-04',
          summary: '从“角色”到“属性”。URL 级、方法级、对象级授权的分层设计。',
          points: [
            'RBAC：用户-角色-权限模型，角色继承',
            'ABAC：基于属性（部门、数据归属、时间）的策略',
            'authorizeHttpRequests 与 @PreAuthorize / @PostAuthorize',
            '自定义 AuthorizationManager 实现对象级授权',
            '多租户 / 组织维度的数据隔离',
          ],
          questions: ['“管理员能看所有数据”这种规则应该写在 URL 层、方法层还是 SQL 层？'],
          practice: ['设计用户/角色/权限/组织四张表并实现接口级 + 数据级权限'],
          resources: [
            { t: 'Spring Security：Authorization', u: 'https://docs.spring.io/spring-security/reference/servlet/authorization/index.html', type: '官方' },
            { t: 'NIST：Role Based Access Control', u: 'https://csrc.nist.gov/projects/role-based-access-control', type: '标准' },
            { t: 'NIST SP 800-162：ABAC Definition and Considerations', u: 'https://csrc.nist.gov/pubs/sp/800/162/upd2/final', type: '标准' },
          ],
        },
        {
          id: 'ss-oauth2', title: 'OAuth2 / OIDC', month: '2027-05',
          summary: 'OAuth2 解决“授权”，OIDC 在其上解决“认证”。重点是授权码 + PKCE 流程和常见的配置漏洞。',
          points: [
            '四个角色：Resource Owner / Client / Authorization Server / Resource Server',
            '授权码模式 + PKCE；为什么隐式模式和密码模式被废弃',
            'OIDC：ID Token、UserInfo、Discovery',
            'OAuth 常见漏洞：redirect_uri 校验不严、state 缺失、Token 泄露',
            'Spring Security OAuth2 Client / Resource Server / Authorization Server',
          ],
          questions: ['ID Token 能不能拿来调用后端 API？为什么？'],
          practice: ['用 Keycloak 或 Spring Authorization Server 搭一个授权服务器，完成授权码 + PKCE 登录', '完成 PortSwigger OAuth 实验'],
          resources: [
            { t: 'oauth.net：OAuth 2.0', u: 'https://oauth.net/2/', type: '教程' },
            { t: 'RFC 6749：The OAuth 2.0 Authorization Framework', u: 'https://www.rfc-editor.org/rfc/rfc6749', type: '规范' },
            { t: 'RFC 9700：OAuth 2.0 Security Best Current Practice', u: 'https://www.rfc-editor.org/rfc/rfc9700', type: '规范' },
            { t: 'RFC 7636：PKCE', u: 'https://www.rfc-editor.org/rfc/rfc7636', type: '规范' },
            { t: 'OpenID Connect Core 1.0', u: 'https://openid.net/specs/openid-connect-core-1_0.html', type: '规范' },
            { t: 'Spring Security：OAuth2', u: 'https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html', type: '官方' },
            { t: 'Spring Security：Authorization Server（原 Spring Authorization Server）', u: 'https://docs.spring.io/spring-security/reference/servlet/oauth2/authorization-server/index.html', type: '官方' },
            { t: 'Keycloak Documentation', u: 'https://www.keycloak.org/documentation', type: '官方' },
            { t: 'PortSwigger：OAuth authentication', u: 'https://portswigger.net/web-security/oauth', type: '靶场' },
            { t: 'OWASP：OAuth2 Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html', type: '标准' },
          ],
        },
        {
          id: 'ss-token', title: 'Access / Refresh Token、撤销与 SSO', month: '2027-05',
          summary: 'Token 生命周期设计：短 Access Token + 可轮换的 Refresh Token + 撤销列表，再加审计日志。',
          points: [
            'Access Token 短有效期，Refresh Token 轮换（Rotation）与重放检测',
            'Token 撤销：黑名单（Redis）、版本号、Introspection（RFC 7662）',
            '登出的真正含义：客户端、服务端、SSO 全局登出',
            'SSO：基于 OIDC 的单点登录',
            '审计日志：谁在什么时候对什么做了什么（不记录敏感数据）',
          ],
          questions: ['Refresh Token 被偷了，Rotation 机制如何帮你发现？'],
          practice: ['在认证中心里实现 Refresh Token 轮换 + Redis 撤销 + 审计日志'],
          resources: [
            { t: 'Spring Security：OAuth2 Resource Server JWT', u: 'https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html', type: '官方' },
            { t: 'RFC 7662：OAuth 2.0 Token Introspection', u: 'https://www.rfc-editor.org/rfc/rfc7662', type: '规范' },
            { t: 'NIST SP 800-63B：Digital Identity Guidelines（认证与生命周期）', u: 'https://pages.nist.gov/800-63-4/sp800-63b.html', type: '标准' },
            { t: 'OWASP：Logging Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html', type: '标准' },
            { t: 'OWASP ASVS（应用安全验证标准）', u: 'https://owasp.org/ASVS/', type: '标准' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S5
    {
      id: 's5', title: '容器与 Kubernetes 安全', from: '2027-07', to: '2027-12',
      goal: '回答“一个 Docker 容器到底为什么不是虚拟机”，并能给一个 Spring Boot 服务配出安全的 K8s 部署。',
      topics: [
        {
          id: 'docker-basics', title: 'Docker 基础', month: '2027-07',
          summary: '镜像、容器、仓库、网络、卷。先会用，再看安全。',
          points: [
            'Image / Container / Registry / Layer',
            'Dockerfile 最佳实践：多阶段构建、最小基础镜像、非 root 用户',
            'Docker Network（bridge / host）与 Volume',
            '镜像漏洞扫描与 SBOM',
          ],
          questions: ['把 /var/run/docker.sock 挂进容器等于给了什么权限？'],
          practice: ['把 MyNotes 做成多阶段构建镜像，以非 root 用户运行', '用 Trivy 扫描镜像漏洞'],
          resources: [
            { t: 'Docker Docs：Get started', u: 'https://docs.docker.com/get-started/', type: '官方' },
            { t: 'Docker Docs：Engine security', u: 'https://docs.docker.com/engine/security/', type: '官方' },
            { t: 'OWASP：Docker Security Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html', type: '标准' },
            { t: 'Trivy', u: 'https://trivy.dev/', type: '工具' },
          ],
        },
        {
          id: 'docker-isolation', title: '容器隔离：Namespace / Cgroup / Capabilities', month: '2027-08',
          summary: '容器 = 共享内核的进程 + 隔离视图 + 资源限制。这正是容器逃逸存在的原因。',
          points: [
            '七类 Namespace：pid / net / mnt / uts / ipc / user / cgroup',
            'Cgroup：CPU、内存限制',
            'Linux Capabilities 与 --privileged 的危害',
            'seccomp、AppArmor/SELinux',
            '容器逃逸的常见路径：特权容器、docker.sock、内核漏洞、敏感挂载',
          ],
          questions: ['一个 Docker 容器到底为什么不是虚拟机？（写进笔记，用你自己的话）'],
          practice: ['用 unshare 手工创建一个 PID + mount namespace，体会“容器只是进程”'],
          resources: [
            { t: 'man7：namespaces(7)', u: 'https://man7.org/linux/man-pages/man7/namespaces.7.html', type: '官方' },
            { t: 'man7：cgroups(7)', u: 'https://man7.org/linux/man-pages/man7/cgroups.7.html', type: '官方' },
            { t: 'man7：capabilities(7)', u: 'https://man7.org/linux/man-pages/man7/capabilities.7.html', type: '官方' },
            { t: 'NIST SP 800-190：Application Container Security Guide', u: 'https://csrc.nist.gov/pubs/sp/800/190/final', type: '标准' },
            { t: '《Container Security》（Liz Rice，O\'Reilly）', u: '', type: '书' },
          ],
        },
        {
          id: 'k8s-basics', title: 'Kubernetes 核心对象', month: '2027-09',
          summary: 'Pod、Deployment、Service、Ingress、ConfigMap、Secret、ServiceAccount。',
          points: [
            'Pod / Deployment / Service / Ingress 的关系',
            'ConfigMap vs Secret（Secret 默认只是 Base64）',
            'ServiceAccount 与自动挂载的 Token',
            'API Server 是一切的入口：认证 → 授权 → 准入控制',
          ],
          questions: ['Pod 里默认挂载的 ServiceAccount Token 被拿到，攻击者能做什么？'],
          practice: ['用 kind 或 minikube 部署 MyNotes（Deployment + Service + Ingress）'],
          resources: [
            { t: 'Kubernetes Docs：Concepts', u: 'https://kubernetes.io/docs/concepts/', type: '官方' },
            { t: 'Kubernetes Docs：Secrets', u: 'https://kubernetes.io/docs/concepts/configuration/secret/', type: '官方' },
            { t: 'Killercoda（免费在线 K8s 环境）', u: 'https://killercoda.com/', type: '靶场' },
          ],
        },
        {
          id: 'k8s-rbac', title: 'Kubernetes RBAC（重点）', month: '2027-10',
          summary: 'Role / ClusterRole / RoleBinding。和你在 Spring Security 里做的 RBAC 是同一个思想，只是对象换成了集群资源。',
          points: [
            'Role vs ClusterRole，RoleBinding vs ClusterRoleBinding',
            '危险权限：secrets 的 get/list、pods/exec、create pods、escalate/bind/impersonate',
            'kubectl auth can-i 审计权限',
            '为每个应用使用独立 ServiceAccount，关闭不需要的 Token 自动挂载',
          ],
          questions: ['为什么“能创建 Pod”几乎等价于“能拿到节点权限”？'],
          practice: ['给 MyNotes 创建最小权限 ServiceAccount，并用 can-i 验证', '完成 Kubernetes Goat 中与 RBAC 相关的场景'],
          resources: [
            { t: 'Kubernetes Docs：Using RBAC Authorization', u: 'https://kubernetes.io/docs/reference/access-authn-authz/rbac/', type: '官方' },
            { t: 'Kubernetes Docs：RBAC Good Practices', u: 'https://kubernetes.io/docs/concepts/security/rbac-good-practices/', type: '官方' },
            { t: 'Kubernetes Goat（K8s 安全靶场）', u: 'https://madhuakula.com/kubernetes-goat/', type: '靶场' },
          ],
        },
        {
          id: 'k8s-hardening', title: 'Pod Security / NetworkPolicy / 加固', month: '2027-11',
          summary: 'Pod Security Standards、NetworkPolicy 默认拒绝、Secret 管理、镜像来源控制、审计日志。',
          points: [
            'Pod Security Standards：privileged / baseline / restricted',
            'securityContext：runAsNonRoot、readOnlyRootFilesystem、drop ALL capabilities',
            'NetworkPolicy：默认拒绝 + 按需放行',
            'Secret 加密（etcd encryption）与外部密钥管理',
            'CIS Kubernetes Benchmark 与 kube-bench',
          ],
          questions: ['没有 NetworkPolicy 的集群里，一个被攻破的 Pod 能访问哪些东西？'],
          practice: ['给 MyNotes 命名空间加上 restricted 级别 + 默认拒绝的 NetworkPolicy', '跑一次 kube-bench 并解读结果'],
          resources: [
            { t: 'Kubernetes Docs：Pod Security Standards', u: 'https://kubernetes.io/docs/concepts/security/pod-security-standards/', type: '官方' },
            { t: 'Kubernetes Docs：Network Policies', u: 'https://kubernetes.io/docs/concepts/services-networking/network-policies/', type: '官方' },
            { t: 'Kubernetes Docs：Security Checklist', u: 'https://kubernetes.io/docs/concepts/security/security-checklist/', type: '官方' },
            { t: 'OWASP：Kubernetes Security Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Kubernetes_Security_Cheat_Sheet.html', type: '标准' },
            { t: 'kube-bench', u: 'https://github.com/aquasecurity/kube-bench', type: '工具' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S6
    {
      id: 's6', title: 'Cloud Security', from: '2028-01', to: '2028-06',
      goal: '选一个云平台深入（建议华为云），掌握 IAM、密钥、PKI、零信任和审计，形成专业方向。',
      topics: [
        {
          id: 'cloud-iam', title: '云 IAM', month: '2028-01',
          summary: '云上最核心的安全边界是身份，而不是网络。',
          points: [
            '用户 / 用户组 / 角色 / 策略 / 委托（华为云）或 AssumeRole（AWS）',
            '最小权限策略编写，条件键',
            '临时凭证 vs 长期 AK/SK，AK/SK 泄露的应急流程',
            '云上共享责任模型',
          ],
          questions: ['GitHub 上泄露一对 AK/SK，攻击者最先会做什么？'],
          practice: ['在华为云上为 OBS 创建一个只读某个桶的最小权限策略'],
          resources: [
            { t: '华为云：统一身份认证 IAM 文档', u: 'https://support.huaweicloud.com/iam/index.html', type: '官方' },
            { t: 'AWS Well-Architected：Security Pillar', u: 'https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html', type: '官方' },
            { t: 'flAWS（AWS 云安全闯关）', u: 'http://flaws.cloud/', type: '靶场' },
          ],
        },
        {
          id: 'cloud-secrets', title: 'KMS 与 Secrets Management', month: '2028-02',
          summary: '密钥不进代码、不进镜像、不进 Git。信封加密与密钥轮换。',
          points: [
            'KMS 与信封加密（CMK / DEK）',
            '凭据管理服务 / HashiCorp Vault：动态凭据、租约',
            '密钥轮换与访问审计',
            'Git 泄露扫描（gitleaks 等）',
          ],
          questions: ['数据库密码放在 K8s Secret 里就安全了吗？'],
          practice: ['让 Spring Boot 从 Vault 或华为云 DEW 读取数据库密码'],
          resources: [
            { t: '华为云：数据加密服务 DEW 文档', u: 'https://support.huaweicloud.com/dew/index.html', type: '官方' },
            { t: 'HashiCorp Vault Docs', u: 'https://developer.hashicorp.com/vault/docs', type: '官方' },
            { t: 'OWASP：Secrets Management Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html', type: '标准' },
            { t: 'gitleaks', u: 'https://github.com/gitleaks/gitleaks', type: '工具' },
          ],
        },
        {
          id: 'cloud-zerotrust', title: 'PKI 与零信任', month: '2028-03',
          summary: '从“内网即可信”到“每次访问都验证”。服务间 mTLS、身份感知代理。',
          points: [
            'PKI：CA 层级、证书签发、吊销（CRL / OCSP）',
            '零信任的核心原则（NIST SP 800-207）',
            '服务间 mTLS 与服务网格（Istio）身份',
            'API Gateway 的鉴权、限流、WAF',
          ],
          questions: ['传统 VPN + 内网信任的模型，在攻击者进入内网后有什么问题？'],
          practice: ['用 step-ca 或 openssl 搭一个私有 CA，给两个服务配置 mTLS'],
          resources: [
            { t: 'NIST SP 800-207：Zero Trust Architecture', u: 'https://csrc.nist.gov/pubs/sp/800/207/final', type: '标准' },
            { t: 'Google BeyondCorp 论文集', u: 'https://cloud.google.com/beyondcorp', type: '教程' },
            { t: 'Smallstep step-ca', u: 'https://smallstep.com/docs/step-ca/', type: '工具' },
          ],
        },
        {
          id: 'cloud-detect', title: '审计、日志与 SIEM', month: '2028-04',
          summary: '防不住的时候要能看得见：云审计、集中日志、告警与响应。',
          points: [
            '云审计服务（华为云 CTS / AWS CloudTrail）记录什么',
            '集中日志与关联分析（SIEM）',
            'MITRE ATT&CK 云矩阵：攻击者在云上的常见行为',
            '安全事件响应流程：发现 → 遏制 → 根除 → 恢复 → 复盘',
          ],
          questions: ['哪些日志一旦缺失，你就无法还原一次入侵？'],
          practice: ['为你的项目设计一份安全审计日志规范，并接入一个 SIEM（如 Elastic）做一条告警规则'],
          resources: [
            { t: '华为云：云审计服务 CTS 文档', u: 'https://support.huaweicloud.com/cts/index.html', type: '官方' },
            { t: 'MITRE ATT&CK：Cloud Matrix', u: 'https://attack.mitre.org/matrices/enterprise/cloud/', type: '标准' },
            { t: 'NIST SP 800-61：Incident Response', u: 'https://csrc.nist.gov/pubs/sp/800/61/r3/final', type: '标准' },
          ],
        },
        {
          id: 'cloud-huawei', title: '华为云安全实践', month: '2028-05',
          summary: '把前面学的概念落在一个云平台上：OBS 权限、VPC、安全组、WAF、主机安全。',
          points: [
            'OBS 桶策略、ACL、预签名 URL，公开桶的风险',
            'VPC、子网、安全组、网络 ACL',
            'WAF、主机安全、云防火墙',
            'CSA 云控制矩阵（CCM）作为检查清单',
          ],
          questions: ['“桶公开读”在什么情况下是合理的？如何确保只有这些桶是公开的？'],
          practice: ['用华为云搭一套 VPC + ECS + OBS，并按 CCM 做一遍自查'],
          resources: [
            { t: '华为云：对象存储服务 OBS 文档', u: 'https://support.huaweicloud.com/obs/index.html', type: '官方' },
            { t: '华为云：虚拟私有云 VPC 文档', u: 'https://support.huaweicloud.com/vpc/index.html', type: '官方' },
            { t: 'CSA：Cloud Controls Matrix', u: 'https://cloudsecurityalliance.org/research/cloud-controls-matrix', type: '标准' },
            { t: 'CloudGoat（云安全靶场）', u: 'https://github.com/RhinoSecurityLabs/cloudgoat', type: '靶场' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S7
    {
      id: 's7', title: 'IoT Security', from: '2028-06', to: '2028-10',
      goal: '把 Java + MQTT + EMQX + 汽车/IoT 经历 + 安全串起来，形成差异化方向。',
      topics: [
        {
          id: 'iot-mqtt', title: 'MQTT 协议与 EMQX', month: '2028-06',
          summary: '发布/订阅模型、QoS、保留消息、遗嘱消息、主题通配符——每一个特性都有安全含义。',
          points: [
            'MQTT 3.1.1 / 5.0 报文结构，CONNECT 中的 ClientID / 用户名 / 密码',
            '主题通配符 + / #，订阅 # 意味着什么',
            'QoS、Retain、Will 消息',
            'EMQX 集群、规则引擎、数据桥接',
          ],
          questions: ['如果任何客户端都能订阅 #，会泄露什么？'],
          practice: ['用 Docker 起 EMQX，用 Eclipse Paho（Java）写一个设备模拟器'],
          resources: [
            { t: 'OASIS：MQTT Version 5.0 规范', u: 'https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html', type: '规范' },
            { t: 'EMQX 文档', u: 'https://docs.emqx.com/zh/emqx/latest/', type: '官方' },
            { t: 'Eclipse Paho', u: 'https://eclipse.dev/paho/', type: '工具' },
          ],
        },
        {
          id: 'iot-identity', title: '设备身份：TLS / 证书 / Token', month: '2028-07',
          summary: '每台设备都要有独立、可吊销的身份。一机一密、一机一证。',
          points: [
            '一型一密 vs 一机一密 vs 一机一证',
            'MQTT over TLS 与 mTLS 双向认证',
            '设备证书的签发、轮换与吊销',
            '安全存储：TPM / 安全芯片 / TEE 的作用',
          ],
          questions: ['一型一密的设备被拆机提取密钥后，影响范围有多大？'],
          practice: ['给 EMQX 配置 mTLS，用私有 CA 为每个模拟设备签发证书'],
          resources: [
            { t: 'EMQX 文档 › 访问控制 › 认证 / X.509 证书认证', u: 'https://docs.emqx.com/zh/emqx/latest/', type: '官方' },
            { t: 'EMQX 文档 › 网络 › 开启 SSL/TLS 连接（双向认证）', u: 'https://docs.emqx.com/zh/emqx/latest/', type: '官方' },
            { t: 'NIST IR 8259：IoT Device Cybersecurity Capability Core Baseline', u: 'https://csrc.nist.gov/pubs/ir/8259/final', type: '标准' },
          ],
        },
        {
          id: 'iot-acl', title: '设备权限与消息 ACL', month: '2028-08',
          summary: '设备只能发自己的主题、只能订阅发给自己的主题。本质仍是对象级授权。',
          points: [
            'EMQX 授权（ACL）：基于 ClientID / 用户名的主题模板',
            '设备只能 pub devices/{id}/up，只能 sub devices/{id}/down',
            '平台侧指令下发的授权与审计',
            '异常行为检测：频率、非常规主题、离线重连风暴',
          ],
          questions: ['这和 Web 的 IDOR 有什么共同点？'],
          practice: ['实现基于 HTTP 回调（Java 服务）的 EMQX 认证 + 授权，并写测试证明设备 A 读不到设备 B'],
          resources: [
            { t: 'EMQX 文档 › 访问控制 › 授权（ACL）', u: 'https://docs.emqx.com/zh/emqx/latest/', type: '官方' },
            { t: 'OWASP IoT Security Verification Standard (ISVS)', u: 'https://owasp.org/www-project-iot-security-verification-standard/', type: '标准' },
          ],
        },
        {
          id: 'iot-standards', title: 'IoT / 车联网安全标准', month: '2028-09',
          summary: '把你的汽车/IoT 经历升级为可以对外讲的专业方向：OWASP IoT、ETSI EN 303 645、ISO/SAE 21434、UN R155。',
          points: [
            'OWASP IoT Top 10',
            'ETSI EN 303 645 消费级 IoT 安全基线（禁止默认密码、漏洞披露、安全更新）',
            'ISO/SAE 21434 汽车网络安全工程与 TARA（威胁分析与风险评估）',
            'UN R155 / R156：车辆网络安全与软件升级法规',
            'OTA 升级的签名与回滚保护',
          ],
          questions: ['你过去做过的汽车/IoT 项目，按 EN 303 645 检查会有哪些不合规？（只写笔记）'],
          practice: ['对自己的 IoT Demo 做一次简化版 TARA'],
          resources: [
            { t: 'OWASP Internet of Things Project', u: 'https://owasp.org/www-project-internet-of-things/', type: '标准' },
            { t: 'ETSI：Consumer IoT Security（EN 303 645）', u: 'https://www.etsi.org/technologies/consumer-iot-security', type: '标准' },
            { t: 'ISO/SAE 21434：Road vehicles — Cybersecurity engineering', u: 'https://www.iso.org/standard/70918.html', type: '标准' },
            { t: 'UNECE：UN Regulation No. 155', u: 'https://unece.org/transport/documents/2021/03/standards/un-regulation-no-155-cyber-security-and-cyber-security', type: '标准' },
          ],
        },
      ],
    },

    // ------------------------------------------------------------------ S8
    {
      id: 's8', title: 'AI Security', from: '2028-10', to: '2029-12',
      goal: '不追框架，掌握“AI 系统如何被构建，以及如何被保护”：权限 / 数据 / 工具。',
      topics: [
        {
          id: 'ai-llm', title: 'LLM 基础（够用即可）', month: '2028-10',
          summary: 'Token、Embedding、Transformer、Context、RAG、Tool Calling、Agent——掌握到“能解释、能开发”的程度。',
          points: [
            'Token 与上下文窗口；为什么模型“记不住”超出上下文的内容',
            'Embedding 与向量相似度检索',
            'Transformer 与注意力机制的直觉理解',
            'RAG 的基本流程：切分 → 向量化 → 检索 → 拼接 Prompt',
            'Tool Calling 与 Agent 循环',
          ],
          questions: ['从安全角度看，LLM 最根本的问题是什么？（提示：指令和数据在同一个通道里）'],
          practice: ['用 Spring AI 写一个最小的 RAG + 一个 Tool Calling 示例'],
          resources: [
            { t: 'The Illustrated Transformer（Jay Alammar）', u: 'https://jalammar.github.io/illustrated-transformer/', type: '教程' },
            { t: '3Blue1Brown：Neural Networks 系列', u: 'https://www.3blue1brown.com/topics/neural-networks', type: '教程' },
            { t: 'Andrej Karpathy：Neural Networks: Zero to Hero', u: 'https://karpathy.ai/zero-to-hero.html', type: '教程' },
            { t: 'Attention Is All You Need（论文）', u: 'https://arxiv.org/abs/1706.03762', type: '规范' },
            { t: 'Spring AI Reference', u: 'https://docs.spring.io/spring-ai/reference/', type: '官方' },
            { t: 'Anthropic：Building effective agents', u: 'https://www.anthropic.com/engineering/building-effective-agents', type: '教程' },
          ],
        },
        {
          id: 'ai-prompt-injection', title: 'Prompt Injection', month: '2029-01',
          summary: '直接注入与间接注入（来自网页、邮件、文档、工具返回）。这是 AI 时代的“SQL 注入”，但没有“预编译”这样的根治方案。',
          points: [
            '直接注入 vs 间接注入（Indirect Prompt Injection）',
            '越狱（Jailbreak）与注入的区别',
            '为什么过滤和“更强的系统提示词”都不可靠',
            '防御思路：权限隔离、人类确认、输出校验、不可信内容标记、最小工具集',
          ],
          questions: ['为什么说 Prompt Injection 和 SQL 注入同源，却没有等价于“参数化查询”的解法？'],
          practice: ['通关 Gandalf', '完成 PortSwigger Web LLM attacks 实验'],
          resources: [
            { t: 'OWASP Top 10 for LLM Applications', u: 'https://genai.owasp.org/llm-top-10/', type: '标准' },
            { t: 'OWASP：LLM Prompt Injection Prevention Cheat Sheet', u: 'https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html', type: '标准' },
            { t: 'PortSwigger：Web LLM attacks', u: 'https://portswigger.net/web-security/llm-attacks', type: '靶场' },
            { t: 'Greshake et al.：Indirect Prompt Injection（论文）', u: 'https://arxiv.org/abs/2302.12173', type: '规范' },
            { t: 'Simon Willison：Prompt injection 系列文章', u: 'https://simonwillison.net/tags/prompt-injection/', type: '教程' },
            { t: 'Lakera Gandalf（提示注入闯关）', u: 'https://gandalf.lakera.ai/', type: '靶场' },
          ],
        },
        {
          id: 'ai-rag', title: 'RAG Security', month: '2029-03',
          summary: '“A 用户能不能通过 AI 看到 B 用户的数据？”——这是权限 + 数据安全 + AI 的交叉点，也是你 Web 越权经验的直接延伸。',
          points: [
            '检索阶段的权限过滤（在向量检索时带上 ACL，而不是检索后再过滤）',
            '多租户向量库隔离',
            '知识库投毒：恶意文档中的间接注入',
            '敏感数据脱敏与输出审查',
            'Embedding 反演与数据泄露风险',
          ],
          questions: ['“先检索 Top-K 再按权限过滤”有什么问题？'],
          practice: ['在 RAG Demo 中实现按用户权限过滤的检索，并写测试证明越权读取失败'],
          resources: [
            { t: 'OWASP LLM08：Vector and Embedding Weaknesses', u: 'https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/', type: '标准' },
            { t: 'OWASP LLM02：Sensitive Information Disclosure', u: 'https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/', type: '标准' },
          ],
        },
        {
          id: 'ai-agent', title: 'Agent Security（重点）', month: '2029-06',
          summary: 'Agent 能访问文件系统、数据库、Git、API、Shell、浏览器——“Agent 到底允许做什么？”是传统权限控制在 AI 时代的重现。',
          points: [
            '过度代理（Excessive Agency）：过多工具、过大权限、过少确认',
            '工具权限最小化：只读 vs 读写、按用户身份代理调用（而非服务账号）',
            'MCP 等工具协议的信任边界：工具描述投毒、恶意服务器',
            '沙箱：文件系统、网络出口（Agent 的 fetch 就是 SSRF 入口）',
            '人类确认（Human-in-the-loop）与操作审计',
          ],
          questions: ['一个能读邮件又能发邮件的 Agent，收到一封恶意邮件会发生什么？'],
          practice: ['给你的知识库 Agent 设计工具权限矩阵，并实现高危操作的人工确认 + 审计日志'],
          resources: [
            { t: 'OWASP LLM06：Excessive Agency', u: 'https://genai.owasp.org/llmrisk/llm062025-excessive-agency/', type: '标准' },
            { t: 'OWASP GenAI Security Project（含 Agentic AI 威胁与缓解）', u: 'https://genai.owasp.org/', type: '标准' },
            { t: 'Model Context Protocol 规范', u: 'https://modelcontextprotocol.io/', type: '规范' },
            { t: 'Anthropic：Tool use 文档', u: 'https://docs.claude.com/en/docs/agents-and-tools/tool-use/overview', type: '官方' },
          ],
        },
        {
          id: 'ai-governance', title: 'AI 安全框架与治理', month: '2029-09',
          summary: '把零散的攻击手法放进体系里：MITRE ATLAS（攻击知识库）、NIST AI RMF（风险管理）、Google SAIF。',
          points: [
            'MITRE ATLAS：针对 AI 系统的攻击战术与技术',
            'NIST AI RMF：Govern / Map / Measure / Manage',
            'NIST AI 100-2：对抗机器学习分类（投毒、逃逸、隐私攻击）',
            'LLM 红队测试与自动化扫描工具',
          ],
          questions: ['如果要向公司介绍“AI 应用上线前的安全评审清单”，你会列哪些项？'],
          practice: ['用 garak 扫描你自己的 Agent Demo，并把发现写成一份评估报告'],
          resources: [
            { t: 'MITRE ATLAS', u: 'https://atlas.mitre.org/', type: '标准' },
            { t: 'NIST AI Risk Management Framework', u: 'https://www.nist.gov/itl/ai-risk-management-framework', type: '标准' },
            { t: 'NIST AI 100-2：Adversarial Machine Learning Taxonomy', u: 'https://csrc.nist.gov/pubs/ai/100/2/e2023/final', type: '标准' },
            { t: 'Google Secure AI Framework (SAIF)', u: 'https://saif.google/', type: '标准' },
            { t: 'garak（LLM 漏洞扫描器）', u: 'https://github.com/NVIDIA/garak', type: '工具' },
          ],
        },
      ],
    },
  ],

  projects: [
    {
      id: 'p1', title: '项目①：安全 Web 服务', period: '2026 Q4 – 2027 Q1',
      stack: 'Spring Boot + MySQL + Nginx', link: 'docs/labs/README.md（就是本仓库）',
      milestones: [
        'Lab 01 SQL 注入：攻防 + 测试 + 笔记', 'Lab 02 XSS + CSP', 'Lab 04 越权：实现修复版',
        'Lab 05 SSRF', 'Lab 06 文件上传 + 路径穿越', 'Lab 07 RCE（命令注入 / SpEL）',
        'Lab 08 Java 反序列化', 'Lab 09 JWT 漏洞', 'Lab 10 BCrypt + Spring Security', 'Lab 03 CSRF',
        '从 H2 迁移到 MySQL，前面加 Nginx', '写一篇总结博客：“一个 Java 后端眼中的 Web 漏洞”',
      ],
    },
    {
      id: 'p2', title: '项目②：安全认证中心', period: '2027 Q1 – Q2',
      stack: 'Spring Boot + Spring Security + OAuth2 + JWT + Redis + MySQL',
      milestones: [
        '用户 / 角色 / 权限 / 组织 数据模型', '登录（BCrypt + 限流 + 锁定）', 'RBAC 接口权限 + 数据权限',
        'OAuth2 授权码 + PKCE / OIDC', 'Access Token + Refresh Token 轮换', 'Token 撤销（Redis）与登出',
        '审计日志', '用 OWASP ASVS L2 自查并写报告', '整理成简历项目描述',
      ],
    },
    {
      id: 'p3', title: '项目③：IoT 安全平台', period: '2027 Q2 – Q3（与 S7 呼应）',
      stack: 'MQTT + EMQX + Java + MySQL + Redis + Docker',
      milestones: [
        'Docker Compose 起 EMQX + Java 平台', '设备模拟器（Paho）', '一机一证 + mTLS',
        'HTTP 回调认证 / 授权（ACL）', '指令下发审计', '异常行为检测（频率 / 非常规主题）', '简化版 TARA 报告',
      ],
    },
    {
      id: 'p4', title: '项目④：Kubernetes 安全平台', period: '2027 Q4 – 2028',
      stack: 'Spring Boot → Docker → Kubernetes',
      milestones: [
        '多阶段镜像 + 非 root + Trivy 扫描', 'K8s 部署（Deployment / Service / Ingress）',
        '最小权限 ServiceAccount + RBAC', 'Pod Security restricted', 'NetworkPolicy 默认拒绝',
        'Secret 外部化（Vault / 云 KMS）', 'kube-bench 报告与整改',
      ],
    },
    {
      id: 'p5', title: '项目⑤：企业知识库 Agent（AI Security）', period: '2028 – 2029',
      stack: 'Java（Spring AI）+ RAG + 权限系统 + Tool + 数据库',
      milestones: [
        '最小 RAG 问答', '接入项目②的认证中心，检索按用户权限过滤', 'Tool Calling（查数据库 / 调 API）',
        '工具权限矩阵 + 高危操作人工确认', 'Prompt Injection / 间接注入攻防测试', '审计日志与告警',
        'garak / 红队测试报告', '写成对外分享或技术文章',
      ],
    },
  ],

  checkpoints: [
    { date: '2027-06-30', title: '第一年复盘：我是不是真的喜欢安全？', note: 'checkpoint-2027-06',
      detail: '喜欢 → 进入 K8s → Cloud → IoT → AI Security；不喜欢也没关系，网络 + Linux + Web 安全 + Java 安全依然会增强你的后端能力。' },
    { date: '2027-12-31', title: '开始尝试安全相关岗位 / 内部转岗', note: 'checkpoint-2027-12',
      detail: '关注：后端安全、应用安全、安全研发、DevSecOps、云安全、IoT/车联网安全、API Security。' },
    { date: '2034-12-31', title: '40 岁：从单一工资收入 → 工资 + 技术副业 + 软件产品 + 兴趣商业化', note: 'checkpoint-40',
      detail: '主业（Java + Security）/ 技术产品（AI / Security）/ 兴趣产品（多肉 / 株罗纪 / 壁纸）。' },
  ],

  careers: ['后端安全', '应用安全', '安全研发', 'DevSecOps', '云安全', 'IoT 安全', '车联网安全', 'API Security'],

  certs: [
    { t: 'CompTIA Security+', u: 'https://www.comptia.org/certifications/security', when: '想系统补基础、或目标岗位要求时' },
    { t: 'CKS（Certified Kubernetes Security Specialist）', u: 'https://training.linuxfoundation.org/certification/certified-kubernetes-security-specialist/', when: 'S5 完成后，与云原生方向最契合' },
    { t: 'OSCP（OffSec PEN-200）', u: 'https://www.offsec.com/courses/pen-200/', when: '只有明确走渗透方向才考虑' },
    { t: 'CISSP', u: 'https://www.isc2.org/certifications/cissp', when: '有安全工作经历、目标岗位明确后再决定' },
  ],

  pitfalls: [
    '不要同时学 AI、大数据、网络安全、K8s、云原生、Python、Go、Rust —— 会再次“什么都知道一点，什么都不会”',
    '不要为了转安全放弃 Java —— Java 是资产，不是负担',
    '不要追每个 AI 框架 —— 框架会换，网络 / OS / 数据库 / 权限 / 分布式 / 安全不会那么快换',
    '不要一开始就钻二进制逆向 —— 路线是 应用安全 → 云安全 → AI Security',
    '不要裸辞转行 —— 在职学习，优先在公司内部找安全相关的活',
    '项目 > 课程 > 证书：每个主题都要落到本项目的一个 Lab 或一段代码',
  ],
};
