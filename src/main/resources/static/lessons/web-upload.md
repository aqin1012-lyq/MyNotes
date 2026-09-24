## 为什么要学

文件上传和下载几乎是每个业务系统都有的功能：电商的商品图和售后凭证、IoT 平台的设备固件、车联网的行车记录导出、后台的批量导入。它们的共同要害是一句常被忽视的话：**文件名和路径，也是用户输入。** 用户能控制文件名、能控制解压后的路径、有时还能间接控制下载接口读哪个文件——只要你把这些当成可信数据直接拼进 `new File(dir + "/" + name)`，漏洞就出现了。

这一课接在 [[web-ssrf]] 之后、[[web-rce]] 之前，位置很关键：文件上传是通向 RCE 最直接的一条路——传一个 `shell.jsp`/`shell.php` 到能被解析执行的目录，就是一次完整的远程代码执行；而路径穿越（Path Traversal）则能让下载接口读到 `/etc/passwd`、`application-prod.yml` 里的数据库密码，甚至覆盖掉服务器上的配置文件和定时任务。

对你这样的 Java 后端来说，风险点非常具体：`MultipartFile.getOriginalFilename()` 返回的名字里可能带 `../`；`Paths.get(base, userName)` 拼出来的路径可能逃出 `base`；用 `ZipInputStream` 解压用户上传的压缩包时，压缩包内的条目名可能是 `../../etc/cron.d/x`（Zip Slip）。这一课就把这几处的**正确写法**用可编译的 Java 17 代码固定下来。

学完你应该能：写出经得起 `../` 和编码绕过的路径校验（`normalize()` + `startsWith()` 真实基准路径）、给上传文件生成随机名并存到 Web 根目录之外、以及安全地解压压缩包，并说清“只校验 Content-Type 为什么远远不够”。

## 核心概念

### 1. 路径穿越：../ 与 normalize + startsWith

路径穿越的本质：文件路径里出现 `..`（上级目录），让最终路径跳出你预期的目录。经典入口是下载接口：

```java
// 危险：name 由用户传入，?name=../../../../etc/passwd
@GetMapping("/download")
public byte[] bad(@RequestParam String name) throws IOException {
    return Files.readAllBytes(Paths.get("/app/uploads/" + name));  // 逃出 /app/uploads
}
```

`Paths.get("/app/uploads/" + "../../../../etc/passwd")` 会被系统解析成 `/etc/passwd`。除了直接的 `../`，还有编码绕过：`%2e%2e%2f`（URL 编码的 `../`）、`..%252f`（双重编码，某些框架会解两次）、Windows 上的 `..\`。所以“字符串里 `contains("..")` 就拒绝”既会误伤（合法文件名里也可能有 `..`），又可能漏（编码形式）。

正确做法只有一个可靠范式：**把路径规范化，再验证它仍在基准目录之内。**

```java
static final Path BASE = Paths.get("/app/uploads").toAbsolutePath().normalize();

static Path resolveSafe(String userName) {
    // resolve 拼接，normalize 消解掉 . 和 ..，得到绝对规范路径
    Path target = BASE.resolve(userName).normalize();
    // 关键：规范化之后，它必须仍以 BASE 开头，否则说明逃出去了
    if (!target.startsWith(BASE)) {
        throw new IllegalArgumentException("path traversal detected: " + userName);
    }
    return target;
}
```

三个要点，缺一不可：

- `BASE` 一定要先 `toAbsolutePath().normalize()`，得到一个**真实、规范的绝对路径**再当基准。拿一个带 `.`/`..` 的相对路径当 `BASE`，后面的 `startsWith` 判断就不可靠。
- `normalize()` 必须在 `startsWith` **之前**做：它把 `/app/uploads/../../etc/passwd` 化简成 `/etc/passwd`，这样 `startsWith(BASE)` 才能识破。
- `startsWith` 用的是 `Path` 的方法（按路径段比较），不是 `String.startsWith`。字符串前缀比较会被 `/app/uploads-evil/` 这种“前缀相同但不是子目录”的情况骗过，`Path.startsWith` 不会。

对付符号链接（symlink）攻击还可以更严格：用 `target.toRealPath()`（会跟随链接解析到真实位置）再 `startsWith(BASE.toRealPath())`。代价是文件必须已存在。

### 2. 上传：白名单、随机名、存到 Web 根之外

一个安全的上传要同时做到：**不信任文件名、不信任扩展名、不信任 Content-Type、不放在能被执行的目录**。

- **扩展名白名单**（不是黑名单）：只允许 `jpg/png/gif/webp/pdf` 等，而不是“禁止 jsp/php”。黑名单永远列不全（`jspx`、`phtml`、`pht`、大小写 `PhP`、末尾空格或点 `shell.jsp.`）。
- **内容类型校验要靠真实内容**，别信 `Content-Type` 请求头，也别只信扩展名——用文件头“魔数”判断（JPEG 是 `FF D8 FF`，PNG 是 `89 50 4E 47`）。
- **随机文件名**：不要用用户给的名字落盘。用 UUID 自己生成，只从原名里取一个受控的扩展名。这样既防路径穿越（名字里根本没有 `..`），也防覆盖已有文件、防靠文件名猜到别人的文件。
- **存到 Web 根目录之外**：上传目录不能是 Tomcat/Nginx 能直接按 URL 访问并解析的目录。存到 `/data/uploads`（应用之外），通过一个受控的下载接口带鉴权地读出来，而不是让用户直接 `GET /uploads/xxx.jsp`。

下面是把上面几条揉在一起的可编译写法：

```java
static final Path BASE = Paths.get("/data/uploads").toAbsolutePath().normalize();
static final Set<String> ALLOWED_EXT = Set.of("jpg", "jpeg", "png", "gif", "webp", "pdf");
static final long MAX_BYTES = 10L * 1024 * 1024;

