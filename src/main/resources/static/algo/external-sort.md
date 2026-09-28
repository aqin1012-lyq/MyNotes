## 题意

面试官常问："一个 10GB 的文件，每行一个整数，机器内存只有 1GB，怎么把它排好序输出成一个新文件？"要实现的就是**外部排序**：数据放不进内存时，借助磁盘完成排序，并尽量减少磁盘读写次数。

## 思路

面试官想考的是：知道"分块内排 + 多路归并"这个两阶段模型，能说清楚归并阶段为什么用堆、读写为什么要缓冲，以及文件数太多时怎么办。

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| 直接读进内存排序 | `Arrays.sort` | 最简单 | 内存放不下，直接 OOM |
| 分块排序 + 两两归并 | 每次合并两个有序文件，反复多轮 | 实现简单 | 需要 log₂M 轮，每轮全量读写一遍磁盘 |
| 分块排序 + K 路归并（堆） | 所有有序块同时打开，用小根堆每次取最小 | 通常一轮归并就完成，磁盘读写最少 | 同时打开的文件数和每个文件的缓冲区要控制 |
| 计数 / 位图 | 值域有限且不重复时，用 BitMap 标记后顺序输出 | O(N)，极省内存 | 只适用于值域可控的场景，见 [[algo:bitmap-bloom-filter]] |

选定方案：**两阶段外部排序**。

1. 切分（run generation）：每次读入内存能容纳的一块（例如 800MB），在内存里排序，写成一个有序的临时文件，称为一个 run。
2. 归并（K-way merge）：同时打开所有 run，每个 run 只把当前行放进一个小根堆；每次弹出堆顶写到输出，再从它所在的 run 读下一行补进堆。

:::tip 关键点
堆里只放"每个 run 的当前最小值"，所以归并阶段内存是 O(run 数 × 缓冲区)，与总数据量无关。堆元素要带上"来自哪个 run"，弹出后才知道去哪个文件补下一个。
:::

下面把规模缩小：生成 30 万行随机整数的文本文件，假装内存每次只能放 5 万个数，切成 6 个有序 run，再用堆做 6 路归并，最后逐行与内存排序的暴力结果比对，并删除所有临时文件。

## Java 题解

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;

public class ExternalSort {

    // 阶段一：按"内存上限"分块读入，块内排序后写成有序 run 文件
    static List<Path> splitIntoSortedRuns(Path input, Path dir, int maxInMemory) throws IOException {
        List<Path> runs = new ArrayList<>();
        try (BufferedReader reader = Files.newBufferedReader(input)) {
            int[] buf = new int[maxInMemory];
            while (true) {
                int size = 0;
                String line;
                while (size < maxInMemory && (line = reader.readLine()) != null) {
                    buf[size++] = Integer.parseInt(line);
                }
                if (size == 0) break;
                Arrays.sort(buf, 0, size); // 内存排序
                Path run = dir.resolve("run-" + runs.size() + ".txt");
                try (BufferedWriter w = Files.newBufferedWriter(run)) {
                    for (int i = 0; i < size; i++) {
                        w.write(Integer.toString(buf[i]));
                        w.newLine();
                    }
                }
                runs.add(run);
                if (size < maxInMemory) break; // 最后一块不满，说明读完了
            }
        }
        return runs;
    }

    // 阶段二：K 路归并。堆元素 = {当前值, 来自第几个 run}
    static void kWayMerge(List<Path> runs, Path output) throws IOException {
        List<BufferedReader> readers = new ArrayList<>();
        PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
        try (BufferedWriter w = Files.newBufferedWriter(output)) {
            for (int i = 0; i < runs.size(); i++) {
                BufferedReader r = Files.newBufferedReader(runs.get(i));
                readers.add(r);
                String first = r.readLine();
                if (first != null) heap.offer(new int[]{Integer.parseInt(first), i});
            }
            while (!heap.isEmpty()) {
                int[] top = heap.poll(); // 所有 run 当前值里最小的
                w.write(Integer.toString(top[0]));
                w.newLine();
                String next = readers.get(top[1]).readLine(); // 从同一个 run 补下一个
                if (next != null) heap.offer(new int[]{Integer.parseInt(next), top[1]});
            }
        } finally {
            for (BufferedReader r : readers) r.close();
        }
    }

