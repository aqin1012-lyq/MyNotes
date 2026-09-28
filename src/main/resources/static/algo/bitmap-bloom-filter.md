## 题意

面试官的典型问法有两类："40 亿个不重复的无符号整数，内存只有 1GB，怎么快速判断某个数在不在里面 / 怎么去重？"以及"几十亿个 URL（或用户名）要判断是否出现过，内存装不下 HashSet 怎么办，能接受少量误判吗？"要实现的是：**BitMap**（精确、适合整数值域有限的场景）和**布隆过滤器**（概率型、适合任意对象，允许一定误判率但绝不漏判）。

## 思路

面试官想考的是：能算出 HashSet 放不下，知道用"位"代替"对象"来压缩内存；清楚 BitMap 和布隆过滤器各自的前提和代价（值域 vs 误判率），并会用公式确定布隆过滤器的参数。

| 方案 | 做法 | 内存（以 10 亿元素估算） | 准确性 | 适用 |
|---|---|---|---|---|
| HashSet | 直接存对象 | Integer 对象 + 节点，几十 GB | 精确 | 小数据 |
| 外排序后去重 | 排序后相邻比较 | 磁盘 | 精确 | 离线批处理，慢 |
| BitMap | 值 x 对应第 x 位，出现就置 1 | 取决于值域：2³² 位 = 512MB | 精确 | 整数、值域可控（ID、手机号、IP） |
| 布隆过滤器 | k 个哈希函数把元素映射到 m 位数组的 k 个位置 | 1% 误判率约 1.2GB（每元素约 9.6 位） | 说"不在"一定不在；说"在"可能误判 | 任意对象，允许少量误判（缓存穿透、爬虫 URL 去重） |

BitMap 的核心是位运算：第 x 位在 `long[] words` 的 `words[x >>> 6]` 里，位内偏移 `x & 63`，置位 `|= 1L << (x & 63)`，查询 `& (1L << (x & 63)) != 0`。

布隆过滤器插入时把 k 个位置都置 1；查询时只要有一个位置是 0，元素一定没插入过；k 个位置全是 1 时，可能是真的插入过，也可能是别的元素恰好把这些位凑齐了，这就是误判。它**不支持删除**（清掉一位可能影响别的元素）。

:::tip 关键点
布隆过滤器参数公式：预计元素数 n、目标误判率 p，则位数 `m = -n·ln p / (ln 2)²`，哈希函数个数 `k = (m / n)·ln 2`。p = 1% 时每个元素约 9.6 位、k ≈ 7。k 个哈希不必真写 k 个函数：用两个哈希值 `h1 + i·h2`（双重哈希）组合即可。
:::

下面的演示：用 BitMap 对 30 万个随机"号码"（值域 0 到 1 亿）去重并与 HashSet 结果比对；用布隆过滤器插入 10 万个字符串，检查已插入元素零漏判，再用另外 10 万个没插入过的字符串统计实际误判率，与理论值 1% 对比。

## Java 题解