@PostMapping("/upload")
public String upload(@RequestParam MultipartFile file) throws IOException {
    if (file.isEmpty() || file.getSize() > MAX_BYTES) {
        throw new IllegalArgumentException("empty or too large");
    }
    // 1) 从原始文件名里只取扩展名，且用白名单校验
    String original = file.getOriginalFilename();      // 可能是 ../../x.jsp，绝不直接用它落盘
    String ext = extensionOf(original);                 // 见下
    if (!ALLOWED_EXT.contains(ext)) {
        throw new IllegalArgumentException("extension not allowed: " + ext);
    }
    // 2) 用魔数确认真实类型，别信 Content-Type 头
    if (!looksLikeAllowedImage(file.getBytes())) {
        throw new IllegalArgumentException("content does not match an allowed type");
    }
    // 3) 随机文件名，名字里不含任何用户输入
    String stored = UUID.randomUUID() + "." + ext;
    Path target = BASE.resolve(stored).normalize();
    if (!target.startsWith(BASE)) {                      // 双保险
        throw new IllegalStateException("unexpected path");
    }
    Files.createDirectories(BASE);
    file.transferTo(target);                             // 存到 Web 根之外的 /data/uploads
    return stored;                                       // 只把随机名返回给前端
}

static String extensionOf(String name) {
    if (name == null) return "";
    // 只看最后一个点后面的内容，去掉路径分隔符，统一小写
    String base = name.replace('\\', '/');
    base = base.substring(base.lastIndexOf('/') + 1);   // 去掉任何 ../ 目录部分
    int dot = base.lastIndexOf('.');
    return dot < 0 ? "" : base.substring(dot + 1).trim().toLowerCase(Locale.ROOT);
}
```

`looksLikeAllowedImage` 就是比对开头几个字节的魔数（PNG `89 50 4E 47`、JPEG `FF D8 FF`、GIF `47 49 46 38`、PDF `25 50 44 46`）。注意：即使内容“看起来是图片”，也不代表安全——一张图片里可以藏 PHP 代码（图片马）。真正防住利用的，是**扩展名白名单 + 随机名 + 目录不可执行**这三件事一起：内容像图片但落盘名是 `随机.png` 且目录不解析脚本，藏在里面的代码就没有机会被当程序运行。

### 3. Zip Slip：解压时的路径穿越

“批量导入”常让用户上传一个 zip，服务端解压。危险在于 **zip 里每个条目的名字（entry name）也是攻击者写的**，可以是 `../../../../etc/cron.d/evil` 或 `../../webapps/ROOT/shell.jsp`。天真的解压把 entry name 直接拼到目标目录，条目就写到了目录之外——这就是 Zip Slip。

```java
// 危险写法：
File out = new File(destDir, entry.getName());   // entry.getName() 可能是 ../../x
```

安全写法：解压每个条目前，用和第 1 节完全相同的 `normalize()+startsWith()` 校验目标路径。

```java
static final int MAX_ENTRIES = 10_000;
static final long MAX_TOTAL = 200L * 1024 * 1024;   // 解压后总大小上限，防 zip 炸弹

