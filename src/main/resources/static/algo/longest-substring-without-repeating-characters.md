## 题意

给一个字符串 `s`，求其中不含重复字符的**连续**子串的最大长度。字符可能是字母、数字、符号或空格。

```
输入：s = "abcbdea"
输出：5
解释："cbdea" 里没有重复字符，长度 5
```

```
输入：s = "tttt"
输出：1
```

## 思路

暴力：枚举所有起点和终点，再检查子串是否有重复，O(n³)；边扩展边用 Set 检查可以做到 O(n²)。

瓶颈：起点每右移一位，都从头重新扩展，大量重复工作。观察到：如果 `s[i..j]` 没有重复，那 `s[i+1..j]` 也一定没有重复。所以右端点不必回退，只需要让左端点在"出现重复时"向右跳——这就是**滑动窗口**。

更进一步，用 HashMap 记录每个字符**最后一次出现的下标**。当 `s[r]` 在窗口内出现过（下标 ≥ l），直接把 `l` 跳到那个下标 + 1，不用一步步挪。

:::tip 关键点
窗口 `[l, r]` 始终无重复。`l = max(l, last[c] + 1)` 里的 `max` 很关键：上次出现的位置可能已经在窗口左边了，不能让 l 往回退。
:::

推演 `"abcbdea"`：

```
r  c  last[c]  l(after)  window   len
0  a  -        0         a        1
1  b  -        0         ab       2
2  c  -        0         abc      3
3  b  1        2         cb       2
4  d  -        2         cbd      3
5  e  -        2         cbde     4
6  a  0        2         cbdea    5
best = 5
```

注意 r=6 时 `a` 上次出现在 0，已经在窗口左侧，`max` 保证 l 保持为 2。

## Java 题解

```java
import java.util.*;

class Solution {
    public int lengthOfLongestSubstring(String s) {
        // 字符 -> 最后一次出现的下标
        Map<Character, Integer> last = new HashMap<>();
        int best = 0, l = 0;
        for (int r = 0; r < s.length(); r++) {
            char c = s.charAt(r);
            Integer prev = last.get(c);
            if (prev != null) {
                // 只能往右跳，旧位置在窗口外时不影响
                l = Math.max(l, prev + 1);
            }
            last.put(c, r);
            best = Math.max(best, r - l + 1);
        }
        return best;
    }
}
```

## 复杂度

- 时间 O(n)：r 扫一遍，l 只会右移，每步 O(1)。
- 空间 O(min(n, Σ))：Σ 为字符集大小，map 最多存 Σ 个字符。

## 易错点

- 忘了 `Math.max(l, ...)`：如 `"abba"`，r=3 时 `a` 上次在 0，若直接 `l = 1` 会让窗口退回去包含两个 b，答案错成 3（正确是 2）。
- 长度是 `r - l + 1`，别少加 1。
- 空串要返回 0。
- 字符集不只是小写字母（可能有空格、数字），用 `int[26]` 会越界；可以用 `int[128]` 覆盖 ASCII 或直接用 HashMap。

## 其他解法

经典收缩写法：用 Set 维护窗口，出现重复就不断从左边移除，直到不重复为止。更贴近滑动窗口通用模板。

```java
import java.util.*;

class Solution {
    public int lengthOfLongestSubstring(String s) {
        Set<Character> window = new HashSet<>();
        int best = 0, l = 0;
        for (int r = 0; r < s.length(); r++) {
            char c = s.charAt(r);
            // 窗口里已经有 c，就从左边一个个移除，直到把旧的 c 移出去
            while (window.contains(c)) {
                window.remove(s.charAt(l));
                l++;
            }
            window.add(c);
            best = Math.max(best, r - l + 1);
        }
        return best;
    }
}
```

## 举一反三

- [[algo:minimum-window-substring]]：同样的滑动窗口，但求"满足条件的最短"窗口。
- [[algo:find-all-anagrams-in-a-string]]：固定长度的滑动窗口。
- 滑动窗口和限流里的"滑动窗口计数"是同一个思想：窗口右边进、左边出，只维护窗口内的状态。

## 一句话记忆

右指针一路扩张，遇到窗口内重复字符就把左指针跳到它上次位置 + 1（只进不退）。
