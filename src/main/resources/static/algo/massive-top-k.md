## 题意

面试官常见问法："有 10 亿个整数（或者一个几 GB 的文件），内存只有几百 MB，怎么找出最大的 100 个？"要实现的是：在数据量远大于内存、只能流式或分片读取的前提下，求出最大的 K 个数（K 远小于 N）。

## 思路

面试官想考的是：能不能意识到"全排序是浪费"，以及知道**小根堆**、**快速选择**、**分治 + 归并**这几种方案各自适合什么条件（内存够不够、能不能并行、数据能不能多遍扫描）。

| 方案 | 做法 | 时间 | 内存 | 适用 |
|---|---|---|---|---|
| 全排序 | 外部排序后取最后 K 个 | O(N log N) + 多次磁盘读写 | 需要外排 | 基本不选，做了大量无用功 |
| 小根堆 | 流式读入，维护大小为 K 的小根堆 | O(N log K) | O(K) | 首选；只扫一遍，天然支持数据流 |
| 快速选择 | partition 只递归一边 | 期望 O(N) | 数据要全部进内存 | 内存放得下时最快，但会修改原数组 |
| 分片 + 归并 | 按文件/机器分片，每片求 Top K，再合并 M×K 个候选 | O(N log K / 并行度) | 每片 O(K) | 数据在多台机器或多个文件上，可并行 |
| 计数/桶 | 值域小时直接计数，从大到小累加到 K | O(N + 值域) | O(值域) | 值域有限（如分数 0~100、年龄） |

为什么找**最大**的 K 个要用**小根**堆？堆顶是当前候选里最小的那个，也就是"门槛"。新来的数只有比门槛大才有资格进来，把门槛挤出去；比门槛小的直接丢弃，所以大部分元素只做一次比较，只有少数需要 O(log K) 的调整。

:::tip 关键点
最大 K 个用大小为 K 的小根堆，堆顶是门槛：`x > heap.peek()` 才替换。每个分片独立求 Top K 后，全局 Top K 一定在这 M×K 个候选中，所以分片结果可以放心合并。
:::

下面的实现把"10 亿"缩小成 50 万个随机 int，写成 8 个二进制分片文件（模拟大文件切块或多台机器），分别用"单线程流式扫描"和"线程池分片并行 + 合并"两种方式求 Top 100，并与全排序的暴力结果对比，最后删除临时文件。

## Java 题解

```java
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

public class MassiveTopK {

    // 把 x 放进"最大 K 个"的小根堆：未满直接放，满了只有比堆顶大才替换
    static void offer(PriorityQueue<Integer> heap, int k, int x) {
        if (heap.size() < k) {
            heap.offer(x);
        } else if (x > heap.peek()) {
            heap.poll();
            heap.offer(x);
        }
    }

    // 堆中元素按从大到小输出
    static int[] drainDesc(PriorityQueue<Integer> heap) {
        int[] res = new int[heap.size()];
        for (int i = res.length - 1; i >= 0; i--) res[i] = heap.poll();
        return res;
    }

    // 流式扫描一个分片文件，把数逐个喂给堆，内存里始终只有 K 个数
    static void scanInto(Path file, PriorityQueue<Integer> heap, int k) throws IOException {
        try (DataInputStream in = new DataInputStream(new BufferedInputStream(Files.newInputStream(file)))) {
            while (true) {
                int x;
                try {
                    x = in.readInt();
                } catch (EOFException eof) {
                    break; // 读到文件尾
                }
                offer(heap, k, x);
            }
        }
    }

    static int[] topKOfFile(Path file, int k) throws IOException {
        PriorityQueue<Integer> heap = new PriorityQueue<>(k);
        scanInto(file, heap, k);
        return drainDesc(heap);
    }

    // 方式一：单线程依次流式扫描所有分片，共用一个堆
    static int[] singlePass(List<Path> files, int k) throws IOException {
        PriorityQueue<Integer> heap = new PriorityQueue<>(k);
        for (Path f : files) {
            scanInto(f, heap, k);
        }
        return drainDesc(heap);
    }

    // 方式二：每个分片交给线程池各求 Top K，再合并 M*K 个候选
    static int[] parallel(List<Path> files, int k) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            List<Future<int[]>> futures = new ArrayList<>();
            for (Path f : files) {
                futures.add(pool.submit(() -> topKOfFile(f, k)));
            }
            PriorityQueue<Integer> heap = new PriorityQueue<>(k);
            for (Future<int[]> fu : futures) {
                for (int x : fu.get()) offer(heap, k, x); // 归并各分片的候选
            }
            return drainDesc(heap);
        } finally {
            pool.shutdown(); // 保证进程能正常退出
        }
    }

    public static void main(String[] args) throws Exception {
        final int n = 500_000, chunks = 8, k = 100;
        Random random = new Random(42);
        int[] all = new int[n]; // 仅用于暴力校验，真实场景不会全部进内存
        Path dir = Files.createTempDirectory("topk");
        List<Path> files = new ArrayList<>();
        try {
            // 生成数据并切成 8 个二进制分片文件
            int per = n / chunks, idx = 0;
            for (int c = 0; c < chunks; c++) {
                Path f = dir.resolve("part-" + c + ".bin");
                try (DataOutputStream out = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(f)))) {
                    for (int i = 0; i < per; i++) {
                        int x = random.nextInt(1_000_000); // 值域有限，必然有重复值
                        all[idx++] = x;
                        out.writeInt(x);
                    }
                }
                files.add(f);
            }
            // 暴力：全排序后取最后 K 个（从大到小）
            int[] sorted = all.clone();
            Arrays.sort(sorted);
            int[] expect = new int[k];
            for (int i = 0; i < k; i++) expect[i] = sorted[n - 1 - i];

            int[] a = singlePass(files, k);
            int[] b = parallel(files, k);
            System.out.println("files = " + files.size() + ", numbers = " + n + ", k = " + k);
            System.out.println("top5 = " + Arrays.toString(Arrays.copyOf(a, 5)));
            System.out.println("singlePass == bruteForce: " + Arrays.equals(a, expect));
            System.out.println("parallel   == bruteForce: " + Arrays.equals(b, expect));
        } finally {
            // 清理临时文件
            for (Path f : files) Files.deleteIfExists(f);
            Files.deleteIfExists(dir);
        }
    }
}
```

