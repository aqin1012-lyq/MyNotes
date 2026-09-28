## 题意

给一个只含正整数的数组 `nums`，判断能否把它分成两个子集，使两个子集的元素和相等。每个元素必须且只能属于其中一个子集。

```
输入：nums = [3,1,4,2]
输出：true
解释：{3,2} 和 {1,4}，和都是 5
```

```
输入：nums = [2,3,7]
输出：false
解释：总和 12，但没有任何子集的和恰好是 6
```

## 思路

先做转化：两个子集和相等 ⇔ 总和 `sum` 是偶数，且能挑出一个子集，和恰好为 `target = sum / 2`。于是变成"每个数选或不选，能否凑出 `target`"。

暴力枚举所有子集是 O(2^n)。但我们其实只关心"凑出的和是多少"，而和的取值最多 `target + 1` 种——这就是 **0-1 背包**。

- **dp 定义**：`dp[i][j]` = 只用前 `i` 个数，能否选出一个子集和恰好为 `j`。
- **转移**：看第 `i` 个数 `x = nums[i-1]` 选不选：`dp[i][j] = dp[i-1][j] || (j >= x && dp[i-1][j-x])`。
- **初始化**：`dp[0][0] = true`（不选任何数，和为 0），`dp[0][j>0] = false`。
- **遍历顺序**：物品 `i` 从 1 到 `n`；答案是 `dp[n][target]`。

:::tip 关键点
二维表每一行只依赖上一行，可以压成一维 `dp[j]`。但 0-1 背包的每个数只能用一次，所以内层容量 `j` 必须**从大到小**遍历：这样 `dp[j - x]` 读到的还是"上一行"的值，不会把同一个数用两次。
:::

用 `nums = [3,1,4,2]`，`target = 5` 推演一维 dp（每行是处理完该数后的状态）：

```
j            0  1  2  3  4  5
init         T  F  F  F  F  F
x=3          T  F  F  T  F  F
x=1          T  T  F  T  T  F
x=4          T  T  F  T  T  T
x=2          T  T  T  T  T  T
```

- 处理 `x=4` 时 `dp[5] = dp[5] || dp[1] = T`，已经可以提前返回 true。

如果内层正序遍历，处理 `x=1` 时 `dp[1]` 刚变成 T，紧接着 `dp[2] = dp[1]` 也会变 T，等于把 1 用了两次——那就变成了完全背包（参考 [[algo:coin-change]]）。

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean canPartition(int[] nums) {
        int sum = 0, max = 0;
        for (int x : nums) {
            sum += x;
            max = Math.max(max, x);
        }
        if (sum % 2 != 0) return false; // 奇数和不可能平分
        int target = sum / 2;
        if (max > target) return false; // 最大的数单独就超过一半

        boolean[] dp = new boolean[target + 1];
        dp[0] = true; // 什么都不选，和为 0
        for (int x : nums) {
            // 0-1 背包：容量倒序，保证每个数只用一次
            for (int j = target; j >= x; j--) {
                dp[j] = dp[j] || dp[j - x];
            }
            if (dp[target]) return true; // 提前结束
        }
        return dp[target];
    }
}
```

## 复杂度

- 时间 O(n × target)：每个数扫一遍容量，target 是总和的一半。
- 空间 O(target)：一维滚动数组；二维写法是 O(n × target)。

## 易错点

- 一维写法内层**正序**遍历会重复使用同一个数，比如 `[2,3,7]` 在处理 2 时就会把它用三次凑出 6，错误返回 true。
- 忘了先判断总和奇偶，直接 `sum / 2` 会向下取整，得出错误结论。
- `dp[0] = true` 是一切的起点，漏掉就全是 false。
- 这是伪多项式复杂度：数值很大（比如元素到 10^9）时 target 太大，这个 DP 就不可行了。

## 其他解法

二维写法：和状态定义一一对应，更容易在面试里先写对，再说明如何压缩成一维。

```java
import java.util.*;

class Solution {
    public boolean canPartition(int[] nums) {
        int sum = 0;
        for (int x : nums) sum += x;
        if (sum % 2 != 0) return false;
        int target = sum / 2, n = nums.length;
        boolean[][] dp = new boolean[n + 1][target + 1];
        dp[0][0] = true;
        for (int i = 1; i <= n; i++) {
            int x = nums[i - 1];
            for (int j = 0; j <= target; j++) {
                dp[i][j] = dp[i - 1][j];                  // 不选第 i 个数
                if (j >= x) dp[i][j] |= dp[i - 1][j - x]; // 选第 i 个数
            }
        }
        return dp[n][target];
    }
}
```

## 举一反三

- [[algo:coin-change]]：完全背包（每种无限个），一维写法内层正序；本题 0-1 背包内层倒序，两者对照记忆。
- [[algo:perfect-squares]]：同样是完全背包模型。
- [[algo:subsets]]：暴力枚举所有子集的回溯写法，本题正是用 DP 把它从 2^n 降到 n × target。
- 工程上"从一批数值里挑出总和恰好等于某值的组合"很常见，比如对账时找哪几笔流水凑成一个差额、按预算挑选资源，本质都是子集和问题。

## 一句话记忆

总和为偶数时转成 0-1 背包凑 `sum/2`：`dp[j] |= dp[j - x]`，容量倒序遍历。
