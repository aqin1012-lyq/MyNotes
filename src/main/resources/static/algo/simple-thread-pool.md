## 题意

面试官常说："不用 `ThreadPoolExecutor`，手写一个简易线程池：支持核心线程数、最大线程数、有界任务队列、拒绝策略、空闲的非核心线程超时回收，以及 `shutdown()` 后把已提交的任务执行完再退出。"重点是 `execute` 的决策流程和工作线程的主循环，要能跑起来并正确退出。

## 思路

**面试官想考什么**：是否真的理解 `ThreadPoolExecutor.execute` 的顺序（先核心线程 → 再入队 → 再扩到最大线程 → 最后拒绝）、工作线程如何复用（循环从队列取任务）、非核心线程如何回收（`poll(keepAlive)` 超时）、如何优雅关闭。

| 设计点 | 方案 A | 方案 B | 选择 |
|---|---|---|---|
| 任务存放 | 自己用 List + wait/notify | `BlockingQueue` | B：阻塞与超时都现成 |
| 线程回收 | 后台线程定时扫描 | 工作线程自己 `poll(keepAlive)` 超时退出 | B：和 JDK 一致，无额外线程 |
| 关闭方式 | 往队列放毒丸 | 置 shutdown 标志 + 中断空闲线程 | B：毒丸在有界队列满时放不进去 |
| 拒绝策略 | 写死抛异常 | 策略接口，可选抛异常 / 调用者运行 | B：可扩展 |

:::tip 关键点
`execute` 的四步：①当前线程数 < core，直接新建线程执行该任务（即使有空闲线程）；②否则尝试 `queue.offer`；③队列满了且线程数 < max，新建非核心线程；④否则拒绝。工作线程主循环：`task = firstTask; while (task != null || (task = getTask()) != null) run`；`getTask` 在线程数 > core 时用 `poll(keepAlive)`，超时返回 null 让线程退出；否则用 `take()` 一直等。关闭时只中断**空闲**线程（用每个 worker 的 runLock 判断是否正在执行任务），正在执行的任务不受影响。
:::

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.concurrent.locks.*;

interface RejectPolicy {
    void reject(Runnable task, SimpleThreadPool pool);

    RejectPolicy ABORT = (t, p) -> { throw new RejectedExecutionException("pool is full"); };
    RejectPolicy CALLER_RUNS = (t, p) -> { if (!p.isShutdown()) t.run(); }; // 提交者自己执行，形成反压
}

class SimpleThreadPool implements Executor {
    private final int core, max;
    private final long keepAliveMs;
    private final BlockingQueue<Runnable> queue;
    private final RejectPolicy policy;
    private final ReentrantLock mainLock = new ReentrantLock(); // 保护 workers 集合
    private final Condition terminated = mainLock.newCondition();
    private final Set<Worker> workers = new HashSet<>();
    private volatile boolean shutdown;
    private final AtomicInteger threadSeq = new AtomicInteger();

    SimpleThreadPool(int core, int max, long keepAliveMs, int queueCapacity, RejectPolicy policy) {
        if (core < 0 || max <= 0 || max < core) throw new IllegalArgumentException();
        this.core = core;
        this.max = max;
        this.keepAliveMs = keepAliveMs;
        this.queue = new ArrayBlockingQueue<>(queueCapacity);
        this.policy = policy;
    }

    @Override
    public void execute(Runnable task) {
        Objects.requireNonNull(task);
        mainLock.lock();
        try {
            if (!shutdown) {
                if (workers.size() < core) { addWorker(task); return; } // ①核心线程
                if (queue.offer(task)) {                                  // ②入队
                    if (workers.isEmpty()) addWorker(null); // core = 0 时保证至少有一个线程
                    return;
                }
                if (workers.size() < max) { addWorker(task); return; }  // ③非核心线程
            }
        } finally {
            mainLock.unlock();
        }
        policy.reject(task, this);                                        // ④拒绝
    }

    private void addWorker(Runnable first) { // 调用方持有 mainLock
        Worker w = new Worker(first);
        w.thread = new Thread(w, "pool-worker-" + threadSeq.incrementAndGet());
        workers.add(w);
        w.thread.start();
    }

