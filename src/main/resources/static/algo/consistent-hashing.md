## 题意

面试官常说："分布式缓存有 N 台机器，用 `hash(key) % N` 路由，扩容一台时几乎所有 key 都换了机器，缓存大面积失效。怎么解决？手写一个一致性哈希，并说明为什么要虚拟节点。"要实现：`addNode`、`removeNode`、`getNode(key)`；增删节点时只有少量 key 需要迁移；key 在各节点上分布尽量均匀。

## 思路

**面试官想考什么**：取模路由的问题、哈希环的原理、有序结构（`TreeMap.ceilingEntry`）的使用、虚拟节点解决数据倾斜，以及哈希函数的选择。

| 方案 | 做法 | 扩缩容影响 | 均匀性 |
|---|---|---|---|
| 取模 `hash % N` | 直接取模 | N 变成 N+1 时约 N/(N+1) 的 key 换机器 | 好 |
| 一致性哈希（无虚拟节点） | 节点和 key 映射到 0~2³² 环上，key 顺时针找第一个节点 | 只影响新节点与前一个节点之间的那段，约 1/(N+1) | 差，节点少时环上间隔很不均匀 |
| 一致性哈希 + 虚拟节点 | 每台机器在环上放 100~200 个虚拟点 | 同上，且迁移来源分散到所有旧节点 | 好 |
| 哈希槽（Redis Cluster） | 固定 16384 个槽，槽再分配给节点 | 迁移以槽为单位，需要手动/工具调整 | 好，可人工控制 |

:::tip 关键点
用 `TreeMap<Long, String>`（或线程安全的 `ConcurrentSkipListMap`）表示哈希环：key 是环上的位置，value 是真实节点名。查找时 `ceilingEntry(hash(key))` 找顺时针第一个点，找不到就绕回 `firstEntry()`。虚拟节点命名为 `节点名#序号` 再哈希，每台机器占很多个分散的点，统计上负载就均匀了。哈希函数不能用 `String.hashCode()`（相似字符串分布集中），这里用 MD5 取前 4 字节得到 32 位无符号整数。
:::

下面的 demo：4 台机器每台 160 个虚拟节点，路由 10 万个 key，打印分布；再加入第 5 台，统计迁移比例并与取模对比；最后对比不使用虚拟节点时的分布。

## Java 题解

```java
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;

class ConsistentHashRing {
    private final int virtualNodes;
    private final ConcurrentSkipListMap<Long, String> ring = new ConcurrentSkipListMap<>(); // 环：位置 -> 真实节点

    ConsistentHashRing(int virtualNodes) { this.virtualNodes = virtualNodes; }

    public void addNode(String node) {
        for (int i = 0; i < virtualNodes; i++) ring.put(hash(node + "#" + i), node);
    }

    public void removeNode(String node) {
        for (int i = 0; i < virtualNodes; i++) ring.remove(hash(node + "#" + i), node); // 只删属于自己的点
    }

    public String getNode(String key) {
        if (ring.isEmpty()) return null;
        Map.Entry<Long, String> e = ring.ceilingEntry(hash(key)); // 顺时针第一个节点
        return e != null ? e.getValue() : ring.firstEntry().getValue(); // 超过最大值就绕回环首
    }

    // MD5 取前 4 字节，得到 [0, 2^32) 的无符号值
    static long hash(String s) {
        try {
            byte[] d = MessageDigest.getInstance("MD5").digest(s.getBytes(StandardCharsets.UTF_8));
            return ((long) (d[0] & 0xFF) << 24) | ((d[1] & 0xFF) << 16) | ((d[2] & 0xFF) << 8) | (d[3] & 0xFF);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}

public class ConsistentHashingDemo {
    static Map<String, Integer> distribution(ConsistentHashRing ring, List<String> keys) {
        Map<String, Integer> cnt = new TreeMap<>();
        for (String k : keys) cnt.merge(ring.getNode(k), 1, Integer::sum);
        return cnt;
    }

    public static void main(String[] args) {
        List<String> keys = new ArrayList<>();
        for (int i = 0; i < 100_000; i++) keys.add("user:" + i);
        List<String> nodes = List.of("cache-A", "cache-B", "cache-C", "cache-D");

        ConsistentHashRing ring = new ConsistentHashRing(160);
        nodes.forEach(ring::addNode);
        Map<String, String> before = new HashMap<>();
        for (String k : keys) before.put(k, ring.getNode(k));
        System.out.println("160 vnodes, 4 nodes: " + distribution(ring, keys));

        // 扩容：加入 cache-E，统计迁移比例
        ring.addNode("cache-E");
        int moved = 0, movedToOld = 0;
        for (String k : keys) {
            String now = ring.getNode(k);
            if (!now.equals(before.get(k))) { moved++; if (!now.equals("cache-E")) movedToOld++; }
        }
        System.out.printf("add cache-E: moved %.1f%% (ideal 20%%), moved between old nodes=%d%n", moved * 100.0 / keys.size(), movedToOld);

        // 对比取模：4 台变 5 台
        int modMoved = 0;
        for (String k : keys) {
            long h = ConsistentHashRing.hash(k);
            if (h % 4 != h % 5) modMoved++;
        }
        System.out.printf("modulo 4 -> 5: moved %.1f%%%n", modMoved * 100.0 / keys.size());

        // 缩容：删除 cache-E 后路由应与扩容前完全一致
        ring.removeNode("cache-E");
        boolean same = keys.stream().allMatch(k -> ring.getNode(k).equals(before.get(k)));
        System.out.println("remove cache-E, routes restored: " + same);

        // 对比：不使用虚拟节点
        ConsistentHashRing noVirtual = new ConsistentHashRing(1);
        nodes.forEach(noVirtual::addNode);
        System.out.println("1 vnode, 4 nodes: " + distribution(noVirtual, keys));
        if (movedToOld != 0 || !same) throw new AssertionError();
    }
}
```

