## 题意

给一个正整数 `numRows`，生成杨辉三角的前 `numRows` 行。每一行首尾都是 1，中间每个数等于它"左上方"和"正上方"两个数之和。返回 `List<List<Integer>>`，第 `i` 行（从 0 开始）有 `i+1` 个元素。

```
输入：numRows = 4
输出：[[1],[1,1],[1,2,1],[1,3,3,1]]
```

```
输入：numRows = 1
输出：[[1]]
```

## 思路

这题本身没有"暴力 vs 优化"的差别，关键是把规律翻译成清晰的 DP 表：每一行完全由上一行决定。

把三角形左对齐看成二维表：

- **dp 定义**：`dp[i][j]` = 第 `i` 行第 `j` 列的值（`0 <= j <= i`）。
- **转移**：`dp[i][j] = dp[i-1][j-1] + dp[i-1][j]`（`0 < j < i`）。
- **初始化**：每行两端 `dp[i][0] = dp[i][i] = 1`。
- **遍历顺序**：行 `i` 从上到下，因为第 `i` 行只依赖第 `i-1` 行；行内顺序随意。

:::tip 关键点
左对齐之后，"左上方"就是 `[i-1][j-1]`，"正上方"就是 `[i-1][j]`。题目要返回每一行，所以结果列表本身就是 dp 表，不需要额外空间。
:::

用 `numRows = 4` 填表（左对齐）：

```
      j=0  j=1  j=2  j=3
i=0    1
i=1    1    1
i=2    1    2    1
i=3    1    3    3    1
            ^ dp[3][1] = dp[2][0] + dp[2][1] = 1 + 2
```

**滚动数组**：如果只要第 `k` 行（LeetCode 119），可以只用一个一维数组，**从右往左**更新 `row[j] += row[j-1]`，这样用到的 `row[j-1]` 还是上一行的旧值，空间 O(k)。

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<Integer>> generate(int numRows) {
        List<List<Integer>> res = new ArrayList<>();
        for (int i = 0; i < numRows; i++) {
            List<Integer> row = new ArrayList<>(i + 1);
            for (int j = 0; j <= i; j++) {
                if (j == 0 || j == i) {
                    row.add(1); // 两端固定为 1
                } else {
                    List<Integer> up = res.get(i - 1);
                    // 左上方 + 正上方
                    row.add(up.get(j - 1) + up.get(j));
                }
            }
            res.add(row);
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(numRows²)：总元素个数是 1+2+…+numRows。
- 空间 O(1)：除了必须返回的结果外，没有额外空间。

## 易错点

- 每行两端要单独处理，否则 `j-1` 或 `j` 会越界（上一行只有 `i` 个元素，下标最大 `i-1`）。
- 一维滚动写法必须**从右往左**更新；从左往右会把刚算好的新值当成旧值用。
- 滚动写法往结果里加行时要 `new ArrayList<>(row)` 拷贝一份，否则所有行指向同一个对象，最后全变成最后一行。
- 行数较大时数值会超 int（下标为 34 的那一行，`C(34,17)` 已超过 int 上限），本题 `numRows <= 30` 不用担心。

## 其他解法

一维滚动：只维护一行，末尾补 1 后从右往左原地累加，每行拷贝一份放进结果。求单独某一行时这种写法最省空间。

```java
import java.util.*;

class Solution {
    public List<List<Integer>> generate(int numRows) {
        List<List<Integer>> res = new ArrayList<>();
        List<Integer> row = new ArrayList<>();
        for (int i = 0; i < numRows; i++) {
            row.add(1); // 新行末尾补 1
            // 从右往左：row[j-1] 仍是上一行的值
            for (int j = i - 1; j > 0; j--) {
                row.set(j, row.get(j) + row.get(j - 1));
            }
            res.add(new ArrayList<>(row)); // 必须拷贝
        }
        return res;
    }
}
```

## 举一反三

- [[algo:unique-paths]]：同样是"当前格 = 上方 + 左方"，而且答案本身就是杨辉三角里的组合数。
- [[algo:partition-equal-subset-sum]]：一维滚动时倒序遍历的原因和这里完全一样——保证读到的是上一轮的旧值。

## 一句话记忆

左对齐后 `dp[i][j] = dp[i-1][j-1] + dp[i-1][j]`，两端为 1；一维滚动就从右往左加。
