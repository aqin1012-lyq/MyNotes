## 题意

给两个字符串 `haystack`（主串）和 `needle`（模式串），返回 `needle` 在 `haystack` 中第一次出现的起始下标；找不到返回 -1。相当于自己实现 `String.indexOf`，这里重点练 KMP。

```
输入：haystack = "abababca", needle = "ababca"
输出：2
```

```
输入：haystack = "hello", needle = "xyz"
输出：-1
```

## 思路

暴力：枚举主串每个起点，逐字符比对，失配就起点 +1、模式串从头再来，最坏 O(n·m)（如主串 `aaaa...ab`、模式 `aaab`）。

浪费在哪？失配时，前面已经匹配成功的那段字符我们其实"看过了"，却把主串指针退回去重来。KMP 的做法是**主串指针永不回退**，只移动模式串指针：已匹配的 `needle[0..j-1]` 如果有一段"既是前缀又是后缀"的部分，那么失配后模式串可以直接跳到这段前缀之后继续比。

预处理数组 `next[i]`：`needle[0..i]` 的**最长相等真前后缀长度**。失配时 `j = next[j-1]`，一路回退直到能匹配或 j 为 0。构造 next 的过程本身就是"模式串自己和自己做 KMP"。

:::tip 关键点
next[i] = needle[0..i] 最长相等前后缀的长度；匹配与建表是同一套代码：失配就 `j = next[j-1]` 回退，相等就 `j++`。主串指针 i 只增不减，所以是 O(n + m)。
:::

needle = "ababca" 的 next 表：

```
i      0  1  2  3  4  5
char   a  b  a  b  c  a
next   0  0  1  2  0  1
```

匹配过程：前 4 个字符 `abab` 匹配后，主串 i=4 的 `a` 与 needle[4]=`c` 失配，j 回退到 next[3]=2，相当于把模式串右移两位，复用已匹配的 `ab`：

```
主串   a b a b a b c a
第一次 a b a b c            i=4 失配
右移后     a b a b c a      j=2 继续，i 不回退
结果       ^ 下标 2
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int strStr(String haystack, String needle) {
        int n = haystack.length(), m = needle.length();
        if (m == 0) return 0;
        int[] next = buildNext(needle);
        for (int i = 0, j = 0; i < n; i++) {
            // 失配：模式串指针按 next 回退，主串指针不动
            while (j > 0 && haystack.charAt(i) != needle.charAt(j)) {
                j = next[j - 1];
            }
            if (haystack.charAt(i) == needle.charAt(j)) j++;
            if (j == m) return i - m + 1; // 完整匹配
        }
        return -1;
    }

    // next[i]：needle[0..i] 的最长相等真前后缀长度
    private int[] buildNext(String p) {
        int[] next = new int[p.length()];
        for (int i = 1, j = 0; i < p.length(); i++) {
            while (j > 0 && p.charAt(i) != p.charAt(j)) {
                j = next[j - 1];
            }
            if (p.charAt(i) == p.charAt(j)) j++;
            next[i] = j;
        }
        return next;
    }
}
```

## 复杂度

- 时间 O(n + m)：建表 O(m)，匹配 O(n)。每次 `j++` 最多 n 次，而 while 回退每次让 j 至少减 1，总回退次数不超过总增加次数，均摊线性。
- 空间 O(m)：next 数组。

## 易错点

- 建表时 i 从 1 开始（`next[0]` 恒为 0），j 从 0 开始；如果 i 也从 0 开始，会得到 `next[0] = 1` 的错误结果。
- 回退写成 `j = next[j]` 是常见 bug，正确的是 `j = next[j - 1]`（看的是已匹配部分 `[0..j-1]` 的最长前后缀）。
- 回退要用 `while` 不是 `if`：可能需要连续回退多次。
- 找到后返回 `i - m + 1`，此时 i 指向匹配段最后一个字符。
- 不同教材的 next 数组定义不一样（有的整体右移一位、首位 -1），面试时先说清楚自己用的定义。

## 其他解法

暴力双重循环：面试里可以先写出来作为对照，平均情况其实很快（`String.indexOf` 就是类似思路），最坏 O(n·m)。

```java
import java.util.*;

class Solution {
    public int strStr(String haystack, String needle) {
        int n = haystack.length(), m = needle.length();
        for (int start = 0; start + m <= n; start++) {
            int k = 0;
            // 逐字符比较，失配就换下一个起点
            while (k < m && haystack.charAt(start + k) == needle.charAt(k)) k++;
            if (k == m) return start;
        }
        return -1;
    }
}
```

## 举一反三

- [[algo:find-all-anagrams-in-a-string]]：同样是在主串中找模式，但比较的是字符计数，用滑动窗口。
- [[algo:longest-palindromic-substring]]：另一道经典字符串题，用中心扩展。
- [[algo:sensitive-word-filter]]：多模式串匹配，Trie 上加 KMP 式的失配指针就是 AC 自动机。
- JDK 的 `String.indexOf` 用的是朴素匹配（常见场景下更快、常数小）；grep、文本编辑器的查找则常用 Boyer-Moore 一类算法。

## 一句话记忆

next 记最长相等前后缀，失配时 `j = next[j-1]`，主串指针永不回头。
