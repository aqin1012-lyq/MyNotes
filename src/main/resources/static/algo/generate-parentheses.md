## 题意

给一个整数 `n`（1–8），表示有 n 对括号，生成所有由这 n 对括号组成的**合法**括号串。合法指每个右括号都能和它左边某个未配对的左括号配对。结果顺序不限。

```
输入：n = 2
输出：["(())","()()"]
```

```
输入：n = 4
输出：共 14 个，例如 "(((())))"、"(()())()"、"()()()()"
解释：数量正好是卡特兰数 C4 = 14
```

## 思路

暴力做法：长度 2n 的每个位置放 `(` 或 `)`，共 2^(2n) 个串，逐个用栈判断是否合法。大部分串一开始就已经不合法了（比如以 `)` 开头），却还要继续生成，浪费严重。

优化是在生成过程中就保证合法，只需要维护两个计数：已用的左括号数 `open`、右括号数 `close`。

- 还能放左括号的条件：`open < n`。
- 还能放右括号的条件：`close < open`（右括号不能比左括号多）。

只要每一步都满足这两个条件，走到长度 2n 时得到的一定是合法串，不需要事后校验。

:::tip 关键点
合法性 = 任意前缀中 `(` 数 ≥ `)` 数，且总数相等。把这个条件变成两个剪枝：`open < n` 才放左，`close < open` 才放右。
:::

n = 2 推演（状态为 path / open / close）：

```
"" 0/0
└─ "(" 1/0
    ├─ "((" 2/0
    │   └─ "(()" 2/1
    │       └─ "(())" 2/2  收集
    └─ "()" 1/1
        └─ "()(" 2/1
            └─ "()()" 2/2  收集
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<String> generateParenthesis(int n) {
        List<String> res = new ArrayList<>();
        dfs(n, 0, 0, new StringBuilder(), res);
        return res;
    }

    private void dfs(int n, int open, int close, StringBuilder path, List<String> res) {
        if (path.length() == 2 * n) {
            res.add(path.toString()); // 生成过程已保证合法
            return;
        }
        // 左括号还没用完，就可以放
        if (open < n) {
            path.append('(');
            dfs(n, open + 1, close, path, res);
            path.deleteCharAt(path.length() - 1);
        }
        // 右括号必须少于左括号，才有东西可配对
        if (close < open) {
            path.append(')');
            dfs(n, open, close + 1, path, res);
            path.deleteCharAt(path.length() - 1);
        }
    }
}
```

## 复杂度

- 时间 O(4^n / √n)：合法串的个数是第 n 个卡特兰数，约为 4^n / (n√n)，每个串拷贝 O(n)。
- 空间 O(n)：递归深度 2n，`StringBuilder` 长度 2n（不计结果）。

## 易错点

- 右括号的条件写成 `close < n` 会生成 `"())("` 这类非法串，必须是 `close < open`。
- 两个 if 是**并列**的，不是 if-else：同一个状态下两种括号都可能放。
- 每个分支结束都要 `deleteCharAt` 撤销，否则另一个分支会带着多余的字符。
- 结束条件用长度 `2 * n` 判断；只判 `open == n` 会漏掉后面还没补齐的右括号。

## 举一反三

- [[algo:valid-parentheses]]：判断括号串是否合法，用栈；本题是反过来生成合法串。
- [[algo:longest-valid-parentheses]]：在给定串中找最长合法子串，用栈或 DP。
- [[algo:letter-combinations-of-a-phone-number]]：同样每层只有少量选择的决策树，但本题多了约束剪枝。

## 一句话记忆

左括号没用完就能放左，右括号比左括号少才能放右，长度到 2n 就收集。
