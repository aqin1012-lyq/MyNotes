## 题意

`ZeroEvenOdd(n)` 有三个方法 `zero`、`even`、`odd`，分别由三个线程调用，每个方法都收到一个 `IntConsumer printNumber`，调用 `printNumber.accept(x)` 就会输出 x。要求合起来的输出是 `0 1 0 2 0 3 ... 0 n`：每个正整数前面都有一个 0，奇数由 odd 线程打印，偶数由 even 线程打印。

```
输入：n = 4
输出："01020304"
解释：zero 线程打印 4 次 0；odd 打印 1、3；even 打印 2、4。
```

```
输入：n = 1
输出："01"
解释：even 线程一个数都不打印，必须能直接结束。
```

## 思路

**本质**：三个线程轮转，但顺序不是固定的 A→B→C，而是 `zero → odd → zero → even → zero → odd ...`，由"下一个数是奇是偶"决定 zero 把令牌交给谁。

**方案对比**：

| 方案 | 做法 | 评价 |
|---|---|---|
| 三个 Semaphore | zero(1)、odd(0)、even(0)，zero 按奇偶决定 release 谁 | 最清晰，推荐 |
| Lock + 一个 state 变量 + 多个 Condition | state 取 0/1/2 表示轮到谁 | 通用，能扩展到任意状态机 |
| synchronized + wait/notifyAll | 同上，只用一个等待队列 | 写法简单但会有无效唤醒 |

:::tip 关键点
关键是**先算清楚每个线程循环几次**：zero 循环 n 次；odd 打印 1,3,5...（`i += 2` 从 1 开始）；even 打印 2,4,6...（从 2 开始）。只要每个线程的 acquire 次数和对方的 release 次数完全相等，所有线程都能正常结束，不会有线程永远卡在 acquire 上。
:::

推演（n = 3）：

```
zero  odd  even   who prints
1     0    0      zero: 0, next i=1 is odd -> release odd
0     1    0      odd : 1 -> release zero
1     0    0      zero: 0, next i=2 even -> release even
0     0    1      even: 2 -> release zero
1     0    0      zero: 0, i=3 odd -> release odd
0     1    0      odd : 3 -> release zero, all done
```

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.IntConsumer;

class ZeroEvenOdd {
    private int n;
    private final Semaphore zeroSem = new Semaphore(1); // zero 先手
    private final Semaphore oddSem = new Semaphore(0);
    private final Semaphore evenSem = new Semaphore(0);

    public ZeroEvenOdd(int n) {
        this.n = n;
    }

    public void zero(IntConsumer printNumber) throws InterruptedException {
        for (int i = 1; i <= n; i++) {
            zeroSem.acquire();
            printNumber.accept(0);
            // 下一个要打印的数是 i：奇数交给 odd，偶数交给 even
            if ((i & 1) == 1) oddSem.release();
            else evenSem.release();
        }
    }

    public void even(IntConsumer printNumber) throws InterruptedException {
        for (int i = 2; i <= n; i += 2) {
            evenSem.acquire();
            printNumber.accept(i);
            zeroSem.release(); // 交回 zero
        }
    }

    public void odd(IntConsumer printNumber) throws InterruptedException {
        for (int i = 1; i <= n; i += 2) {
            oddSem.acquire();
            printNumber.accept(i);
            zeroSem.release();
        }
    }
}
```

## 复杂度

- 时间 O(n)：总共打印 2n 个数，每次常数个信号量操作。
- 空间 O(1)。

## 易错点

- odd/even 的循环次数算错（比如都循环 n 次）：多出的 acquire 永远拿不到许可，线程卡死。
- n = 1 时 even 线程不打印任何数，循环条件 `i = 2; i <= n` 直接不进入，正好正确；如果用 `do-while` 就错了。
- zero 根据"刚打印的是第几个 0"判断奇偶，下标从 0 开始时容易差一。
- 用一个共享计数器让 odd/even 自己判断"该不该我打印"时，读写计数器必须在锁内，否则会出现两个线程同时认为轮到自己。

## 其他解法

状态机写法：`state` 0 表示轮到 zero，1 轮到 odd，2 轮到 even；每个角色一个 Condition，精确唤醒。

```java
import java.util.*;
import java.util.concurrent.locks.*;
import java.util.function.IntConsumer;

class ZeroEvenOdd {
    private int n;
    private int state = 0;   // 0: zero, 1: odd, 2: even（锁内访问）
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition[] conds = {lock.newCondition(), lock.newCondition(), lock.newCondition()};

    public ZeroEvenOdd(int n) {
        this.n = n;
    }

    // 等到轮到 me，执行 action，然后把状态切到 next 并唤醒它
    private void step(int me, int next, Runnable action) throws InterruptedException {
        lock.lock();
        try {
            while (state != me) conds[me].await();
            action.run();
            state = next;
            conds[next].signal();
        } finally {
            lock.unlock();
        }
    }

    public void zero(IntConsumer printNumber) throws InterruptedException {
        for (int i = 1; i <= n; i++) {
            step(0, (i & 1) == 1 ? 1 : 2, () -> printNumber.accept(0));
        }
    }

    public void even(IntConsumer printNumber) throws InterruptedException {
        for (int i = 2; i <= n; i += 2) {
            final int x = i;
            step(2, 0, () -> printNumber.accept(x));
        }
    }

    public void odd(IntConsumer printNumber) throws InterruptedException {
        for (int i = 1; i <= n; i += 2) {
            final int x = i;
            step(1, 0, () -> printNumber.accept(x));
        }
    }
}
```

## 举一反三

- [[algo:print-foobar-alternately]]：两线程传令牌。
- [[algo:fizz-buzz-multithreaded]]：同样是"由当前数字决定下一个轮到谁"，但四个线程要各自判断是否轮到自己。
- [[algo:three-threads-print-abc]]：固定顺序的三线程轮转。

## 一句话记忆

zero 当调度员：每次打完 0，看下一个数的奇偶把令牌发给 odd 或 even，它们打完再交还给 zero。