static void unzipSafe(Path zip, Path destDirRaw) throws IOException {
    Path destDir = destDirRaw.toAbsolutePath().normalize();
    Files.createDirectories(destDir);
    long total = 0; int count = 0;
    try (ZipInputStream zis = new ZipInputStream(Files.newInputStream(zip))) {
        ZipEntry entry;
        while ((entry = zis.getNextEntry()) != null) {
            if (++count > MAX_ENTRIES) throw new IOException("too many entries");
            // 关键：拼接后规范化，必须仍在 destDir 之内，否则就是 Zip Slip
            Path target = destDir.resolve(entry.getName()).normalize();
            if (!target.startsWith(destDir)) {
                throw new IOException("zip slip blocked: " + entry.getName());
            }
            if (entry.isDirectory()) {
                Files.createDirectories(target);
            } else {
                Files.createDirectories(target.getParent());
                total += Files.copy(zis, target, StandardCopyOption.REPLACE_EXISTING);
                if (total > MAX_TOTAL) throw new IOException("uncompressed data too large");
            }
            zis.closeEntry();
        }
    }
}
```

除了路径校验，解压还要防两件事：**zip 炸弹**（一个几十 KB 的 zip 解压出几十 GB，撑爆磁盘/内存）——限制条目数、解压后总大小、压缩比；以及 **entry 里的符号链接**——严格场景下应拒绝目录条目之外的 symlink。

### 4. 对象存储（OBS/S3）：直传与预签名 URL

大文件通常不经过你的应用，而是前端直接传到对象存储（华为云 OBS、AWS S3）。这里的安全点变了：

- **预签名 URL（presigned URL）**：由你的后端用云凭证生成一个有时限、限定操作（只 PUT 或只 GET）、限定对象 key 的临时 URL，前端拿它直传。要点是**权限最小化**：URL 只能操作那一个 key、只能在几分钟内用、上传型 URL 不能拿来下载。
- **别让前端决定对象 key**：key 由后端生成（同样用随机名 + 用户隔离前缀，如 `user/{id}/{uuid}`），否则用户能覆盖别人的对象,或猜到别人的 key 下载。
- **桶权限**：桶默认私有，绝不开公共读写；下载也走预签名 URL 或经过你的鉴权接口。很多数据泄露就是“S3 桶设成了公共可读”。
- 存进去的对象同样要考虑：文件名/类型校验在生成预签名 URL 前做，或用云端的内容审核。

这一条把 [[web-ssrf]] 里学的“云凭证”和这里的“预签名 URL”连起来了：预签名 URL 就是“用最小权限、限时”的思路去发放访问能力，和 IAM 最小权限是一脉相承的（[[cloud-iam]]）。

## 动手实践

> 攻击载荷只能打你自己的实验环境或已获授权的目标，切勿用于他人系统。

Lab 06（笔记附件上传 + 下载攻防）在 `docs/labs/README.md` 里还是待做状态（计划 2027.02），所以这一节用两段可自行验证的小实验：一段验证路径校验逻辑本身，一段在 PortSwigger 靶场打真实漏洞。

### 实践一：验证 resolveSafe / unzipSafe 的判断

把第 1、3 节的 `resolveSafe` 和 `unzipSafe` 放进一个测试类，直接断言“攻击路径被拒、正常路径通过”：

```java
@Test
void rejectsTraversalButAllowsNormalName() {
    // 正常名通过
    assertThat(resolveSafe("cat.png")).endsWith(Paths.get("cat.png"));
    // 各种穿越被拒
    for (String bad : new String[]{"../secret", "../../etc/passwd", "a/../../b"}) {
        assertThatThrownBy(() -> resolveSafe(bad)).isInstanceOf(IllegalArgumentException.class);
    }
}
```

怎么读：`a/../../b` 这种“中间带 ..”的形式最能说明为什么要先 `normalize()` 再 `startsWith()`——normalize 之后它化简成了 `BASE` 的上一级，`startsWith(BASE)` 立刻返回 false。若你改成 `String.startsWith` 或漏掉 `normalize()`，这个用例就会挂，正好证明范式的必要性。

构造一个恶意 zip 来测 `unzipSafe`：

```java
// 造一个 entry 名为 ../../pwned 的 zip
try (ZipOutputStream zos = new ZipOutputStream(Files.newOutputStream(evilZip))) {
    zos.putNextEntry(new ZipEntry("../../pwned"));
    zos.write("owned".getBytes());
    zos.closeEntry();
}
assertThatThrownBy(() -> unzipSafe(evilZip, dest))
        .isInstanceOf(IOException.class)
        .hasMessageContaining("zip slip");
