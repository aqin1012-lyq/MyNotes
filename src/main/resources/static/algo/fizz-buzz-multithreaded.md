## 题意

`FizzBuzz(n)` 的四个方法由四个线程分别调用：`fizz` 负责打印 "fizz"（能被 3 整除但不能被 5 整除的数），`buzz` 负责 "buzz"（被 5 整除不被 3 整除），`fizzbuzz` 负责 "fizzbuzz"（被 15 整除），`number` 负责打印其余的数字本身。要求按 1 到 n 的顺序输出正确的序列。

```
输入：n = 10
输出：[1, 2, fizz, 4, buzz, fizz, 7, 8, fizz, buzz]
```

```
输入：n = 16
输出：[..., 14, fizzbuzz, 16]
解释：15 由 fizzbuzz 线程打印，之后轮回 number 线程打印 16。
```

## 思路

**本质**：四个线程共享同一条 1..n 的时间线，每一步只有一个线程该动。难点是"下一步轮到谁"取决于当前数字。

**方案对比**：

| 方案 | 做法 | 评价 |
|---|---|---|
| 共享计数器 + synchronized/wait/notifyAll | 每个线程循环：等到 `cur` 属于自己或 `cur > n` | 通用，但每次 notifyAll 唤醒全部线程，有无效唤醒 |
| 调度员 + 4 个 Semaphore | number 线程遍历 1..n，决定把令牌发给谁 | 精确唤醒，循环次数确定，推荐 |
| 共享 volatile 计数器 + 自旋 | 各自忙等 | 浪费 CPU |

:::tip 关键点
让 `number` 线程当**调度员**：它自己遍历 i = 1..n，遇到普通数自己打印，遇到 3/5/15 的倍数就 release 对应线程的信号量，然后等对方打印完把令牌交回（`numSem.release()`）。其他三个线程只需遍历属于自己的那些数，各自 acquire 的次数是确定的，所以所有线程都能自然结束。
:::

推演（n = 6 片段）：

```
i  number thread           other thread
1  print 1
2  print 2
3  release fizz, wait     fizz: print fizz, release num
4  print 4
5  release buzz, wait     buzz: print buzz, release num
6  release fizz, wait     fizz: print fizz, release num
```

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.function.IntConsumer;

class FizzBuzz {
    private int n;
    private final Semaphore numSem = new Semaphore(1);  // 调度员先手
    private final Semaphore fizzSem = new Semaphore(0);
    private final Semaphore buzzSem = new Semaphore(0);
    private final Semaphore fbSem = new Semaphore(0);

    public FizzBuzz(int n) {
        this.n = n;
    }

    // 只打印 3 的倍数且不是 5 的倍数
    public void fizz(Runnable printFizz) throws InterruptedException {
        for (int i = 3; i <= n; i += 3) {
            if (i % 5 == 0) continue;
            fizzSem.acquire();
            printFizz.run();
            numSem.release(); // 交回调度员
        }
    }

    // 只打印 5 的倍数且不是 3 的倍数
    public void buzz(Runnable printBuzz) throws InterruptedException {
        for (int i = 5; i <= n; i += 5) {
            if (i % 3 == 0) continue;
            buzzSem.acquire();
            printBuzz.run();
            numSem.release();
        }
    }

    public void fizzbuzz(Runnable printFizzBuzz) throws InterruptedException {
        for (int i = 15; i <= n; i += 15) {
            fbSem.acquire();
            printFizzBuzz.run();
            numSem.release();
        }
    }

    // 调度员：遍历 1..n，普通数自己打，其余交给对应线程
    public void number(IntConsumer printNumber) throws InterruptedException {
        for (int i = 1; i <= n; i++) {
            numSem.acquire();
            if (i % 15 == 0) fbSem.release();
            else if (i % 3 == 0) fizzSem.release();
            else if (i % 5 == 0) buzzSem.release();
            else {
                printNumber.accept(i);
                numSem.release(); // 自己打完，令牌留给下一轮的自己
            }
        }
    }
}
```

## 复杂度

- 时间 O(n)：每个数字对应常数次信号量操作。
- 空间 O(1)。

## 易错点

- fizz 线程循环时忘了跳过 15 的倍数：它会多 acquire 一次，永远等不到许可，线程无法结束。
- 调度员自己打印普通数后忘了 `numSem.release()`：下一轮自己 acquire 不到，直接卡死。
- 共享计数器写法里，线程被唤醒后要同时判断 `cur > n`（该退出了）和"是否轮到我"，漏掉前者会导致最后几个线程永远 wait。
- 判断顺序必须先 15 再 3 和 5，否则 15 会被当成 fizz。

## 其他解法

共享计数器 + `synchronized/wait/notifyAll`：每个线程用一个谓词判断"当前数字归不归我"，不归我就 wait。

```java
import java.util.*;
import java.util.function.IntConsumer;
import java.util.function.IntPredicate;

class FizzBuzz {
    private int n;
    private int cur = 1; // 当前要输出的数字，锁内访问

    public FizzBuzz(int n) {
        this.n = n;
    }

    // 通用模板：等到 cur 满足 mine 或已结束；满足则执行 action 并推进
    private synchronized void run(IntPredicate mine, IntConsumer action) throws InterruptedException {
        while (true) {
            while (cur <= n && !mine.test(cur)) wait();
            if (cur > n) return;
            action.accept(cur);
            cur++;
            notifyAll(); // 唤醒其他线程检查是否轮到自己
        }
    }

    public void fizz(Runnable printFizz) throws InterruptedException {
        run(i -> i % 3 == 0 && i % 5 != 0, i -> printFizz.run());
    }

    public void buzz(Runnable printBuzz) throws InterruptedException {
        run(i -> i % 5 == 0 && i % 3 != 0, i -> printBuzz.run());
    }

    public void fizzbuzz(Runnable printFizzBuzz) throws InterruptedException {
        run(i -> i % 15 == 0, i -> printFizzBuzz.run());
    }

    public void number(IntConsumer printNumber) throws InterruptedException {
        run(i -> i % 3 != 0 && i % 5 != 0, printNumber);
    }
}
```

## 举一反三

- [[algo:print-zero-even-odd]]：同样由一个"调度员"线程决定把令牌发给谁。
- [[algo:three-threads-print-abc]]：共享计数器 + 取模判断轮次的另一种典型场景。

## 一句话记忆

一个线程当调度员按数字发令牌，其余线程只处理属于自己的数；每个线程 acquire 次数要算准。
