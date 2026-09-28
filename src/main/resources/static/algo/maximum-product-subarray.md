## 题意

给一个整数数组 `nums`（可能有负数和 0），找出一个**连续**且非空的子数组，使其所有元素的乘积最大，返回这个最大乘积。题目保证答案在 32 位整数范围内。

```
输入：nums = [2,-3,-2,4,-1]
输出：48
解释：子数组 [2,-3,-2,4] 的乘积为 48
```

```
输入：nums = [-5,0,-2]
输出：0
解释：任何含负数且不含 0 的子数组都是负数，最大为单独的 [0]
```

## 思路

暴力：枚举所有子数组 `[i..j]`，边扩展 `j` 边累乘，O(n²)。能否像 [[algo:maximum-subarray]] 那样只用"以 i 结尾的最大值"一趟搞定？不行：乘法遇到负数会**翻转大小**——当前最小的负数乘上一个负数，可能一下子变成最大的正数。

所以同时维护"以 i 结尾"的最大和最小乘积：

- **dp 定义**：`maxDp[i]` / `minDp[i]` = 以 `nums[i]` 结尾的子数组的最大 / 最小乘积。
- **转移**：设 `x = nums[i]`，三个候选是 `x`（从自己重新开始）、`maxDp[i-1] * x`、`minDp[i-1] * x`；`maxDp[i]` 取三者最大，`minDp[i]` 取三者最小。
- **初始化**：`maxDp[0] = minDp[0] = nums[0]`，答案初始为 `nums[0]`。
- **遍历顺序**：`i` 从 1 到 `n-1`，每步用 `maxDp[i]` 更新答案。

:::tip 关键点
负数让"最大"和"最小"互相转化，所以必须两个状态一起滚动。候选里包含 `x` 本身，天然处理了 0 的"断开重来"。
:::

用 `nums = [2,-3,-2,4,-1]` 推演：

```
i  x    max  min  ans
0  2    2    2    2
1  -3   -3   -6   2
2  -2   12   -2   12
3  4    48   -8   48
4  -1   8    -48  48
```

- `i=2`：候选 `-2`、`-3*-2=6`、`-6*-2=12`，最小值 `-6` 翻身成了最大值 12。

**滚动数组优化**：每步只依赖上一步的 max/min，用两个变量即可，空间 O(1)；注意更新 `max` 前要先保存旧值，否则算 `min` 时用到的是新值。

## Java 题解

```java
import java.util.*;

class Solution {
    public int maxProduct(int[] nums) {
        // 以当前位置结尾的最大 / 最小乘积
        int max = nums[0], min = nums[0], ans = nums[0];
        for (int i = 1; i < nums.length; i++) {
            int x = nums[i];
            int a = max * x, b = min * x; // 先用旧值算好候选
            // 三个候选：自己重新开始、接在最大后面、接在最小后面
            max = Math.max(x, Math.max(a, b));
            min = Math.min(x, Math.min(a, b));
            ans = Math.max(ans, max);
        }
        return ans;
    }
}
```

## 复杂度

- 时间 O(n)：一次遍历。
- 空间 O(1)：只滚动 `max`、`min` 两个状态。

## 易错点

- 只维护最大值会错：`[-2,3,-4]` 的答案是 24，需要从最小值 `-6` 翻转过来。
- 先更新 `max` 再用新的 `max` 去算 `min`，结果错乱；要先把 `max * x`、`min * x` 存下来。
- 答案初始化为 `nums[0]` 而不是 0：`[-3]` 应返回 -3。
- 遇到 0 时候选 `x = 0` 会让 max/min 都归 0，相当于从下一个数重新开始，这是正确行为，不用特判。
- 中间乘积可能超出 int，如果题目不保证范围，就改用 `long` 或 `double`。

## 其他解法

前后缀扫描：不含 0 的一段里，负数个数为偶数时整段乘积最大；为奇数时，最大乘积一定是"去掉第一个负数及其左边"或"去掉最后一个负数及其右边"，分别对应从右往左和从左往右的前缀积。遇到 0 就把累乘重置为 1。

```java
import java.util.*;

class Solution {
    public int maxProduct(int[] nums) {
        int n = nums.length;
        int ans = nums[0];
        int pre = 1, suf = 1;
        for (int i = 0; i < n; i++) {
            // 遇到 0 后从 1 重新累乘
            pre = (pre == 0 ? 1 : pre) * nums[i];
            suf = (suf == 0 ? 1 : suf) * nums[n - 1 - i];
            ans = Math.max(ans, Math.max(pre, suf));
        }
        return ans;
    }
}
```

## 举一反三

- [[algo:maximum-subarray]]：加法版本，只需一个状态；乘法因为有符号翻转，需要最大最小两个状态。
- [[algo:product-of-array-except-self]]：同样利用前缀积和后缀积。
- [[algo:best-time-to-buy-and-sell-stock]]：也是一趟扫描同时维护多个滚动状态。

## 一句话记忆

负数会让最大最小互换，所以同时滚动"以 i 结尾的最大积和最小积"，候选是 x、max·x、min·x。
