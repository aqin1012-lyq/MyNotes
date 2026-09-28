## 题意

在 n×n 的棋盘上放 n 个皇后，要求任意两个皇后不在同一行、同一列、同一条斜线上。返回所有不同的摆法，每种摆法用 n 个字符串表示棋盘，`'Q'` 是皇后，`'.'` 是空格。n 的范围是 1–9。

```
输入：n = 5
输出：共 10 种摆法，其中一种是
["Q....",
 "..Q..",
 "....Q",
 ".Q...",
 "...Q."]
```

```
输入：n = 3
输出：[]
解释：3×3 棋盘放不下 3 个互不攻击的皇后
```

## 思路

暴力做法是在 n² 个格子里选 n 个放皇后再检查，组合数巨大。第一个观察：每行**恰好**一个皇后，所以可以逐行放置，第 `row` 行只需决定皇后放在哪一列，问题变成"给每行选一个列号"。

第二个问题是如何快速判断 `(row, col)` 能不能放。同列好判断；两条斜线有个规律：

- 主对角线（左上到右下）上的格子 `row - col` 相同，加 `n - 1` 变成非负下标。
- 副对角线（右上到左下）上的格子 `row + col` 相同。

用三个布尔数组 `cols`、`diag1`、`diag2` 记录已被占用的列和斜线，就能 O(1) 判断冲突。

:::tip 关键点
按行放置消掉"行冲突"；列、主对角线 `row - col + n - 1`、副对角线 `row + col` 各用一个布尔数组记录，放下时置 true，回溯时置 false。
:::

n = 5 找第一个解的过程（每行记录放在哪列）：

```
row0: col0 可放                   -> Q....
row1: col0 同列, col1 斜线, col2 可放 -> ..Q..
row2: col0..3 都冲突, col4 可放      -> ....Q
row3: col0 冲突, col1 可放          -> .Q...
row4: col3 可放                   -> ...Q.  收集
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<String>> solveNQueens(int n) {
        List<List<String>> res = new ArrayList<>();
        int[] queenCol = new int[n]; // queenCol[row] = 该行皇后所在列
        boolean[] cols = new boolean[n];
        boolean[] diag1 = new boolean[2 * n - 1]; // row - col + n - 1
        boolean[] diag2 = new boolean[2 * n - 1]; // row + col
        dfs(0, n, queenCol, cols, diag1, diag2, res);
        return res;
    }

    private void dfs(int row, int n, int[] queenCol, boolean[] cols,
                     boolean[] diag1, boolean[] diag2, List<List<String>> res) {
        if (row == n) { // 每行都放好了
            res.add(build(queenCol, n));
            return;
        }
        for (int col = 0; col < n; col++) {
            int d1 = row - col + n - 1, d2 = row + col;
            if (cols[col] || diag1[d1] || diag2[d2]) continue; // 冲突
            // 放皇后
            queenCol[row] = col;
            cols[col] = diag1[d1] = diag2[d2] = true;
            dfs(row + 1, n, queenCol, cols, diag1, diag2, res);
            // 拿走皇后
            cols[col] = diag1[d1] = diag2[d2] = false;
        }
    }

    private List<String> build(int[] queenCol, int n) {
        List<String> board = new ArrayList<>();
        for (int row = 0; row < n; row++) {
            char[] line = new char[n];
            Arrays.fill(line, '.');
            line[queenCol[row]] = 'Q';
            board.add(new String(line));
        }
        return board;
    }
}
```

## 复杂度

- 时间 O(n!)：第一行 n 种选择，第二行最多 n-1 种……剪枝后实际远小于 n!；每个解生成棋盘还要 O(n²)。
- 空间 O(n)：递归深度 n，三个标记数组 O(n)（不计结果）。

## 易错点

- 主对角线下标 `row - col` 可能为负，要加 `n - 1` 偏移；数组长度是 `2n - 1`，不是 `n`。
- 分清两条斜线：`row - col` 相同是左上到右下，`row + col` 相同是右上到左下，别只判断一条。
- 回溯时三个标记都要恢复；`queenCol[row]` 会被下一次覆盖，可以不恢复。
- 生成棋盘时每行新建一个 `char[]`，不要复用同一个数组导致结果互相覆盖。

## 其他解法

位运算版本：用三个整数的二进制位代替布尔数组，`available = ~(cols | d1 | d2) & ((1 << n) - 1)` 一次算出本行所有可放的列，再用 `x & -x` 逐个取最低位。常用于只求解个数（N 皇后 II），速度更快，面试时能说出思路即可。

## 举一反三

- [[algo:permutations]]：按行放置后，每行的列号互不相同，本质是带斜线约束的全排列。
- [[algo:word-search]]：同样的"标记 → 递归 → 取消标记"。
- 解数独也是同一个套路：逐格尝试，用行、列、宫三组标记判冲突。

## 一句话记忆

逐行放皇后，用列、`row-col`、`row+col` 三个数组 O(1) 判冲突，放下递归再拿起。
