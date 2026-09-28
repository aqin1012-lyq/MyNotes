## 题意

给一个由字符 `'1'`（陆地）和 `'0'`（水）组成的二维网格，上下左右相邻的陆地连在一起算同一个岛屿（斜对角不算）。网格外面全是水。求岛屿的数量。网格边长最多 300。

```
输入：grid =
1 1 0 0 1
0 1 0 1 1
1 0 0 0 0
0 0 1 1 0
输出：4
解释：左上 3 格一个岛，右上 3 格一个岛，(2,0) 单独一个岛，底部两格一个岛；(1,1) 和 (2,0) 只是斜着相邻，不相连。
```

## 思路

这是最典型的"求连通分量个数"。把每个陆地格子看成图的结点，相邻陆地之间有边，岛屿数就是连通分量数。

**做法**：从左到右、从上到下扫描网格，每遇到一个还没访问过的 `'1'`，岛屿数加 1，然后从它出发做 DFS（或 BFS），把整座岛上的格子全部标记成已访问。之后再扫到这座岛的其他格子时，它们已被标记，不会重复计数。

:::tip 关键点
"标记已访问"可以直接把 `'1'` 改成 `'0'`（俗称"沉岛"），省掉一个 `visited` 数组。如果不允许修改输入，就用 `boolean[][] visited`。
:::

推演（按扫描顺序）：

```
扫描到    计数   沉岛后
(0,0)     1      (0,0) (0,1) (1,1) 变为 0
(0,4)     2      (0,4) (1,4) (1,3) 变为 0
(2,0)     3      (2,0) 变为 0
(3,2)     4      (3,2) (3,3) 变为 0
其余格子都是 0，答案 4
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int numIslands(char[][] grid) {
        int count = 0;
        for (int i = 0; i < grid.length; i++) {
            for (int j = 0; j < grid[0].length; j++) {
                if (grid[i][j] == '1') {
                    count++;          // 发现新岛屿
                    sink(grid, i, j); // 把整座岛沉掉，避免重复计数
                }
            }
        }
        return count;
    }

    private void sink(char[][] grid, int i, int j) {
        // 越界或不是陆地就返回
        if (i < 0 || j < 0 || i >= grid.length || j >= grid[0].length || grid[i][j] != '1') return;
        grid[i][j] = '0'; // 先标记，再向四个方向扩散
        sink(grid, i + 1, j);
        sink(grid, i - 1, j);
        sink(grid, i, j + 1);
        sink(grid, i, j - 1);
    }
}
```

## 复杂度

- 时间 O(m·n)：每个格子最多被扫描一次、被沉一次。
- 空间 O(m·n)：最坏情况下（全是陆地）DFS 递归深度可达 m·n。

## 易错点

- 必须**先标记再递归**，否则相邻格子互相递归会死循环。
- 越界判断要放在访问 `grid[i][j]` 之前。
- 网格元素是 `char`，比较要写 `'1'` 而不是数字 `1`。
- 300×300 全陆地时递归深度可达 9 万层，Java 默认栈可能溢出；面试时可以主动说明，改用 BFS 或显式栈可以规避。

## 其他解法

BFS：遇到陆地后入队并立刻标记，出队时把四个方向的陆地入队。避免了深递归，适合大网格。

```java
import java.util.*;

class Solution {
    private static final int[][] DIRS = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};

    public int numIslands(char[][] grid) {
        int m = grid.length, n = grid[0].length, count = 0;
        Deque<int[]> queue = new ArrayDeque<>();
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                if (grid[i][j] != '1') continue;
                count++;
                grid[i][j] = '0'; // 入队时就标记，防止重复入队
                queue.offer(new int[]{i, j});
                while (!queue.isEmpty()) {
                    int[] cur = queue.poll();
                    for (int[] d : DIRS) {
                        int x = cur[0] + d[0], y = cur[1] + d[1];
                        if (x >= 0 && y >= 0 && x < m && y < n && grid[x][y] == '1') {
                            grid[x][y] = '0';
                            queue.offer(new int[]{x, y});
                        }
                    }
                }
            }
        }
        return count;
    }
}
```

还可以用并查集：把相邻陆地 union 起来，最后数有多少个根。在"陆地动态增加、实时求岛屿数"的变种里并查集更合适。

## 举一反三

- [[algo:rotting-oranges]]：网格上的多源 BFS。
- [[algo:word-search]]：网格 DFS + 回溯。
- [[algo:course-schedule]]：一般图（邻接表）上的遍历。
- 后端联系：求连通分量的思路在"关系图中找出互相关联的账号群组"（风控团伙识别）、微服务依赖分组等场景都会用到。

## 一句话记忆

扫到一块陆地就计数加一，然后 DFS 把整座岛沉掉。
