## 题意

老式手机键盘上，数字 2–9 各对应几个字母（2→abc，3→def，4→ghi，5→jkl，6→mno，7→pqrs，8→tuv，9→wxyz）。给一个只含 2–9 的数字串 `digits`（长度 0–4），返回按这些键能拼出的所有字母串。输入为空串时返回空列表。

```
输入：digits = "58"
输出：["jt","ju","jv","kt","ku","kv","lt","lu","lv"]
解释：5 有 3 个字母，8 有 3 个字母，共 3×3 = 9 种
```

```
输入：digits = ""
输出：[]
```

## 思路

如果数字个数固定为 2，两层 for 就够了；但长度不定，for 的层数没法写死。于是换成递归：第 `idx` 层负责决定第 `idx` 个数字取哪个字母，取完递归到 `idx + 1`，当 `idx == digits.length()` 时得到一个完整字符串。

和排列、子集不同，这里每一层的"选择列表"是**不同的集合**（由当前数字决定），而且层与层之间互不影响，所以不需要 `used[]` 也不需要 `start`。

:::tip 关键点
第几层就处理第几个数字，本层的选择 = 这个数字对应的字母。用 `StringBuilder` 做路径，append 后递归，回来 deleteCharAt 撤销。
:::

用 `"58"` 推演：

```
idx=0 digit=5 -> j / k / l
  j: idx=1 digit=8 -> t u v   => jt ju jv
  k: idx=1 digit=8 -> t u v   => kt ku kv
  l: idx=1 digit=8 -> t u v   => lt lu lv
```

## Java 题解

```java
import java.util.*;

class Solution {
    // 下标即数字，0 和 1 不对应字母
    private static final String[] MAP = {
        "", "", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz"
    };

    public List<String> letterCombinations(String digits) {
        List<String> res = new ArrayList<>();
        if (digits == null || digits.isEmpty()) return res; // 空串直接返回空列表
        dfs(digits, 0, new StringBuilder(), res);
        return res;
    }

    private void dfs(String digits, int idx, StringBuilder path, List<String> res) {
        if (idx == digits.length()) {
            res.add(path.toString());
            return;
        }
        String letters = MAP[digits.charAt(idx) - '0'];
        for (int i = 0; i < letters.length(); i++) {
            path.append(letters.charAt(i));      // 做选择
            dfs(digits, idx + 1, path, res);
            path.deleteCharAt(path.length() - 1); // 撤销选择
        }
    }
}
```

## 复杂度

- 时间 O(4^n × n)：n 为数字个数，每位最多 4 个字母，共最多 4^n 个结果，每个 `toString` 为 O(n)。
- 空间 O(n)：递归深度和 `StringBuilder` 长度都是 n（不计结果）。

## 易错点

- 空串要返回 `[]` 而不是 `[""]`；如果不特判，`dfs` 会在 `idx == 0 == length` 时收集一个空串。
- 7 和 9 对应 4 个字母，别都写成 3 个。
- `digits.charAt(idx) - '0'` 得到的是数字，直接用 `charAt(idx)` 当下标会越界。
- 用 `String` 拼接 `path + c` 也能过（不用撤销），但每层都新建字符串；`StringBuilder` 需要记得 `deleteCharAt`。

## 举一反三

- [[algo:permutations]]、[[algo:subsets]]：同样是决策树遍历，区别在每层的选择列表从哪来。
- [[algo:generate-parentheses]]：每层也只有少数几个选择，但要带约束剪枝。
- [[algo:word-search]]：在网格上做 DFS 回溯，每层选择是上下左右四个方向。

## 一句话记忆

第几层处理第几个数字，每层遍历该数字的字母，拼满长度就收集。
