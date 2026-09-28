## 题意

给一个整数数组 `nums`，求其中**严格递增子序列**的最大长度。子序列不要求连续，但要保持原来的相对顺序。进阶要求做到 O(n log n)。

```
输入：nums = [4,1,6,2,5,3,7]
输出：4
解释：例如 [1,2,5,7] 或 [1,2,3,7]
```

```
输入：nums = [5,5,5]
输出：1
解释：相等不算递增
```

## 思路

暴力：枚举所有 2^n 个子序列，检查是否递增，取最长。子问题重复在于：很多子序列共享同一个"结尾元素"，而后续能接什么只取决于结尾。

所以把状态定在"以谁结尾"上。看**倒数第二个元素**是谁：以 `nums[i]` 结尾的递增子序列，前一个元素一定是某个 `j < i` 且 `nums[j] < nums[i]`。

- **dp 定义**：`dp[i]` = 以 `nums[i]` **结尾**的最长严格递增子序列长度。
- **转移**：`dp[i] = max(dp[j] + 1)`，`j < i` 且 `nums[j] < nums[i]`；没有这样的 `j` 时为 1。
- **初始化**：所有 `dp[i] = 1`（自己单独成一个序列）。
- **遍历顺序**：`i` 从左到右，内层 `j` 扫 `0..i-1`。答案是 **所有 `dp[i]` 的最大值**，不是 `dp[n-1]`。

:::tip 关键点
"以 i 结尾"是子序列/子数组类 DP 的经典定义，因为它让"能不能接上"只需比较结尾元素。代价是答案要在所有位置里取最大。
:::

用 `nums = [4,1,6,2,5,3,7]` 填表：

```
i        0  1  2  3  4  5  6
nums[i]  4  1  6  2  5  3  7
dp[i]    1  1  2  2  3  3  4
```

- `dp[4]`（值 5）：可接在 4(dp=1)、1(dp=1)、2(dp=2) 后面 → 3
- `dp[6]`（值 7）：可接在 5(dp=3) 或 3(dp=3) 后面 → 4

O(n²) 的 dp 每个位置都可能依赖前面任意位置，无法滚动压缩；想更快要换状态定义，见"其他解法"的贪心 + 二分。

## Java 题解

```java
import java.util.*;

class Solution {
    public int lengthOfLIS(int[] nums) {
        int n = nums.length;
        int[] dp = new int[n];
        int best = 0;
        for (int i = 0; i < n; i++) {
            dp[i] = 1; // 只有自己
            // 枚举前一个元素 nums[j]
            for (int j = 0; j < i; j++) {
                if (nums[j] < nums[i]) {
                    dp[i] = Math.max(dp[i], dp[j] + 1);
                }
            }
            best = Math.max(best, dp[i]); // 答案取所有结尾中的最大值
        }
        return best;
    }
}
```

## 复杂度

- 时间 O(n²)：两层循环。贪心 + 二分的写法是 O(n log n)。
- 空间 O(n)：dp 数组（或 tails 数组）。

## 易错点

- 返回 `dp[n-1]` 是错的：最长子序列不一定以最后一个元素结尾，比如 `[1,2,0]`。
- 严格递增用 `<`；如果题目改成"非递减"，比较条件和二分的查找目标都要跟着改。
- 贪心 + 二分里的 `tails` **不是**一个真实的 LIS，只保证长度正确；要输出具体序列需额外记录前驱。
- 二分要找"第一个 `>= x` 的位置"（lower bound），找成 `> x` 会让相等元素也被追加，变成非递减。

## 其他解法

贪心 + 二分：`tails[k]` 表示"长度为 `k+1` 的递增子序列中，最小的结尾值"。结尾越小，后面越容易接。`tails` 一定严格递增，于是每来一个数 `x`，二分找到第一个 `>= x` 的位置替换它；如果 `x` 比所有都大就追加，长度 +1。

```
x   tails
4   [4]
1   [1]          1 替换 4
6   [1,6]        追加
2   [1,2]        2 替换 6
5   [1,2,5]      追加
3   [1,2,3]      3 替换 5
7   [1,2,3,7]    追加，长度 4
```

```java
import java.util.*;

class Solution {
    public int lengthOfLIS(int[] nums) {
        int[] tails = new int[nums.length];
        int size = 0;
        for (int x : nums) {
            // 在 tails[0..size) 中找第一个 >= x 的位置
            int lo = 0, hi = size;
            while (lo < hi) {
                int mid = (lo + hi) >>> 1;
                if (tails[mid] < x) lo = mid + 1;
                else hi = mid;
            }
            tails[lo] = x;       // 替换，或在末尾追加
            if (lo == size) size++;
        }
        return size;
    }
}
```

## 举一反三

- [[algo:maximum-subarray]]：同样用"以 i 结尾"定义状态，但子数组要求连续，只需看 `i-1`。
- [[algo:longest-common-subsequence]]：两个序列上的子序列 DP，二维表。
- [[algo:search-insert-position]]：tails 上的二分就是"找插入位置"。
- [[algo:longest-consecutive-sequence]]：名字相似但要求的是值连续、不管顺序，用哈希表而不是 DP。

## 一句话记忆

`dp[i]` 为以 `nums[i]` 结尾的 LIS 长度，从所有更小的前驱 +1；进阶用 tails 数组 + 二分做到 O(n log n)。
