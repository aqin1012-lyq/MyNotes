## 题意

给一个只含小写字母的字符串 `s`（长度 ≤ 16），把它切成若干段，要求**每一段都是回文串**，返回所有可能的切法。

```
输入：s = "abb"
输出：[["a","b","b"],["a","bb"]]
解释："ab"、"abb" 都不是回文，所以第一刀只能切在 "a" 后面
```

```
输入：s = "x"
输出：[["x"]]
```

## 思路

把"切分"看成一系列决策：从位置 `start` 开始，下一段取 `s[start..end]`，`end` 可以是 `start` 到末尾的任意位置；只有当这一段是回文时才继续从 `end + 1` 递归，走到 `start == n` 时说明整串切完了，收集一份答案。

朴素做法里每次都用双指针判断子串是否回文，是 O(n) 的，同一个子串会在不同路径里被反复判断。优化是先用 DP 预处理 `pal[i][j]` 表示 `s[i..j]` 是否回文，回溯时 O(1) 查表：

- `pal[i][j] = s[i] == s[j] && (j - i < 2 || pal[i+1][j-1])`
- 因为依赖 `i+1`，所以 `i` 要**从后往前**算。

:::tip 关键点
回溯枚举"下一刀切在哪"，只有当前段是回文才往下走；回文判断用 DP 预处理成 O(1) 查表。
:::

`s = "abb"` 推演（start 为当前段起点）：

```
start=0
├─ "a"   回文 -> start=1
│   ├─ "b"  回文 -> start=2
│   │   └─ "b" 回文 -> start=3 收集 [a,b,b]
│   └─ "bb" 回文 -> start=3 收集 [a,bb]
├─ "ab"  非回文, 跳过
└─ "abb" 非回文, 跳过
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<String>> partition(String s) {
        int n = s.length();
        // pal[i][j]：s[i..j] 是否回文，i 从后往前填
        boolean[][] pal = new boolean[n][n];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = i; j < n; j++) {
                pal[i][j] = s.charAt(i) == s.charAt(j) && (j - i < 2 || pal[i + 1][j - 1]);
            }
        }
        List<List<String>> res = new ArrayList<>();
        dfs(s, 0, pal, new ArrayList<>(), res);
        return res;
    }

    private void dfs(String s, int start, boolean[][] pal, List<String> path, List<List<String>> res) {
        if (start == s.length()) { // 整串都切完了
            res.add(new ArrayList<>(path));
            return;
        }
        for (int end = start; end < s.length(); end++) {
            if (!pal[start][end]) continue; // 这一段不是回文，不能这么切
            path.add(s.substring(start, end + 1));
            dfs(s, end + 1, pal, path, res);
            path.remove(path.size() - 1);
        }
    }
}
```

## 复杂度

- 时间 O(n × 2^n)：长度 n 的串有 n-1 个可切位置，最多 2^(n-1) 种切法（如全是同一字母），每种拷贝 O(n)；预处理 O(n²)。
- 空间 O(n²)：`pal` 表；递归深度 O(n)。

## 易错点

- DP 填表顺序：`pal[i][j]` 依赖 `pal[i+1][j-1]`，所以外层 `i` 从大到小，内层 `j` 从小到大；顺序反了会读到还没算的值。
- `j - i < 2` 覆盖了长度 1 和 2 的情况，避免 `i+1 > j-1` 时越界读表。
- `substring(start, end + 1)` 右边界是开区间，别漏了 `+1`。
- 非回文段用 `continue` 而不是 `break`：`"ab"` 不是回文，不代表 `"aba"` 不是。

## 举一反三

- [[algo:longest-palindromic-substring]]：同一个 `pal[i][j]` 状态定义，或者用中心扩展。
- [[algo:word-break]]：同样是"下一刀切在哪"，但只问能否切分，用 DP 而不是枚举全部方案。
- [[algo:subsets]]：切分也可以看成"每个间隙切或不切"的子集问题。

## 一句话记忆

枚举下一段的终点，是回文才递归；回文判断先用 DP 打表。