```java
import java.nio.charset.StandardCharsets;
import java.util.*;

// 精确的位图：值 x 对应第 x 位
class BitMap {
    private final long[] words;

    BitMap(long maxValue) {
        words = new long[(int) ((maxValue >>> 6) + 1)]; // 每个 long 存 64 位
    }

    // 置位；返回 true 表示之前不存在（首次出现）
    boolean add(long x) {
        int idx = (int) (x >>> 6);
        long mask = 1L << (x & 63);
        boolean absent = (words[idx] & mask) == 0;
        words[idx] |= mask;
        return absent;
    }

    boolean contains(long x) {
        return (words[(int) (x >>> 6)] & (1L << (x & 63))) != 0;
    }

    long memoryBytes() {
        return words.length * 8L;
    }
}

// 布隆过滤器：k 个哈希位置全为 1 才认为"可能存在"
class BloomFilter {
    private final long[] bits;
    private final long m; // 位数
    private final int k;  // 哈希函数个数

    BloomFilter(long expectedN, double fpp) {
        // m = -n ln p / (ln2)^2, k = m/n * ln2
        this.m = (long) Math.ceil(-expectedN * Math.log(fpp) / (Math.log(2) * Math.log(2)));
        this.k = Math.max(1, (int) Math.round((double) m / expectedN * Math.log(2)));
        this.bits = new long[(int) ((m + 63) >>> 6)];
    }

    void put(String s) {
        long h = hash64(s);
        int h1 = (int) h, h2 = (int) (h >>> 32);
        for (int i = 1; i <= k; i++) {
            long pos = Integer.toUnsignedLong(h1 + i * h2) % m; // 双重哈希模拟 k 个函数
            bits[(int) (pos >>> 6)] |= 1L << (pos & 63);
        }
    }

    boolean mightContain(String s) {
        long h = hash64(s);
        int h1 = (int) h, h2 = (int) (h >>> 32);
        for (int i = 1; i <= k; i++) {
            long pos = Integer.toUnsignedLong(h1 + i * h2) % m;
            if ((bits[(int) (pos >>> 6)] & (1L << (pos & 63))) == 0) {
                return false; // 有一位是 0，一定不存在
            }
        }
        return true; // 可能存在
    }

    // FNV-1a 64 位哈希 + splitmix64 收尾打散
    private static long hash64(String s) {
        long h = 0xcbf29ce484222325L;
        for (byte b : s.getBytes(StandardCharsets.UTF_8)) {
            h ^= (b & 0xff);
            h *= 0x100000001b3L;
        }
        h ^= h >>> 33;
        h *= 0xff51afd7ed558ccdL;
        h ^= h >>> 33;
        h *= 0xc4ceb9fe1a85ec53L;
        h ^= h >>> 33;
        return h;
    }

    long bitCount() { return m; }
    int hashCount() { return k; }
}

public class BitmapBloomDemo {
    public static void main(String[] args) {
        // 1. BitMap 去重：30 万个随机号码，值域 [0, 1 亿)
        Random random = new Random(2024);
        final int maxValue = 100_000_000;
        BitMap bitmap = new BitMap(maxValue);
        Set<Integer> hashSet = new HashSet<>(); // 暴力对照
        int distinct = 0;
        for (int i = 0; i < 300_000; i++) {
            int x = random.nextInt(maxValue);
            if (i % 3 == 0 && i > 0) x = i; // 人为制造一些重复
            if (bitmap.add(x)) distinct++;
            hashSet.add(x);
        }
        boolean containsOk = true;
        for (int x : hashSet) containsOk &= bitmap.contains(x);
        System.out.println("BitMap distinct = " + distinct + ", HashSet size = " + hashSet.size()
                + ", equal = " + (distinct == hashSet.size()) + ", all contained = " + containsOk);
        System.out.println("BitMap memory = " + bitmap.memoryBytes() / 1024 / 1024 + " MB for value range 1e8");

        // 2. 布隆过滤器：预计 10 万个元素，目标误判率 1%
        int n = 100_000;
        BloomFilter bloom = new BloomFilter(n, 0.01);
        for (int i = 0; i < n; i++) bloom.put("user-" + i);
        int falseNegative = 0;
        for (int i = 0; i < n; i++) {
            if (!bloom.mightContain("user-" + i)) falseNegative++; // 必须为 0
        }
        int falsePositive = 0;
        for (int i = n; i < 2 * n; i++) {
            if (bloom.mightContain("user-" + i)) falsePositive++; // 从未插入却说"可能在"
        }
        System.out.println("Bloom m = " + bloom.bitCount() + " bits (" + bloom.bitCount() / 8 / 1024
                + " KB), k = " + bloom.hashCount());
        System.out.println("false negatives = " + falseNegative);
        System.out.printf("false positive rate = %.4f (target 0.01)%n", falsePositive / (double) n);
    }
}
```

## 复杂度