## 复杂度

- 时间：`getNode` 为 O(log(N × V))（N 台机器，每台 V 个虚拟节点，跳表/红黑树查找），另加一次 MD5；`addNode`/`removeNode` 为 O(V × log(N × V))。
- 空间 O(N × V)：100 台 × 160 个虚拟节点 = 16000 个环上的点，内存不到 1MB，可以放心多放虚拟节点。
- 迁移量：加入第 N+1 台时，期望只有约 1/(N+1) 的 key 迁移（demo 中 4 → 5 台约 20%），而取模约 N/(N+1)（约 80%）。

## 易错点

- 找不到 `ceilingEntry` 时忘了绕回环首，哈希值最大的那部分 key 返回 null。
- 用 `String.hashCode()` 做哈希：`cache-A#1`、`cache-A#2` 这类字符串的 hashCode 很接近，虚拟节点挤在环的一小段，失去打散效果。
- MD5 前 4 字节拼接时没有 `& 0xFF`：byte 是有符号的，负数会带着符号位扩展，结果错乱。
- 不同机器的虚拟节点哈希冲突时后放入的会覆盖前面的；删除时要用 `remove(key, value)` 只删自己的点，避免误删别人的。
- 增删节点只是改变路由，数据本身需要迁移（或者依靠缓存自然回源），这一点面试时要主动说明。

## 追问

:::details 虚拟节点数一般设多少？
经验值是每台 100~200 个。虚拟节点越多分布越均匀，但环越大、增删节点越慢；demo 中 160 个时各节点占比在 22%~29% 之间，而只用 1 个时最多的节点占了近一半。
:::

:::details 机器配置不同，怎么让性能强的多分担？
按权重分配虚拟节点数：权重为 2 的机器放 2 倍的虚拟节点，它在环上占的弧长期望也是 2 倍。
:::

:::details 一致性哈希和 Redis Cluster 的哈希槽有什么区别？
Redis Cluster 不用一致性哈希，而是 `CRC16(key) % 16384` 映射到固定的 16384 个槽，每个节点负责一部分槽；扩容时把部分槽迁到新节点。槽的归属可以精确控制，迁移粒度清晰；一致性哈希则不需要中心化的槽分配表。
:::

:::details 节点宕机时它的 key 会怎样？
它在环上的所有虚拟节点被移除，这些 key 顺时针落到各自的下一个点上。因为虚拟节点分散，这部分压力会均摊到其他所有节点，而不是全部压到一台邻居上，避免雪崩式的连锁过载。
:::

## 举一反三

- [[algo:search-insert-position]]：`ceilingEntry` 本质上就是在有序集合中找"第一个大于等于目标"的位置，数组版就是二分查找。
- [[algo:lru-cache]]：一致性哈希负责"数据放在哪台缓存"，LRU 负责"每台缓存里淘汰谁"。
- 中间件对应：Dubbo 的 `ConsistentHashLoadBalance`（默认每个服务提供者 160 个虚拟节点）、Nginx 的 `hash $key consistent`、Memcached 客户端的 Ketama 算法；Redis Cluster 则使用 16384 个哈希槽。

## 一句话记忆

节点和 key 都哈希到环上，key 顺时针找第一个节点；每台机器放上百个虚拟节点，扩缩容只动一小段、负载也均匀。
