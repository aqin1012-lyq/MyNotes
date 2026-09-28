## 题意

数组 `nums` 有 `n + 1` 个整数，每个数都在 `[1, n]` 范围内，所以至少有一个数重复。题目保证**只有一个**重复的数（但它可能出现不止两次），找出它。要求：不能修改数组，只用 O(1) 额外空间，时间低于 O(n²)。

```
输入：nums = [2,5,1,3,4,2]
输出：2
```

```
输入：nums = [2,2,2,2]
输出：2
解释：重复的数可以出现多次
```

## 思路

常规做法都被限制卡住了：HashSet 要 O(n) 空间；排序要修改数组；原地把数放到"该在的位置"也要修改数组；双重循环是 O(n²)。

关键是把数组看成一张**图**：每个下标 `i` 连一条边指向 `nums[i]`。因为值都在 `[1, n]`，而下标范围是 `[0, n]`，每个值都是合法下标，所以从任意下标出发都能一直走下去：`0 → nums[0] → nums[nums[0]] → ...`。

- 每个节点恰好一条出边，节点数有限，一直走下去必然进入一个**环**。
- 没有任何值等于 0，所以下标 0 没有入边，它一定不在环上，是一条"尾巴"的起点。
- 环的**入口**有两条入边：一条来自尾巴、一条来自环上前一个节点，这两个不同的下标 `i != j` 满足 `nums[i] == nums[j] == 入口`，所以**入口就是重复的数**。

于是问题变成 [[algo:linked-list-cycle-ii]]：找环的入口，用 Floyd 快慢指针，O(1) 空间、不改数组。

:::tip 为什么对
Floyd 两阶段：第一阶段 slow 每次走一步、fast 走两步，两者必在环内相遇。设尾巴长 `a`，环长 `c`，相遇点在环内距入口 `b` 处。fast 走的路是 slow 的两倍：`2(a+b) = a + b + k·c`，得到 `a = k·c - b`。也就是说，从相遇点再走 `a` 步，恰好绕回入口（走 `k·c - b` 步，相当于补完这一圈剩下的 `c - b` 再多绕几圈）。第二阶段让一个指针从 0 出发、另一个从相遇点出发，都每次一步，走 `a` 步后同时到达入口，相遇处就是答案。
:::

用 `nums = [2,5,1,3,4,2]` 推演。先画出边：

```
index : 0  1  2  3  4  5
nums  : 2  5  1  3  4  2

path from 0:  0 -> 2 -> 1 -> 5 -> 2 -> 1 -> 5 ...
tail = [0], cycle = 2 -> 1 -> 5 -> 2, entry = 2
(3 -> 3 and 4 -> 4 are self-loops, never reached from 0)
```

```
phase 1          slow  fast
start            0     0
step 1           2     1
step 2           1     2
step 3           5     5      相遇于 5
phase 2          p     q
start            0     5
step 1           2     2      相遇于 2，答案
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int findDuplicate(int[] nums) {
        // 把 i -> nums[i] 看作链表的 next，从下标 0 出发
        int slow = 0, fast = 0;
        // 阶段一：快慢指针找环内相遇点
        do {
            slow = nums[slow];
            fast = nums[nums[fast]];
        } while (slow != fast);
        // 阶段二：一个从起点、一个从相遇点，同速前进，相遇处即环入口
        int p = 0;
        while (p != slow) {
            p = nums[p];
            slow = nums[slow];
        }
        // 环入口有两条入边，即被两个不同下标指向，就是重复的数
        return p;
    }
}
```

## 复杂度

- 时间 O(n)：阶段一 slow 在进环后一圈之内会被 fast 追上，总步数 O(a + c)；阶段二走 `a` 步。`a + c <= n + 1`。
- 空间 O(1)：只有几个下标变量，也没有修改数组。

## 易错点

- 起点必须是下标 0：只有 0 保证不在环上。从别的下标出发，可能起点本身就在环里（例如自环 `3 -> 3`），找到的"入口"就不是重复数。
- 阶段一用 `do-while` 或者先各走一步再进 `while`，否则 `slow == fast == 0` 一开始就满足条件直接退出。
- fast 是 `nums[nums[fast]]`，不是 `nums[fast] + 1` 之类的下标运算；这里的"next"就是取值。
- 返回的是相遇时的**下标** `p`，它同时也是某个元素的值，这正是重复的数；别再多取一次 `nums[p]`。
- 题目禁止修改数组，所以"把 `nums[i]` 标成负数"和"原地归位"的做法虽然 O(1) 空间，但不符合要求。

## 其他解法

对**值域**二分，O(n log n)：统计 `<= mid` 的元素个数 `cnt`。如果重复数 `d > mid`，那么 `[1, mid]` 里每个值最多出现一次，`cnt <= mid`；如果 `d <= mid`，那么大于 `mid` 的值每个最多出现一次，最多 `n - mid` 个，`cnt >= n + 1 - (n - mid) = mid + 1`。所以 `cnt > mid` 当且仅当答案在左半边。

```java
import java.util.*;

class Solution {
    public int findDuplicate(int[] nums) {
        int lo = 1, hi = nums.length - 1;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            // 统计 <= mid 的元素个数
            int cnt = 0;
            for (int x : nums) {
                if (x <= mid) cnt++;
            }
            // 抽屉原理：个数超过 mid，重复数一定在 [lo, mid]
            if (cnt > mid) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }
}
```

## 举一反三

- [[algo:linked-list-cycle-ii]]：本题的原型，找链表环入口，推导完全相同。
- [[algo:linked-list-cycle]]：只判断有没有环，只需要阶段一。
- [[algo:first-missing-positive]]：同样把"值"当"下标"用，但那题允许修改数组，所以用原地归位。
- [[algo:single-number]]：另一道限制 O(1) 空间找特殊数的技巧题。
- 工程联系：Floyd 判环的思想也用在检测伪随机数生成器的周期、以及 Pollard rho 分解等场景；对于业务里的"引用链是否成环"（例如配置继承、上级审批链），思路相同。

## 一句话记忆

把 i → nums[i] 当链表，从 0 出发必入环，环入口被两个下标指向就是重复数，用快慢指针找入口。
