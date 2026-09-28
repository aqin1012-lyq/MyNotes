## 题意

`FooBar(n)` 的 `foo()` 和 `bar()` 各由一个线程调用，两个方法内部都是循环 n 次，每次分别打印 "foo" 和 "bar"。要求最终输出严格交替：foo、bar、foo、bar……共 n 组，不管哪个线程先启动。

```
输入：n = 3
输出："foobarfoobarfoobar"
解释：bar 线程即使先启动，也必须等 foo 打印后才能打印第一个 bar。
```

## 思路

**和 1114 的区别**：依赖变成了"循环往复"的：foo → bar → foo → bar。`CountDownLatch` 只能用一次，需要能反复发放许可的工具。

**方案对比**：

| 方案 | 做法 | 评价 |
|---|---|---|
| 两个 Semaphore | fooSem(1)、barSem(0)，互相 release 对方 | 最简洁，像"传令牌" |
| synchronized + wait/notifyAll | 共享布尔 `fooTurn` | 经典，注意 while 与 notifyAll |
| ReentrantLock + 两个 Condition | 各自在自己的 Condition 上等 | 可精确唤醒，适合多线程轮转 |
| 自旋 + volatile + Thread.yield | 轮询 turn 变量 | 能过但浪费 CPU |

:::tip 关键点
把"轮到谁"建模成**一张令牌**：`fooSem` 初始 1 张、`barSem` 初始 0 张。foo 拿自己的令牌打印后，把令牌交给 bar（`barSem.release()`）；bar 打印后再交回来。任一时刻总共只有 1 张令牌，所以天然严格交替。`release()` happens-before 之后成功的 `acquire()`，可见性也有保障。
:::

推演（n = 2，bar 线程先启动）：

```
step  fooSem barSem  action
0     1      0       B: barSem.acquire() blocked
1     0      0       F: acquire fooSem, print foo
2     0      1       F: barSem.release()
3     0      0       B: wakes, print bar
4     1      0       B: fooSem.release()
5     0      0       F: print foo ... then bar, done
```

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;

class FooBar {
    private int n;
    private final Semaphore fooSem = new Semaphore(1); // foo 先手，持有 1 张令牌
    private final Semaphore barSem = new Semaphore(0);

    public FooBar(int n) {
        this.n = n;
    }

    public void foo(Runnable printFoo) throws InterruptedException {
        for (int i = 0; i < n; i++) {
            fooSem.acquire();   // 等轮到 foo
            printFoo.run();
            barSem.release();   // 把令牌交给 bar
        }
    }

    public void bar(Runnable printBar) throws InterruptedException {
        for (int i = 0; i < n; i++) {
            barSem.acquire();   // 等轮到 bar
            printBar.run();
            fooSem.release();   // 把令牌交回 foo
        }
    }
}
```

## 复杂度

- 时间 O(n)：每个线程循环 n 次，每次常数个同步操作。
- 空间 O(1)。

## 易错点

- 两个信号量初值都设成 1 或都设成 0：前者会让两个线程同时打印，后者直接死锁。
- 在 `release` 自己的信号量而不是对方的：变成自己连续打印。
- wait/notify 写法里用 `notify()`：两个线程时恰好能工作，但换成多线程轮转就会丢失唤醒，习惯上用 `notifyAll()` 或 Condition。
- `printFoo.run()` 放在 `acquire()` 之前：打印不受保护，交替顺序失效。

## 其他解法

`ReentrantLock + Condition`：一个布尔变量表示轮次，两个 Condition 分别让 foo、bar 等待，可以精确唤醒对方。

```java
import java.util.*;
import java.util.concurrent.locks.*;

class FooBar {
    private int n;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition fooCond = lock.newCondition();
    private final Condition barCond = lock.newCondition();
    private boolean fooTurn = true; // 锁内读写，无需 volatile

    public FooBar(int n) {
        this.n = n;
    }

    public void foo(Runnable printFoo) throws InterruptedException {
        for (int i = 0; i < n; i++) {
            lock.lock();
            try {
                while (!fooTurn) fooCond.await();
                printFoo.run();
                fooTurn = false;
                barCond.signal(); // 只唤醒 bar
            } finally {
                lock.unlock();
            }
        }
    }

    public void bar(Runnable printBar) throws InterruptedException {
        for (int i = 0; i < n; i++) {
            lock.lock();
            try {
                while (fooTurn) barCond.await();
                printBar.run();
                fooTurn = true;
                fooCond.signal();
            } finally {
                lock.unlock();
            }
        }
    }
}
```

## 举一反三

- [[algo:print-in-order]]：一次性依赖版本。
- [[algo:print-zero-even-odd]]、[[algo:three-threads-print-abc]]：三个线程的轮转，同样是"传令牌"。
- 后端联系：Semaphore 在业务里更常用于限制并发数（如同时访问下游的连接数），本题用它当"令牌传递"是同一个原语的另一种用法。

## 一句话记忆

交替打印 = 传令牌：每人一个信号量，拿自己的、打印、释放对方的。
