## 题意

笔试平台（牛客、赛码、各大厂自研 OJ）常用 **ACM 模式**：不像 LeetCode 那样只写一个方法，而是要自己写完整的 `public class Main`，从标准输入读数据、向标准输出打印结果。典型题面是"输入包含多组测试数据，每组第一行是 n，第二行是 n 个整数，输出每组数的和"，组数不告诉你，要一直读到文件结束（EOF）。要掌握的是：一个既快又不容易出错的输入输出模板。

## 思路

面试官（或者笔试系统）考的其实是基本功：类名必须是 `Main`、不能有 `package`、能正确处理多组输入直到 EOF、数据量大时不会因为 I/O 慢而超时、输出格式与要求一字不差。

| 读入方式 | 速度 | 优点 | 缺点 |
|---|---|---|---|
| `Scanner` | 慢（大量数据时可能比下面慢十倍） | 写法最简单，`hasNextInt()` 判 EOF 很方便 | 内部用正则解析，10⁵ 级以上数据容易超时 |
| `BufferedReader` + `StringTokenizer` | 快 | 能读整行、字符串、long，精度无损 | 要自己封装 `next()`，EOF 时 `readLine()` 返回 null |
| `StreamTokenizer` | 最快 | 直接解析数字，`nextToken()` 返回 `TT_EOF` 判结束 | 数字按 double 解析，超过 2⁵³ 的 long 会丢精度；字符串中的特殊字符处理不友好 |

输出方面：大量 `System.out.println` 每次都会刷新并加锁，很慢；用 `PrintWriter` 包一层 `BufferedWriter`，全部写完后 `flush()` 一次即可。

:::tip 关键点
模板三件套：`public class Main` + 快速读入（纯数字用 StreamTokenizer，含字符串或大 long 用 BufferedReader + StringTokenizer）+ PrintWriter 缓冲输出并在最后 `flush()`。多组数据用 `while` 读到 EOF，不要假设组数。
:::

下面的模板用三种方式读同一份多组输入并各自求出每组的和（用 long 防溢出），演示时用 `System.setIn` 把一段写死的字符串当成标准输入，程序会自己结束；真正提交时把这一行删掉即可。

输入格式与期望输出：

```
输入：
3
1 2 3
2
-5 10
3
2000000000 2000000000 2000000000

输出：
6
5
6000000000
```

## Java 题解

```java
import java.io.*;
import java.util.*;

public class Main {

    // 演示用的"标准输入"；提交到 OJ 时不需要
    static final String DEMO_INPUT = "3\n1 2 3\n2\n-5 10\n3\n2000000000 2000000000 2000000000\n";
    static final String EXPECTED = "6\n5\n6000000000\n";

    public static void main(String[] args) throws IOException {
        // 真正提交时 main 里只需要这两行：
        //   PrintWriter out = new PrintWriter(new BufferedWriter(new OutputStreamWriter(System.out)));
        //   solveByStreamTokenizer(out); out.flush();
        String[] names = {"StreamTokenizer", "BufferedReader+StringTokenizer", "Scanner"};
        for (int mode = 0; mode < 3; mode++) {
            System.setIn(new ByteArrayInputStream(DEMO_INPUT.getBytes())); // 演示：把字符串当作标准输入
            StringWriter captured = new StringWriter();
            PrintWriter out = new PrintWriter(new BufferedWriter(captured));
            if (mode == 0) solveByStreamTokenizer(out);
            else if (mode == 1) solveByBufferedReader(out);
            else solveByScanner(out);
            out.flush(); // 缓冲输出，最后统一刷新
            String result = captured.toString().replace("\r\n", "\n");
            System.out.print("== " + names[mode] + "\n" + result);
            System.out.println("matches expected: " + result.equals(EXPECTED));
        }
    }

    // 方式一：StreamTokenizer，纯数字输入最快
    static void solveByStreamTokenizer(PrintWriter out) throws IOException {
        StreamTokenizer in = new StreamTokenizer(new BufferedReader(new InputStreamReader(System.in)));
        while (in.nextToken() != StreamTokenizer.TT_EOF) { // 多组数据，读到 EOF 为止
            int n = (int) in.nval;
            long sum = 0; // 用 long 防止求和溢出
            for (int i = 0; i < n; i++) {
                in.nextToken();
                sum += (long) in.nval; // nval 是 double，超过 2^53 会丢精度
            }
            out.println(sum);
        }
    }

    // 方式二：BufferedReader + StringTokenizer，通用、精度无损
    static void solveByBufferedReader(PrintWriter out) throws IOException {
        FastReader in = new FastReader(System.in);
        String token;
        while ((token = in.next()) != null) { // next() 返回 null 表示 EOF
            int n = Integer.parseInt(token);
            long sum = 0;
            for (int i = 0; i < n; i++) sum += Long.parseLong(in.next());
            out.println(sum);
        }
    }

    // 方式三：Scanner，写法最简单但慢
    static void solveByScanner(PrintWriter out) {
        Scanner sc = new Scanner(System.in);
        while (sc.hasNextInt()) {
            int n = sc.nextInt();
            long sum = 0;
            for (int i = 0; i < n; i++) sum += sc.nextLong();
            out.println(sum);
        }
    }

    // 按空白切分的快速读入
    static class FastReader {
        private final BufferedReader br;
        private StringTokenizer st;

        FastReader(InputStream is) {
            br = new BufferedReader(new InputStreamReader(is), 1 << 16);
        }

        String next() throws IOException {
            while (st == null || !st.hasMoreTokens()) {
                String line = br.readLine();
                if (line == null) return null; // EOF
                st = new StringTokenizer(line);
            }
            return st.nextToken();
        }

        String nextLine() throws IOException { // 需要整行（含空格）时用
            st = null;
            return br.readLine();
        }
    }
}
```

