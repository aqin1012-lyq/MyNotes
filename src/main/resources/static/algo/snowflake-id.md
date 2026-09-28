## 题意

面试官常说："分库分表后不能再用数据库自增 ID，手写一个雪花算法 ID 生成器：64 位 long，全局唯一、趋势递增、单机每秒能生成几百万个；再说说时钟回拨怎么处理。"要实现：`nextId()` 线程安全；能把 ID 解析回时间戳、机器号、序列号；处理同一毫秒内序列号用完和时钟回拨两种情况。

## 思路

**面试官想考什么**：位运算拼装、各字段位数的取舍与容量计算、同一毫秒内的并发控制、时钟回拨这个经典坑。

| 方案 | 优点 | 缺点 |
|---|---|---|
| 数据库自增 / 多库设置不同步长 | 简单、严格递增 | 依赖数据库，性能和可用性受限，扩容时步长难调 |
| UUID | 本地生成、无依赖 | 128 位字符串，无序，做 InnoDB 主键会导致频繁页分裂 |
| Redis `INCR` | 递增、性能好 | 依赖 Redis，持久化不当可能重复 |
| 号段模式（美团 Leaf-segment） | 批量从数据库取一段 ID 放内存，性能高 | 依赖数据库，ID 会泄露业务量 |
| 雪花算法 | 本地生成、64 位、趋势递增 | 依赖时钟，需要分配机器号 |

位布局（从高到低）：

```
| 1 bit | 41 bits timestamp (ms since epoch) | 5 bits dc | 5 bits worker | 12 bits sequence |
  sign=0   ~69 years                          32 dcs      32 workers      4096 ids per ms
```

:::tip 关键点
`id = (ts - EPOCH) << 22 | datacenterId << 17 | workerId << 12 | sequence`。同一毫秒内 `sequence = (sequence + 1) & 4095`，变成 0 说明本毫秒用完，**自旋等到下一毫秒**；进入新毫秒时序列号归零。如果当前时间小于上次时间（时钟回拨），回拨很小时等待追上，回拨较大时直接抛异常拒绝发号，绝不能生成可能重复的 ID。整个 `nextId` 用 `synchronized` 保护，时间和序列号两个状态必须一起原子更新。
:::

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.LongSupplier;

class SnowflakeIdGenerator {
    static final long EPOCH = 1704067200000L; // 自定义起始时间 2024-01-01 00:00:00 UTC，延长可用年限
    static final int WORKER_BITS = 5, DC_BITS = 5, SEQ_BITS = 12;
    static final long MAX_WORKER = ~(-1L << WORKER_BITS);   // 31
    static final long MAX_DC = ~(-1L << DC_BITS);           // 31
    static final long SEQ_MASK = ~(-1L << SEQ_BITS);        // 4095
    static final int WORKER_SHIFT = SEQ_BITS;               // 12
    static final int DC_SHIFT = SEQ_BITS + WORKER_BITS;     // 17
    static final int TS_SHIFT = DC_SHIFT + DC_BITS;         // 22
    static final long MAX_BACKWARD_MS = 5;                  // 可容忍的回拨毫秒数

    private final long datacenterId, workerId;
    private final LongSupplier clock; // 注入时钟，便于测试回拨
    private long lastTs = -1L;
    private long sequence = 0L;

    SnowflakeIdGenerator(long datacenterId, long workerId, LongSupplier clock) {
        if (datacenterId < 0 || datacenterId > MAX_DC || workerId < 0 || workerId > MAX_WORKER)
            throw new IllegalArgumentException("id out of range");
        this.datacenterId = datacenterId;
        this.workerId = workerId;
        this.clock = clock;
    }

    SnowflakeIdGenerator(long datacenterId, long workerId) {
        this(datacenterId, workerId, System::currentTimeMillis);
    }

