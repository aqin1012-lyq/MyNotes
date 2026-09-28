## 题意

给一个字符串 `s` 和一个单词列表 `wordDict`，判断 `s` 能否被完整切分成若干段，且每一段都是字典里的单词。字典里的单词可以重复使用，字典中没有重复单词。

```
输入：s = "redblue", wordDict = ["re","red","blue"]
输出：true
解释："red" + "blue"
```

```
输入：s = "sunsets", wordDict = ["sun","set","sunset"]
输出：false
解释："sun"+"set" 或 "sunset" 之后都剩下一个 "s"，无法匹配
```

## 思路

暴力：从头开始，尝试每一个是单词的前缀，剩下的后缀递归判断，最坏指数级（比如 `s = "aaaa...ab"`，字典是 `a, aa, aaa`）。重复点在于：同一个后缀会被不同的切法反复判断。

把问题改成"前缀能不能切"，看**最后一个单词**：如果 `s[0..i)` 能切，那么一定存在一个切分点 `j`，使 `s[0..j)` 能切且 `s[j..i)` 是字典里的单词。

- **dp 定义**：`dp[i]` = `s` 的前 `i` 个字符 `s[0..i)` 能否被切分。
- **转移**：`dp[i] = OR( dp[j] && dict.contains(s[j..i)) )`，`0 <= j < i`。
- **初始化**：`dp[0] = true`（空串可以被切分，是递推的起点）。
- **遍历顺序**：`i` 从 1 到 `n` 递增，内层枚举切分点 `j`；答案是 `dp[n]`。

:::tip 关键点
字典转成 HashSet 做 O(1) 查找；内层只需枚举长度不超过"最长单词"的最后一段，可以大幅剪枝。一旦 `dp[i]` 为 true 就 `break`。
:::

用 `s = "redblue"` 推演（`T` = true，`F` = false）：

```
i       0  1  2  3  4  5  6  7
s[i-1]  -  r  e  d  b  l  u  e
dp[i]   T  F  T  T  F  F  F  T
```

- `dp[2]`：`dp[0]` 且 `"re"` 在字典 → T
- `dp[3]`：`dp[0]` 且 `"red"` 在字典 → T
- `dp[7]`：`dp[3]` 且 `"blue"` 在字典 → T

`dp` 已经是一维，且 `dp[i]` 依赖所有更小的 `dp[j]`，不能再压缩成常数空间。

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean wordBreak(String s, List<String> wordDict) {
        Set<String> dict = new HashSet<>(wordDict);
        int maxLen = 0;
        for (String w : wordDict) maxLen = Math.max(maxLen, w.length());

        int n = s.length();
        boolean[] dp = new boolean[n + 1];
        dp[0] = true; // 空串可切分
        for (int i = 1; i <= n; i++) {
            // 最后一段 s[j..i)，长度不超过最长单词
            for (int j = i - 1; j >= Math.max(0, i - maxLen); j--) {
                if (dp[j] && dict.contains(s.substring(j, i))) {
                    dp[i] = true;
                    break; // 找到一种切法即可
                }
            }
        }
        return dp[n];
    }
}
```

## 复杂度

- 时间 O(n × L × L)：L 为最长单词长度；外层 n 个位置，内层最多 L 个切分点，每次 `substring` + 哈希 O(L)。不剪枝时是 O(n³)。
- 空间 O(n + 字典总长度)：dp 数组加 HashSet。

## 易错点

- 忘记 `dp[0] = true`，所有位置都会是 false。
- 下标区间：`dp[i]` 表示前 `i` 个字符，最后一段是 `s.substring(j, i)`（左闭右开），不是 `substring(j, i+1)`。
- 直接在 `List` 上 `contains` 是 O(字典大小)，要先转 HashSet。
- 贪心"每次匹配最长单词"会错：比如 `s = "aab", dict = ["aa","a","ab"]` 贪心取 `"aa"` 后剩 `"b"` 失败，但 `"a"+"ab"` 可以。
- 不加记忆化的 DFS 在 `"aaaa...ab"` 这类输入上会超时。

## 举一反三

- [[algo:coin-change]]：同样是"枚举最后一块"的一维 DP，硬币换成单词，最少个数换成可行性。
- [[algo:palindrome-partitioning]]：切分字符串的回溯版本，要求列出所有切法而不是判断可行性。
- [[algo:implement-trie-prefix-tree]]：字典很大时，可以用 Trie 从位置 `j` 往后走，一次遍历找出所有以 `j` 开头的单词，代替逐个 `substring` 查哈希。
- 工程上这就是**分词**的基础：中文分词的最大匹配法、搜索引擎对 query 做切词，都要解决"一段文本能否/如何切成词典里的词"。

## 一句话记忆

`dp[i]` 表示前 i 个字符能否切分，枚举最后一个单词 `s[j..i)`，`dp[0] = true`。
