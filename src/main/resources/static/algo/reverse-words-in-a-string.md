## 题意

给一个字符串 `s`，由单词和空格组成（单词是连续的非空格字符）。把单词的顺序整体倒过来，返回新字符串。输入可能有前导、尾随空格，单词之间也可能有多个空格；输出中单词之间只保留一个空格，首尾不能有空格。

```
输入：s = "  hello   java world "
输出："world java hello"
```

```
输入：s = "one"
输出："one"
```

## 思路

最省事的写法是 `s.trim().split("\\s+")` 然后倒序拼接，面试官通常会追问"不用库函数怎么写"。

手写思路：**从后往前扫**。指针 `i` 从末尾出发，先跳过空格；停在某个单词的最后一个字符，记为 `end`；再继续往左走到单词开头前一个位置，`s[i+1..end]` 就是一个完整单词，直接追加到结果里。因为是从后往前取词，追加顺序天然就是反转后的顺序。

:::tip 关键点
倒着扫、先跳空格再截单词；只在"追加第二个及以后的单词"前补一个空格，这样首尾和中间多余空格都自动消失。
:::

用 `"  hello   java world "` 推演（从右往左）：

```
步骤  跳过空格后 end  取到的单词  结果
1     19            world       "world"
2     13            java        "world java"
3     6             hello       "world java hello"
4     i < 0 结束
```

## Java 题解

```java
import java.util.*;

class Solution {
    public String reverseWords(String s) {
        StringBuilder sb = new StringBuilder();
        int i = s.length() - 1;
        while (i >= 0) {
            // 跳过单词之间 / 末尾的空格
            while (i >= 0 && s.charAt(i) == ' ') i--;
            if (i < 0) break; // 剩下全是空格
            int end = i;
            // 找到单词开头的前一个位置
            while (i >= 0 && s.charAt(i) != ' ') i--;
            if (sb.length() > 0) sb.append(' '); // 非第一个单词前补一个空格
            sb.append(s, i + 1, end + 1);
        }
        return sb.toString();
    }
}
```

## 复杂度

- 时间 O(n)：每个字符最多被 i 扫过一次，`append` 也是线性的。
- 空间 O(n)：结果字符串本身；除此之外只用了几个指针。

## 易错点

- 忘了处理前导/尾随空格，结果首尾多出空格；或者中间多个空格被原样保留。
- 用 `split(" ")` 时连续空格会切出空字符串 `""`，要先 `trim()` 并用正则 `"\\s+"`，或者手动过滤空串。
- 截取单词用 `s[i+1 .. end]`：内层 while 结束时 i 停在单词前一个位置（可能是 -1）。
- 每次 `sb.insert(0, word)` 往头部插入会退化成 O(n²)，倒序扫描再 append 才是线性的。

## 其他解法

"整体反转 + 逐词反转"：把字符数组先去掉多余空格，再整体反转，最后把每个单词各自反转回来。在字符可变的语言（C++ 的 string）里可以做到 O(1) 额外空间，是经典的原地思路；Java 的 String 不可变，只能在 `char[]` 上做。

```java
import java.util.*;

class Solution {
    public String reverseWords(String s) {
        char[] a = s.toCharArray();
        // 1. 去掉多余空格，压缩到数组前部，len 为有效长度
        int len = 0;
        for (int i = 0; i < a.length; i++) {
            if (a[i] != ' ') {
                if (len > 0) a[len++] = ' '; // 单词之间补一个空格
                while (i < a.length && a[i] != ' ') a[len++] = a[i++];
            }
        }
        // 2. 整体反转
        reverse(a, 0, len - 1);
        // 3. 逐个单词再反转回来
        for (int start = 0, i = 0; i <= len; i++) {
            if (i == len || a[i] == ' ') {
                reverse(a, start, i - 1);
                start = i + 1;
            }
        }
        return new String(a, 0, len);
    }

    private void reverse(char[] a, int l, int r) {
        while (l < r) {
            char t = a[l];
            a[l++] = a[r];
            a[r--] = t;
        }
    }
}
```

## 举一反三

- [[algo:rotate-array]]：同样是"整体反转 + 局部反转"的三次反转技巧。
- [[algo:string-to-integer-atoi]]：同类的"手写字符串解析"，要小心空格与边界。
- [[algo:decode-string]]：更复杂的字符串扫描与拼接。
- 工程上 `StringBuilder` 的 `append(CharSequence, start, end)` 能避免 `substring` 产生中间字符串，处理日志、拼接大文本时值得用。

## 一句话记忆

从后往前扫：跳空格、截单词、非首词前补一个空格。