    public synchronized long nextId() {
        long ts = clock.getAsLong();
        if (ts < lastTs) { // 时钟回拨
            long offset = lastTs - ts;
            if (offset > MAX_BACKWARD_MS)
                throw new IllegalStateException("clock moved backwards by " + offset + "ms, refuse to generate id");
            ts = waitUntilAfter(lastTs - 1); // 回拨很小：等时间追上
        }
        if (ts == lastTs) {
            sequence = (sequence + 1) & SEQ_MASK;
            if (sequence == 0) ts = waitUntilAfter(lastTs); // 本毫秒 4096 个用完，等下一毫秒
        } else {
            sequence = 0; // 新的一毫秒，序列号归零
        }
        lastTs = ts;
        return ((ts - EPOCH) << TS_SHIFT) | (datacenterId << DC_SHIFT) | (workerId << WORKER_SHIFT) | sequence;
    }

    // 自旋直到时钟大于 last
    private long waitUntilAfter(long last) {
        long ts = clock.getAsLong();
        while (ts <= last) {
            Thread.onSpinWait();
            ts = clock.getAsLong();
        }
        return ts;
    }

    // 反解：{时间戳, 数据中心, 机器, 序列号}
    static long[] parse(long id) {
        return new long[]{(id >>> TS_SHIFT) + EPOCH, (id >>> DC_SHIFT) & MAX_DC,
                (id >>> WORKER_SHIFT) & MAX_WORKER, id & SEQ_MASK};
    }
}