    public static void main(String[] args) throws IOException {
        final int n = 300_000, memoryLimit = 50_000;
        Path dir = Files.createTempDirectory("extsort");
        Path input = dir.resolve("input.txt");
        Path output = dir.resolve("sorted.txt");
        List<Path> runs = new ArrayList<>();
        try {
            // 生成大文件：每行一个随机整数（含负数和重复值）
            Random random = new Random(7);
            int[] all = new int[n]; // 仅用于校验
            try (BufferedWriter w = Files.newBufferedWriter(input)) {
                for (int i = 0; i < n; i++) {
                    all[i] = random.nextInt(2_000_001) - 1_000_000;
                    w.write(Integer.toString(all[i]));
                    w.newLine();
                }
            }
            runs = splitIntoSortedRuns(input, dir, memoryLimit);
            kWayMerge(runs, output);

            // 与内存排序的暴力结果逐行比对
            Arrays.sort(all);
            boolean ok = true;
            int count = 0;
            try (BufferedReader r = Files.newBufferedReader(output)) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (count >= n || Integer.parseInt(line) != all[count]) ok = false;
                    count++;
                }
            }
            ok &= count == n;
            System.out.println("input lines = " + n + ", memory limit = " + memoryLimit);
            System.out.println("sorted runs = " + runs.size());
            System.out.println("output lines = " + count + ", min = " + all[0] + ", max = " + all[n - 1]);
            System.out.println("matches in-memory sort: " + ok);
        } finally {
            // 清理全部临时文件
            for (Path p : runs) Files.deleteIfExists(p);
            Files.deleteIfExists(input);
            Files.deleteIfExists(output);
            Files.deleteIfExists(dir);
        }
    }
}
```

## 复杂度

- 时间：切分阶段每块排序 O(B log B)，共 N/B 块，合计 O(N log B)；K 路归并每个元素一次堆操作 O(log K)，合计 O(N log K)。总计 O(N log N)，但真正的瓶颈是磁盘 I/O。
- 磁盘读写：一轮归并时，数据总共被读 2 次、写 2 次（切分读写一次，归并读写一次）。两两归并则需要 log₂K 轮，每轮都完整读写一遍。
- 资源估算：10GB 文本、1GB 内存。每块按 800MB 算（留出 JVM 开销；注意文本解析成 int 后 Java 对象开销，用 `int[]` 而不是 `List<Integer>`），约切成 13 个 run。归并阶段 13 个文件各给 32MB 的读缓冲，总共约 400MB，一轮就能合并完。以 SSD 500MB/s 顺序读写估算，读写各 20GB 大约 80 秒量级。
- 如果 run 有几千个，同时打开的文件句柄和每路缓冲区都会成问题，这时做**多轮归并**：比如每次合并 100 个 run，先得到几十个更大的 run，再合并一次。

## 易错点

- 堆里只放值不放来源编号，弹出后就不知道该从哪个 run 补下一个元素。
- 读写不带缓冲（每次 `read()` 一个字节），性能会慢几个数量级；归并阶段每路都要有自己的缓冲区。
- 读到某个 run 的末尾时不要再往堆里放东西，也不要提前结束整个归并，其他 run 可能还有数据。
- 块内用 `List<Integer>` 存储，每个 Integer 对象约 16 字节再加引用，比 `int[]` 多出好几倍内存，"内存上限"算不准。
- 所有 reader/writer 都要在 finally 或 try-with-resources 里关闭，临时文件用完要删除，否则会泄漏句柄、占满磁盘。

## 追问

:::details run 数量太多，文件句柄不够怎么办？
做多轮归并：限定每次最多合并 F 个 run（F 由文件句柄上限和"内存 / 每路缓冲区大小"决定），第一轮把 K 个 run 合成 K/F 个，依次类推，需要 log_F(K) 轮。F 越大轮数越少，但每路缓冲变小、随机读变多，需要折中。
:::

:::details 能不能让 run 更长、数量更少？
可以用"置换选择"（replacement selection）：内存里维护一个堆，输出堆顶后读入新元素，如果新元素不小于刚输出的值就继续放入当前 run，否则留给下一个 run。对随机数据，平均 run 长度约是内存容量的 2 倍，run 数减半。
:::

:::details 怎么利用多核或多机加速？
切分阶段各块互不依赖，可以多线程并行读取、排序、写出。归并阶段可以先按值域做范围分区（比如先采样确定分界点，把数据按区间分到不同文件），每个区间独立排序，最后按区间顺序拼接即可，不需要全局归并。这正是 Hadoop TeraSort 的思路。
:::

:::details 如果数据是不重复的手机号 / QQ 号这类有限值域的整数呢？
不用外部排序。用 BitMap：值域 0~2³² 只需要 2³² 位 = 512MB，扫一遍把出现的数对应位置 1，再按位顺序输出，就是排好序的结果。值域更大时可以按高位分段多次扫描。详见 [[algo:bitmap-bloom-filter]]。
:::

## 举一反三

- [[algo:merge-k-sorted-lists]]：K 路归并的内存版，一模一样的堆写法。
- [[algo:sort-an-array]]：块内排序用的就是归并 / 快排；归并排序的"合并有序段"是外部排序的原型。
- [[algo:massive-top-k]]：同样是分片处理大数据，但 Top K 不需要全局有序。
- 工程上：MySQL 的 `ORDER BY` 超过 `sort_buffer_size` 时会用临时文件做外部归并排序（执行计划里的 Using filesort）；Hadoop/Spark 的 shuffle 在 map 端溢写有序文件、再合并，本质也是外部排序；LSM-Tree（RocksDB、HBase）的 compaction 就是对多个有序 SSTable 做多路归并。

## 一句话记忆

内存放不下就先分块排序写成有序 run，再用小根堆做 K 路归并，堆里带上来源编号。
