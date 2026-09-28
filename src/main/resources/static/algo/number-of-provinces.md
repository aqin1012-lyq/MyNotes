## 题意

有 n 座城市，用一个 n×n 的 0/1 矩阵 `isConnected` 描述它们之间是否有直接道路：`isConnected[i][j] = 1` 表示 i 和 j 直接相连（矩阵对称，对角线为 1）。直接或间接相连的城市算同一个"省份"，求一共有多少个省份，也就是无向图的连通分量个数。

```
输入：isConnected = [[1,0,0,1],[0,1,1,0],[0,1,1,0],[1,0,0,1]]
输出：2
解释：{0,3} 一组，{1,2} 一组
```

```
输入：isConnected = [[1,0,0],[0,1,0],[0,0,1]]
输出：3
解释：三座城市互不相连，各自成省
```

## 思路

求连通分量有两条路：DFS/BFS 从每个未访问点出发把整片染色，染了几次就有几个分量；或者用**并查集**：一开始每个城市自成一个集合（计数 n），每遇到一条边 (i, j) 就尝试合并两者所在的集合，合并成功一次计数减 1，最后剩下的集合数就是答案。

并查集的效率靠两个优化：**路径压缩**（find 时把沿途节点直接挂到根上）和**按秩/按大小合并**（小树挂到大树下）。两者一起用，单次操作接近 O(1)（反阿克曼函数）。

:::tip 关键点
"合并成功才减 1"：如果 i、j 已经同根，说明这条边连的是同一个分量，不能再减。矩阵对称，只扫上三角 `j > i` 即可。
:::

用例子 1 推演（只看上三角里的 1）：

```
初始 parent = [0,1,2,3]  count = 4
边(0,3): 根0 != 根3 -> 合并  count = 3
边(1,2): 根1 != 根2 -> 合并  count = 2
结束 -> 2
```

## Java 题解

```java
import java.util.*;

class Solution {
    private int[] parent;
    private int[] size;

    public int findCircleNum(int[][] isConnected) {
        int n = isConnected.length;
        parent = new int[n];
        size = new int[n];
        for (int i = 0; i < n; i++) {
            parent[i] = i; // 每个城市自成一个集合
            size[i] = 1;
        }
        int count = n;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) { // 矩阵对称，只看上三角
                if (isConnected[i][j] == 1 && union(i, j)) {
                    count--; // 合并成功才减少一个分量
                }
            }
        }
        return count;
    }

    private int find(int x) {
        // 路径压缩：沿途节点直接指向根
        if (parent[x] != x) {
            parent[x] = find(parent[x]);
        }
        return parent[x];
    }

    private boolean union(int a, int b) {
        int ra = find(a), rb = find(b);
        if (ra == rb) return false; // 已在同一集合
        // 按大小合并：小树挂到大树下
        if (size[ra] < size[rb]) { int t = ra; ra = rb; rb = t; }
        parent[rb] = ra;
        size[ra] += size[rb];
        return true;
    }
}
```

## 复杂度

- 时间 O(n² · α(n))：要扫一遍 n×n 矩阵，每次 union/find 在路径压缩 + 按大小合并下是反阿克曼 α(n)，实际可视为常数。
- 空间 O(n)：parent 和 size 两个数组（递归 find 的栈深度在压缩后也很浅）。

## 易错点

- 不管合并是否成功都 `count--` 会少算：同一分量内的多条边会被重复扣减。
- `union` 里要比较的是**根** `find(a)` 和 `find(b)`，而不是 `a`、`b` 本身，也不是 `parent[a]`。
- 只做路径压缩不做按秩合并也能过这题，但要知道两者合用才有 α(n) 的保证。
- 输入是邻接矩阵不是边列表，别把 `isConnected[i][i] = 1` 当成边去处理（自己和自己本来就同根，无害但多余）。

## 其他解法

DFS 染色：从每个没访问过的城市出发，把能到达的城市全部标记，出发的次数就是省份数。

```java
import java.util.*;

class Solution {
    public int findCircleNum(int[][] isConnected) {
        int n = isConnected.length;
        boolean[] visited = new boolean[n];
        int count = 0;
        for (int i = 0; i < n; i++) {
            if (!visited[i]) {
                count++; // 发现一个新的连通分量
                dfs(isConnected, visited, i);
            }
        }
        return count;
    }

    private void dfs(int[][] g, boolean[] visited, int u) {
        visited[u] = true;
        for (int v = 0; v < g.length; v++) {
            if (g[u][v] == 1 && !visited[v]) {
                dfs(g, visited, v);
            }
        }
    }
}
```

## 举一反三

- [[algo:redundant-connection]]：同样是并查集，但关注"哪条边合并失败"——那条边就是成环的边。
- [[algo:number-of-islands]]：网格上的连通分量，DFS/BFS/并查集三种都能做。
- [[algo:course-schedule]]：有向图就不能用并查集判环了，要用拓扑排序。
- 工程上并查集常用于"账号合并/关系归并"：比如把共享手机号、设备号的多个账号归并为同一个用户实体。

## 一句话记忆

每个点自成一家，每条边尝试合并，合并成功一次分量数减一。
