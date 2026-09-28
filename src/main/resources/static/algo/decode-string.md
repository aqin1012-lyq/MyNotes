## 题意

给一个编码后的字符串，规则是 `k[内容]` 表示把「内容」重复 k 次，k 为正整数，括号可以嵌套。输入保证格式合法，原始数据里不含数字（数字只作为重复次数出现）。返回解码后的字符串。

```
输入：s = "x2[ab3[c]]y"
输出："xabcccabcccy"
解释：内层 3[c] 得到 ccc，外层 2[abccc] 得到 abcccabccc，前后再拼上 x 和 y

输入：s = "12[z]"
输出："zzzzzzzzzzzz"
解释：次数可能是多位数
```

## 思路

难点是嵌套：遇到 `]` 时要知道「这一层的内容是什么」「重复几次」「解码后接到哪个字符串后面」。这和括号匹配一样是后进先出的结构，用栈。

维护两个变量：`cur` 表示当前这一层正在拼的字符串，`num` 表示正在读的数字。

- 数字：`num = num * 10 + d`（处理多位数）。
- 字母：追加到 `cur`。
- `[`：进入新的一层。把「外层已经拼好的 cur」和「这一层的次数 num」压栈保存，然后 cur、num 清零，开始拼内层。
- `]`：这一层结束。弹出次数 k 和外层字符串 prev，令 `cur = prev + cur 重复 k 次`，回到外层继续拼。

:::tip 关键点
遇到 `[` 把「外层前缀 + 重复次数」存起来，遇到 `]` 取出来拼接。栈保存的是「被打断的外层现场」，和函数调用栈保存现场是同一回事。
:::

推演 `"x2[ab3[c]]y"`：

```
char  cur           num  stack (prev, k)
x     x             0    []
2     x             2    []
[     ""            0    [(x,2)]
a,b   ab            0    [(x,2)]
3     ab            3    [(x,2)]
[     ""            0    [(x,2),(ab,3)]
c     c             0    [(x,2),(ab,3)]
]     abccc         0    [(x,2)]
]     xabcccabccc   0    []
y     xabcccabcccy  0    []
```

## Java 题解

```java
import java.util.*;

class Solution {
    public String decodeString(String s) {
        Deque<Integer> counts = new ArrayDeque<>();
        Deque<StringBuilder> prevs = new ArrayDeque<>();
        StringBuilder cur = new StringBuilder();
        int num = 0;
        for (char c : s.toCharArray()) {
            if (Character.isDigit(c)) {
                // 次数可能是多位数
                num = num * 10 + (c - '0');
            } else if (c == '[') {
                // 保存外层现场：外层已拼好的前缀和本层重复次数
                counts.push(num);
                prevs.push(cur);
                cur = new StringBuilder();
                num = 0;
            } else if (c == ']') {
                // 本层结束：把本层内容重复 k 次，接回外层前缀后面
                int k = counts.pop();
                StringBuilder prev = prevs.pop();
                String part = cur.toString();
                for (int i = 0; i < k; i++) prev.append(part);
                cur = prev;
            } else {
                cur.append(c);
            }
        }
        return cur.toString();
    }
}
```

## 复杂度

- 时间：与解码后的长度成正比。内层结果在每一层 `]` 时会被复制一次，严格说是 O(输出长度 × 嵌套层数)，嵌套不深时就是 O(输出长度)。
- 空间 O(输出长度)：栈里保存的前缀加上结果本身。

## 易错点

- 数字可能有多位，如 `12[z]`，不能只取一个字符。
- 遇到 `[` 后要把 num 清零，否则内层的数字会接在外层数字后面。
- `]` 时要把重复后的内容**接在外层前缀之后**，而不是直接覆盖；这就是为什么要把 cur 压栈。
- 用 `String` 做 `+=` 拼接会产生大量临时对象，用 `StringBuilder`。

## 其他解法

递归下降：遇到 `[` 就递归解析内层，遇到 `]` 返回。递归调用栈替代了手动的栈。

```java
import java.util.*;

class Solution {
    private int i = 0;

    public String decodeString(String s) {
        i = 0;
        return parse(s);
    }

    // 从位置 i 解析，直到遇到 ] 或字符串结束
    private String parse(String s) {
        StringBuilder sb = new StringBuilder();
        int num = 0;
        while (i < s.length()) {
            char c = s.charAt(i++);
            if (Character.isDigit(c)) {
                num = num * 10 + (c - '0');
            } else if (c == '[') {
                // 递归解析括号内部，返回时 i 已越过对应的 ]
                String inner = parse(s);
                sb.append(inner.repeat(num));
                num = 0;
            } else if (c == ']') {
                return sb.toString();
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }
}
```

## 举一反三

- 栈处理嵌套结构的入门题：[[algo:valid-parentheses]]。
- 「显式栈 ↔ 递归」的互相转换，在树的遍历 [[algo:binary-tree-inorder-traversal]] 里也用过。
- 后端里的表达式求值、配置/模板语言解析（比如解析嵌套的占位符）都是这类「栈 / 递归下降」解析器。

## 一句话记忆

遇 `[` 压入「外层前缀 + 次数」并清空，遇 `]` 弹出后把本层重复 k 次接回去。
