## 题意

一排房子，每间房里有一笔非负金额 `nums[i]`。相邻两间房不能在同一晚都被偷（会触发报警），问在不报警的前提下最多能拿到多少钱。数组长度至少为 1。

```
输入：nums = [3,1,5,9,2]
输出：12
解释：偷第 0 间和第 3 间，3 + 9 = 12
```

```
输入：nums = [4]
输出：4
```

## 思路

暴力做法：每间房"偷或不偷"两种选择，枚举所有不相邻的子集，O(2^n)。瓶颈同样是重复子问题——"前 k 间房最多能偷多少"会被反复计算。

看**最后一间房**（第 `i-1` 间）偷不偷：

- 不偷：答案等于"前 `i-1` 间"的最优值。
- 偷：那第 `i-2` 间一定不能偷，答案等于"前 `i-2` 间"的最优值 + `nums[i-1]`。

两者取最大即可。

- **dp 定义**：`dp[i]` = 只考虑前 `i` 间房（下标 `0..i-1`）时能偷到的最大金额。
- **转移**：`dp[i] = max(dp[i-1], dp[i-2] + nums[i-1])`。
- **初始化**：`dp[0] = 0`（没有房子），`dp[1] = nums[0]`。
- **遍历顺序**：`i` 从 2 递增到 `n`，答案是 `dp[n]`。

:::tip 关键点
状态定义成"前 i 间的最优值"而不是"必须偷第 i 间"，转移只需看最后一间偷不偷，不用再往前找。多开一位 `dp[0] = 0` 能省掉很多边界判断。
:::

用 `nums = [3,1,5,9,2]` 填表：

```
i          0   1   2   3   4   5
nums[i-1]  -   3   1   5   9   2
dp[i]      0   3   3   8   12  12
```

- `dp[3] = max(dp[2]=3, dp[1]+5=8) = 8`
- `dp[4] = max(dp[3]=8, dp[2]+9=12) = 12`
- `dp[5] = max(dp[4]=12, dp[3]+2=10) = 12`

**滚动数组优化**：`dp[i]` 只依赖 `dp[i-1]` 和 `dp[i-2]`，两个变量即可，空间 O(1)。

## Java 题解

```java
import java.util.*;

class Solution {
    public int rob(int[] nums) {
        // prev2 = dp[i-2], prev1 = dp[i-1]，初始对应 dp[0] = 0, dp[1] = nums[0]
        int prev2 = 0, prev1 = nums[0];
        for (int i = 2; i <= nums.length; i++) {
            // 不偷第 i-1 间 vs 偷第 i-1 间
            int cur = Math.max(prev1, prev2 + nums[i - 1]);
            prev2 = prev1;
            prev1 = cur;
        }
        return prev1;
    }
}
```

## 复杂度

- 时间 O(n)：每间房处理一次。
- 空间 O(1)：只保留前两个状态。

## 易错点

- 不要以为"隔一个偷一个"（全偷奇数位或全偷偶数位）就是最优：`[3,1,5,9,2]` 里最优是第 0、3 间，中间隔了两间。
- 下标偏移：`dp[i]` 对应的是 `nums[i-1]`，写成 `nums[i]` 会越界或错位。
- 只有一间房时循环不执行，直接返回 `nums[0]`；如果把 `dp[1]` 初始化写成 `max(nums[0], nums[1])` 就要先判断长度。
- 滚动时先算 `cur` 再移动 `prev2/prev1`。

## 其他解法

状态机写法：`yes` 表示"最后一间偷了"，`no` 表示"最后一间没偷"，思路和"买卖股票"系列一致。

```java
import java.util.*;

class Solution {
    public int rob(int[] nums) {
        int yes = 0, no = 0;
        for (int x : nums) {
            int newYes = no + x;          // 偷当前：上一间必须没偷
            int newNo = Math.max(yes, no); // 不偷当前：上一间随意
            yes = newYes;
            no = newNo;
        }
        return Math.max(yes, no);
    }
}
```

## 举一反三

- [[algo:climbing-stairs]]：同样只依赖前两项，结构几乎一样，只是把"相加"换成了"取最大"。
- [[algo:best-time-to-buy-and-sell-stock]]：状态机写法的思路（持有/不持有）与这里的偷/不偷一致。
- [[algo:maximum-subarray]]：另一类"以当前位置结尾"的一维 DP，可以对比两种状态定义的区别。

## 一句话记忆

看最后一间偷不偷：`dp[i] = max(dp[i-1], dp[i-2] + nums[i-1])`，两个变量滚动。