## 复杂度

- 时间 O(N log K)：每个数最多一次堆调整；实际上随机数据里绝大多数数比门槛小，只做一次比较，瓶颈是 I/O 而不是 CPU。
- 空间 O(K)：单线程只有一个大小为 K 的堆；分片并行时是 O(并行度 × K)，合并阶段只处理 M×K 个候选。
- 资源估算：10 亿个 int 按二进制存储 = 10⁹ × 4B ≈ 4GB（如果是文本，每行平均 10 个字符左右就是 10GB 上下）。K = 100 的堆只占几 KB。顺序读 4GB：机械盘约 100~200MB/s 需要 20~40 秒，SSD 1GB/s 以上只要几秒，所以并行的收益主要在多块盘或多台机器上。
- 如果数据分布在 100 台机器上，每台求本地 Top 100 再汇总，网络上只传输 100 × 100 = 1 万个数，几乎可以忽略。

## 易错点

- 找最大 K 个却用了大根堆：堆顶是最大值，无法作为"门槛"快速淘汰，只能把所有数都放进去，内存爆掉。
- 堆满时忘了先比较 `x > heap.peek()` 就直接 offer 再 poll，结果仍然正确但每个数都要两次 O(log K) 操作，慢很多。
- 分片后只取"每片的最大值"再合并是错的：全局 Top K 可能集中在同一个分片里，每片必须保留 K 个候选。
- 用 `Scanner` 或逐行 `readLine` + `Integer.parseInt` 读超大文本很慢，要用缓冲流、大块读取；这里用二进制 `DataInputStream` 避免解析开销。
- 线程池用完要 `shutdown()`，否则非守护线程会让 JVM 不退出。

## 追问

:::details 如果数据是一直在来的实时流，怎么维护 Top K？
仍然用大小为 K 的小根堆，每来一个数就做一次 offer 判断，任意时刻堆里就是当前 Top K，查询时拷贝出来排序即可。如果要"最近 1 小时的 Top K"（滑动窗口），元素会过期，单个堆不够，通常按时间分桶（比如每分钟一个桶的计数），查询时合并最近 60 个桶再求 Top K。
:::

:::details 如果要找的是出现次数最多的 K 个（热词 Top K），和这题有什么区别？
多了一步"计数"。数据放不下时先按 `hash(key) % M` 把数据拆成 M 个小文件，保证同一个 key 落在同一个文件里；每个文件用 HashMap 计数后用小根堆求本文件 Top K，最后合并各文件的候选。详见 [[algo:most-frequent-ip]]。
:::

:::details 内存足够放下全部数据时，还用堆吗？
可以用快速选择：以第 N-K 小的位置做 partition，只递归一边，期望 O(N)，比堆的 O(N log K) 更快，但会打乱原数组，而且最坏 O(N²) 需要随机 pivot。另一种选择是直接用堆，代码简单且不改原数据。
:::

:::details 数值范围很小（比如 0~100 的考试分数）怎么办？
不需要堆，直接开一个长度为 101 的计数数组，扫一遍计数，再从 100 往下累加到 K 个即可，O(N) 时间 O(值域) 空间。这就是计数排序 / 桶的思路。
:::

:::details 分布式环境下怎么做？
这就是 MapReduce 的经典例子：Map 阶段每台机器求本地 Top K，Reduce 阶段汇总 M×K 个候选再求一次 Top K。因为 Top K 满足"局部 Top K 的并集包含全局 Top K"，所以可以放心分治，还能在 Map 端提前聚合（Combiner）减少网络传输。
:::

## 举一反三

- [[algo:kth-largest-element-in-an-array]]：内存版的 Top K，堆和快速选择两种解法都要会。
- [[algo:top-k-frequent-elements]]：先计数再用堆，是热词 Top K 的内存版。
- [[algo:most-frequent-ip]]：海量数据下的"频次 Top K"，多了哈希分片这一步。
- [[algo:find-median-from-data-stream]]：用两个堆维护数据流的中位数。
- 工程上热门商品排行、热搜榜常用 Redis 的 ZSet（`ZADD` + `ZREVRANGE`）；日志类离线统计则是 MapReduce / Spark 里的 `takeOrdered`、`top` 这类算子。

## 一句话记忆

最大 K 个用 K 大小的小根堆，堆顶是门槛；数据太大就分片各求 Top K，再合并候选。
