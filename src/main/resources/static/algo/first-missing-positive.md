## 题意

给一个未排序的整数数组（可能有负数、0、重复值、很大的数），找出没有在数组中出现的**最小正整数**。要求 O(n) 时间、O(1) 额外空间（可以修改原数组）。

```
输入：nums = [4,-2,1,6,2]
输出：3
解释：1、2 都在，3 不在
```

```
输入：nums = [1,2,3]
输出：4
解释：1..n 全部出现，答案是 n+1
```

## 思路

- 排序后找：O(n log n)，不满足时间要求。
- HashSet：把所有数放进集合，从 1 开始往上找第一个不在的，O(n) 时间但 O(n) 空间。

关键观察：长度为 n 的数组，答案一定在 `[1, n+1]` 范围内（n 个格子最多放下 1..n 这 n 个数）。所以只关心 1..n 的数，其它数（≤0 或 >n）都是无用的。

既然值域和下标范围一致，就可以**把数组自己当哈希表用**：把值 v 放到下标 `v-1` 的位置上（"原地哈希"/"座位交换"）。整理完后，从左往右第一个 `nums[i] != i+1` 的位置，答案就是 `i+1`；全都对上则答案是 `n+1`。

:::tip 关键点
答案必在 1..n+1。让每个 1..n 的值"坐到自己的座位" `v-1` 上：用 while 循环不断交换，直到当前位置的值无效或者目标座位上已经是正确的值（防止重复值死循环）。
:::

推演 `[4,-2,1,6,2]`，n = 5：

```
i  action                              array
0  4 -> seat 3, swap with 6            [6,-2,1,4,2]
0  6 > n, stop
1  -2 invalid, stop
2  1 -> seat 0, swap with 6            [1,-2,6,4,2]
2  6 > n, stop
3  4 already at seat 3, stop
4  2 -> seat 1, swap with -2           [1,2,6,4,-2]
4  -2 invalid, stop
scan: seat 2 holds 6, not 3 -> answer 3
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int firstMissingPositive(int[] nums) {
        int n = nums.length;
        for (int i = 0; i < n; i++) {
            // 当前值在 1..n 且它的座位上不是它，就把它换过去
            while (nums[i] >= 1 && nums[i] <= n && nums[nums[i] - 1] != nums[i]) {
                int seat = nums[i] - 1;
                int t = nums[seat];
                nums[seat] = nums[i];
                nums[i] = t; // 换回来的值继续在 i 处判断
            }
        }
        // 第一个座位不对的位置就是答案
        for (int i = 0; i < n; i++) {
            if (nums[i] != i + 1) return i + 1;
        }
        return n + 1;
    }
}
```

## 复杂度

- 时间 O(n)：虽然有嵌套 while，但每次交换都会让一个值坐到正确位置，最多交换 n 次。
- 空间 O(1)：只在原数组上交换。

## 易错点

- while 条件必须是 `nums[nums[i]-1] != nums[i]`（目标座位上的值不对），不能写成 `nums[i] != i+1`，否则遇到重复值如 `[1,1]` 会死循环。
- 交换时先把 `nums[i]-1` 存进局部变量 `seat`，再交换；如果直接写 `nums[nums[i]-1] = nums[i]` 这种会在 `nums[i]` 被改写后用错下标。
- 用 while 而不是 if：换回来的新值也可能需要继续归位。
- 全部归位时答案是 `n+1`，别漏掉最后的返回。

## 其他解法

标记法：先把无用的数（≤0 或 >n）改成 n+1，然后对每个有效值 v，把下标 `v-1` 处的数变成负数作为"出现过"的标记，最后第一个正数的位置就是答案。

```java
import java.util.*;

class Solution {
    public int firstMissingPositive(int[] nums) {
        int n = nums.length;
        // 无用值统一改成 n+1，保证后面都是正数
        for (int i = 0; i < n; i++) {
            if (nums[i] <= 0 || nums[i] > n) nums[i] = n + 1;
        }
        // 值 v 出现过，就把下标 v-1 标记为负数
        for (int i = 0; i < n; i++) {
            int v = Math.abs(nums[i]);
            if (v <= n && nums[v - 1] > 0) nums[v - 1] = -nums[v - 1];
        }
        for (int i = 0; i < n; i++) {
            if (nums[i] > 0) return i + 1;
        }
        return n + 1;
    }
}
```

## 举一反三

- [[algo:find-the-duplicate-number]]：同样利用"值域 = 下标范围"，把数组当成链表/哈希表。
- [[algo:longest-consecutive-sequence]]：用 HashSet 的 O(n) 空间版本的思路，本题是其 O(1) 空间的极致优化。
- 原地哈希的思想：当值域有界且和下标对应时，数组本身就是一个位图/计数器，类似 bitmap 统计用户签到、布隆过滤器中的位数组。

## 一句话记忆

答案必在 1..n+1，把每个 v 换到下标 v-1 的座位上，第一个坐错的位置就是答案。
