## 题意

给一个字符串 `s`，返回它最长的**回文子串**（连续的一段，正读反读相同）。如果有多个同样长的，返回任意一个即可。`1 <= s.length <= 1000`，只含数字和英文字母。

```
输入：s = "xabacd"
输出："aba"
```

```
输入：s = "cbbe"
输出："bb"
解释：偶数长度的回文，中心在两个 b 之间
```

## 思路

暴力做法：枚举所有 O(n²) 个子串，每个用 O(n) 判断是否回文，总共 O(n³)。瓶颈在于判断回文时做了大量重复工作：判断 `s[i..j]` 时，其实 `s[i+1..j-1]` 是否回文早就判断过了。

**区间 DP**：

- **dp 定义**：`dp[i][j]` = 子串 `s[i..j]` 是否回文（boolean）。
- **转移**：`dp[i][j] = (s[i] == s[j]) && (j - i < 3 || dp[i+1][j-1])`。两端字符相同，且去掉两端后的内部也是回文；长度 ≤ 3 时去掉两端只剩 0 或 1 个字符，必然回文。
- **初始化**：单个字符 `dp[i][i] = true`（被 `j - i < 3` 自然覆盖）。
- **遍历顺序**：`dp[i][j]` 依赖**左下方**的 `dp[i+1][j-1]`，所以 `i` 要**从大到小**，`j` 从 `i` 往右；或者按子串长度从小到大枚举。

DP 的空间是 O(n²)。更省的做法是**中心扩展**：回文一定关于某个中心对称，中心要么是一个字符（奇数长度），要么是两个字符之间的缝（偶数长度），一共 `2n-1` 个中心。从每个中心向两边扩，直到两端不相等。时间同样 O(n²)，空间 O(1)，面试首选。

:::tip 关键点
区间 DP 的正确性在于"外层回文 ⇔ 两端相等 + 内层回文"，所以必须先算短区间再算长区间，`i` 倒序正是为了这个。中心扩展则是同一个事实的另一种用法：从内层回文出发往外"长"，一旦两端不等就可以停，因为再往外包的子串都以它为内层，不可能是回文。
:::

用 `s = "xabacd"` 推演 DP 表（只画上三角，T=回文）：

```
       j: 0x  1a  2b  3a  4c  5d
i=0 x     T   .   .   .   .   .
i=1 a         T   .   T   .   .
i=2 b             T   .   .   .
i=3 a                 T   .   .
i=4 c                     T   .
i=5 d                         T
```

`dp[1][3]`：`s[1]='a' == s[3]='a'`，且 `j-i = 2 < 3`，为 T，长度 3，得到 `"aba"`。`dp[0][4]`：`'x' != 'c'`，为 F。

中心扩展对 `"xabacd"`，以下标 2（`'b'`）为中心：`l=1,r=3` 都是 `'a'`，继续；`l=0,r=4` 是 `'x'` 和 `'c'`，停止，得到 `[1,3]`。

## Java 题解

```java
import java.util.*;

class Solution {
    public String longestPalindrome(String s) {
        int start = 0, maxLen = 1;
        for (int c = 0; c < s.length(); c++) {
            // 奇数长度：以 c 为中心；偶数长度：以 c 和 c+1 之间为中心
            int len1 = expand(s, c, c);
            int len2 = expand(s, c, c + 1);
            int len = Math.max(len1, len2);
            if (len > maxLen) {
                maxLen = len;
                // 由中心和长度反推起点，奇偶统一
                start = c - (len - 1) / 2;
            }
        }
        return s.substring(start, start + maxLen);
    }

    // 从 [l, r] 向两边扩，返回能扩到的最长回文长度
    private int expand(String s, int l, int r) {
        while (l >= 0 && r < s.length() && s.charAt(l) == s.charAt(r)) {
            l--;
            r++;
        }
        // 退出时 l、r 各多走了一步，真实区间是 [l+1, r-1]
        return r - l - 1;
    }
}
```

## 复杂度

- 时间 O(n²)：`2n-1` 个中心，每个最多扩 O(n) 步。
- 空间 O(1)：只用几个下标变量（区间 DP 版本是 O(n²)）。

## 易错点

- 只做奇数中心会漏掉 `"bb"` 这种偶数回文，两种中心都要试。
- `expand` 退出时 `l`、`r` 已经越过了回文边界，长度是 `r - l - 1` 而不是 `r - l + 1`。
- 起点公式 `c - (len - 1) / 2` 对奇偶都成立，可以拿 `"bb"`（c=0, len=2 → start=0）和 `"aba"`（c=1, len=3 → start=0）自己验证一下，别凭感觉写成 `c - len / 2`。
- 区间 DP 如果 `i` 正序遍历，算 `dp[i][j]` 时 `dp[i+1][j-1]` 还没算，结果全错。
- 注意是**子串**（连续），不是子序列；最长回文子序列是另一道 DP。

## 其他解法

区间 DP：`i` 从右往左、`j` 从 `i` 往右，保证 `dp[i+1][j-1]` 已经就绪。

```java
import java.util.*;

class Solution {
    public String longestPalindrome(String s) {
        int n = s.length();
        // dp[i][j]：s[i..j] 是否回文
        boolean[][] dp = new boolean[n][n];
        int start = 0, maxLen = 1;
        // i 倒序：dp[i][j] 依赖左下角的 dp[i+1][j-1]
        for (int i = n - 1; i >= 0; i--) {
            for (int j = i; j < n; j++) {
                // 两端相等，且内部长度 <= 1 或内部本身是回文
                if (s.charAt(i) == s.charAt(j) && (j - i < 3 || dp[i + 1][j - 1])) {
                    dp[i][j] = true;
                    if (j - i + 1 > maxLen) {
                        maxLen = j - i + 1;
                        start = i;
                    }
                }
            }
        }
        return s.substring(start, start + maxLen);
    }
}
```

另外还有 O(n) 的 Manacher 算法，面试一般不要求手写，知道名字和"利用已知回文的对称性跳过重复扩展"的思想即可。

## 举一反三

- [[algo:palindrome-partitioning]]：先用同样的区间 DP 预处理 `isPal[i][j]`，再回溯切分。
- [[algo:longest-common-subsequence]]：另一种经典二维 DP，区别在于它是两个串的前缀，不是一个串的区间。
- [[algo:palindrome-linked-list]]：同样是回文判断，换成链表后用快慢指针 + 反转后半段。

## 一句话记忆

回文由中心往外长：枚举 2n-1 个中心向两边扩；DP 写法是"两端相等 + 内部回文"，i 倒序填表。
