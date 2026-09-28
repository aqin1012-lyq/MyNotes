## 题意

面试官常说："手写一个生产者-消费者模型：几个生产者线程往一个容量有限的缓冲区里放数据，几个消费者线程取出来处理；缓冲区满了生产者要等，空了消费者要等。最后所有数据都要被恰好消费一次，程序能正常退出。"通常先要求用 `wait/notify` 手写，再问用 JUC 怎么写、怎么优雅停止。

## 思路

**面试官想考什么**：①管程（monitor）思想：共享状态 + 互斥锁 + 条件等待；②`while` 等待与 `notifyAll`；③如何让消费者知道"生产已经结束"（毒丸 / 关闭标志）；④对 `BlockingQueue` 的熟悉程度。

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| synchronized + wait/notifyAll | 手写缓冲区，满则生产者 wait，空则消费者 wait | 考基础，面试最常要求 | 生产者和消费者共用一个等待队列，notifyAll 会唤醒同类线程 |
| ReentrantLock + notFull/notEmpty | 两个 Condition 分开等待 | 精确唤醒对方那一类线程 | 代码稍多，见 [[algo:bounded-blocking-queue]] |
| BlockingQueue（`ArrayBlockingQueue`） | 直接 `put` / `take` | 生产代码首选，最不容易出错 | 面试时不能只写这个 |
| Semaphore 三件套 | empty(N)、full(0)、mutex(1) | 教科书经典写法 | acquire 顺序写反就死锁 |

:::tip 关键点
三件事缺一不可：**①所有对缓冲区的读写都在同一把锁内；②条件不满足时在 `while` 里 `wait()`；③状态改变后 `notifyAll()`**。结束信号用"毒丸"（poison pill）：生产者全部结束后，往队列里放与消费者数量相同的特殊元素，消费者取到毒丸就退出，这样不需要额外的共享标志，也不会有消费者卡在空队列上。
:::

下面代码手写一个 `Buffer`（wait/notifyAll 版），3 个生产者各生产 1000 个数，2 个消费者消费，最后校验"数量和总和都对得上"；再用 `ArrayBlockingQueue` 实现同样的流程作对比。

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

// 手写的有界缓冲区：synchronized + wait/notifyAll
class Buffer<T> {
    private final Object[] items;
    private int head, tail, count; // 环形数组，全部在锁内访问

    Buffer(int capacity) { items = new Object[capacity]; }

    public synchronized void put(T x) throws InterruptedException {
        while (count == items.length) wait(); // 满了：生产者等待
        items[tail] = x;
        tail = (tail + 1) % items.length;
        count++;
        notifyAll(); // 唤醒等待"非空"的消费者
    }

    @SuppressWarnings("unchecked")
    public synchronized T take() throws InterruptedException {
        while (count == 0) wait(); // 空了：消费者等待
        T x = (T) items[head];
        items[head] = null; // 帮助 GC
        head = (head + 1) % items.length;
        count--;
        notifyAll(); // 唤醒等待"非满"的生产者
        return x;
    }
}

public class ProducerConsumer {
    static final int POISON = -1; // 毒丸：通知消费者退出

    public static void main(String[] args) throws Exception {
        int producers = 3, consumers = 2, perProducer = 1000;
        long expectedSum = (long) producers * perProducer * (perProducer + 1) / 2;

        Buffer<Integer> buf = new Buffer<>(8);
        long[] r1 = run(producers, consumers, perProducer, buf::put, buf::take);
        System.out.println("wait/notify   : consumed=" + r1[0] + " sum=" + r1[1] + " expected=" + expectedSum);

        BlockingQueue<Integer> q = new ArrayBlockingQueue<>(8);
        long[] r2 = run(producers, consumers, perProducer, q::put, q::take);
        System.out.println("BlockingQueue : consumed=" + r2[0] + " sum=" + r2[1] + " expected=" + expectedSum);

        if (r1[0] != producers * perProducer || r1[1] != expectedSum || r2[1] != expectedSum)
            throw new AssertionError("mismatch");
        System.out.println("OK");
    }

    interface Put { void put(Integer x) throws InterruptedException; }
    interface Take { Integer take() throws InterruptedException; }

