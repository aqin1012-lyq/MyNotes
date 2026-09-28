## 题意

面试官常问："启动三个线程，分别只会打印 A、B、C，让它们轮流打印，输出 `ABCABC...` 共 10 轮。"要求真正用三个线程、不能在一个线程里拼好再打印，线程启动顺序不确定，程序必须能正常结束。进阶会问：推广到 N 个线程怎么写？

## 思路

**面试官想考什么**：线程间通信（谁该醒、谁该睡）、条件判断为什么用 `while`、`notify` 与 `notifyAll` 的区别、以及对 JUC 工具的熟悉程度。

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| synchronized + wait/notifyAll | 共享 `turn`，不是自己就 wait | 只用语言内置能力 | notifyAll 唤醒所有线程，大部分白醒一次 |
| ReentrantLock + N 个 Condition | 每个线程在自己的 Condition 上等，打印完精确 signal 下一个 | 精确唤醒，无惊群 | 代码稍长，必须 finally 解锁 |
| N 个 Semaphore 接力 | 第 0 个初值 1，其余 0；打印后 release 下一个 | 最短、最好理解 | 不容易表达更复杂的条件 |
| volatile + 自旋 | 忙等 turn | 实现简单 | 空转 CPU，不推荐 |

:::tip 关键点
用一个 `turn` 计数表示"轮到第几个线程"，线程 i 只在 `turn % N == i` 时打印，打印后 `turn++` 并**只唤醒下一个线程**（`conds[(i + 1) % N].signal()`）。等待必须写在 `while` 循环里：被唤醒不代表条件成立（虚假唤醒、或者被唤醒时已经被别人抢先）。`turn` 只在锁内读写，锁的 unlock/lock 已建立 happens-before，不需要 volatile。
:::

下面代码同时给出 Condition 版和 Semaphore 版，并在 main 里各跑 200 次校验结果。

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.*;

public class ThreeThreadsPrintABC {

    // 方案一：ReentrantLock + 每个线程一个 Condition，可推广到 N 个线程
    static String runWithCondition(int n, int rounds) throws InterruptedException {
        ReentrantLock lock = new ReentrantLock();
        Condition[] conds = new Condition[n];
        for (int i = 0; i < n; i++) conds[i] = lock.newCondition();
        int[] turn = {0}; // 只在锁内访问
        StringBuilder out = new StringBuilder();
        Thread[] ts = new Thread[n];
        for (int i = 0; i < n; i++) {
            final int id = i;
            ts[i] = new Thread(() -> {
                for (int r = 0; r < rounds; r++) {
                    lock.lock();
                    try {
                        while (turn[0] % n != id) conds[id].awaitUninterruptibly(); // while 防虚假唤醒
                        out.append((char) ('A' + id));
                        turn[0]++;
                        conds[(id + 1) % n].signal(); // 只唤醒下一个
                    } finally {
                        lock.unlock();
                    }
                }
            });
        }
        startAndJoin(ts);
        return out.toString();
    }

    // 方案二：N 个 Semaphore 接力传令牌
    static String runWithSemaphore(int n, int rounds) throws InterruptedException {
        Semaphore[] sems = new Semaphore[n];
        for (int i = 0; i < n; i++) sems[i] = new Semaphore(i == 0 ? 1 : 0); // A 先手
        StringBuffer out = new StringBuffer(); // 线程安全，且 release/acquire 保证可见性
        Thread[] ts = new Thread[n];
        for (int i = 0; i < n; i++) {
            final int id = i;
            ts[i] = new Thread(() -> {
                for (int r = 0; r < rounds; r++) {
                    sems[id].acquireUninterruptibly();
                    out.append((char) ('A' + id));
                    sems[(id + 1) % n].release(); // 令牌交给下一个
                }
            });
        }
        startAndJoin(ts);
        return out.toString();
    }

