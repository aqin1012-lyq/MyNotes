## 题意

面试官常见问法："有一个 100GB 的访问日志，每行包含一个访问者 IP，内存只有 1GB，怎么找出访问次数最多的 IP？"延伸问法是找出现次数最多的前 K 个 IP / 搜索词 / URL。要实现的是：数据和不同 key 的数量都可能超出内存时，**精确**统计出频次最高的 key。

## 思路

面试官想考的是"分而治之 + 哈希分片"：直接用一个 HashMap 计数放不下，就先按 key 的哈希把数据拆成若干小文件，**保证同一个 key 只会出现在同一个文件里**，这样每个小文件可以独立计数，局部冠军中的最大者就是全局冠军。

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| 单个 HashMap 计数 | 扫一遍日志，`map.merge(ip, 1, Integer::sum)` | 最简单，一遍扫描 | 不同 IP 太多时内存放不下 |
| 按 IP 数组计数 | IPv4 转成 32 位整数做下标，int 计数数组 | 不需要哈希，O(1) 更新 | 2³² × 4 字节 = 16GB，内存不够 |
| 外部排序后统计 | 按 IP 排序，相同 IP 相邻，一遍统计连续段 | 精确 | 排序本身要多轮磁盘读写，慢 |
| 哈希分片 + 分片计数 | `hash(ip) % M` 写入 M 个小文件，每个文件 HashMap 计数 | 精确，只多一轮读写，可并行 | 数据倾斜时个别分片仍可能过大 |
| 近似算法（Count-Min Sketch 等） | 固定大小的计数矩阵 | 内存极小，支持实时流 | 有误差，只能给近似结果 |

:::tip 关键点
分片依据必须是 key 的哈希（不能按行号或文件大小随便切），这样同一个 IP 的所有记录都在同一个分片里，分片内的计数就是这个 IP 的全局计数。每个分片求出局部最大值后再比较一次即可；求 Top K 则每个分片求 Top K，再合并候选。
:::

下面把规模缩小：生成 30 万行日志（其中少数"热点 IP"被刻意多次访问），按 IP 哈希拆成 16 个分片文件，逐个分片用 HashMap 计数求出局部最大，再与一次性在内存中计数的暴力结果比较，最后删除临时文件。平局时取字典序较小的 IP，保证结果唯一。

