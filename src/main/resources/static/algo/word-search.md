## 题意

给一个 m×n 的字符网格 `board` 和一个单词 `word`，判断能否在网格里找到这个单词：从某个格子出发，每一步走到上下左右相邻的格子，依次拼出单词的每个字母，**同一个格子在一条路径里只能用一次**。网格最大 6×6，单词长度不超过 15。

```
输入：board = [["C","A","T"],
               ["D","O","G"],
               ["E","R","S"]], word = "DOGS"
输出：true
解释：D(1,0) → O(1,1) → G(1,2) → S(2,2)
```

```
输入：同上 board，word = "GOG"
输出：false
解释：G→O 之后要回到 G，但唯一的 G 已经用过了
```

## 思路

路径的起点不确定，所以先枚举每个格子作为起点；从起点出发，第 k 步要匹配 `word[k]`，候选是四个方向的邻居——这就是网格上的 DFS 回溯。

为了满足"同一个格子不能重复使用"，走进一个格子时把它标记为已访问，从它出发的所有尝试都失败后再恢复，让其他路径还能使用它。标记可以用额外的 `visited` 数组，也可以直接把 `board[i][j]` 临时改成一个不会出现在单词里的字符（如 `'#'`），省掉额外空间。

:::tip 关键点
四步走：越界或字符不匹配就返回 false → 匹配到最后一个字符返回 true → 标记当前格子后向四个方向递归 → 恢复现场。任何一个方向成功就立刻返回，避免多余搜索。
:::

`word = "DOGS"` 推演：

```
起点 (0,0)='C' != 'D'  失败
起点 (0,1)='A' != 'D'  失败
...
起点 (1,0)='D' k=0 匹配, 标记 #
  -> (1,1)='O' k=1 匹配, 标记 #
     -> (1,2)='G' k=2 匹配, 标记 #
        -> (2,2)='S' k=3 是最后一个字母 => true
```

## Java 题解

```java
import java.util.*;

class Solution {
    private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    public boolean exist(char[][] board, String word) {
        for (int i = 0; i < board.length; i++) {
            for (int j = 0; j < board[0].length; j++) {
                // 每个格子都可能是起点
                if (dfs(board, word, i, j, 0)) return true;
            }
        }
        return false;
    }

    private boolean dfs(char[][] b, String word, int i, int j, int k) {
        // 越界或字符不匹配（已访问的 '#' 也不会匹配）
        if (i < 0 || j < 0 || i >= b.length || j >= b[0].length || b[i][j] != word.charAt(k)) {
            return false;
        }
        if (k == word.length() - 1) return true; // 最后一个字母也匹配上了
        char saved = b[i][j];
        b[i][j] = '#'; // 标记已访问
        boolean found = false;
        for (int[] d : DIRS) {
            if (dfs(b, word, i + d[0], j + d[1], k + 1)) {
                found = true;
                break;
            }
        }
        b[i][j] = saved; // 恢复现场
        return found;
    }
}
```

## 复杂度

- 时间 O(m × n × 3^L)：L 为单词长度，每个起点最多展开 L 层，除第一步外每步最多 3 个方向（不能走回头路）。
- 空间 O(L)：递归深度最多 L；原地标记不需要额外的 `visited`。

## 易错点

- 找到答案后直接 `return true` 会跳过恢复现场，导致 board 被改脏；上面的写法先 `break` 再恢复，更安全（虽然本题找到后就结束了，但写成习惯更好）。
- 不做标记会导致一个格子被重复使用，`"GOG"` 这类单词会被误判为 true。
- 结束条件放在匹配检查之后：`k == word.length() - 1` 时才说明整个单词匹配完；如果写成 `k == word.length()` 放在最前面，要注意对单字符单词和越界的处理顺序。
- 可以先做一个剪枝：统计 board 中每个字母的数量，如果某个字母比 word 里需要的少，直接返回 false。

## 举一反三

- [[algo:number-of-islands]]：同样是网格 DFS，但只需要标记不需要恢复（不是回溯）。
- [[algo:n-queens]]：同样"放下 → 递归 → 拿起"的回溯，只是约束是行列对角线。
- [[algo:implement-trie-prefix-tree]]：单词搜索 II（一次查多个单词）会把单词建成 Trie 再在网格上 DFS。

## 一句话记忆

每个格子做起点，DFS 四个方向逐字匹配，进入时打 `#` 标记，退出时恢复。
