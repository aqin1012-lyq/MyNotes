## 题意

面试官常说："不用 JDK 的 BlockingQueue，自己实现一个线程安全的有界阻塞队列：构造时给定容量；`put` 满了就阻塞，`take` 空了就阻塞；再加上带超时的 `offer(e, timeout)` 和 `poll(timeout)`，超时返回 false / null；以及 `size()`。"约束：多个生产者和多个消费者并发调用，不能丢数据、不能重复取，不能忙等。

## 思路

**面试官想考什么**：本质就是看你能不能写出 `ArrayBlockingQueue` 的核心：一把锁 + 两个条件队列，以及 `awaitNanos` 的超时循环写法。

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| synchronized + wait/notifyAll | 一个监视器，一个等待队列 | 简单 | 生产者和消费者混在一个等待队列，只能 notifyAll 广播；超时等待要自己算剩余时间 |
| ReentrantLock + notFull/notEmpty | 两个 Condition 分别存放生产者和消费者 | 精确唤醒，`awaitNanos` 自带剩余时间 | 必须 finally 解锁 |
| 双锁（putLock/takeLock） | 头尾各一把锁，计数用 AtomicInteger | 生产和消费可并行，吞吐更高 | 实现复杂，`LinkedBlockingQueue` 用的就是这种 |
| Semaphore（slots/items）+ 锁 | 用两个信号量计数空位与元素 | 思路直观 | 超时、中断处理更繁琐 |

:::tip 关键点
**入队后 signal `notEmpty`，出队后 signal `notFull`**，每次只唤醒对方那一类中的一个线程。超时版本用 `nanos = cond.awaitNanos(nanos)`：它返回剩余等待时间，放在 `while` 里循环，即使被虚假唤醒也会按剩余时间继续等，`nanos <= 0` 就返回失败。底层用环形数组，`putIndex`/`takeIndex` 到末尾后绕回 0。
:::

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.*;

class MyBlockingQueue<E> {
    private final Object[] items;
    private int putIndex, takeIndex, count; // 环形数组，全部在锁内访问
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notEmpty = lock.newCondition(); // 消费者在这里等
    private final Condition notFull = lock.newCondition();  // 生产者在这里等

    MyBlockingQueue(int capacity) {
        if (capacity <= 0) throw new IllegalArgumentException();
        items = new Object[capacity];
    }

    public void put(E e) throws InterruptedException {
        Objects.requireNonNull(e);
        lock.lockInterruptibly(); // 等锁时也能响应中断
        try {
            while (count == items.length) notFull.await();
            enqueue(e);
        } finally {
            lock.unlock();
        }
    }

    public boolean offer(E e, long timeout, TimeUnit unit) throws InterruptedException {
        Objects.requireNonNull(e);
        long nanos = unit.toNanos(timeout);
        lock.lockInterruptibly();
        try {
            while (count == items.length) {
                if (nanos <= 0) return false;       // 超时
                nanos = notFull.awaitNanos(nanos); // 返回剩余时间
            }
            enqueue(e);
            return true;
        } finally {
            lock.unlock();
        }
    }

    public E take() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (count == 0) notEmpty.await();
            return dequeue();
        } finally {
            lock.unlock();
        }
    }

    public E poll(long timeout, TimeUnit unit) throws InterruptedException {
        long nanos = unit.toNanos(timeout);
        lock.lockInterruptibly();
        try {
            while (count == 0) {
                if (nanos <= 0) return null;
                nanos = notEmpty.awaitNanos(nanos);
            }
            return dequeue();
        } finally {
            lock.unlock();
        }
    }

    public int size() {
        lock.lock();
        try {
            return count;
        } finally {
            lock.unlock();
        }
    }

    private void enqueue(E e) { // 调用方已持锁
        items[putIndex] = e;
        if (++putIndex == items.length) putIndex = 0;
        count++;
        notEmpty.signal(); // 只唤醒一个消费者
    }

    @SuppressWarnings("unchecked")
    private E dequeue() {
        E e = (E) items[takeIndex];
        items[takeIndex] = null; // 帮助 GC
        if (++takeIndex == items.length) takeIndex = 0;
        count--;
        notFull.signal(); // 只唤醒一个生产者
        return e;
    }
}