## Java 题解

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class MostFrequentIp {

    // 结果：IP 及其次数；次数多者优先，平局取字典序小的
    record IpCount(String ip, int count) {
        boolean betterThan(IpCount o) {
            if (o == null) return true;
            return count != o.count ? count > o.count : ip.compareTo(o.ip) < 0;
        }
    }

    // 从一行日志中取出 IP（第一个空格之前）
    static String ipOf(String line) {
        return line.substring(0, line.indexOf(' '));
    }

    // 第一步：按 hash(ip) % m 把日志拆成 m 个分片，同一 IP 必然落在同一分片
    static List<Path> partition(Path log, Path dir, int m) throws IOException {
        List<Path> parts = new ArrayList<>();
        BufferedWriter[] writers = new BufferedWriter[m];
        try (BufferedReader reader = Files.newBufferedReader(log)) {
            for (int i = 0; i < m; i++) {
                parts.add(dir.resolve("part-" + i + ".txt"));
                writers[i] = Files.newBufferedWriter(parts.get(i));
            }
            String line;
            while ((line = reader.readLine()) != null) {
                String ip = ipOf(line);
                int p = Math.floorMod(ip.hashCode(), m); // 注意 hashCode 可能为负
                writers[p].write(ip); // 只写需要的字段，分片文件更小
                writers[p].newLine();
            }
        } finally {
            for (BufferedWriter w : writers) if (w != null) w.close();
        }
        return parts;
    }

    // 第二步：逐个分片计数，每次内存里只有一个分片的 HashMap
    static IpCount findMostFrequent(List<Path> parts) throws IOException {
        IpCount best = null;
        for (Path part : parts) {
            Map<String, Integer> counter = new HashMap<>();
            try (BufferedReader r = Files.newBufferedReader(part)) {
                String ip;
                while ((ip = r.readLine()) != null) counter.merge(ip, 1, Integer::sum);
            }
            for (Map.Entry<String, Integer> e : counter.entrySet()) {
                IpCount c = new IpCount(e.getKey(), e.getValue());
                if (c.betterThan(best)) best = c; // 局部冠军与全局冠军比较
            }
        }
        return best;
    }

    public static void main(String[] args) throws IOException {
        final int lines = 300_000, parts = 16;
        Path dir = Files.createTempDirectory("ipcount");
        Path log = dir.resolve("access.log");
        List<Path> partFiles = new ArrayList<>();
        try {
            // 生成日志：大部分是随机 IP，少数热点 IP 被频繁访问
            Random random = new Random(99);
            String[] hot = {"10.0.0.8", "172.16.3.21", "192.168.1.100"};
            try (BufferedWriter w = Files.newBufferedWriter(log)) {
                for (int i = 0; i < lines; i++) {
                    String ip = random.nextInt(100) < 3
                            ? hot[random.nextInt(hot.length)]
                            : random.nextInt(256) + "." + random.nextInt(256) + "." + random.nextInt(4) + "." + random.nextInt(256);
                    w.write(ip + " - - GET /api/item/" + random.nextInt(1000) + " 200");
                    w.newLine();
                }
            }
            partFiles = partition(log, dir, parts);
            IpCount answer = findMostFrequent(partFiles);

            // 暴力对照：一次性在内存中计数
            Map<String, Integer> all = new HashMap<>();
            try (BufferedReader r = Files.newBufferedReader(log)) {
                String line;
                while ((line = r.readLine()) != null) all.merge(ipOf(line), 1, Integer::sum);
            }
            IpCount brute = null;
            for (Map.Entry<String, Integer> e : all.entrySet()) {
                IpCount c = new IpCount(e.getKey(), e.getValue());
                if (c.betterThan(brute)) brute = c;
            }
            long maxPartLines = 0;
            for (Path p : partFiles) {
                try (BufferedReader r = Files.newBufferedReader(p)) {
                    maxPartLines = Math.max(maxPartLines, r.lines().count());
                }
            }
            System.out.println("log lines = " + lines + ", distinct ips = " + all.size() + ", partitions = " + parts);
            System.out.println("largest partition lines = " + maxPartLines);
            System.out.println("partitioned answer = " + answer);
            System.out.println("brute force answer = " + brute);
            System.out.println("equal: " + answer.equals(brute));
        } finally {
            for (Path p : partFiles) Files.deleteIfExists(p);
            Files.deleteIfExists(log);
            Files.deleteIfExists(dir);
        }
    }
}
```

## 复杂度

- 时间 O(N)：日志读一遍、分片文件写一遍再读一遍，HashMap 计数均摊 O(1)。瓶颈是磁盘 I/O，总共约"读 1 次原始日志 + 写读各 1 次精简后的 IP"。
- 空间：任何时刻内存里只有一个分片的 HashMap，加上 M 个写缓冲区。
- 资源估算：100GB 日志，每行约 100 字节，约 10 亿行。只把 IP 写入分片（平均约 14 字节一行），分片总量约 14GB；若把 IPv4 转成 4 字节整数二进制写入，只有 4GB。
- 资源估算：取 M = 1024 个分片，每个分片约 14MB、约 100 万行；最坏情况下每行都是不同 IP，一个 HashMap<String, Integer> 每个条目算上 String、Integer、Node 大约 100 字节，100 万条目约 100MB，1GB 内存绰绰有余。1024 个写缓冲区每个 8KB，共 8MB。
- 如果改用 `int` 表示 IP 并用 `HashMap<Integer, Integer>` 或原始类型的开放寻址表（如 fastutil 的 `Int2IntOpenHashMap`），内存还能再降几倍。

## 易错点

- 按行号或文件大小切分会把同一个 IP 分散到多个文件，局部计数不等于全局计数，结果错误。分片依据必须是 key 的哈希。
- `hashCode() % m` 可能是负数，要用 `Math.floorMod` 或 `(h & 0x7fffffff) % m`。
- 数据倾斜：某个超级热点 IP 或哈希不均匀会让个别分片特别大。处理办法是对过大的分片换一个哈希种子再拆一次（二次分片）。
- 同时打开的分片文件太多会超过进程文件句柄上限（`ulimit -n`），M 要结合句柄上限和每个分片的大小来定。
- 分片写入不加缓冲会产生海量小 I/O；所有 writer 要在 finally 里关闭，否则缓冲区里的最后一批数据丢失。

## 追问

:::details 要找的是访问次数最多的前 100 个 IP 呢？
每个分片计数后，用大小为 100 的小根堆求出局部 Top 100；因为同一 IP 只在一个分片里，全局 Top 100 一定在这 M × 100 个候选里，再用一个小根堆合并即可。堆的写法见 [[algo:massive-top-k]]。
:::

:::details 如果不同 IP 数量其实不多（比如几百万），还需要分片吗？
不需要。一次扫描直接用 HashMap 计数，几百万条目只要几百 MB；甚至可以把 IPv4 转成 int，用原始类型哈希表更省。面试时先估算 distinct key 的数量再决定方案，比直接上分片更能体现判断力。
:::

:::details 如果是实时的访问流，要持续给出热点 IP 怎么办？
精确方案是按时间窗口（如每分钟）分桶计数，窗口滑动时合并最近若干个桶；数据量太大时用近似算法：Count-Min Sketch 用几个哈希函数和固定大小的计数矩阵估算频次（只会高估不会低估），配合一个小根堆维护候选 Top K，这就是很多"实时热点探测"的做法。
:::

:::details 多台机器上怎么做？
和单机分片是同一个思路，只是"文件"换成"机器"：Map 阶段每台机器读自己那部分日志，按 `hash(ip) % R` 把记录发给 R 个 Reducer（即 shuffle），Reducer 收到的就是某些 IP 的全部记录，计数后各自求 Top K，最后汇总。这就是 MapReduce 的 WordCount + Top K。
:::

## 举一反三

- [[algo:top-k-frequent-elements]]：内存版"频次 Top K"，计数 + 堆 / 桶排序。
- [[algo:massive-top-k]]：数值 Top K，不需要计数和哈希分片。
- [[algo:group-anagrams]]：同样是"按 key 分组"，分片就是磁盘上的分组。
- [[algo:bitmap-bloom-filter]]：只判断 IP 是否出现过时，BitMap 比计数更省。
- 工程对应：Nginx 日志分析里的 `awk '{print $1}' | sort | uniq -c | sort -nr | head` 就是"外排序后统计"的方案；Hadoop / Spark 的 shuffle 按 key 哈希分区，和这里的哈希分片是同一个原理；Kafka 按 key 哈希选分区，也保证了同一 key 的消息落在同一分区。

## 一句话记忆

按 `hash(IP) % M` 拆小文件保证同 IP 同文件，逐个分片 HashMap 计数，局部冠军里取全局冠军。
