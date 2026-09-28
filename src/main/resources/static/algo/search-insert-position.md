## 题意

给一个**升序且无重复**的整数数组 `nums` 和目标值 `target`：如果 `target` 在数组里，返回它的下标；如果不在，返回它按顺序应该插入的位置。要求时间复杂度 O(log n)。

```
输入：nums = [2,4,7,9], target = 5
输出：2
解释：5 不在数组中，插在 4 和 7 之间，即下标 2
```

```
输入：nums = [2,4,7,9], target = 12
输出：4
解释：比所有数都大，插到末尾
```

## 思路

线性扫描找第一个 `>= target` 的位置是 O(n)，题目要求 O(log n)，自然想到二分。

仔细看会发现，"找到就返回下标、找不到返回插入位置"其实是**同一个问题**：找第一个 `>= target` 的元素下标（也就是 lower_bound）。如果 target 存在，第一个 `>=` 的就是它自己；不存在，第一个比它大的位置就是插入点；都比它小时答案是 `n`。

用左闭右开区间 `[lo, hi)`，初始 `hi = n`，这样"插到末尾"的情况自然覆盖：

- `nums[mid] < target`：答案在右边，`lo = mid + 1`。
- 否则 `nums[mid] >= target`：mid 可能就是答案，`hi = mid`。
- 循环结束时 `lo == hi`，就是第一个 `>= target` 的位置。

:::tip 关键点
这题就是 lower_bound：找第一个 `>= target` 的位置。选定一种区间写法（推荐左闭右开）并保持不变量，边界就不会写错。
:::

`nums = [2,4,7,9], target = 5` 推演：

```
lo hi mid nums[mid]  比较        动作
0  4  2   7          7 >= 5     hi = 2
0  2  1   4          4 < 5      lo = 2
2  2  -   -          lo == hi   返回 2
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int searchInsert(int[] nums, int target) {
        // 在 [lo, hi) 中找第一个 >= target 的位置
        int lo = 0, hi = nums.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2; // 防溢出写法
            if (nums[mid] < target) {
                lo = mid + 1; // mid 及左边都太小
            } else {
                hi = mid;     // mid 可能就是答案，保留
            }
        }
        return lo; // lo == hi，可能等于 nums.length
    }
}
```

## 复杂度

- 时间 O(log n)：每轮区间减半。
- 空间 O(1)：只用了几个变量。

## 易错点

- `hi` 初始化为 `nums.length - 1` 且用 `lo < hi`，会漏掉"插到末尾"的情况（例子里的 12 会返回 3）。
- 左闭右开时更新 `hi = mid`，不能写 `hi = mid - 1`，否则可能把答案丢掉。
- `(lo + hi) / 2` 在下标很大时可能溢出，习惯写 `lo + (hi - lo) / 2`。
- 找到相等就直接返回也可以，但写成统一的 lower_bound 更不容易出错，也能直接复用到下一题。

## 举一反三

- [[algo:find-first-and-last-position-of-element-in-sorted-array]]：两次 lower_bound 找左右边界。
- [[algo:search-a-2d-matrix]]：把二维矩阵拉平成一维再二分。
- [[algo:longest-increasing-subsequence]]：贪心 + 二分的解法里，每次就是找第一个 `>= x` 的位置替换。
- Java 里 `Arrays.binarySearch` 找不到时返回 `-(插入点) - 1`，本题正是这个"插入点"；`TreeMap.ceilingKey` 也是同一语义。

## 一句话记忆

找插入位置就是找第一个 `>= target` 的下标，左闭右开 `[0, n)`，小于就 `lo = mid + 1`，否则 `hi = mid`。
