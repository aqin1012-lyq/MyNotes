## 题意

面试官常说："某个接口每秒最多允许 N 次请求，手写一个限流器，`tryAcquire()` 返回是否放行。分别说说固定窗口、滑动窗口、令牌桶怎么实现，各有什么问题。"要求线程安全、O(1) 或接近 O(1) 的判断，能讲清楚各算法在"窗口边界突发"和"允许突发"上的差异。

## 思路

**面试官想考什么**：几种经典算法的原理与缺陷、如何在不开定时线程的情况下"惰性"补充令牌、线程安全、以及单机限流与分布式限流的区别。

| 算法 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| 固定窗口计数 | 按 `now / 窗口` 分段，每段一个计数器 | 最简单，O(1) 内存 | **边界突发**：上一窗口最后时刻和下一窗口开头各打满，短时间内通过 2N |
| 滑动窗口日志 | 队列记录最近窗口内每个请求的时间戳 | 精确 | 内存 O(N)，N 大时不划算 |
| 滑动窗口计数 | 把窗口切成若干小格，只统计最近若干格 | 在精度和内存之间折中 | 仍有小格粒度的误差 |
| 漏桶 | 请求进桶，以恒定速率流出 | 输出绝对平滑 | 不允许突发，突发请求要排队或被丢弃 |
| 令牌桶 | 以速率 r 往容量 b 的桶里放令牌，请求取令牌 | 平均速率受控，又允许不超过 b 的突发 | 需要维护上次补充时间 |

:::tip 关键点
令牌桶不需要后台线程定时放令牌：每次请求时按 `(now - lastRefill) × rate` **惰性补充**，再 `min(capacity, ...)` 截断，然后判断是否 ≥ 1。所有状态的读改写放在同一个 `synchronized` 里（或用 CAS 循环）保证线程安全。为了便于测试，下面把"当前时间"作为参数传入，生产代码里传 `System.nanoTime()`。
:::

下面的 demo 用人为指定的时间戳演示：限流 5 次/秒时，固定窗口在 999ms 与 1000ms 两个时刻共放行 10 个请求，而滑动窗口只放行 5 个；令牌桶先允许 5 个突发，之后按每 200ms 一个的速率恢复；最后 8 个线程在同一时刻并发抢令牌，校验恰好放行 5 个。

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

interface Limiter {
    boolean tryAcquire(long nowMs); // 传入当前时间，便于测试
}

// 固定窗口：同一窗口内计数，超过上限拒绝
class FixedWindowLimiter implements Limiter {
    private final int limit;
    private final long windowMs;
    private long windowStart = Long.MIN_VALUE;
    private int count;

    FixedWindowLimiter(int limit, long windowMs) { this.limit = limit; this.windowMs = windowMs; }

    public synchronized boolean tryAcquire(long nowMs) {
        long start = nowMs / windowMs * windowMs; // 当前时间所在窗口的起点
        if (start != windowStart) {               // 进入新窗口，计数清零
            windowStart = start;
            count = 0;
        }
        if (count < limit) { count++; return true; }
        return false;
    }
}

// 滑动窗口日志：只保留最近 windowMs 内的请求时间戳
class SlidingWindowLimiter implements Limiter {
    private final int limit;
    private final long windowMs;
    private final Deque<Long> log = new ArrayDeque<>();

    SlidingWindowLimiter(int limit, long windowMs) { this.limit = limit; this.windowMs = windowMs; }

    public synchronized boolean tryAcquire(long nowMs) {
        while (!log.isEmpty() && log.peekFirst() <= nowMs - windowMs) log.pollFirst(); // 移出过期请求
        if (log.size() < limit) { log.addLast(nowMs); return true; }
        return false;
    }
}

// 令牌桶：容量 capacity，每秒补充 ratePerSec 个，惰性补充
class TokenBucketLimiter implements Limiter {
    private final double capacity, ratePerMs;
    private double tokens;
    private long lastRefillMs;

    TokenBucketLimiter(int capacity, double ratePerSec, long nowMs) {
        this.capacity = capacity;
        this.ratePerMs = ratePerSec / 1000.0;
        this.tokens = capacity; // 初始满桶，允许一开始的突发
        this.lastRefillMs = nowMs;
    }

    public synchronized boolean tryAcquire(long nowMs) {
        if (nowMs > lastRefillMs) { // 按流逝时间补充令牌，不超过容量
            tokens = Math.min(capacity, tokens + (nowMs - lastRefillMs) * ratePerMs);
            lastRefillMs = nowMs;
        }
        if (tokens >= 1) { tokens -= 1; return true; }
        return false;
    }
}

public class RateLimiterDemo {
    // 在给定的时间点依次发请求，返回放行个数
    static int passCount(Limiter l, long... times) {
        int pass = 0;
        for (long t : times) if (l.tryAcquire(t)) pass++;
        return pass;
    }

    static long[] repeat(long t, int n) {
        long[] a = new long[n];
        Arrays.fill(a, t);
        return a;
    }

