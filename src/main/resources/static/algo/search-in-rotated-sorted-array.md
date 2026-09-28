## 题意

一个元素**互不相同**的升序数组，在某个未知位置被"旋转"过：后半段整体搬到了前面（例如 `[1,3,5,6,8,9]` 变成 `[6,8,9,1,3,5]`）。给这个旋转后的数组和 `target`，返回 `target` 的下标，不存在返回 -1。要求 O(log n)。

```
输入：nums = [6,8,9,1,3,5], target = 3
输出：4
```

```
输入：nums = [6,8,9,1,3,5], target = 7
输出：-1
```

## 思路

线性查找 O(n) 不满足要求。数组整体无序，不能直接二分；但它由两段各自升序的子数组组成。关键观察：**任取一个 mid，`[lo, mid]` 和 `[mid, hi]` 至少有一半是完全有序的**。

判断哪一半有序只需比较 `nums[lo]` 和 `nums[mid]`：

- `nums[lo] <= nums[mid]`：左半 `[lo, mid]` 有序。若 `nums[lo] <= target < nums[mid]`，target 只可能在左半，`hi = mid - 1`；否则去右半。
- 否则右半 `[mid, hi]` 有序。若 `nums[mid] < target <= nums[hi]`，去右半，`lo = mid + 1`；否则去左半。

在有序的那一半里，用首尾两个值就能 O(1) 判断 target 在不在里面，每轮仍然能扔掉一半。

:::tip 关键点
每次二分先确定哪一半是有序的，只在有序的那一半里做"target 在不在区间内"的判断；不在就去另一半。
:::

`target = 3` 推演：

```
lo hi mid nums[mid] 有序的一半     3 在其中?   动作
0  5  2   9         左 [6..9]     否          lo = 3
3  5  4   3         -             相等        返回 4
```

`target = 7` 推演：

```
lo hi mid nums[mid] 有序的一半     7 在其中?   动作
0  5  2   9         左 [6..9]     是          hi = 1
0  1  0   6         左 [6..6]     否          lo = 1
1  1  1   8         左 [8..8]     否          lo = 2
lo > hi -> -1
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int search(int[] nums, int target) {
        int lo = 0, hi = nums.length - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] == target) return mid;
            if (nums[lo] <= nums[mid]) {
                // 左半 [lo, mid] 有序
                if (nums[lo] <= target && target < nums[mid]) {
                    hi = mid - 1;
                } else {
                    lo = mid + 1;
                }
            } else {
                // 右半 [mid, hi] 有序
                if (nums[mid] < target && target <= nums[hi]) {
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
        }
        return -1;
    }
}
```

## 复杂度

- 时间 O(log n)：每轮排除一半。
- 空间 O(1)。

## 易错点

- `nums[lo] <= nums[mid]` 必须带等号：当 `lo == mid`（区间只剩 1–2 个元素）时，左半只有一个元素，也算有序。
- 区间判断的开闭要对：左半用 `nums[lo] <= target < nums[mid]`，右半用 `nums[mid] < target <= nums[hi]`，`mid` 已经在前面判过相等。
- 本题元素互不相同；如果有重复（搜索旋转排序数组 II），`nums[lo] == nums[mid]` 时无法判断哪边有序，只能 `lo++`，最坏退化为 O(n)。
- 没被旋转（整体有序）的情况也要能正确处理，上面的写法天然覆盖。

## 其他解法

两次二分：先用 [[algo:find-minimum-in-rotated-sorted-array]] 的方法找到最小值下标（旋转点），再根据 target 和 `nums[n-1]` 的大小关系，决定在左段还是右段做普通二分。思路更"拆解"，但代码更长。

## 举一反三

- [[algo:find-minimum-in-rotated-sorted-array]]：同样利用"一半有序"，找的是旋转点。
- [[algo:search-insert-position]]：普通有序数组上的二分模板。
- [[algo:median-of-two-sorted-arrays]]：更进一步的二分变形，二分的是划分位置。

## 一句话记忆

先看 `nums[lo] <= nums[mid]` 判断哪半有序，target 落在有序半里就进去，否则去另一半。
