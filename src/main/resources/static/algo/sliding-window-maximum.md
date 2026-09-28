## 题意

给一个整数数组 `nums` 和窗口大小 `k`，一个长度为 k 的窗口从最左边一格一格滑到最右边。返回每个窗口位置里的最大值组成的数组（共 `n - k + 1` 个）。

```
输入：nums = [4,2,12,3,8,6,1], k = 3
输出：[12,12,12,8,8]
```

```
输入：nums = [9,7,5,3], k = 2
输出：[9,7,5]
```

## 思路

暴力：每个窗口扫一遍取最大值，O(n · k)，k 很大时超时。

用大顶堆（PriorityQueue）存 `(值, 下标)`：每次取堆顶，如果堆顶下标已经滑出窗口就弹掉，O(n log n)，能过，但还不是最优。

最优：**单调队列**。关键观察：如果 `i < j` 且 `nums[i] <= nums[j]`，那么只要 j 还在窗口里，i 就永远不可能是最大值（i 比 j 先离开窗口，又不比 j 大）——i 可以直接扔掉。于是维护一个双端队列，存下标，对应的值**从队头到队尾单调递减**：

1. 新元素从队尾进来前，把队尾所有 `<=` 它的元素弹出；
2. 队头如果已经滑出窗口（下标 `<= i - k`），从队头弹出；
3. 队头就是当前窗口最大值。

:::tip 关键点
"又老又小"的元素永远没有出头之日，直接淘汰。每个下标最多进队一次、出队一次，所以总共 O(n)。
:::

推演 `[4,2,12,3,8,6,1], k = 3`（队列里写"下标:值"）：

```
i  num  deque(after)        window max
0  4    [0:4]               -
1  2    [0:4, 1:2]          -
2  12   [2:12]              12
3  3    [2:12, 3:3]         12
4  8    [2:12, 4:8]         12
5  6    [4:8, 5:6]          8     (2 out of window)
6  1    [4:8, 5:6, 6:1]     8
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int[] maxSlidingWindow(int[] nums, int k) {
        int n = nums.length;
        int[] res = new int[n - k + 1];
        // 存下标，对应的值从队头到队尾单调递减
        Deque<Integer> dq = new ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            // 1. 队尾比当前小（或相等）的元素不可能再成为最大值，弹出
            while (!dq.isEmpty() && nums[dq.peekLast()] <= nums[i]) {
                dq.pollLast();
            }
            dq.offerLast(i);
            // 2. 队头滑出窗口 [i-k+1, i] 就移除
            if (dq.peekFirst() <= i - k) {
                dq.pollFirst();
            }
            // 3. 窗口形成后，队头就是最大值
            if (i >= k - 1) {
                res[i - k + 1] = nums[dq.peekFirst()];
            }
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n)：每个下标最多入队、出队各一次。
- 空间 O(k)：队列里最多 k 个下标（不计结果数组）。

## 易错点

- 队列里要存**下标**而不是值，否则没法判断队头是否已经滑出窗口。
- 过期判断是 `dq.peekFirst() <= i - k`，窗口是 `[i-k+1, i]`，边界差 1 很容易写错。
- 弹队尾时用 `<=` 或 `<` 都正确；用 `<=` 队列更短。
- 结果从 `i >= k - 1` 才开始记录，结果下标是 `i - k + 1`。

## 其他解法

大顶堆 + 懒删除：堆顶过期才弹出，O(n log n)，思路直接，面试时可以先说这个再优化。

```java
import java.util.*;

class Solution {
    public int[] maxSlidingWindow(int[] nums, int k) {
        int n = nums.length;
        int[] res = new int[n - k + 1];
        // 元素为 {值, 下标}，按值从大到小
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> Integer.compare(b[0], a[0]));
        for (int i = 0; i < n; i++) {
            pq.offer(new int[]{nums[i], i});
            if (i >= k - 1) {
                // 懒删除：堆顶不在窗口内才弹出
                while (pq.peek()[1] <= i - k) pq.poll();
                res[i - k + 1] = pq.peek()[0];
            }
        }
        return res;
    }
}
```

## 举一反三

- [[algo:daily-temperatures]]：单调栈，和单调队列是同一类"淘汰没用的候选"的思想。
- [[algo:min-stack]]：同样是在变化的集合里 O(1) 拿最值。
- [[algo:minimum-window-substring]]：滑动窗口，但窗口长度可变。
- 监控系统里"最近 N 秒的峰值 QPS/延迟"就是滑动窗口最大值，单调队列可以做到每个采样点 O(1) 均摊。

## 一句话记忆

单调递减的双端队列存下标：进队前踢掉队尾更小的，队头过期就弹，队头即最大。