public class BoundedBlockingQueueDemo {
    public static void main(String[] args) throws Exception {
        // 1. 超时行为：容量 2，放满后 offer 超时失败；空队列 poll 超时返回 null
        MyBlockingQueue<Integer> q = new MyBlockingQueue<>(2);
        q.put(1);
        q.put(2);
        long t0 = System.nanoTime();
        boolean ok = q.offer(3, 100, TimeUnit.MILLISECONDS);
        System.out.println("offer when full -> " + ok + ", waited ~" + (System.nanoTime() - t0) / 1_000_000 + "ms");
        System.out.println("take -> " + q.take() + ", take -> " + q.take() + ", size -> " + q.size());
        System.out.println("poll when empty -> " + q.poll(50, TimeUnit.MILLISECONDS));

        // 2. 并发正确性：4 个生产者 × 5000 个数，4 个消费者，校验总数与总和，重复 50 轮
        for (int round = 0; round < 50; round++) {
            MyBlockingQueue<Integer> bq = new MyBlockingQueue<>(3);
            int producers = 4, consumers = 4, per = 5000;
            AtomicLong sum = new AtomicLong();
            AtomicInteger cnt = new AtomicInteger();
            ExecutorService pool = Executors.newFixedThreadPool(producers + consumers);
            for (int p = 0; p < producers; p++)
                pool.submit(() -> { for (int i = 1; i <= per; i++) bq.put(i); return null; });
            int total = producers * per;
            for (int c = 0; c < consumers; c++)
                pool.submit(() -> {
                    // 每个消费者取 total / consumers 个
                    for (int i = 0; i < total / consumers; i++) { sum.addAndGet(bq.take()); cnt.incrementAndGet(); }
                    return null;
                });
            pool.shutdown();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) throw new IllegalStateException("deadlock");
            long expected = (long) producers * per * (per + 1) / 2;
            if (cnt.get() != total || sum.get() != expected || bq.size() != 0) throw new AssertionError("mismatch");
        }
        System.out.println("50 concurrent rounds OK (20000 items each)");
    }
}
```

## 复杂度

- 时间：`put`/`take`/`offer`/`poll` 除去等待都是 O(1)（环形数组读写 + 一次 signal）。
- 空间 O(capacity)：固定大小的数组，不会随流量增长。

## 易错点

- 只用一个 Condition 并 `signal()`：生产者可能唤醒另一个生产者，消费者一直不醒，形成丢失唤醒；一个 Condition 时必须 `signalAll()`。
- 超时等待写成 `if (count == full) cond.await(timeout)` 后直接判断：虚假唤醒会导致提前返回或者超时后仍往满队列里写。
- 超时循环里每次都用原始 timeout 重新等：总等待时间会远超预期，必须用 `awaitNanos` 的返回值。
- `lock()` 放进 `try` 里：如果加锁本身抛异常，`finally` 会去 `unlock()` 一把没拿到的锁，抛 `IllegalMonitorStateException`。
- 出队后不把数组槽置 null：对象被队列长期引用，造成内存泄漏。

## 追问

:::details ArrayBlockingQueue 和 LinkedBlockingQueue 有什么区别？
`ArrayBlockingQueue` 基于数组、必须指定容量、一把锁两个 Condition，生产和消费互斥；`LinkedBlockingQueue` 基于链表、默认容量 `Integer.MAX_VALUE`（相当于无界，要小心 OOM）、用 putLock/takeLock 两把锁，入队和出队可并行，计数用 AtomicInteger。
:::

:::details 为什么 signal 而不是 signalAll？
每次入队只多出一个元素，只需要唤醒一个消费者；signalAll 会把所有消费者都唤醒去抢锁，其中大部分发现队列又空了再睡回去，浪费上下文切换。前提是生产者和消费者分别在不同的 Condition 上等待。
:::

:::details lockInterruptibly 和 lock 的区别？
`lock()` 在等待锁期间不响应中断；`lockInterruptibly()` 在等待锁时被中断会立即抛 `InterruptedException`。阻塞队列的阻塞方法应当可中断，这样线程池 `shutdownNow()` 才能让工作线程退出。
:::

:::details 如何保证公平？
`new ReentrantLock(true)` 构造公平锁，等待最久的线程先拿锁；`ArrayBlockingQueue(capacity, true)` 就是这么做的。代价是吞吐下降，默认非公平。
:::

## 举一反三

- [[algo:producer-consumer]]：本题就是生产者-消费者模型里那个"缓冲区"。
- [[algo:simple-thread-pool]]：线程池的任务队列就是阻塞队列，工作线程循环 `take()`。
- [[algo:three-threads-print-abc]]：同样用多个 Condition 实现精确唤醒。
- JDK 对应：`ArrayBlockingQueue` 的 `put/take/offer/poll` 与本题实现结构一致（`enqueue` 里 `notEmpty.signal()`，`dequeue` 里 `notFull.signal()`）。

## 一句话记忆

一把锁 + notFull/notEmpty 两个条件；满了在 notFull 上等，空了在 notEmpty 上等，放完叫醒消费者，取完叫醒生产者，超时用 awaitNanos 循环。
