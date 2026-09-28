## 题意

给两个字符串 `text1` 和 `text2`，求它们**最长公共子序列**的长度。子序列是从原串中删掉若干字符（可以不删）、剩余字符保持原有顺序得到的串，不要求连续。没有公共子序列时返回 0。两个串长度都在 1000 以内，只含小写字母。

```
输入：text1 = "acbd", text2 = "abcd"
输出：3
解释："abd" 和 "acd" 都是长度 3 的公共子序列
```

```
输入：text1 = "xyz", text2 = "abc"
输出：0
```

## 思路

暴力做法是枚举 `text1` 的全部 2^m 个子序列，逐个检查是不是 `text2` 的子序列，指数级。换个角度：只看两个串的**末尾字符**就能把问题缩小。

- 如果 `text1` 的最后一个字符等于 `text2` 的最后一个字符，那它一定可以作为 LCS 的最后一个字符，问题变成两个串各去掉末尾。
- 如果不相等，那两者至少有一个不在 LCS 的末尾，分别试"去掉 `text1` 末尾"和"去掉 `text2` 末尾"，取较大。

于是：

- **dp 定义**：`dp[i][j]` = `text1` 的前 `i` 个字符与 `text2` 的前 `j` 个字符的 LCS 长度（注意是"前 i 个"，下标偏移 1）。
- **转移**：若 `text1[i-1] == text2[j-1]`，`dp[i][j] = dp[i-1][j-1] + 1`；否则 `dp[i][j] = max(dp[i-1][j], dp[i][j-1])`。
- **初始化**：`dp[0][*] = dp[*][0] = 0`，空串与任何串的 LCS 为 0。多开一行一列正是为了省掉边界判断。
- **遍历顺序**：`i` 从 1 到 m，`j` 从 1 到 n，依赖上、左、左上三个格子。

:::tip 关键点
为什么字符相等时可以放心取 `dp[i-1][j-1] + 1`，不用再和 `dp[i-1][j]`、`dp[i][j-1]` 比？因为任何一个不用这对末尾字符的公共子序列，都可以把它的最后一个字符换成这对相等字符（或者直接接上），长度不会变差，所以"匹配末尾"永远不亏。这是一个交换论证，面试时能说出来很加分。
:::

用 `text1 = "acbd"`（行）、`text2 = "abcd"`（列）推演，第 0 行 / 第 0 列是空串：

```
         ""  a   b   c   d
    ""    0  0   0   0   0
    a     0  1   1   1   1
    c     0  1   1   2   2
    b     0  1   2   2   2
    d     0  1   2   2   3
```

- `dp[2][3]`（"ac" vs "abc"）：`c == c`，取左上 `dp[1][2] = 1` 加 1，得 2。
- `dp[3][2]`（"acb" vs "ab"）：`b == b`，左上 `dp[2][1] = 1` 加 1，得 2。
- `dp[4][4]`：`d == d`，左上 `dp[3][3] = 2` 加 1，得 3。

## Java 题解

```java
import java.util.*;

class Solution {
    public int longestCommonSubsequence(String text1, String text2) {
        int m = text1.length(), n = text2.length();
        // dp[i][j]：text1 前 i 个字符与 text2 前 j 个字符的 LCS 长度
        // 多开一行一列，第 0 行/列表示空串，天然为 0
        int[][] dp = new int[m + 1][n + 1];
        for (int i = 1; i <= m; i++) {
            char c1 = text1.charAt(i - 1);
            for (int j = 1; j <= n; j++) {
                if (c1 == text2.charAt(j - 1)) {
                    // 末尾相等：一起纳入 LCS
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    // 末尾不等：丢掉其中一个的末尾，取较优
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        return dp[m][n];
    }
}
```

## 复杂度

- 时间 O(m·n)：表里每格 O(1)。
- 空间 O(m·n)：二维表；可压到 O(min(m, n))，见下方其他解法。

## 易错点

- dp 下标和字符串下标差 1：`dp[i][j]` 对应的是 `text1.charAt(i-1)` 和 `text2.charAt(j-1)`，最容易写错。
- 相等时是**左上** `dp[i-1][j-1] + 1`，不是 `max(上, 左) + 1`，后者会把同一个字符重复计数（例如 "a" 与 "aa" 会算出 2）。
- 子序列不要求连续；如果题目改成"最长公共子**串**"，不相等时要置 0，答案取全表最大值。
- 压成一维时，左上角的值会被本行覆盖，需要用一个变量提前保存。

## 其他解法

一维滚动数组：`dp[j]` 在更新前是"上方"，`dp[j-1]` 是"左方"，"左上"需要用 `prev` 暂存上一轮被覆盖前的 `dp[j-1]`。

```java
import java.util.*;

class Solution {
    public int longestCommonSubsequence(String text1, String text2) {
        int m = text1.length(), n = text2.length();
        int[] dp = new int[n + 1];
        for (int i = 1; i <= m; i++) {
            // prev 保存左上角 dp[i-1][j-1]，每行开始时是 dp[i-1][0] = 0
            int prev = 0;
            for (int j = 1; j <= n; j++) {
                // 覆盖前先存下 dp[i-1][j]，它是下一格的左上角
                int tmp = dp[j];
                if (text1.charAt(i - 1) == text2.charAt(j - 1)) {
                    dp[j] = prev + 1;
                } else {
                    dp[j] = Math.max(dp[j], dp[j - 1]);
                }
                prev = tmp;
            }
        }
        return dp[n];
    }
}
```

## 举一反三

- [[algo:edit-distance]]：同样是两个串的前缀 DP，同样看上、左、左上，只是从"求最长"变成"求最少操作"。
- [[algo:longest-increasing-subsequence]]：单序列的子序列 DP，可以对比理解"子序列"类状态怎么定义。
- [[algo:longest-palindromic-substring]]：单串区间 DP，与"两串前缀 DP"是另一种二维形态。
- 工程联系：`git diff` / `diff` 工具的核心就是求两个文件行序列的 LCS（或最短编辑脚本），公共部分之外的就是增删行。

## 一句话记忆

比较两串末尾：相等就左上 +1，不等就 max(上, 左)；多开一行一列当空串。