    // 启动生产者和消费者；生产者全部结束后放入 consumers 个毒丸
    static long[] run(int producers, int consumers, int per, Put put, Take take) throws Exception {
        AtomicLong count = new AtomicLong(), sum = new AtomicLong();
        ExecutorService pool = Executors.newFixedThreadPool(producers + consumers);
        List<Future<?>> ps = new ArrayList<>();
        for (int p = 0; p < producers; p++) {
            ps.add(pool.submit(() -> {
                for (int i = 1; i <= per; i++) put.put(i);
                return null;
            }));
        }
        for (int c = 0; c < consumers; c++) {
            pool.submit(() -> {
                while (true) {
                    int x = take.take();
                    if (x == POISON) return null; // 取到毒丸就退出
                    count.incrementAndGet();
                    sum.addAndGet(x);
                }
            });
        }
        for (Future<?> f : ps) f.get();                     // 等生产者全部完成
        for (int c = 0; c < consumers; c++) put.put(POISON); // 每个消费者一个毒丸
        pool.shutdown();
        if (!pool.awaitTermination(5, TimeUnit.SECONDS)) throw new IllegalStateException("timeout");
        return new long[]{count.get(), sum.get()};
    }
}
```

## 复杂度

- 时间：每个元素一次 put + 一次 take，均摊 O(1)；总计 O(元素数)。吞吐瓶颈在锁竞争：单锁模型下生产和消费互斥，`LinkedBlockingQueue` 用 putLock/takeLock 两把锁让两端可以并行。
- 空间 O(capacity)：有界缓冲区。**有界**是关键：无界队列在消费变慢时会不断堆积直到 OOM。

## 易错点

- `if (count == 0) wait();`：两个消费者同时被唤醒，第一个取走了数据，第二个不再检查条件直接取，读到 null 或越界。
- 用 `notify()`：生产者可能唤醒的是另一个生产者（都在同一个等待队列里），消费者一直睡，最终全部挂住。
- 忘了结束信号：生产完后消费者永远阻塞在 `take()`，程序无法退出。毒丸数量要等于消费者数量。
- 在 `wait()` 所在对象之外的锁上调用它，会抛 `IllegalMonitorStateException`。
- 线程池没有 `shutdown()`：非守护线程让 JVM 无法退出。

## 追问

:::details notifyAll 会唤醒同类线程，有什么更好的办法？
改用 `ReentrantLock` 加两个 Condition：生产者在 `notFull` 上等，消费者在 `notEmpty` 上等；put 之后只 `notEmpty.signal()`，take 之后只 `notFull.signal()`。这正是 `ArrayBlockingQueue` 的实现。
:::

:::details 除了毒丸，还有什么停止方式？
可以用 `volatile boolean stopped` + 消费者用 `poll(timeout)` 轮询，超时后检查标志；或者直接 `shutdownNow()` 中断消费者，消费者在 `take()` 上收到 `InterruptedException` 后退出。毒丸的好处是能保证"队列里剩下的数据都被处理完"再退出。
:::

:::details 消费者处理很慢，队列满了怎么办？
这就是"背压"。可选策略：生产者阻塞等待（put）、带超时的 offer 失败后降级/丢弃/落盘、或者增加消费者。线程池的拒绝策略（AbortPolicy、CallerRunsPolicy 等）就是同一个问题的不同答案。
:::

:::details 这个模型在实际系统里对应什么？
线程池（任务队列 + 工作线程）、日志框架的异步 Appender、消息队列（Kafka/RocketMQ 是跨进程的生产者-消费者，Broker 就是持久化的缓冲区）。
:::

## 举一反三

- [[algo:bounded-blocking-queue]]：把本题的缓冲区用 Lock + 两个 Condition 重写，并实现带超时的 offer/poll。
- [[algo:simple-thread-pool]]：线程池本身就是"提交任务的生产者 + 工作线程消费者"。
- JDK 对应：`ArrayBlockingQueue`（单锁 + notEmpty/notFull）、`LinkedBlockingQueue`（双锁）、`SynchronousQueue`（没有容量，put 必须等到 take），`ThreadPoolExecutor` 的工作队列就是 `BlockingQueue`。

## 一句话记忆

一把锁、两个条件（非满/非空）、while 里等、改完状态就唤醒；结束时每个消费者发一颗毒丸。
