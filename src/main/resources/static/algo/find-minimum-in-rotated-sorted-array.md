## 题意

一个元素**互不相同**的升序数组被旋转了若干次（每次把最后一个元素挪到最前面，也可能转了一整圈回到原样）。给旋转后的数组，返回其中的最小值。要求 O(log n)。

```
输入：nums = [7,9,2,4,5]
输出：2
```

```
输入：nums = [3,6,8]
输出：3
解释：转了整数圈，数组仍然有序，最小值在开头
```

## 思路

遍历一遍取最小是 O(n)。要 O(log n) 就得二分，关键是找到一个能"扔掉一半"的判断条件。

旋转数组由两段升序组成：左段的所有值都**大于**右段的所有值，最小值是右段的第一个元素。拿 `nums[mid]` 和区间右端 `nums[hi]` 比较：

- `nums[mid] < nums[hi]`：`mid` 到 `hi` 这一段是连续升序的，最小值在 `mid` 或它左边，`hi = mid`（mid 本身可能就是答案，保留）。
- `nums[mid] > nums[hi]`：`mid` 在左段，而最小值在右段，所以最小值一定在 `mid` 右边，`lo = mid + 1`。

元素互不相同且 `mid < hi`，不会出现相等。区间缩到 `lo == hi` 时就是最小值。

:::tip 关键点
和**右端点** `nums[hi]` 比，而不是左端点：比右端点能统一处理"没旋转"的情况；比左端点时，未旋转的数组会把你引向错误的一边。
:::

`nums = [7,9,2,4,5]` 推演：

```
lo hi mid nums[mid] nums[hi] 比较    动作
0  4  2   2         5        2 < 5  hi = 2
0  2  1   9         2        9 > 2  lo = 2
2  2  -   -         -        结束    返回 nums[2] = 2
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int findMin(int[] nums) {
        int lo = 0, hi = nums.length - 1;
        // 区间 [lo, hi] 内一定包含最小值，缩到只剩一个元素为止
        while (lo < hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] < nums[hi]) {
                // mid..hi 连续升序，最小值在 mid 或其左侧
                hi = mid;
            } else {
                // mid 落在左段（较大的一段），最小值在 mid 右侧
                lo = mid + 1;
            }
        }
        return nums[lo];
    }
}
```

## 复杂度

- 时间 O(log n)：每轮区间减半。
- 空间 O(1)。

## 易错点

- 用 `nums[mid]` 和 `nums[lo]` 比较：对 `[3,6,8]` 这种没旋转的数组，`nums[mid] > nums[lo]` 会让你去右边找，结果错误。
- `nums[mid] < nums[hi]` 时写成 `hi = mid - 1` 会把答案扔掉，mid 本身可能就是最小值。
- 循环条件用 `lo < hi` 配合 `hi = mid`，用 `lo <= hi` 会死循环。
- 如果数组有重复值（II），`nums[mid] == nums[hi]` 时无法判断，只能 `hi--`，最坏 O(n)。

## 举一反三

- [[algo:search-in-rotated-sorted-array]]：同一个数组结构上找指定值，可以先用本题找旋转点再二分。
- [[algo:find-first-and-last-position-of-element-in-sorted-array]]：同样是"区间内保留可能答案"的边界二分写法。
- [[algo:search-insert-position]]：二分的基本模板。

## 一句话记忆

拿 `nums[mid]` 和 `nums[hi]` 比：小于就 `hi = mid`，大于就 `lo = mid + 1`，最后 `nums[lo]` 就是最小值。