## 复杂度

- 时间 O(输入字节数)：三种方式都是线性扫描，但常数差别很大。经验上读 10⁶ 个整数，Scanner 往往要接近 1 秒甚至更久，BufferedReader + StringTokenizer 和 StreamTokenizer 通常在 100~200 毫秒量级，笔试 1~2 秒的时限下差别足以决定是否超时。
- 空间 O(缓冲区)：BufferedReader 默认 8KB 缓冲（模板里设成 64KB），PrintWriter 的输出先攒在缓冲里，最后一次性写出。
- 输出 10⁵ 行时，逐行 `System.out.println` 每次都要加锁、可能触发刷新，明显慢于 PrintWriter 缓冲后一次 `flush()`。

## 易错点

- 类名必须是 `Main` 且是 `public`，文件里不能有 `package` 声明，否则 OJ 编译失败。
- 用了 PrintWriter 却忘记 `flush()`（或 `close()`），缓冲区里的内容不会输出，结果是空答案。
- 不要混用多个读取器读同一个 `System.in`：第一个带缓冲的 reader 可能已经把后面的数据读进了自己的缓冲区，第二个就读不到了。
- `Scanner.nextInt()` 之后紧跟 `nextLine()`，会读到这一行剩下的空串；BufferedReader 版本的 `nextLine()` 同理要注意当前行是否已经读完（模板里调用它会丢弃当前行剩余的 token）。
- StreamTokenizer 把数字当 double 解析：超过 2⁵³ 的 long 会丢精度，形如 `1e5` 的字符串也会被当成数字；需要读字符串（尤其含 `-`、`/` 等字符）时换成 BufferedReader。
- 多组输入不要写成 `for (int t = 0; t < 某个猜测的组数; t++)`；题目没给组数就要读到 EOF。题目给了组数 T 时，按 T 读。
- 求和、乘积注意 int 溢出，默认用 long；输出格式（空格、换行、行末空格、小数位数）要与题目严格一致。

## 追问

:::details 本地调试时怎么模拟 EOF？
从文件重定向输入 `java Main < input.txt` 最方便，文件读完自然就是 EOF。在终端手动输入时，macOS / Linux 按 Ctrl+D，Windows 按 Ctrl+Z 再回车。也可以像模板一样用 `System.setIn(new ByteArrayInputStream(...))`。
:::

:::details 为什么 Scanner 这么慢？
Scanner 每次读取 token 都要用正则表达式做匹配和类型解析，还要处理本地化的数字格式，单次开销大；而 StringTokenizer 只是按空白字符切分字符串，StreamTokenizer 更是直接在字符流上边读边解析数字。
:::

:::details 还能更快吗？
可以自己基于 `DataInputStream` 或 `System.in.read(byte[])` 一次读入一大块字节，手动解析整数（跳过空白、处理负号、逐位累加），避免创建任何 String 对象，是竞赛里最快的写法。不过笔试中 BufferedReader / StreamTokenizer 通常已经足够。
:::

:::details 输入是一行多个用逗号分隔的数，比如 "1,2,3"，怎么读？
先 `br.readLine()` 读整行，再 `split(",")` 并逐个 `Integer.parseInt(s.trim())`；或者用 `new StringTokenizer(line, ", ")` 同时把逗号和空格当分隔符。注意空行和行末多余分隔符。
:::

## 举一反三

- [[algo:two-sum]] 等 LeetCode 题转成 ACM 模式时，只需在 `main` 里读入数据、构造参数、调用自己的方法并打印结果，核心算法不变。
- [[algo:string-to-integer-atoi]]：手写整数解析的规则，与自己实现快速读入时的逐位解析一致。
- 工程上"缓冲 I/O + 批量刷新"的思想随处可见：日志框架的异步 Appender、Kafka Producer 的批量发送、JDBC 的 `addBatch` 批量提交，本质都是减少昂贵的系统调用次数。

## 一句话记忆

`public class Main`，BufferedReader / StreamTokenizer 读到 EOF，PrintWriter 攒着输出最后 flush。