    // 倒序启动，证明结果与启动顺序无关；join 带超时，卡死就报错
    static void startAndJoin(Thread[] ts) throws InterruptedException {
        for (int i = ts.length - 1; i >= 0; i--) ts[i].start();
        for (Thread t : ts) {
            t.join(3000);
            if (t.isAlive()) throw new IllegalStateException("deadlock");
        }
    }

    public static void main(String[] args) throws InterruptedException {
        String expected = "ABC".repeat(10);
        System.out.println("Condition: " + runWithCondition(3, 10));
        System.out.println("Semaphore: " + runWithSemaphore(3, 10));
        for (int i = 0; i < 200; i++) {
            if (!runWithCondition(3, 10).equals(expected) || !runWithSemaphore(3, 10).equals(expected))
                throw new AssertionError("wrong order");
        }
        System.out.println("200 x 2 runs OK");
        System.out.println("N=5: " + runWithCondition(5, 3)); // 推广到 5 个线程
    }
}
```

## 复杂度

- 时间 O(N × rounds)：总共打印 N × rounds 个字符，每次常数次加解锁。Condition 版每次只唤醒 1 个线程；如果换成 `notifyAll`，每次会唤醒 N - 1 个线程，其中 N - 2 个是白醒。
- 空间 O(N)：N 个 Condition 或 Semaphore。

## 易错点

- `if` 代替 `while` 判断条件：虚假唤醒后直接打印，顺序错乱。
- synchronized 版用 `notify()`：可能唤醒的是不该打印的线程，它又睡回去，真正该醒的线程没人叫，所有线程一起挂住。
- `lock()` 后不在 `finally` 里 `unlock()`：异常时锁永远不释放。
- 最后一轮结束后没有线程再去唤醒别人也没关系，因为每个线程循环次数固定为 rounds；如果用 `while (true)` + 共享计数退出，要保证退出前唤醒其他线程，否则它们会永远等待。
- 在 `Condition.await()` 之外调用 `signal()`（不持有锁）会抛 `IllegalMonitorStateException`，`wait/notify` 同理必须在 synchronized 块里。

## 追问

:::details 为什么 wait 要放在 while 里？
两个原因：一是 JVM 允许"虚假唤醒"，线程可能没有任何 notify 就醒来；二是 notifyAll 会唤醒所有等待者，醒来时条件可能已被别的线程改变。所以醒来后必须重新检查条件。
:::

:::details wait 和 sleep 有什么区别？
`wait` 必须在持有对象监视器时调用，会**释放锁**并进入该对象的等待队列，需要 notify 或超时唤醒；`sleep` 是 Thread 的静态方法，不释放任何锁，只是让出 CPU 一段时间。
:::

:::details Condition 比 wait/notify 好在哪？
一个 Lock 可以创建多个 Condition，相当于多个独立的等待队列，可以精确唤醒某一类线程；synchronized 每个对象只有一个等待队列，只能 notifyAll 广播。此外 Lock 还支持可中断加锁、超时加锁、公平锁。
:::

:::details 如果要求打印到 100 为止（A1 B2 C3 ...），怎么改？
把"每个线程循环 rounds 次"改成共享计数 `num`，线程 i 在 `num % 3 == i` 时打印并 `num++`；退出条件是 `num > 100`。注意等待循环要写成 `while (num <= 100 && num % 3 != id)`，并且退出前 `signalAll()`，让其他线程也能发现已结束。
:::

## 举一反三

- [[algo:print-foobar-alternately]]、[[algo:print-zero-even-odd]]、[[algo:fizz-buzz-multithreaded]]：同一类"线程轮转"题，分别是 2 个、3 个（非固定顺序）、4 个线程。
- [[algo:bounded-blocking-queue]]：`ArrayBlockingQueue` 内部同样是一把 `ReentrantLock` 配两个 Condition（notEmpty / notFull）。

## 一句话记忆

轮流打印 = 共享 turn + while 等待 + 只唤醒下一个；Condition 精确唤醒，Semaphore 接力传令牌。
