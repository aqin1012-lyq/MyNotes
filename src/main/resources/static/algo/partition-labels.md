## 题意

给一个只含小写字母的字符串 `s`，把它切成尽可能多的连续片段，要求**每个字母只出现在其中一个片段里**。按顺序返回每个片段的长度。

```
输入：s = "abcabdxyxz"
输出：[5,1,3,1]
解释：切成 "abcab" | "d" | "xyx" | "z"，a、b、c 只在第一段，x 只在第三段
```

```
输入：s = "abc"
输出：[1,1,1]
```

## 思路

先想约束：如果字母 a 出现在某个片段里，那么 a 的**第一次和最后一次出现**之间的全部字符都必须在同一个片段里。也就是说，每个字母都对应一个区间 `[first, last]`，有重叠的区间必须合并到同一段，最后不重叠的块就是答案——这其实就是 [[algo:merge-intervals]]。

不用真的建区间。先扫一遍记下每个字母的最后出现位置 `last[c]`；再从左往右扫，维护当前片段"至少要延伸到"的位置 `end = max(end, last[s[i]])`。当 `i == end` 时，说明当前片段里所有字母的最后一次出现都已经包含在内，可以在这里切一刀；片段尽早切，数量就最多。

:::tip 关键点
两遍扫描：第一遍记每个字母最后出现的下标；第二遍用 `end = max(end, last[c])` 不断延伸当前片段，`i == end` 时切一刀。
:::

`s = "abcabdxyxz"` 推演（last: a=3, b=4, c=2, d=5, x=8, y=7, z=9）：

```
i  c  last[c] end  i==end?  切出
0  a  3       3    否
1  b  4       4    否
2  c  2       4    否
3  a  3       4    否
4  b  4       4    是       [0..4] 长度 5
5  d  5       5    是       [5..5] 长度 1
6  x  8       8    否
7  y  7       8    否
8  x  8       8    是       [6..8] 长度 3
9  z  9       9    是       [9..9] 长度 1
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<Integer> partitionLabels(String s) {
        // 第一遍：每个字母最后出现的位置
        int[] last = new int[26];
        for (int i = 0; i < s.length(); i++) {
            last[s.charAt(i) - 'a'] = i;
        }
        List<Integer> res = new ArrayList<>();
        int start = 0, end = 0;
        // 第二遍：不断延伸当前片段的右边界
        for (int i = 0; i < s.length(); i++) {
            end = Math.max(end, last[s.charAt(i) - 'a']);
            if (i == end) { // 当前片段内所有字母都不会再出现
                res.add(end - start + 1);
                start = i + 1;
            }
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n)：两次遍历。
- 空间 O(1)：`last` 数组固定 26 个元素（字符集大小 Σ，不随 n 增长）。

## 易错点

- `end` 要取 `max`：遇到一个最后位置更靠前的字母（如例子里的 c）不能把 `end` 缩回去。
- 切完一段后记得 `start = i + 1`，长度是 `end - start + 1`。
- 只看"当前字母的 last"就切刀是错的，必须等 `i` 走到**所有**已见字母的最远 last。
- 返回类型是 `List<Integer>`，不是 `int[]`。

## 举一反三

- [[algo:merge-intervals]]：本题本质是把每个字母的 `[first, last]` 区间合并后数长度。
- [[algo:jump-game]]、[[algo:jump-game-ii]]：同样是一边遍历一边维护"必须 / 能够到达的最远位置"。
- 工程上类似"把有依赖关系的任务切成互不交叉的批次"：同一个资源（字母）涉及的操作必须落在同一批里，批次越小并行度越高。

## 一句话记忆

先记每个字母最后出现的位置，再扫一遍用 `end = max(end, last[c])` 延伸，`i == end` 就切一刀。
