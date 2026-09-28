## 题意

有若干氢线程（调用 `hydrogen`）和氧线程（调用 `oxygen`），它们到达的顺序随机。要让它们三个一组"组成水分子"：输出序列每连续 3 个字符必须恰好是 2 个 H 和 1 个 O（组内顺序随意），且一个分子的 3 个线程全部打印完之前，下一个分子的线程不能开始打印。保证 H 线程数正好是 O 线程数的 2 倍。

```
输入：到达顺序 = "HHHOHO"（2 个分子）
输出："HHOHOH" 或 "HOHHHO" 等都可以
解释：切成 "HHO" | "HOH" 两组，每组都是 2H1O。
```

```
输入：到达顺序 = "OOHHHH"
输出：例如 "OHHOHH"
解释：第二个 O 先到也只能等，直到第一组凑齐并打印完。
```

## 思路

**面试考点**：两类约束叠加：①**名额限制**：一组里最多 2 个 H、1 个 O；②**集合点**：凑齐 3 个才一起放行。

**方案对比**：

| 方案 | 做法 | 评价 |
|---|---|---|
| Semaphore 限名额 + CyclicBarrier 凑齐 | H 信号量 2 张、O 信号量 1 张，拿到名额的去 barrier 等 | 语义最直观，推荐 |
| synchronized + 计数器 | 记录本组已打印的 H/O 个数，满员就等，凑齐一组后清零 | 只用基础工具，面试官不让用 JUC 时用 |
| 纯 Semaphore 接力 | 用多个信号量编排"两 H 一 O" | 容易写错边界 |

:::tip 关键点
信号量控制"本组还能进几个 H / 几个 O"，`CyclicBarrier(3)` 让本组 3 个线程在打印前会合。名额**在打印之后才归还**：新一组的 H 必须等旧组的某个 H 打印完才能拿到名额，新一组的 O 同理，所以新一组凑齐时旧组一定已全部打印完，分子之间不会交错。CyclicBarrier 触发后会自动重置，可以一直复用。
:::

推演（到达顺序 H H H O H O）：

```
H1 get h-permit(1 left) -> barrier 1/3
H2 get h-permit(0 left) -> barrier 2/3
H3 no h-permit          -> blocked
O1 get o-permit         -> barrier 3/3, trip
H1 H2 O1 print, then release permits
H3 get h-permit, H4 get h-permit, O2 get o-permit -> trip, print
```

## Java 题解

```java
import java.util.*;
import java.util.concurrent.*;

class H2O {
    private final Semaphore hSem = new Semaphore(2);     // 每组最多 2 个 H
    private final Semaphore oSem = new Semaphore(1);     // 每组最多 1 个 O
    private final CyclicBarrier barrier = new CyclicBarrier(3); // 凑齐 3 个一起放行

    public H2O() {
    }

    public void hydrogen(Runnable releaseHydrogen) throws InterruptedException {
        hSem.acquire();
        await();
        releaseHydrogen.run();
        hSem.release(); // 打印完才归还名额，保证分子之间不交错
    }

    public void oxygen(Runnable releaseOxygen) throws InterruptedException {
        oSem.acquire();
        await();
        releaseOxygen.run();
        oSem.release();
    }

    private void await() throws InterruptedException {
        try {
            barrier.await();
        } catch (BrokenBarrierException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

## 复杂度

- 时间：每个线程 O(1) 次同步操作，总计 O(线程数)。
- 空间 O(1)。

## 易错点

- 在 barrier 之前就归还名额：新一组的线程可能在旧组打印之前挤进来，输出交错。
- 只用信号量不用 barrier：2 个 H 名额和 1 个 O 名额满足，但无法保证"本组 3 个都到了再打印"，会出现 H 先于同组 O 很久打印、与下一组混在一起。
- `CyclicBarrier.await()` 抛 `BrokenBarrierException`（受检异常），方法签名只允许 `InterruptedException`，需要包装。
- 计数器写法里重置计数的时机：必须在一组的第 3 个线程打印完后，由它清零并 `notifyAll()`。

## 其他解法

`synchronized + 计数器`：记录当前这组已经打印了几个 H、几个 O；本组对应名额满了就等待，凑齐 2H1O 后清零进入下一组。

```java
import java.util.*;

class H2O {
    private int h = 0, o = 0; // 当前这组已打印的 H、O 个数

    public H2O() {
    }

    public synchronized void hydrogen(Runnable releaseHydrogen) throws InterruptedException {
        while (h == 2) wait(); // 本组 H 已满，等下一组
        releaseHydrogen.run();
        h++;
        finishIfFull();
    }

    public synchronized void oxygen(Runnable releaseOxygen) throws InterruptedException {
        while (o == 1) wait();
        releaseOxygen.run();
        o++;
        finishIfFull();
    }

    private void finishIfFull() {
        if (h == 2 && o == 1) { // 一个分子完成，开启下一组
            h = 0;
            o = 0;
        }
        notifyAll();
    }
}
```

这个写法不要求 3 个线程"同时"放行，只保证每组正好 2H1O 按组连续输出，同样满足题意。

## 举一反三

- [[algo:the-dining-philosophers]]：同样是"限制同时进入的数量"来避免问题。
- [[algo:print-foobar-alternately]]：Semaphore 作为令牌的基础用法。
- 后端联系：`CyclicBarrier` 适合"多个工作线程分阶段计算、每阶段等所有人到齐再进入下一阶段"，例如并行分片计算后统一合并。

## 一句话记忆

Semaphore 管名额（2H、1O），CyclicBarrier 管集合（凑齐 3 个），名额在打印之后才归还。
