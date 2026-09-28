## 题意

给字符串 `s` 和 `t`，在 `s` 中找一个最短的连续子串，使它包含 `t` 里的所有字符（**包括重复次数**，比如 t 有两个 a，子串里也至少要有两个 a）。找不到返回空串 `""`。题目保证答案唯一。字符为大小写英文字母。

```
输入：s = "QBAXBYAB", t = "ABB"
输出："BAXB"
解释：需要至少 1 个 A、2 个 B；最短的是下标 1 到 4 的 "BAXB"
```

```
输入：s = "ab", t = "aa"
输出：""
解释：s 里只有一个 a，不可能覆盖
```

## 思路

暴力：枚举所有子串，逐个检查是否覆盖 t，O(n² · Σ) 甚至更高。

滑动窗口的经典模板，适用于"求满足条件的最短连续区间"：

1. 右指针 `r` 不断扩张，把字符纳入窗口；
2. 一旦窗口满足条件（覆盖了 t），就尝试收缩左指针 `l`，每收缩一步都更新答案，直到窗口不再满足条件；
3. 然后继续扩张右边。

判断"是否覆盖"如果每次都比较 52 个计数会慢一些。技巧：用 `need[c]` 表示窗口还欠 c 多少个，`missing` 表示还欠的字符总数。字符进窗口时，若 `need[c] > 0` 说明它是"有用的"，`missing--`；`need[c]` 统一减 1（可以变成负数，表示多余）。`missing == 0` 即覆盖。出窗口时反过来。

:::tip 关键点
扩张右边直到"可行"，收缩左边直到"刚好不可行"，在可行的每一步记录最短。`need` 允许为负，负数表示窗口里这个字符有富余，移出它不会破坏覆盖。
:::

推演 `s = "QBAXBYAB", t = "ABB"`，初始 need = {A:1, B:2}，missing = 3：

```
r  c  missing  need(A,B)  action
0  Q  3        1, 2
1  B  2        1, 1       useful
2  A  1        0, 1       useful
3  X  1        0, 1
4  B  0        0, 0       covered: [0,4] QBAXB
                          drop Q -> [1,4] BAXB len 4  best
                          drop B -> missing 1, stop
5  Y  1        0, 1
6  A  1        -1, 1      extra A
7  B  0        -1, 0      covered: [2,7] AXBYAB
                          drop A -> need A 0, [3,7] XBYAB
                          drop X -> [4,7] BYAB len 4, not shorter
                          drop B -> missing 1, stop
answer = s[1..4] = "BAXB"
```

## Java 题解

```java
import java.util.*;

class Solution {
    public String minWindow(String s, String t) {
        if (s.length() < t.length()) return "";
        // need[c] > 0：窗口还欠 c 这么多个；< 0：窗口里 c 有富余
        int[] need = new int[128];
        for (char c : t.toCharArray()) need[c]++;
        int missing = t.length();          // 还欠的字符总数
        int bestL = 0, bestLen = Integer.MAX_VALUE;
        int l = 0;
        for (int r = 0; r < s.length(); r++) {
            char c = s.charAt(r);
            if (need[c] > 0) missing--;    // 有用的字符，欠账减少
            need[c]--;
            // 已覆盖：不断收缩左边，每一步都是一个候选答案
            while (missing == 0) {
                if (r - l + 1 < bestLen) {
                    bestLen = r - l + 1;
                    bestL = l;
                }
                char d = s.charAt(l++);
                need[d]++;
                if (need[d] > 0) missing++; // 移出了必需的字符，不再覆盖
            }
        }
        return bestLen == Integer.MAX_VALUE ? "" : s.substring(bestL, bestL + bestLen);
    }
}
```

## 复杂度

- 时间 O(|s| + |t|)：l 和 r 都只向右走，各最多 |s| 步。
- 空间 O(Σ)：计数数组大小固定为 128。

## 易错点

- `t` 里有重复字符时，必须按**次数**覆盖，不能用 Set 只看种类。
- `missing` 只在"有用的"字符进出时变化：进窗口时判断 `need[c] > 0`（减之前），出窗口时判断 `need[d] > 0`（加之后），顺序反了就错。
- 答案要在 while 循环**里**更新（窗口可行时），不是在收缩结束后。
- 用 `bestLen == Integer.MAX_VALUE` 判断无解，别拿 0 当初始值。
- 大小写字母都有，数组开 128（或 52 并换算），开 26 会越界。

## 举一反三

- [[algo:longest-substring-without-repeating-characters]]：可变窗口求"最长"，在扩张时更新答案；本题求"最短"，在收缩时更新答案。
- [[algo:find-all-anagrams-in-a-string]]：固定长度窗口 + 计数。
- [[algo:subarray-sum-equals-k]]：同样是求子数组，但有负数时窗口失效，要换前缀和，注意区分适用条件。

## 一句话记忆

右扩到覆盖，左缩到刚好不覆盖，收缩过程中记最短；用 need 数组 + missing 计数 O(1) 判断覆盖。