```

怎么读：抛出 “zip slip blocked” 说明校验在“写盘之前”就拦住了。关键是要在**每个 entry 落盘前**都校验，而不是解压完再检查——那时文件已经写到目录外了。

### 实践二：PortSwigger 文件上传 / 路径穿越

在 PortSwigger 靶场做入门级（Apprentice）：

- **File upload**：“Remote code execution via web shell upload”。上传一个内容为 `<?php echo file_get_contents('/home/carlos/secret'); ?>` 的 `.php`，因为服务端没校验类型、又把文件放在可执行目录，访问它就执行了。这演示了本课“扩展名白名单 + 目录不可执行”为什么是硬性要求。
- **Path traversal**：“File path traversal, simple case”。把图片加载参数 `?filename=xxx.jpg` 改成 `?filename=../../../etc/passwd`，服务端把它拼进文件路径直接读出来。这正是第 1 节 `resolveSafe` 要防的场景。

怎么读：这两个实验对应本课两大主题——上传通向 RCE、路径穿越通向任意文件读。做完回看 `resolveSafe` 的三行校验，会更清楚每一行挡的是哪一步。

## 攻击者视角

上传/路径类漏洞的利用套路：

```
上传:  找上传点 -> 试各种扩展名/大小写/双扩展名 -> 看落盘目录能否直接访问并执行
       shell.php / shell.jsp / shell.phtml / shell.php%00.jpg / shell.php.（末尾点）
路径:  找“按文件名读/写”的参数 -> 塞 ../  -> 编码绕过 %2e%2e%2f / ..%252f
       读: ../../application-prod.yml（数据库密码）、/etc/passwd、日志
       写: ../../webapps/ROOT/shell.jsp（覆盖到可执行目录）、../../cron.d/x（定时任务）