- BitMap：add / contains 都是 O(1)；空间 O(值域 / 8) 字节，与元素个数无关。
- 布隆过滤器：put / mightContain 都是 O(k)；空间 m 位，与元素本身的大小无关（存 URL 和存 int 一样大）。
- 资源估算：40 亿个无符号 int，值域 2³²，BitMap 需要 2³² 位 = 512MB，1GB 内存放得下；判断存在性只需一次位运算。同样的数据用 HashSet<Integer> 至少几十 GB。
- 资源估算：10 亿个 URL、误判率 1%：m ≈ 10⁹ × 9.6 位 ≈ 1.2GB，k = 7；误判率放宽到 3% 约 0.9GB，收紧到 0.1% 约 1.8GB。同样数据用 HashSet<String> 存平均 60 字节的 URL，要 100GB 以上。
- 如果值域很大但元素很稀疏（比如 64 位 ID 只有几百万个），普通 BitMap 会浪费，应该用 RoaringBitmap 这类压缩位图。

## 易错点

- 下标计算用 `x / 64`、`x % 64` 遇到负数会出错，统一用无符号右移 `x >>> 6` 和 `x & 63`，负数要先映射到非负区间。
- `1 << (x & 63)` 写成 int 的 1，移位超过 31 就错了，必须是 `1L`。
- 布隆过滤器说"存在"不代表真的存在，业务上要允许误判（例如误判时回源查库），不能用它做精确去重计费。
- 标准布隆过滤器不支持删除；要删除需要计数布隆过滤器（每个位置换成小计数器），内存成倍增加。
- 实际插入量远超预计 n 时，误判率会急剧上升，需要预估容量留余量，或定期重建。
- 哈希函数质量差（比如直接用 `String.hashCode` 取模）会让位分布不均，实测误判率远高于理论值。

## 追问

:::details 40 亿个整数，内存只有 1GB，怎么找出只出现一次的数？
用 2 位的 BitMap（2-bit map）：每个数用 2 位表示 00 未出现、01 出现一次、10 出现多次。2³² × 2 位 = 1GB，刚好；再紧一点就按高位分段扫描多次，每次只处理一个值域区间。
:::

:::details 布隆过滤器怎么解决缓存穿透？
把数据库里所有合法的 key 预先放进布隆过滤器。请求来了先查过滤器，一定不存在的 key 直接返回，不打到缓存和数据库；判定"可能存在"才走正常流程。少量误判的请求只会多查一次库，不影响正确性。新增数据时要同步写入过滤器，删除则无法同步，通常定期重建。
:::

:::details 布隆过滤器为什么不能删除？有什么替代方案？
一个位可能被多个元素共享，把某元素的 k 位清零会让其他元素出现漏判，破坏"说不在就一定不在"的保证。替代方案：计数布隆过滤器（每个槽是 4 位计数器，内存约 4 倍）、布谷鸟过滤器（Cuckoo Filter，支持删除且空间效率更好），或者定期全量重建。
:::

:::details 分布式场景下布隆过滤器放在哪里？
可以放在 Redis：RedisBloom 模块提供 `BF.ADD` / `BF.EXISTS`，或者自己用 Redis 的 `SETBIT` / `GETBIT` 在一个大 bitmap 上实现（Redisson 的 RBloomFilter 就是这个思路）。单机进程内可以直接用 Guava 的 `BloomFilter.create(funnel, expectedInsertions, fpp)`，它内部用 Murmur3 128 位哈希加双重哈希生成 k 个位置。
:::

## 举一反三

- [[algo:external-sort]]：值域有限且不重复时，BitMap 可以代替外部排序。
- [[algo:most-frequent-ip]]：IPv4 同样是 32 位整数，但要计数而不是判存在，需要哈希分片。
- [[algo:single-number]]：同属位运算技巧，用异或抵消。
- 工程对应：Redis 的 `SETBIT` / `BITCOUNT` 常用于签到、日活统计；Guava `BloomFilter`；HBase、RocksDB 在每个 SSTable 上挂布隆过滤器，读时先判断 key 是否可能在该文件里，避免无效磁盘读。

## 一句话记忆

整数值域可控用 BitMap 精确判重；任意对象又能容忍误判用布隆过滤器，"说不在一定不在"，m、k 按公式算。
