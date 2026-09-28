## 题意

给一个**非递减**（可能有重复）的整数数组 `nums` 和目标值 `target`，返回 `target` 在数组中第一次和最后一次出现的下标 `[start, end]`；不存在则返回 `[-1,-1]`。要求 O(log n)。

```
输入：nums = [1,3,3,3,6,8], target = 3
输出：[1,3]
```

```
输入：nums = [1,3,3,3,6,8], target = 5
输出：[-1,-1]
```

## 思路

简单做法：二分找到任意一个 `target`，再向左右线性扩展。但如果数组全是 `target`，扩展就退化成 O(n)。

正确做法是把两个边界都转成 lower_bound（第一个 `>= x` 的位置）：

- 左边界 = 第一个 `>= target` 的位置 `L`。
- 右边界 = 第一个 `>= target + 1` 的位置减 1，即 `lowerBound(target + 1) - 1`。
- 如果 `L == n` 或 `nums[L] != target`，说明 target 不存在。

这样只写一个二分函数，调用两次就行，不用分别维护"找左边界"和"找右边界"两套容易写错的代码。

:::tip 关键点
右边界 = "第一个 > target 的位置" - 1 = `lowerBound(target + 1) - 1`（整数数组才能这样用）。一个 lower_bound 函数解决两个边界。
:::

`nums = [1,3,3,3,6,8], target = 3` 推演：

```
lowerBound(3):  [lo,hi)
0,6 mid=3 nums=3 >=3 hi=3
0,3 mid=1 nums=3 >=3 hi=1
0,1 mid=0 nums=1 <3  lo=1   -> L = 1
lowerBound(4):
0,6 mid=3 nums=3 <4  lo=4
4,6 mid=5 nums=8 >=4 hi=5
4,5 mid=4 nums=6 >=4 hi=4   -> 4, R = 4 - 1 = 3
结果 [1,3]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int[] searchRange(int[] nums, int target) {
        int left = lowerBound(nums, target);
        // 不存在：越界或第一个 >= target 的数不是 target
        if (left == nums.length || nums[left] != target) {
            return new int[]{-1, -1};
        }
        // 第一个 >= target+1 的位置减一，就是最后一个 target
        int right = lowerBound(nums, target + 1) - 1;
        return new int[]{left, right};
    }

    // 返回第一个 >= x 的下标，都小于 x 时返回 nums.length
    private int lowerBound(int[] nums, int x) {
        int lo = 0, hi = nums.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] < x) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
}
```

## 复杂度

- 时间 O(log n)：两次二分。
- 空间 O(1)。

## 易错点

- 找到一个 target 后向两边线性扩展，最坏 O(n)，不满足题目要求。
- 判断不存在时先判 `left == nums.length` 再访问 `nums[left]`，顺序反了会越界；空数组也靠这一步处理。
- `target + 1` 在 `target == Integer.MAX_VALUE` 时会溢出；本题数据范围安全，否则可以改写一个"第一个 > x"的 upperBound。
- 如果分别写"找左边界"和"找右边界"两个二分，最容易在 `mid` 取整方向和 `lo/hi` 更新上出错，导致死循环。

## 其他解法

写一个带参数的二分，`lower = true` 时找第一个 `>= target`，`false` 时找第一个 `> target`，右边界再减 1。本质和上面相同，只是避免了 `target + 1` 的溢出隐患。

```java
import java.util.*;

class Solution {
    public int[] searchRange(int[] nums, int target) {
        int left = bound(nums, target, true);
        if (left == nums.length || nums[left] != target) return new int[]{-1, -1};
        int right = bound(nums, target, false) - 1;
        return new int[]{left, right};
    }

    // lower=true：第一个 >= target；lower=false：第一个 > target
    private int bound(int[] nums, int target, boolean lower) {
        int lo = 0, hi = nums.length;
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            boolean goRight = lower ? nums[mid] < target : nums[mid] <= target;
            if (goRight) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
}
```

## 举一反三

- [[algo:search-insert-position]]：就是一次 lower_bound。
- [[algo:search-in-rotated-sorted-array]]：数组局部有序时的二分变形。
- [[algo:median-of-two-sorted-arrays]]：二分的对象从"下标"变成"划分位置"。
- 业务上统计"某个时间区间内有多少条记录"，在有序时间戳数组上做两次边界二分，数量就是 `right - left + 1`；数据库 B+ 树的范围查询也是先定位左边界再顺序扫描。

## 一句话记忆

左边界 = `lowerBound(t)`，右边界 = `lowerBound(t + 1) - 1`，一个二分函数用两次。
