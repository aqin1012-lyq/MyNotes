## 题意

网格里每格是 0（空）、1（新鲜橘子）或 2（烂橘子）。每过一分钟，所有烂橘子会让上下左右相邻的新鲜橘子也变烂。问最少经过多少分钟，网格里不再有新鲜橘子；如果有新鲜橘子永远不会被感染，返回 -1。网格边长最多 10。

```
输入：grid =
2 1 0
1 1 0
0 1 2
输出：2
解释：第 1 分钟 (0,1)(1,0)(2,1) 变烂，第 2 分钟 (1,1) 变烂。

输入：grid =
1 0 2
输出：-1
解释：(0,0) 的橘子被空格隔开，永远不会烂。
```

## 思路

**模拟**：每一分钟扫描整个网格，把烂橘子旁边的新鲜橘子标记为下一分钟要烂，直到没有变化。每轮 O(mn)，最多 O(mn) 轮，共 O((mn)^2)。

**瓶颈**：每轮都在重复扫描已经处理过的格子。实际上"感染"是一圈一圈往外扩散的，这正是 BFS 按层遍历的样子，每一层就是一分钟。

:::tip 关键点
多源 BFS：一开始把**所有**烂橘子同时放进队列作为第 0 层，同时统计新鲜橘子数 `fresh`。每处理完一整层，分钟数加 1；每感染一个橘子，`fresh--`。BFS 结束后 `fresh > 0` 说明有橘子够不着，返回 -1。
:::

推演第一个例子（初始烂橘子 (0,0) 和 (2,2)，fresh = 4）：

```
层   队列                  新感染              fresh  分钟
0    (0,0) (2,2)           (0,1) (1,0) (2,1)   1      1
1    (0,1) (1,0) (2,1)     (1,1)               0      2
fresh 为 0，停止，答案 2
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int orangesRotting(int[][] grid) {
        int m = grid.length, n = grid[0].length, fresh = 0;
        Deque<int[]> queue = new ArrayDeque<>();
        // 所有烂橘子作为 BFS 的起点，同时统计新鲜橘子
        for (int i = 0; i < m; i++) {
            for (int j = 0; j < n; j++) {
                if (grid[i][j] == 2) queue.offer(new int[]{i, j});
                else if (grid[i][j] == 1) fresh++;
            }
        }
        int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
        int minutes = 0;
        // 还有新鲜橘子且队列非空时，才需要再过一分钟
        while (fresh > 0 && !queue.isEmpty()) {
            minutes++;
            for (int size = queue.size(); size > 0; size--) { // 处理当前这一层
                int[] cur = queue.poll();
                for (int[] d : dirs) {
                    int x = cur[0] + d[0], y = cur[1] + d[1];
                    if (x >= 0 && y >= 0 && x < m && y < n && grid[x][y] == 1) {
                        grid[x][y] = 2; // 立即标记，避免重复入队
                        fresh--;
                        queue.offer(new int[]{x, y});
                    }
                }
            }
        }
        return fresh == 0 ? minutes : -1;
    }
}
```

## 复杂度

- 时间 O(m·n)：每个格子最多入队一次。
- 空间 O(m·n)：队列最坏存下所有格子。

## 易错点

- 一开始就没有新鲜橘子，答案是 0，不是 -1；循环条件里带上 `fresh > 0` 就自然返回 0。
- 如果循环条件只写 `!queue.isEmpty()`，最后一层出队时不会再感染任何橘子，但分钟数仍被加了 1，结果多 1。
- 必须按层处理（先取 `size` 再循环），否则无法区分分钟。
- 入队时就把橘子改成 2，而不是出队时再改，否则同一个橘子会被多个邻居重复入队、`fresh` 被多减。
- 只从一个烂橘子开始 BFS 是错的，所有烂橘子是同时开始扩散的。

## 举一反三

- [[algo:number-of-islands]]：网格遍历的基本功，也可以用 BFS。
- [[algo:course-schedule]]：拓扑排序本质上也是一种 BFS，每次处理入度为 0 的结点。
- [[algo:binary-tree-level-order-traversal]]：按层 BFS 的模板，这里只是把树换成了网格。
- 后端联系：多源 BFS 的"按层扩散"对应消息或故障在服务拓扑中的传播轮次、社交网络中 N 度好友的计算。

## 一句话记忆

所有烂橘子一起入队做多源 BFS，一层一分钟，最后还有新鲜的就是 -1。
