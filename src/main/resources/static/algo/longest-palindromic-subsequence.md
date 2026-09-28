## 题意

给一个字符串 `s`，求它最长的**回文子序列**的长度。子序列可以跳着取字符，但不能改变相对顺序（区别于必须连续的子串）。

```
输入：s = "abcacb"
输出：5
解释：取下标 1..5 的 "bcacb"
```

```
输入：s = "abca"
输出：3
解释："aba" 或 "aca"
```

## 思路

暴力枚举所有子序列是 O(2ⁿ)。观察回文的结构：一段区间 `[i, j]` 的最长回文子序列，只取决于两端字符和内部更小区间的答案——这就是**区间 DP**。

定义 `dp[i][j]` = `s[i..j]` 内最长回文子序列长度：

- `s[i] == s[j]`：两端可以同时作为回文的外壳，`dp[i][j] = dp[i+1][j-1] + 2`。
- 否则两端不可能同时用上，丢掉其中一个：`dp[i][j] = max(dp[i+1][j], dp[i][j-1])`。
- 基础：`dp[i][i] = 1`；`i > j` 的空区间为 0。

:::tip 关键点
区间 DP 的遍历顺序由依赖决定：`dp[i][j]` 依赖 `i+1`（下一行）和 `j-1`（左一列），所以 **i 从大到小、j 从 i+1 往大**。答案是 `dp[0][n-1]`。
:::

用 `s = "abca"` 填表（只填上三角）：

```
      j=0  j=1  j=2  j=3
i=0   1    1    1    3     a==a: dp[1][2]+2
i=1        1    1    1
i=2             1    1
i=3                  1
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int longestPalindromeSubseq(String s) {
        int n = s.length();
        int[][] dp = new int[n][n];
        // i 从后往前：dp[i][j] 依赖 dp[i+1][..]
        for (int i = n - 1; i >= 0; i--) {
            dp[i][i] = 1; // 单个字符本身是回文
            for (int j = i + 1; j < n; j++) {
                if (s.charAt(i) == s.charAt(j)) {
                    // 两端相同：一起作为外壳（j == i+1 时 dp[i+1][j-1] 是空区间，值为 0）
                    dp[i][j] = dp[i + 1][j - 1] + 2;
                } else {
                    // 两端不同：舍弃其中一端
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j - 1]);
                }
            }
        }
        return dp[0][n - 1];
    }
}
```

## 复杂度

- 时间 O(n²)：上三角共约 n²/2 个状态，每个 O(1)。
- 空间 O(n²)：二维表；由于只依赖下一行，可以压缩成两行或一维数组做到 O(n)。

## 易错点

- 遍历顺序写成 i 从小到大，会用到还没算出来的 `dp[i+1][*]`，结果全错。
- `j == i + 1` 且两字符相等时，`dp[i+1][j-1]` 是 `dp[i+1][i]`，属于下三角，Java 数组默认 0，恰好正确；换成别的语言或别的初始化要留意。
- 和[[algo:longest-palindromic-substring]]混淆：子串要求连续，不等时直接为 false；子序列不等时可以取 max 继续。
- 空串不需要处理（题目保证长度 ≥ 1），否则 `dp[0][n-1]` 会越界。

## 其他解法

转化为 LCS：一个序列是回文，等价于它同时是 `s` 和 `reverse(s)` 的公共子序列，所以答案就是 `LCS(s, reverse(s))`。复杂度同样 O(n²)，胜在可以直接复用 LCS 模板。

```java
import java.util.*;

class Solution {
    public int longestPalindromeSubseq(String s) {
        String t = new StringBuilder(s).reverse().toString();
        int n = s.length();
        // dp[i][j]：s 前 i 个字符与 t 前 j 个字符的 LCS 长度
        int[][] dp = new int[n + 1][n + 1];
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= n; j++) {
                if (s.charAt(i - 1) == t.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        return dp[n][n];
    }
}
```

## 举一反三

- [[algo:longest-common-subsequence]]：本题的"其他解法"就是它的直接应用，状态转移几乎一样。
- [[algo:longest-palindromic-substring]]：连续版本，常用中心扩展 O(n²) / O(1) 空间。
- [[algo:edit-distance]]：同为双串/区间类二维 DP，转移时比较两端字符。
- [[algo:palindrome-partitioning]]：先用区间 DP 预处理"是否回文"表，再回溯。

## 一句话记忆

区间 DP：两端相等就 +2 往里缩，不等就丢一端取 max，i 倒着、j 正着填。