public class SnowflakeDemo {
    public static void main(String[] args) throws Exception {
        // 1. 生成并反解
        SnowflakeIdGenerator gen = new SnowflakeIdGenerator(3, 7);
        long id = gen.nextId();
        System.out.println("id=" + id + " parse=" + Arrays.toString(SnowflakeIdGenerator.parse(id)));

        // 2. 8 个线程并发各生成 25 万个：全局唯一，且每个线程拿到的 ID 严格递增
        int threads = 8, per = 250_000;
        long[][] out = new long[threads][per];
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        long t0 = System.nanoTime();
        List<Future<Boolean>> fs = new ArrayList<>();
        for (int t = 0; t < threads; t++) {
            final int k = t;
            fs.add(pool.submit(() -> {
                for (int i = 0; i < per; i++) out[k][i] = gen.nextId();
                for (int i = 1; i < per; i++) if (out[k][i] <= out[k][i - 1]) return false;
                return true;
            }));
        }
        boolean increasing = true;
        for (Future<Boolean> f : fs) increasing &= f.get();
        long ms = Math.max(1, (System.nanoTime() - t0) / 1_000_000);
        pool.shutdown();
        long[] all = Arrays.stream(out).flatMapToLong(Arrays::stream).sorted().toArray();
        int dup = 0;
        for (int i = 1; i < all.length; i++) if (all[i] == all[i - 1]) dup++;
        System.out.println("2,000,000 ids: dup=" + dup + " perThreadIncreasing=" + increasing + " cost=" + ms + "ms");

        // 3. 序列号溢出：假时钟每被调用 5000 次才前进 1ms，同一毫秒内最多 4096 个
        long[] calls = {0};
        SnowflakeIdGenerator slow = new SnowflakeIdGenerator(0, 0, () -> SnowflakeIdGenerator.EPOCH + calls[0]++ / 5000);
        Map<Long, Integer> perMs = new HashMap<>();
        for (int i = 0; i < 10000; i++) perMs.merge(SnowflakeIdGenerator.parse(slow.nextId())[0], 1, Integer::sum);
        System.out.println("max ids in one ms = " + Collections.max(perMs.values()));

        // 4. 时钟回拨：回拨 10ms 拒绝发号；回拨 2ms 等待追上后继续
        long[] now = {SnowflakeIdGenerator.EPOCH + 1000};
        boolean[] advance = {false};
        SnowflakeIdGenerator g2 = new SnowflakeIdGenerator(1, 1, () -> advance[0] ? now[0]++ : now[0]);
        long before = g2.nextId();
        now[0] -= 10;
        try {
            g2.nextId();
        } catch (IllegalStateException e) {
            System.out.println("rollback 10ms -> " + e.getMessage());
        }
        now[0] += 8;          // 相比上次仍回拨 2ms
        advance[0] = true;    // 时钟继续走
        long after = g2.nextId();
        System.out.println("rollback 2ms -> waited, new id greater: " + (after > before));

        if (dup != 0 || !increasing || Collections.max(perMs.values()) > 4096 || after <= before) throw new AssertionError();
        System.out.println("OK");
    }
}
```

## 复杂度

- 时间：`nextId` O(1)，只有位运算和一次读时钟；序列号用完时最多自旋不到 1ms。
- 容量估算：41 位毫秒时间戳可用 2⁴¹ ms ≈ 69.7 年（从自定义 EPOCH 算起，所以 EPOCH 要设成上线前不久）；10 位机器号最多 1024 个节点；12 位序列号每毫秒 4096 个，单机理论上限约 409.6 万/秒。demo 中 8 线程 200 万个 ID 约 0.5 秒，瓶颈在 synchronized 和序列号上限。
- 空间 O(1)。

## 易错点

- 时间戳不减 EPOCH：直接用当前毫秒数左移 22 位会溢出符号位，得到负数 ID。
- 序列号用完后不等待下一毫秒而是继续自增：高位进位到机器号字段，与其他机器的 ID 冲突。
- 进入新毫秒时序列号总是从 0 开始：低并发下 ID 末尾总是偶数/0，按 ID 取模分库会严重倾斜。常见改进是新毫秒时从一个随机小数开始。
- 忽略时钟回拨：NTP 校时让时间倒退后，会生成与之前完全相同的 ID。
- `nextId` 不加锁：`lastTs` 和 `sequence` 的读改写不是原子的，并发下会重复。
- ID 传给前端 JavaScript：Number 只能精确表示 2⁵³ 以内的整数，19 位的雪花 ID 会丢精度，接口里应序列化为字符串。

## 追问

:::details 机器号（workerId）怎么分配？
小规模可以写在配置里；容器化部署时实例频繁变化，常见做法是启动时从 ZooKeeper 的顺序节点或数据库/Redis 中申请一个号并定期续约（美团 Leaf-snowflake 用 ZooKeeper 持久顺序节点分配 workerId），也可以用 IP 后几位但要防冲突。
:::

:::details 时钟回拨还有什么处理方式？
①回拨小于几毫秒：等待追上（本实现）；②回拨较大：拒绝服务并告警，把该节点摘除；③预留几位"时钟序列"位，发生回拨时加 1，相当于换了一个逻辑机器号继续发号；④不用实时时钟，而是启动时取一次时间后用自增的"逻辑时间"（百度 UidGenerator 的 CachedUidGenerator 借用未来时间的思路）。
:::

:::details 雪花 ID 做 MySQL 主键好不好？
好于 UUID：趋势递增，插入时基本追加在 B+ 树最右侧，页分裂少；8 字节的 BIGINT 也比 36 字符的 UUID 字符串小得多，二级索引更小。但它只是"趋势递增"，多台机器之间不保证严格递增。
:::

:::details 为什么说是"趋势递增"而不是严格递增？
单个生成器内严格递增；但不同机器的时钟有偏差，且机器号在序列号前面，同一毫秒内机器 2 的 ID 总比机器 1 的大，整体只按时间大致递增。
:::

## 举一反三

- [[algo:thread-safe-singleton]]：ID 生成器在一个进程内通常是单例，否则两个实例使用同一 workerId 会生成重复 ID。
- [[algo:consistent-hashing]]：拿到 ID 后常按 ID 取模或一致性哈希进行分库分表路由。
- 中间件对应：美团 Leaf（号段模式 + snowflake 模式）、百度 UidGenerator、MyBatis-Plus 的 `IdType.ASSIGN_ID` 默认使用雪花算法生成 ID。

## 一句话记忆

1 位符号 + 41 位毫秒 + 10 位机器 + 12 位序列；同毫秒序列自增、用完等下一毫秒，时钟回拨小就等、大就拒绝。
