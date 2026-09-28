## 题意

5 个哲学家围坐圆桌，编号 0~4，相邻两人之间放 1 把叉子，共 5 把。哲学家 i 左手边是叉子 i，右手边是叉子 `(i + 1) % 5`，必须同时拿到左右两把叉子才能吃饭。实现 `wantsToEat(philosopher, pickLeftFork, pickRightFork, eat, putLeftFork, putRightFork)`：它会被 5 个线程反复调用，要求任何情况下都不会死锁，同一把叉子不会同时被两个人拿着。

```
输入：每位哲学家吃 2 次（共 10 次 wantsToEat 调用，5 个线程并发）
输出：一串动作记录，例如 [0,1,1] 表示 0 号拿起左叉，[0,0,3] 表示 0 号吃饭
要求：所有调用都能完成（无死锁），任何时刻每把叉子最多被 1 人持有。
```

## 思路

**死锁从哪来**：如果 5 个人同时拿起左叉，再去等右叉，就形成环形等待：0 等 1、1 等 2、……、4 等 0。死锁的四个必要条件（互斥、持有并等待、不可剥夺、循环等待）全部满足。

**方案对比（本质是破坏其中一个条件）**：

| 方案 | 破坏哪个条件 | 做法 |
|---|---|---|
| 按编号顺序加锁 | 循环等待 | 每人先拿编号小的叉子，再拿大的 |
| 最多 4 人同时上桌 | 循环等待 | `Semaphore(4)`，5 人里总有 1 人能拿到两把 |
| 两把叉子一起拿 | 持有并等待 | 用一把全局锁，或 `tryLock` 失败就放下已拿的 |
| 奇偶不同顺序 | 循环等待 | 奇数号先左后右，偶数号先右后左 |

:::tip 关键点
**全局统一加锁顺序**是后端里最常用的防死锁手段：给资源编号，所有线程都按从小到大的顺序加锁。4 号哲学家的左叉是 4、右叉是 0，按规则他要先拿 0，于是和 0 号竞争同一把叉子，环被打破。
:::

推演（5 人同时伸手）：

```
p  left right  lock order
0  0    1      0 -> 1
1  1    2      1 -> 2
2  2    3      2 -> 3
3  3    4      3 -> 4
4  4    0      0 -> 4   competes with p0 for fork 0
=> someone (p3) always gets fork 3 and 4, eats, releases, chain unblocks
```

## Java 题解

```java
import java.util.*;
import java.util.concurrent.locks.*;

class DiningPhilosophers {
    // 每把叉子一把锁
    private final ReentrantLock[] forks = new ReentrantLock[5];

    public DiningPhilosophers() {
        for (int i = 0; i < 5; i++) forks[i] = new ReentrantLock();
    }

    public void wantsToEat(int philosopher,
                           Runnable pickLeftFork,
                           Runnable pickRightFork,
                           Runnable eat,
                           Runnable putLeftFork,
                           Runnable putRightFork) throws InterruptedException {
        int left = philosopher, right = (philosopher + 1) % 5;
        // 统一按编号从小到大加锁，破坏循环等待
        int first = Math.min(left, right), second = Math.max(left, right);
        forks[first].lock();
        forks[second].lock();
        try {
            pickLeftFork.run();
            pickRightFork.run();
            eat.run();
            putLeftFork.run();
            putRightFork.run();
        } finally {
            forks[second].unlock();
            forks[first].unlock();
        }
    }
}
```

## 复杂度

- 时间：每次进餐 O(1) 次加解锁；等待时间取决于竞争。
- 空间 O(1)：5 把锁。

## 易错点

- 所有人都"先左后右"加锁：极端调度下 5 人同时拿到左叉，直接死锁；测试时不一定复现，但面试官一定会指出。
- 解锁放在 `try` 里而不是 `finally`：`eat` 抛异常时叉子永远不被释放。
- 用一把全局锁包住整个吃饭过程：能避免死锁，但同一时间只有 1 人吃饭，失去了并发（理论上可以 2 人同时吃）。
- `tryLock` 失败后放下叉子立刻重试：可能出现所有人同时拿起、同时放下的**活锁**，需要随机退避。

## 其他解法

限制上桌人数：`Semaphore(4)` 保证同时最多 4 人去拿叉子，5 把叉子分给 4 个人，至少有 1 人能拿齐两把，因此不会形成环。

```java
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.*;

class DiningPhilosophers {
    private final ReentrantLock[] forks = new ReentrantLock[5];
    private final Semaphore seats = new Semaphore(4); // 最多 4 人同时尝试拿叉子

    public DiningPhilosophers() {
        for (int i = 0; i < 5; i++) forks[i] = new ReentrantLock();
    }

    public void wantsToEat(int philosopher,
                           Runnable pickLeftFork,
                           Runnable pickRightFork,
                           Runnable eat,
                           Runnable putLeftFork,
                           Runnable putRightFork) throws InterruptedException {
        int left = philosopher, right = (philosopher + 1) % 5;
        seats.acquire();
        try {
            forks[left].lock();   // 可以都先左后右，因为最多 4 人在抢
            forks[right].lock();
            try {
                pickLeftFork.run();
                pickRightFork.run();
                eat.run();
                putLeftFork.run();
                putRightFork.run();
            } finally {
                forks[right].unlock();
                forks[left].unlock();
            }
        } finally {
            seats.release();
        }
    }
}
```

## 举一反三

- [[algo:building-h2o]]：同样用 Semaphore 限制同时进入的数量。
- [[algo:bounded-blocking-queue]]：锁与条件变量的另一个经典应用。
- 后端联系：转账时同时锁两个账户，按账户 ID 从小到大加锁（或按 ID 顺序 `SELECT ... FOR UPDATE`）就是本题"统一加锁顺序"的直接应用，能避免 A 转 B、B 转 A 同时发生时的数据库死锁。

## 一句话记忆

破坏循环等待：所有人按叉子编号从小到大加锁，或者最多只让 4 个人上桌。