```

- **双扩展名与解析漏洞**：`shell.php.jpg` 在某些老 Apache 配置下仍按 php 解析；`shell.jsp;.jpg`、末尾空格/点、`%00` 截断（老版本）都是历史绕过。
- **图片马**：把脚本藏进合法图片的元数据里，配合“包含漏洞”或“解析漏洞”触发。
- **写穿越比读穿越更狠**：读穿越泄露配置，写穿越（上传/解压时逃出目录）能直接落一个 WebShell 或改定时任务，进而 RCE（[[web-rce]]）。
- **信息收集**：先读 `WEB-INF/web.xml`、`application.yml`、源码，摸清路径结构和密钥，再决定往哪写。

## 防御与最佳实践

- **路径**：一律 `BASE.toAbsolutePath().normalize()` 作基准，用户输入 `resolve().normalize()` 后 `Path.startsWith(BASE)` 校验；更严可加 `toRealPath()` 防 symlink。
- **上传**：扩展名白名单 + 魔数校验真实内容 + UUID 随机名 + 存到 Web 根之外 + 大小限制。下载走带鉴权的接口，别让用户直接按 URL 访问上传目录。
- **目录权限**：上传目录设为不可执行（不解析 jsp/php），文件系统层面 `noexec` 挂载更佳。
- **解压**：每个 entry 落盘前 `normalize()+startsWith()`；限制条目数、总大小、压缩比防 zip 炸弹；拒绝可疑 symlink。
- **对象存储**：桶默认私有；用限时、限操作、限 key 的预签名 URL；key 由后端生成并带用户隔离前缀。
- **纵深防御**：Nginx 层限制上传大小与类型；`Content-Disposition: attachment` 让浏览器下载而非渲染,防止 HTML/SVG 里的脚本执行；给下载响应加 `X-Content-Type-Options: nosniff`。

## 常见误区

- **“我校验了 Content-Type 是 image/png。”** 请求头里的 Content-Type 完全由客户端设置，`curl -H 'Content-Type: image/png'` 就能伪造。必须靠魔数看真实内容，且内容像图片也不等于安全（图片马），要靠白名单+随机名+目录不可执行兜底。
- **“文件名里没有 `../` 就行。”** 有编码绕过（`%2e%2e%2f`、双重编码）、有 Windows 的 `..\`，且合法名也可能含 `..`。正解是 `normalize()+startsWith()`，不是字符串黑名单。
- **“我用了 `String.startsWith(base)`。”** 会被 `/app/uploads-evil` 这种“字符串同前缀但非子目录”骗过。要用 `Path.startsWith`（按路径段比较）。
- **“解压完再检查有没有跑出目录。”** 太晚了，文件已经写到外面。必须每个 entry 落盘前校验。
- **“禁止 jsp/php 就安全了。”** 黑名单列不全（jspx/phtml/pht/大小写/末尾点空格）。永远用白名单。
- **“存到项目里的 static 目录方便访问。”** 那正是可被 URL 直接访问、可能被解析执行的目录，等于给 WebShell 铺路。要存到 Web 根之外。

## 自测

:::details 1. 只校验 Content-Type 为什么不够？
因为 `Content-Type` 是 HTTP 请求头，完全由客户端控制，攻击者用 `curl -H 'Content-Type: image/png'` 上传一个 `.jsp` 就能伪造成图片。它既不能证明扩展名安全，也不能证明内容安全。要判断真实类型得读文件头魔数；而且即便内容确实是图片，也可能是藏了脚本的图片马。真正防住利用要靠“扩展名白名单 + 魔数校验 + 随机文件名 + 存到不可执行目录”这一整套，Content-Type 顶多是辅助。
:::

:::details 2. 为什么 normalize() 必须在 startsWith() 之前？
因为路径穿越的 `..` 只有在 normalize 后才会被真正解析消解。`/app/uploads/../../etc/passwd` 在字符串上是以 `/app/uploads` 开头的，直接 startsWith 会误判为“安全”；normalize 之后它变成 `/etc/passwd`，`startsWith(BASE)` 才能返回 false 识破它。顺序反了等于没校验。
:::

:::details 3. 为什么要用 Path.startsWith 而不是 String.startsWith？
String.startsWith 是纯字符前缀比较，会把 `/app/uploads-evil/x` 当成在 `/app/uploads` 之内（前缀确实匹配），但它其实是另一个目录。Path.startsWith 按“路径段”比较，`uploads-evil` 与 `uploads` 是不同的段，不会误判。
:::

:::details 4. 什么是 Zip Slip，怎么防？
Zip Slip 是解压时的路径穿越：压缩包里条目的名字（entry name）由攻击者控制，可能是 `../../../etc/cron.d/x`，天真的解压把它拼到目标目录就写到了目录之外，可落 WebShell 或改定时任务。防法是对**每个 entry**、在落盘之前，用 `destDir.resolve(entryName).normalize()` 后 `startsWith(destDir)` 校验，不通过就中止；同时限制条目数、解压总大小、压缩比以防 zip 炸弹。
:::

:::details 5. 为什么随机文件名同时解决了好几个问题？
用 UUID 生成落盘名、只保留白名单里的扩展名，意味着：名字里根本不含用户输入（`..` 无从谈起，杜绝路径穿越）；不会覆盖已有文件；别人无法靠可猜的文件名遍历下载他人文件；也切断了“上传时精心构造的文件名触发解析漏洞”的路径。原始文件名可另存到数据库仅用于展示。
:::

:::details 6. 上传目录为什么要放在 Web 根目录之外？
如果上传目录能被 Nginx/Tomcat 按 URL 直接访问、且该目录会解析脚本，那么传上去的 `shell.jsp` 一访问就执行，直接 RCE。放到 Web 根之外（如 /data/uploads），只能通过你自己写的、带鉴权和类型控制的下载接口读出来，攻击者就无法直接访问和执行上传的文件。
:::

:::details 7. 预签名 URL 的安全要点是什么？
最小权限 + 限时：URL 由后端用云凭证生成，只允许一个操作（上传型只能 PUT，下载型只能 GET）、只针对一个具体对象 key、有效期只有几分钟。对象 key 由后端生成并带用户隔离前缀（如 user/{id}/{uuid}），不让前端指定，避免覆盖或遍历他人对象。桶保持私有，绝不开公共读写。
:::

## 一句话总结

文件名和路径都是用户输入：路径穿越用 `toAbsolutePath().normalize()` 定基准、`resolve().normalize()` 后 `Path.startsWith` 校验来防（解压时对每个 entry 同样处理防 Zip Slip），上传则靠扩展名白名单 + 魔数校验 + UUID 随机名 + 存到 Web 根之外这一整套，而不是只看那句随手就能伪造的 Content-Type。