    // 取任务；返回 null 表示该线程应退出（退出前已在锁内把自己移出 workers）
    private Runnable getTask(Worker w) {
        boolean timedOut = false;
        while (true) {
            boolean timed;
            mainLock.lock();
            try {
                timed = workers.size() > core;
                boolean idleTooLong = timed && timedOut && (workers.size() > 1 || queue.isEmpty());
                if ((shutdown && queue.isEmpty()) || idleTooLong) {
                    workers.remove(w);
                    if (workers.isEmpty()) terminated.signalAll();
                    return null;
                }
            } finally {
                mainLock.unlock();
            }
            try {
                Runnable r = shutdown ? queue.poll()                                   // 关闭中：不再阻塞
                        : timed ? queue.poll(keepAliveMs, TimeUnit.MILLISECONDS)       // 非核心：超时回收
                        : queue.take();                                                // 核心：一直等
                if (r != null) return r;
                timedOut = timed;
            } catch (InterruptedException e) {
                timedOut = false; // 被 shutdown 唤醒，回到循环顶部重新检查
            }
        }
    }

    public void shutdown() {
        mainLock.lock();
        try {
            shutdown = true;
            for (Worker w : workers) {
                if (w.runLock.tryLock()) { // 拿得到说明它空闲，只中断空闲线程
                    try { w.thread.interrupt(); } finally { w.runLock.unlock(); }
                }
            }
            if (workers.isEmpty()) terminated.signalAll();
        } finally {
            mainLock.unlock();
        }
    }

    public boolean awaitTermination(long timeout, TimeUnit unit) throws InterruptedException {
        long nanos = unit.toNanos(timeout);
        mainLock.lock();
        try {
            while (!workers.isEmpty()) {
                if (nanos <= 0) return false;
                nanos = terminated.awaitNanos(nanos);
            }
            return true;
        } finally {
            mainLock.unlock();
        }
    }

    public boolean isShutdown() { return shutdown; }

    public int poolSize() {
        mainLock.lock();
        try { return workers.size(); } finally { mainLock.unlock(); }
    }

    // 工作线程：先执行 firstTask，然后循环从队列取任务
    private class Worker implements Runnable {
        final ReentrantLock runLock = new ReentrantLock(); // 执行任务期间持有，表示"忙"
        Runnable firstTask;
        Thread thread;

        Worker(Runnable firstTask) { this.firstTask = firstTask; }

        @Override
        public void run() {
            Runnable task = firstTask;
            firstTask = null;
            while (task != null || (task = getTask(this)) != null) {
                runLock.lock();
                try {
                    Thread.interrupted(); // 清掉关闭时可能残留的中断标志，不影响本任务
                    task.run();
                } catch (RuntimeException e) {
                    System.out.println("task failed: " + e.getMessage()); // 单个任务异常不影响线程复用
                } finally {
                    runLock.unlock();
                }
                task = null;
            }
        }
    }
}

