## 题意

给两个只含小写字母的字符串 `s` 和 `p`，在 `s` 中找出所有长度等于 `p.length()`、并且是 `p` 的字母异位词（字母种类和次数完全相同）的子串，返回这些子串的起始下标，顺序不限。

```
输入：s = "dcabacbd", p = "abc"
输出：[1,3,4]
解释：下标 1 起 "cab"，下标 3 起 "bac"，下标 4 起 "acb"
```

```
输入：s = "xyxyx", p = "xy"
输出：[0,1,2,3]
```

## 思路

暴力：对 `s` 的每个长度为 m 的子串，排序后和排好序的 `p` 比较，O(n · m log m)；或者每个子串都重新计数 O(n · m)。

瓶颈：相邻两个窗口只差"左边出去一个字符、右边进来一个字符"，重新统计是浪费。用**固定长度的滑动窗口**：维护窗口内 26 个字母的计数，每移动一步只改两个计数。

判断"窗口计数 == p 的计数"：直接比较两个 `int[26]` 是 O(26)，已经足够好；更进一步可以维护一个 `diff` 变量，记录有多少个字母的计数还不相等，`diff == 0` 即命中，每步 O(1)。

:::tip 关键点
异位词 = 字母计数相同。长度固定的窗口每次只进一个、出一个，所以只需增量更新计数，而不是重新统计。
:::

推演 `s = "dcabacbd", p = "abc"`（只列 a/b/c/d 的计数，need = a1 b1 c1 d0）：

```
window  start  a b c d   match?
dca     0      1 0 1 1   no
cab     1      1 1 1 0   yes -> 1
aba     2      2 1 0 0   no
bac     3      1 1 1 0   yes -> 3
acb     4      1 1 1 0   yes -> 4
cbd     5      0 1 1 1   no
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<Integer> findAnagrams(String s, String p) {
        List<Integer> res = new ArrayList<>();
        int n = s.length(), m = p.length();
        if (n < m) return res;
        // cnt[c] = 窗口中 c 的个数 - p 中 c 的个数
        int[] cnt = new int[26];
        for (int i = 0; i < m; i++) {
            cnt[p.charAt(i) - 'a']--;
            cnt[s.charAt(i) - 'a']++;
        }
        // diff = 计数不为 0 的字母种数，为 0 说明窗口是异位词
        int diff = 0;
        for (int x : cnt) if (x != 0) diff++;
        if (diff == 0) res.add(0);
        for (int r = m; r < n; r++) {
            // 右边进一个字符
            int in = s.charAt(r) - 'a';
            if (cnt[in] == 0) diff++;
            cnt[in]++;
            if (cnt[in] == 0) diff--;
            // 左边出一个字符
            int out = s.charAt(r - m) - 'a';
            if (cnt[out] == 0) diff++;
            cnt[out]--;
            if (cnt[out] == 0) diff--;
            if (diff == 0) res.add(r - m + 1);
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n + m + 26)：初始化 O(m + 26)，之后每步 O(1)。
- 空间 O(26) = O(1)：不计返回结果。

## 易错点

- `s` 比 `p` 短时要直接返回空列表，否则初始化窗口会越界。
- 维护 `diff` 时，"变化前是否为 0"和"变化后是否为 0"都要检查，漏一个就会计数错乱。
- 结果下标是窗口**起点** `r - m + 1`，不是 `r`。
- 第一个窗口（起点 0）要在循环外单独判断，别漏掉。

## 其他解法

更直观的写法：两个 `int[26]` 数组，每次滑动后用 `Arrays.equals` 比较，每步 O(26)，面试时先写这个也完全可以。

```java
import java.util.*;

class Solution {
    public List<Integer> findAnagrams(String s, String p) {
        List<Integer> res = new ArrayList<>();
        int n = s.length(), m = p.length();
        if (n < m) return res;
        int[] need = new int[26], win = new int[26];
        for (int i = 0; i < m; i++) {
            need[p.charAt(i) - 'a']++;
            win[s.charAt(i) - 'a']++;
        }
        if (Arrays.equals(need, win)) res.add(0);
        for (int r = m; r < n; r++) {
            win[s.charAt(r) - 'a']++;      // 进
            win[s.charAt(r - m) - 'a']--;  // 出
            if (Arrays.equals(need, win)) res.add(r - m + 1);
        }
        return res;
    }
}
```

## 举一反三

- [[algo:group-anagrams]]：同样用字母计数刻画异位词。
- [[algo:minimum-window-substring]]：可变长度窗口 + 计数，"覆盖"而不是"恰好相等"。
- [[algo:longest-substring-without-repeating-characters]]：可变长度滑动窗口的入门题。

## 一句话记忆

长度固定为 |p| 的窗口在 s 上滑，每步进一出一更新 26 个计数，计数全等就记录起点。
