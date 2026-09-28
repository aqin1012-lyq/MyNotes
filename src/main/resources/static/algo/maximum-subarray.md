## 题意

给一个整数数组（至少有一个元素，可能全是负数），找出和最大的**连续非空**子数组，返回这个最大和。

```
输入：nums = [3,-4,2,-1,5,-6,1]
输出：6
解释：子数组 [2,-1,5] 的和为 6
```

```
输入：nums = [-5,-2,-9]
输出：-2
解释：全是负数时，只选最大的那一个
```

## 思路

暴力：枚举起点、终点，用累加的方式算和，O(n²)。

动态规划：定义 `f[i]` = **以 nums[i] 结尾**的最大子数组和。以 i 结尾的子数组只有两种可能：

- 接在以 i-1 结尾的最优子数组后面：`f[i-1] + nums[i]`；
- 从 i 自己重新开始：`nums[i]`。

所以 `f[i] = max(f[i-1] + nums[i], nums[i])`，等价于：**如果前面的累计和是负数，就扔掉它重新开始**。答案是所有 `f[i]` 的最大值。`f[i]` 只依赖 `f[i-1]`，用一个变量滚动即可，这就是 Kadane 算法。

:::tip 关键点
状态定义成"以 i 结尾"才能保证连续性。负的前缀只会拖累后面，所以 `cur < 0` 时直接丢弃。
:::

推演 `[3,-4,2,-1,5,-6,1]`：

```
i  num  cur = max(cur+num, num)   best
0  3    3                         3
1  -4   max(-1,-4) = -1           3
2  2    max(1, 2)  = 2            3
3  -1   max(1,-1)  = 1            3
4  5    max(6, 5)  = 6            6
5  -6   max(0,-6)  = 0            6
6  1    max(1, 1)  = 1            6
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int maxSubArray(int[] nums) {
        int cur = nums[0];  // 以当前位置结尾的最大子数组和
        int best = nums[0]; // 全局最大
        for (int i = 1; i < nums.length; i++) {
            // 前面的累计和为负就丢掉，从自己重新开始
            cur = Math.max(cur + nums[i], nums[i]);
            best = Math.max(best, cur);
        }
        return best;
    }
}
```

## 复杂度

- 时间 O(n)：一次遍历。
- 空间 O(1)：只用两个变量滚动。

## 易错点

- `best` 和 `cur` 要初始化为 `nums[0]`，不能初始化为 0，否则全负数组会错误返回 0。
- 状态是"以 i 结尾"，不是"前 i 个元素里的最大子数组和"，后者无法直接转移。
- 更新顺序：先算 `cur`，再用它更新 `best`。
- 如果题目追问"返回子数组本身"，需要额外记录起点：`cur` 重新开始时记下 `start = i`，`best` 更新时记下 `[start, i]`。

## 其他解法

前缀和视角：子数组和 = `pre[j] - pre[i]`，要让它最大，就在遍历时维护之前出现过的最小前缀和。

```java
import java.util.*;

class Solution {
    public int maxSubArray(int[] nums) {
        int pre = 0;            // 当前前缀和
        int minPre = 0;         // 之前出现过的最小前缀和（含空前缀 0）
        int best = Integer.MIN_VALUE;
        for (int x : nums) {
            pre += x;
            // 以当前位置结尾的最大和 = 当前前缀和 - 之前最小前缀和
            best = Math.max(best, pre - minPre);
            minPre = Math.min(minPre, pre);
        }
        return best;
    }
}
```

## 举一反三

- [[algo:subarray-sum-equals-k]]：同样可以用前缀和理解子数组和。
- [[algo:maximum-product-subarray]]：乘积版本，因为负负得正，要同时维护最大和最小。
- [[algo:best-time-to-buy-and-sell-stock]]：本质相同——维护历史最小值，用当前值减去它。

## 一句话记忆

以 i 结尾的最大和 = max(接上前面, 从自己重来)，前缀为负就丢掉。
