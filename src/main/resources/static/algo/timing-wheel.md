## 题意

面试官常说："系统里有几十万个定时任务，比如订单 30 分钟未支付自动取消、连接空闲超时检测、RPC 请求超时，用 `DelayQueue` 或 `ScheduledThreadPoolExecutor` 每次插入都是 O(log n)，怎么做到 O(1)？手写一个时间轮。"要实现：`newTimeout(task, delay)` 添加任务并返回可取消的句柄、到期后执行、`stop()` 停止；允许毫秒级误差（精度为一个 tick）。

## 思路

**面试官想考什么**：时间轮的数据结构（环形数组 + 桶内链表）、如何表示超过一圈的延迟（轮数 rounds 或多层时间轮）、线程安全如何处理（添加线程与工作线程分离），以及和堆实现的对比。

| 方案 | 添加 | 到期检查 | 适用 |
|---|---|---|---|
| `Timer` / `ScheduledThreadPoolExecutor` / `DelayQueue` | O(log n) 堆插入 | O(log n) 取堆顶 | 任务量不大、需要精确时间 |
| 单层时间轮 + rounds（Netty `HashedWheelTimer`） | O(1) 放入桶 | 每个 tick 遍历一个桶，桶里轮数没到的只减 1 | 大量短延迟任务，允许 tick 级误差 |
| 多层时间轮（Kafka 的 `TimingWheel`） | O(1) | 高层到期后降级到低层重新放置 | 延迟跨度很大（秒到天） |
| 定时扫描数据库 | 无 | 每次扫表 O(n) | 实现简单但延迟高、压力大 |

:::tip 关键点
环形数组有 `wheelSize` 个桶，每 `tick` 前进一格。延迟为 d 的任务需要走 `ticks = d / tick` 格：放入下标 `ticks % wheelSize` 的桶，并记录 `rounds = ticks / wheelSize`（还要转几整圈）。工作线程每走到一个桶，把 `rounds == 0` 的任务执行掉，其余的 `rounds--`。**添加任务的线程不直接操作桶**，而是放入并发队列 `pending`，由工作线程在每个 tick 开始时统一搬进桶里，这样桶只被单线程访问，不需要加锁。`wheelSize` 取 2 的幂，可以用位运算 `& mask` 代替取模。
:::

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

class HashedTimingWheel {
    // 定时任务句柄，可取消
    static final class Timeout {
        final long deadline;      // 相对 startNanos 的到期时间（纳秒）
        final Runnable task;
        long rounds;              // 还要转几圈，只由工作线程读写
        volatile boolean cancelled;
        Timeout(long deadline, Runnable task) { this.deadline = deadline; this.task = task; }
        public void cancel() { cancelled = true; } // 惰性删除：工作线程遇到时丢弃
    }

    private final long tickNanos;
    private final int mask;
    private final ArrayDeque<Timeout>[] buckets;          // 只由工作线程访问
    private final Queue<Timeout> pending = new ConcurrentLinkedQueue<>(); // 多线程添加
    private final long startNanos = System.nanoTime();
    private final Thread worker;
    private volatile boolean running = true;
    private long tick; // 当前走到第几格，只由工作线程访问

    @SuppressWarnings("unchecked")
    HashedTimingWheel(long tickMs, int wheelSize) {
        if (Integer.bitCount(wheelSize) != 1) throw new IllegalArgumentException("wheelSize must be power of 2");
        this.tickNanos = TimeUnit.MILLISECONDS.toNanos(tickMs);
        this.mask = wheelSize - 1;
        this.buckets = new ArrayDeque[wheelSize];
        for (int i = 0; i < wheelSize; i++) buckets[i] = new ArrayDeque<>();
        worker = new Thread(this::runLoop, "timing-wheel");
        worker.start();
    }

    public Timeout newTimeout(Runnable task, long delay, TimeUnit unit) {
        if (!running) throw new IllegalStateException("stopped");
        long deadline = System.nanoTime() + unit.toNanos(delay) - startNanos;
        Timeout t = new Timeout(deadline, task);
        pending.add(t); // O(1)，不碰桶
        return t;
    }

