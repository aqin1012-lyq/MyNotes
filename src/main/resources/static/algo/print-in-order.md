## 题意

同一个 `Foo` 实例的三个方法 `first()`、`second()`、`third()` 会被三个不同的线程分别调用，线程启动顺序不确定。要求无论调度如何，输出一定是 first、second、third 的顺序。每个方法收到一个 `Runnable`，调用它的 `run()` 就会打印对应单词。

```
输入：线程调用顺序 = [3,1,2]（先启动调 third 的线程，再 first，再 second）
输出："firstsecondthird"
解释：third 线程先到也要等，直到 second 完成才能打印。
```

## 思路

**本质**：这是"一次性的先后依赖"问题：second 依赖 first 完成，third 依赖 second 完成。每个依赖只触发一次，不需要循环。

**方案对比**：

| 方案 | 做法 | 评价 |
|---|---|---|
| 忙等 volatile 变量 | `while (stage != 1) {}` | 能跑但空转烧 CPU，不推荐 |
| synchronized + wait/notifyAll | 共享 stage，不满足就 wait | 经典写法，要用 while 防虚假唤醒 |
| CountDownLatch(1) × 2 | first 完成后 countDown，second 先 await | 最贴合"一次性事件"语义，代码最短 |
| Semaphore(0) × 2 | first 完成后 release，second 先 acquire | 同样简洁 |

:::tip 关键点
一次性的"A 完成后 B 才能开始"用 `CountDownLatch(1)` 最自然。`countDown()` 与 `await()` 返回之间有 happens-before 关系，所以 first 里写的数据对 second 一定可见，不需要额外加 volatile。
:::

推演（调用顺序 [3,1,2]）：

```
t0  T3: third()  -> latch2.await()   blocked
t1  T1: first()  -> print first; latch1.countDown()
t2  T2: second() -> latch1 is 0, pass; print second; latch2.countDown()
t3  T3: wakes up -> print third
```

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;

class Foo {
    // 两个一次性"信号"：first 完成、second 完成
    private final CountDownLatch firstDone = new CountDownLatch(1);
    private final CountDownLatch secondDone = new CountDownLatch(1);

    public Foo() {
    }

    public void first(Runnable printFirst) throws InterruptedException {
        printFirst.run();
        firstDone.countDown(); // 通知 second 可以开始
    }

    public void second(Runnable printSecond) throws InterruptedException {
        firstDone.await(); // 等 first 完成
        printSecond.run();
        secondDone.countDown();
    }

    public void third(Runnable printThird) throws InterruptedException {
        secondDone.await(); // 等 second 完成
        printThird.run();
    }
}
```

## 复杂度

- 时间 O(1)：每个方法只做常数次同步操作；等待时线程被挂起，不占 CPU。
- 空间 O(1)：两个 latch。

## 易错点

- 用 `wait()` 时写成 `if (stage != 1) wait();`：虚假唤醒或被别的线程的 notifyAll 唤醒后条件仍不满足，必须用 `while`。
- 用 `notify()` 而不是 `notifyAll()`：可能唤醒的是 third 线程，它发现条件不满足又睡回去，而 second 线程永远没被叫醒，形成"丢失唤醒"。
- 忙等变量不加 `volatile`：JIT 可能把读取提到循环外，导致死循环。
- `countDown()` 放在 `run()` 之前：输出还没打印就放行了下一个线程，顺序可能错乱。

## 其他解法

`synchronized + wait/notifyAll` 写法：用一个 `stage` 表示当前轮到第几步。

```java
import java.util.*;

class Foo {
    private int stage = 1; // 只在锁内读写，不需要 volatile

    public Foo() {
    }

    public synchronized void first(Runnable printFirst) throws InterruptedException {
        printFirst.run();
        stage = 2;
        notifyAll();
    }

    public synchronized void second(Runnable printSecond) throws InterruptedException {
        while (stage != 2) wait(); // while 防虚假唤醒
        printSecond.run();
        stage = 3;
        notifyAll();
    }

    public synchronized void third(Runnable printThird) throws InterruptedException {
        while (stage != 3) wait();
        printThird.run();
    }
}
```

## 举一反三

- [[algo:print-foobar-alternately]]：从"一次性依赖"升级为"循环交替"，latch 不能复用，改用 Semaphore。
- [[algo:three-threads-print-abc]]：三线程循环接力，是本题的循环版本。
- 后端联系：`CountDownLatch` 常用于"等所有子任务/依赖服务初始化完成后再开放流量"，例如启动时等多个缓存预热完成。

## 一句话记忆

一次性的先后依赖，用两个 `CountDownLatch(1)` 串起来：前一个做完 countDown，后一个先 await。