public class SimpleThreadPoolDemo {
    public static void main(String[] args) throws Exception {
        // 1. 决策流程：core=2, max=4, 队列容量 2；8 个任务都卡在 gate 上
        SimpleThreadPool pool = new SimpleThreadPool(2, 4, 200, 2, RejectPolicy.ABORT);
        CountDownLatch gate = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(6);
        int rejected = 0;
        for (int i = 0; i < 8; i++) {
            try {
                pool.execute(() -> {
                    try { gate.await(); } catch (InterruptedException ignored) { }
                    done.countDown();
                });
            } catch (RejectedExecutionException e) {
                rejected++;
            }
        }
        System.out.println("threads=" + pool.poolSize() + " rejected=" + rejected); // 2 核心 + 2 入队 + 2 非核心，拒绝 2
        gate.countDown();
        done.await(3, TimeUnit.SECONDS);
        Thread.sleep(600); // 超过 keepAlive，非核心线程应被回收
        System.out.println("after keepAlive threads=" + pool.poolSize());

        // 2. 单个任务抛异常不影响后续任务
        CountDownLatch after = new CountDownLatch(1);
        pool.execute(() -> { throw new IllegalStateException("boom"); });
        pool.execute(after::countDown);
        System.out.println("pool still works: " + after.await(1, TimeUnit.SECONDS));

        // 3. 关闭：已提交任务执行完、线程全部退出、之后再提交被拒绝
        pool.shutdown();
        System.out.println("terminated=" + pool.awaitTermination(2, TimeUnit.SECONDS) + " threads=" + pool.poolSize());
        try {
            pool.execute(() -> { });
        } catch (RejectedExecutionException e) {
            System.out.println("submit after shutdown -> rejected");
        }

        // 4. 压力测试：20 轮 × 20000 个任务，CALLER_RUNS 反压，校验一个不丢
        for (int round = 0; round < 20; round++) {
            SimpleThreadPool p = new SimpleThreadPool(4, 8, 50, 16, RejectPolicy.CALLER_RUNS);
            AtomicInteger cnt = new AtomicInteger();
            for (int i = 0; i < 20000; i++) p.execute(cnt::incrementAndGet);
            p.shutdown();
            if (!p.awaitTermination(5, TimeUnit.SECONDS) || cnt.get() != 20000 || p.poolSize() != 0)
                throw new AssertionError("round " + round + " cnt=" + cnt.get());
        }
        System.out.println("stress 20 x 20000 tasks OK");
    }
}
```

## 复杂度

- 时间：`execute` 是 O(1)（加锁 + 一次 offer）；工作线程取任务 O(1)。锁竞争是主要开销，JDK 用一个 `AtomicInteger ctl` 同时编码运行状态和线程数，大部分路径用 CAS 代替 mainLock。
- 资源估算：每个线程默认栈大小约 1MB（`-Xss`），开 1000 个线程光栈就要预留约 1GB 虚拟内存；线程数常用经验值：CPU 密集型 ≈ 核数 + 1，IO 密集型 ≈ 核数 × (1 + 等待时间 / 计算时间)。队列必须有界：假设任务对象 1KB，无界队列积压 100 万个就是 1GB。

## 易错点

- 把 `execute` 的顺序记成"先扩到 max 再入队"：JDK 是先入队，队列满了才创建非核心线程，所以用无界队列时 max 形同虚设。
- 工作线程执行完一个任务就退出：那就不叫线程池了，核心是 `while` 循环复用线程。
- 核心线程用 `poll(timeout)` 超时就退出：核心线程会被错误回收（JDK 里只有开启 `allowCoreThreadTimeOut` 才会这样）。
- 线程退出时的判断不在锁里做：多个线程同时认为自己是"多余的"，一起退出后线程数低于 core，甚至队列里还有任务却没有线程。
- `shutdown` 时中断正在执行任务的线程：会打断业务任务；应只中断空闲线程，`shutdownNow` 才中断全部。
- 任务里的异常没有捕获：工作线程直接死掉（JDK 会补一个新线程替换它，本实现选择捕获后继续）。

## 追问

:::details 核心线程数设为 0 会怎样？
任务都会先进入队列；为了不让任务没人执行，入队后如果当前没有线程，需要补一个线程（JDK 的 `addWorker(null, false)`，本实现也做了这个处理）。
:::

:::details JDK 有哪几种拒绝策略？
`AbortPolicy`（默认，抛 `RejectedExecutionException`）、`CallerRunsPolicy`（由提交任务的线程自己执行，天然降低提交速度）、`DiscardPolicy`（静默丢弃）、`DiscardOldestPolicy`（丢弃队列头部最老的任务再重试提交）。
:::

:::details 为什么阿里规范不建议用 Executors 创建线程池？
`newFixedThreadPool` 和 `newSingleThreadExecutor` 使用无界的 `LinkedBlockingQueue`，任务积压可能 OOM；`newCachedThreadPool` 最大线程数是 `Integer.MAX_VALUE`，可能创建大量线程。应直接用 `ThreadPoolExecutor` 构造，明确队列容量和拒绝策略。
:::

:::details submit 和 execute 有什么区别？
`submit` 把任务包成 `FutureTask` 再交给 `execute`，返回 `Future`；任务抛出的异常被 FutureTask 捕获，只有调用 `future.get()` 时才以 `ExecutionException` 抛出，不 get 就"看不到"异常。`execute` 中抛出的异常会传到工作线程，由 `UncaughtExceptionHandler` 处理。
:::

:::details shutdown 和 shutdownNow 有什么区别？
`shutdown` 不再接受新任务，但会执行完队列中已有的任务，只中断空闲线程；`shutdownNow` 中断所有线程，并把队列中尚未执行的任务作为列表返回。两者都不会等待，需要配合 `awaitTermination`。
:::

## 举一反三

- [[algo:bounded-blocking-queue]]：线程池的任务队列就是有界阻塞队列。
- [[algo:producer-consumer]]：提交任务的线程是生产者，工作线程是消费者。
- [[algo:parallel-calls-aggregate]]：并行调用时要为业务单独配置线程池。
- JDK 对应：`ThreadPoolExecutor` 的 `execute`、`addWorker`、`runWorker`、`getTask`、`processWorkerExit` 分别对应本实现的同名思路；Worker 在 JDK 里继承 AQS 作为不可重入锁，用途和这里的 runLock 相同：判断线程是否空闲。

## 一句话记忆

execute 四步：不足核心就建线程、否则入队、队满且不足最大再建线程、都不行就拒绝；工作线程在循环里取任务，非核心线程取不到就超时退出。