    private void runLoop() {
        while (running) {
            long target = startNanos + tickNanos * (tick + 1); // 本格结束的时刻
            long sleep = target - System.nanoTime();
            if (sleep > 0) {
                try {
                    TimeUnit.NANOSECONDS.sleep(sleep);
                } catch (InterruptedException e) {
                    continue; // stop() 唤醒，回到循环检查 running
                }
            }
            transferPending();
            expire(buckets[(int) (tick & mask)]);
            tick++;
        }
    }

    // 把新任务放进对应的桶
    private void transferPending() {
        Timeout t;
        while ((t = pending.poll()) != null) {
            if (t.cancelled) continue;
            long calculated = t.deadline / tickNanos;         // 到期应在第几格
            t.rounds = Math.max(0, (calculated - tick) / buckets.length);
            long ticks = Math.max(calculated, tick);           // 已过期的放到当前格立即执行
            buckets[(int) (ticks & mask)].add(t);
        }
    }

    // 处理当前桶：轮数为 0 的执行，其余轮数减一
    private void expire(ArrayDeque<Timeout> bucket) {
        for (Iterator<Timeout> it = bucket.iterator(); it.hasNext(); ) {
            Timeout t = it.next();
            if (t.cancelled) { it.remove(); continue; }
            if (t.rounds <= 0) {
                it.remove();
                try {
                    t.task.run(); // 生产中应交给业务线程池，避免阻塞时间轮
                } catch (RuntimeException e) {
                    System.out.println("task failed: " + e);
                }
            } else {
                t.rounds--;
            }
        }
    }

    public void stop() throws InterruptedException {
        running = false;
        worker.interrupt();
        worker.join();
    }
}