    public static void main(String[] args) throws Exception {
        // 1. 边界突发：限 5 次/秒，999ms 发 5 个，1000ms 再发 5 个
        long[] burst = new long[10];
        for (int i = 0; i < 10; i++) burst[i] = i < 5 ? 999 : 1000;
        int fixed = passCount(new FixedWindowLimiter(5, 1000), burst);
        int sliding = passCount(new SlidingWindowLimiter(5, 1000), burst);
        System.out.println("boundary burst: fixed=" + fixed + " sliding=" + sliding); // 10 vs 5

        // 2. 令牌桶：容量 5、每秒 5 个；t=0 突发 7 个，t=200 恢复 1 个，t=1200 最多攒满 5 个
        TokenBucketLimiter tb = new TokenBucketLimiter(5, 5, 0);
        int b0 = passCount(tb, repeat(0, 7));
        int b1 = passCount(tb, repeat(200, 3));
        int b2 = passCount(tb, repeat(1200, 10));
        System.out.println("token bucket: t=0 " + b0 + "/7, t=200 " + b1 + "/3, t=1200 " + b2 + "/10"); // 5, 1, 5

        // 3. 线程安全：8 个线程在同一时刻各抢 100 次，只应放行 5 个
        for (Limiter l : List.of(new FixedWindowLimiter(5, 1000), new SlidingWindowLimiter(5, 1000),
                new TokenBucketLimiter(5, 5, 0))) {
            AtomicInteger pass = new AtomicInteger();
            ExecutorService pool = Executors.newFixedThreadPool(8);
            CountDownLatch go = new CountDownLatch(1);
            for (int i = 0; i < 8; i++) pool.submit(() -> {
                go.await();
                for (int k = 0; k < 100; k++) if (l.tryAcquire(0)) pass.incrementAndGet();
                return null;
            });
            go.countDown();
            pool.shutdown();
            pool.awaitTermination(5, TimeUnit.SECONDS);
            System.out.println(l.getClass().getSimpleName() + " concurrent pass=" + pass.get());
            if (pass.get() != 5) throw new AssertionError();
        }
        if (fixed != 10 || sliding != 5 || b0 != 5 || b1 != 1 || b2 != 5) throw new AssertionError();
        System.out.println("OK");
    }
}
```

## 复杂度

- 固定窗口、令牌桶：每次判断 O(1) 时间、O(1) 空间。
- 滑动窗口日志：均摊 O(1) 时间（每个时间戳进出队列各一次），空间 O(N)，N 为窗口内的上限。
- 资源估算：若对 10 万个用户分别限流（每人 100 次/分钟），日志法最坏要存 10⁵ × 100 = 10⁷ 个 long ≈ 80MB（还不算包装对象开销）；令牌桶每人只需一个 double 和一个 long，约 16 字节 × 10⁵ ≈ 1.6MB。

## 易错点

- 固定窗口用 `now - windowStart >= windowMs` 判断换窗口，但 `windowStart` 设成了"第一次请求的时间"而不是对齐的窗口起点：语义变成"从第一次请求起算"，与需求不一致时要说清楚。
- 令牌桶补充时忘了 `min(capacity, ...)`：长时间空闲后令牌无限累积，瞬间放行巨量请求。
- 令牌数用 `int` 并且每次补充向下取整后更新 `lastRefill`：零头被丢弃，实际速率偏低；要么用 double，要么只把 lastRefill 前进"整数个令牌对应的时间"。
- 判断和扣减分成两步且没有加锁：并发下多个线程同时看到"还有 1 个令牌"，一起通过。
- 用 `System.currentTimeMillis()` 计时：系统时间可能被回拨，单机限流应使用单调时钟 `System.nanoTime()`。

## 追问

:::details 令牌桶和漏桶的本质区别？
漏桶限制的是**流出速率**，不论进来多快，出去都是匀速，适合保护处理能力固定的下游；令牌桶限制的是**平均速率**，桶里攒着的令牌允许一次性突发，适合需要容忍短时高峰的接口。
:::

:::details 分布式环境下怎么限流？
单机限流只能保证每个实例的速率，总量 = 单机上限 × 实例数。全局限流通常把计数放到 Redis：固定窗口用 `INCR` + `EXPIRE`；滑动窗口用 ZSET 存时间戳，`ZREMRANGEBYSCORE` 删除过期再 `ZCARD`；令牌桶用 Lua 脚本把"读取、补充、扣减"做成原子操作。网关层（如 Sentinel、Nginx `limit_req`）也是常见位置。
:::

:::details 被限流的请求怎么处理？
直接拒绝并返回 HTTP 429；或者排队等待（令牌桶的阻塞版 `acquire()`，按欠的令牌数计算需要 sleep 的时间）；或者走降级逻辑返回缓存/默认值。
:::

:::details Guava RateLimiter 是怎么实现的？
它是令牌桶的变体：`SmoothBursty` 允许攒最多一定时间的令牌做突发；`SmoothWarmingUp` 带预热期，冷启动时速率逐渐升高。它还允许"预支"：当前请求可以透支令牌立即通过，代价由下一个请求等待来偿还。
:::

## 举一反三

- [[algo:sliding-window-maximum]]：同样是维护"最近一个窗口"内的数据，队列头部过期就弹出。
- [[algo:parallel-calls-aggregate]]：并行调用放大了下游流量，常需要配合限流与熔断。
- 中间件对应：Guava `RateLimiter`（令牌桶）、Sentinel 的 QPS 流控（滑动窗口统计 + 匀速排队模式类似漏桶）、Nginx `limit_req`（漏桶）、Redis + Lua 做分布式限流。

## 一句话记忆

固定窗口简单但有边界突发，滑动窗口精确但费内存，令牌桶按时间惰性补令牌、控平均速率又允许突发。
