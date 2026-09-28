## 题意

给两个升序数组 `nums1`（长 m）和 `nums2`（长 n），求把它们合在一起后的中位数：总数为奇数时取正中间那个，偶数时取中间两个的平均值。两个数组可能有一个为空，但不会都为空。要求 O(log(m+n))。

```
输入：nums1 = [1,4,9], nums2 = [2,3]
输出：3.0
解释：合并后 [1,2,3,4,9]，中间是 3
```

```
输入：nums1 = [5,8], nums2 = [1,6]
输出：5.5
解释：合并后 [1,5,6,8]，(5 + 6) / 2 = 5.5
```

## 思路

**暴力**：归并成一个数组取中间，O(m+n)。只用双指针走到中间位置可以省掉额外空间，但时间还是 O(m+n)。

**换个角度**：中位数的本质是把所有数分成个数相等（或左边多一个）的左右两半，并且"左半最大值 ≤ 右半最小值"。设总数 `total = m + n`，左半需要 `half = (total + 1) / 2` 个数。如果 `nums1` 贡献前 `i` 个，那 `nums2` 必须贡献前 `j = half - i` 个——**只要确定 i，j 就确定了**。

于是问题变成在 `[0, m]` 上二分 i，使得交叉条件成立（两个数组各自内部已有序，只需检查交叉的两对）：

- `A[i-1] <= B[j]` 且 `B[j-1] <= A[i]`。
- 若 `A[i-1] > B[j]`，说明 A 拿多了，i 往左；否则 i 往右。
- 越界的位置用 `-∞` / `+∞` 代替，省去一堆特判。

找到后：奇数取 `max(A[i-1], B[j-1])`；偶数再和 `min(A[i], B[j])` 求平均。

:::tip 关键点
不二分"值"，而是二分"较短数组切在哪"。切口 i 确定后 j = half - i 随之确定，只需检查两条交叉不等式。对**较短**的数组二分，既保证 j 不越界，也让复杂度是 O(log min(m,n))。
:::

`nums1 = [1,4,9], nums2 = [2,3]` 推演：令 A = 较短的 `[2,3]`（m=2），B = `[1,4,9]`，total = 5，half = 3。

```
lo hi i j  A[i-1] A[i] B[j-1] B[j]  检查
0  2  1 2  2      3    4      9     B[j-1]=4 > A[i]=3, i 太小, lo = 2
2  2  2 1  3      +inf 1      4     3<=4 且 1<=+inf, 成立
奇数 -> max(A[i-1], B[j-1]) = max(3, 1) = 3
```

## Java 题解

```java
import java.util.*;

class Solution {
    public double findMedianSortedArrays(int[] nums1, int[] nums2) {
        // 保证在较短的数组上二分
        if (nums1.length > nums2.length) return findMedianSortedArrays(nums2, nums1);
        int[] a = nums1, b = nums2;
        int m = a.length, n = b.length;
        int half = (m + n + 1) / 2; // 左半部分的元素个数（奇数时左边多一个）
        int lo = 0, hi = m;          // i 表示 a 贡献给左半的个数，取值 [0, m]
        while (lo <= hi) {
            int i = lo + (hi - lo) / 2;
            int j = half - i;
            // 越界用正负无穷代替
            int aLeft = i == 0 ? Integer.MIN_VALUE : a[i - 1];
            int aRight = i == m ? Integer.MAX_VALUE : a[i];
            int bLeft = j == 0 ? Integer.MIN_VALUE : b[j - 1];
            int bRight = j == n ? Integer.MAX_VALUE : b[j];
            if (aLeft > bRight) {
                hi = i - 1;          // a 拿多了
            } else if (bLeft > aRight) {
                lo = i + 1;          // a 拿少了
            } else {
                // 找到合法切分
                int leftMax = Math.max(aLeft, bLeft);
                if (((m + n) & 1) == 1) return leftMax;
                int rightMin = Math.min(aRight, bRight);
                return (leftMax + (long) rightMin) / 2.0; // 防止相加溢出
            }
        }
        throw new IllegalArgumentException("输入不是有序数组");
    }
}
```

## 复杂度

- 时间 O(log min(m, n))：只在较短数组的切口位置 `[0, m]` 上二分。
- 空间 O(1)（交换参数的那一次递归只有一层）。

## 易错点

- 必须在**较短**的数组上二分，否则 `j = half - i` 可能为负数或超过 n，导致越界。
- i 的取值范围是 `[0, m]`（闭区间，共 m+1 种切法），`hi` 要初始化为 `m` 而不是 `m - 1`。
- `half = (m + n + 1) / 2` 让奇数时左半多一个，这样中位数统一是左半最大值；用 `(m + n) / 2` 就要改成取右半最小值。
- 两个 int 相加再除以 2 可能溢出，转成 long 或 double 再算；返回值要用 `/ 2.0` 得到小数。
- 用 `Integer.MIN_VALUE/MAX_VALUE` 当哨兵时，比较只用 `>`，不做加减，就不会溢出。

## 其他解法

第 k 小元素法：中位数就是第 `(m+n+1)/2` 小（和第 `(m+n+2)/2` 小的平均）。每次比较两个数组的第 `k/2` 个元素，较小一方的前 `k/2` 个一定不是第 k 小，可以整体排除，k 减半。复杂度 O(log(m+n))，思路直观，适合面试时先讲。

```java
import java.util.*;

class Solution {
    public double findMedianSortedArrays(int[] nums1, int[] nums2) {
        int total = nums1.length + nums2.length;
        int left = kth(nums1, 0, nums2, 0, (total + 1) / 2);
        if ((total & 1) == 1) return left;
        int right = kth(nums1, 0, nums2, 0, total / 2 + 1);
        return (left + (long) right) / 2.0;
    }

    // 在 a[i..] 和 b[j..] 中找第 k 小（k 从 1 开始）
    private int kth(int[] a, int i, int[] b, int j, int k) {
        if (i == a.length) return b[j + k - 1]; // a 已经用完
        if (j == b.length) return a[i + k - 1];
        if (k == 1) return Math.min(a[i], b[j]);
        // 各取第 k/2 个比较，越界时取数组末尾
        int ni = Math.min(a.length, i + k / 2) - 1;
        int nj = Math.min(b.length, j + k / 2) - 1;
        if (a[ni] <= b[nj]) {
            return kth(a, ni + 1, b, j, k - (ni - i + 1)); // 排除 a[i..ni]
        } else {
            return kth(a, i, b, nj + 1, k - (nj - j + 1)); // 排除 b[j..nj]
        }
    }
}
```

## 举一反三

- [[algo:merge-two-sorted-lists]]：暴力解就是归并，这是它的基础。
- [[algo:kth-largest-element-in-an-array]]：同样是"求第 k 个"，单个无序数组用快速选择或堆。
- [[algo:find-median-from-data-stream]]：数据流的中位数，用大顶堆 + 小顶堆维护左右两半，和本题"左右两半"的视角一致。
- [[algo:search-in-rotated-sorted-array]]：另一种"二分的不是值本身"的变形。

## 一句话记忆

在短数组上二分切口 i，j = half - i，检查 `A[i-1] <= B[j]` 和 `B[j-1] <= A[i]`，中位数取左半最大 / 右半最小。