public class TimingWheelDemo {
    public static void main(String[] args) throws Exception {
        // tick = 10ms，16 个桶，一圈 160ms；250ms 的任务需要多转 1 圈
        HashedTimingWheel wheel = new HashedTimingWheel(10, 16);
        long start = System.nanoTime();
        List<String> fired = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch latch = new CountDownLatch(4);
        for (long d : new long[]{250, 30, 100, 5}) {
            wheel.newTimeout(() -> {
                long cost = (System.nanoTime() - start) / 1_000_000;
                fired.add(d + "ms@" + cost);
                latch.countDown();
            }, d, TimeUnit.MILLISECONDS);
        }
        HashedTimingWheel.Timeout canceled = wheel.newTimeout(() -> fired.add("SHOULD NOT RUN"), 50, TimeUnit.MILLISECONDS);
        canceled.cancel();
        latch.await(2, TimeUnit.SECONDS);
        Thread.sleep(50);
        System.out.println("fired (delay@actual): " + fired); // 顺序 5, 30, 100, 250，被取消的不执行

        // 压力：4 个线程并发添加 20000 个 0~400ms 的任务，校验全部执行、没有提前执行
        int n = 20000;
        CountDownLatch all = new CountDownLatch(n);
        AtomicInteger early = new AtomicInteger();
        AtomicLong maxLateMs = new AtomicLong();
        ExecutorService adders = Executors.newFixedThreadPool(4);
        for (int p = 0; p < 4; p++) {
            adders.submit(() -> {
                ThreadLocalRandom r = ThreadLocalRandom.current();
                for (int i = 0; i < n / 4; i++) {
                    long delay = r.nextLong(400);
                    long due = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(delay);
                    wheel.newTimeout(() -> {
                        long diff = System.nanoTime() - due;
                        if (diff < 0) early.incrementAndGet();
                        maxLateMs.accumulateAndGet(diff / 1_000_000, Math::max);
                        all.countDown();
                    }, delay, TimeUnit.MILLISECONDS);
                }
            });
        }
        adders.shutdown();
        boolean done = all.await(5, TimeUnit.SECONDS);
        System.out.println("stress: all fired=" + done + ", early=" + early.get() + ", max late=" + maxLateMs.get() + "ms");
        wheel.stop();
        if (!done || early.get() != 0 || fired.contains("SHOULD NOT RUN")) throw new AssertionError();
        System.out.println("OK");
    }
}
```

## 复杂度

- 添加 O(1)：入并发队列；搬进桶也是 O(1)。取消 O(1)：只打标记，工作线程遇到时丢弃。
- 每个 tick 的开销 O(当前桶的任务数)：桶里轮数未到的任务也要被遍历一次（`rounds--`），任务延迟远大于一圈时这部分是浪费，这正是多层时间轮要解决的。
- 精度：误差在一个 tick 以内（demo 中 tick = 10ms，实测最大延后约 10~15ms，从不提前）。
- 资源估算：50 万个超时任务，每个句柄对象加上桶中引用约 50~80 字节，总共约 25~40MB；只需 1 个工作线程。若用 `ScheduledThreadPoolExecutor`，每次插入/取出要做 log₂(5×10⁵) ≈ 19 次比较，并且堆由锁保护，高并发添加时竞争明显。

## 易错点

- 延迟超过一圈时只取模不记录轮数：250ms 的任务会在 90ms 时就被执行。
- 多个线程直接往桶里加任务，同时工作线程在遍历桶：`ConcurrentModificationException` 或丢任务；要么桶加锁，要么像这里一样经由 pending 队列交给工作线程。
- 用 `Thread.sleep(tick)` 固定睡眠：每轮处理任务的耗时会不断累积成漂移；应按"起始时间 + (tick + 1) × tickNanos"计算本轮的目标时刻。
- 在时间轮线程里直接执行耗时任务：会拖慢后续所有 tick，应把任务提交给业务线程池。
- 已经过期的任务（添加时计算出的格子已经走过）要放到当前格子立即执行，否则要等一整圈。

## 追问

:::details 单层时间轮在延迟跨度很大时有什么问题？怎么解决？
比如 tick = 1ms、延迟 1 天，要么桶数非常多，要么 rounds 很大，每个 tick 都要遍历大量"还没到"的任务。多层时间轮类似钟表的时、分、秒：秒轮一圈对应分轮一格，任务先放在能容纳它的最粗粒度的轮上，到期时再降级到更细的轮上重新放置。Kafka 的 `TimingWheel` 就是这种分层设计，并用 `DelayQueue` 只保存非空的桶，避免空转推进。
:::

:::details 时间轮和 DelayQueue 怎么选？
任务量小、需要精确到毫秒以内：`DelayQueue`/`ScheduledThreadPoolExecutor` 足够；任务量大（十万级以上）、能接受 tick 级误差、主要是超时类任务（大多数会被取消）：时间轮。超时任务的特点是"绝大部分在到期前就被取消"，时间轮的 O(1) 取消优势很明显。
:::

:::details 机器重启后定时任务丢了怎么办？
内存时间轮不持久化。对"订单 30 分钟未支付取消"这类业务，常见做法是：用 RocketMQ 延迟消息或 Redis ZSET（score 为到期时间，轮询 `ZRANGEBYSCORE`），并在数据库中保留状态，重启后能通过兜底扫描补偿。
:::

:::details Netty 的 HashedWheelTimer 默认参数是多少？
默认 tickDuration 为 100ms，ticksPerWheel 为 512（会规整为 2 的幂），单个工作线程；它同样使用"添加进队列、由工作线程在每个 tick 搬入桶"和"remainingRounds"的设计。
:::

## 举一反三

- [[algo:simple-thread-pool]]：到期任务应交给线程池执行，时间轮只负责"何时触发"。
- [[algo:rate-limiter]]：同样是用时间片（窗口/格子）把连续时间离散化。
- [[algo:merge-k-sorted-lists]]：堆实现的定时器（`DelayQueue`）用的就是小顶堆，与时间轮形成对比。
- 中间件对应：Netty `HashedWheelTimer`（连接空闲检测、超时）、Kafka 的分层 `TimingWheel`（延迟请求）、Dubbo 的调用超时检测也使用 `HashedWheelTimer`。

## 一句话记忆

环形数组每 tick 前进一格，任务按到期格子入桶、超出一圈就记轮数；添加走并发队列交给单线程搬运，O(1) 添加、O(1) 取消。
