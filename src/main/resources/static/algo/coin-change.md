## 题意

给若干种硬币面额 `coins`（每种数量无限）和一个总金额 `amount`，求凑出恰好 `amount` 所需的最少硬币个数；如果怎么都凑不出来，返回 `-1`。`amount = 0` 时答案是 0。

```
输入：coins = [2,5], amount = 11
输出：4
解释：11 = 5 + 2 + 2 + 2
```

```
输入：coins = [3], amount = 4
输出：-1
解释：只有面额 3，凑不出 4
```

## 思路

暴力：递归地尝试"先拿哪一枚硬币"，剩余金额继续递归，取最少，指数级。而"凑出金额 x 最少要几枚"这个子问题会被不同路径反复求解。

看**最后拿的那一枚硬币** `c`：拿掉它之后剩下 `i - c`，只要知道凑出 `i - c` 的最优解，再 +1 即可。

- **dp 定义**：`dp[i]` = 凑出金额 `i` 所需的最少硬币数；凑不出记为"无穷大"。
- **转移**：`dp[i] = min(dp[i - c] + 1)`，对所有 `c <= i` 且 `dp[i - c]` 可达的面额取最小。
- **初始化**：`dp[0] = 0`；其余设为 `amount + 1` 作为"无穷大"（最多也就用 `amount` 枚面额 1 的硬币）。
- **遍历顺序**：金额 `i` 从 1 到 `amount` 递增，内层枚举硬币；最后 `dp[amount] > amount` 说明不可达。

:::tip 关键点
这是**完全背包求最少件数**。因为求的是"个数"而不是"方案数"，金额在外层还是硬币在外层都可以；但如果求组合数（LeetCode 518），就必须硬币在外层，否则会把 `2+5` 和 `5+2` 算成两种。
:::

用 `coins = [2,5], amount = 11` 填表（`∞` 表示不可达）：

```
i      0  1  2  3  4  5  6  7  8  9  10 11
dp[i]  0  ∞  1  ∞  2  1  3  2  4  3  2  4
```

- `dp[7] = min(dp[5]+1, dp[2]+1) = min(2, 2) = 2`
- `dp[11] = min(dp[9]+1, dp[6]+1) = min(4, 4) = 4`

一维 dp 本身就是完全背包二维表"按物品滚动"后的结果；完全背包内层**正序**遍历金额，允许同一枚硬币被重复使用。

## Java 题解

```java
import java.util.*;

class Solution {
    public int coinChange(int[] coins, int amount) {
        int inf = amount + 1; // 不可能达到的上界，当作"无穷大"
        int[] dp = new int[amount + 1];
        Arrays.fill(dp, inf);
        dp[0] = 0;
        for (int i = 1; i <= amount; i++) {
            // 枚举最后一枚硬币
            for (int c : coins) {
                if (c <= i && dp[i - c] != inf) {
                    dp[i] = Math.min(dp[i], dp[i - c] + 1);
                }
            }
        }
        return dp[amount] == inf ? -1 : dp[amount];
    }
}
```

## 复杂度

- 时间 O(amount × k)：k 为硬币种类数，每个金额枚举一遍硬币。
- 空间 O(amount)：一维 dp 数组。

## 易错点

- 贪心"先用最大面额"不对：`coins = [1,3,4], amount = 6`，贪心得 `4+1+1` 共 3 枚，最优是 `3+3` 共 2 枚。
- "无穷大"不要用 `Integer.MAX_VALUE`，`+1` 会溢出成负数，反而被 `min` 选中。
- 最后要把不可达（仍是 `inf`）转换成 `-1`。
- `amount = 0` 应返回 0 而不是 -1，`dp[0] = 0` 已经覆盖。
- 面额可能大于 `amount`，必须判断 `c <= i`，否则下标为负。

## 其他解法

标准完全背包写法：硬币在外层、金额在内层**正序**遍历。求最少个数时两种循环顺序结果相同；这种写法可以直接迁移到"组合数"问题。

```java
import java.util.*;

class Solution {
    public int coinChange(int[] coins, int amount) {
        int inf = amount + 1;
        int[] dp = new int[amount + 1];
        Arrays.fill(dp, inf);
        dp[0] = 0;
        for (int c : coins) {
            // 正序：dp[i - c] 可能已包含本枚硬币，即允许重复使用
            for (int i = c; i <= amount; i++) {
                dp[i] = Math.min(dp[i], dp[i - c] + 1);
            }
        }
        return dp[amount] > amount ? -1 : dp[amount];
    }
}
```

## 举一反三

- [[algo:perfect-squares]]：同一个模型，"硬币"是所有平方数，且一定有解。
- [[algo:partition-equal-subset-sum]]：0-1 背包，每个数只能用一次，所以一维写法要**倒序**遍历容量；和这里的正序正好对照。
- [[algo:word-break]]：把"最后一枚硬币"换成"最后一个单词"，求可行性而不是最少个数。
- 工程上"用最少张数凑金额"就是找零/优惠券组合问题；真实面额体系（1、5、10…）恰好让贪心成立，但通用场景要用 DP。

## 一句话记忆

完全背包求最少件数：`dp[i] = min(dp[i - c] + 1)`，`dp[0] = 0`，其余初始化为 `amount + 1`。
