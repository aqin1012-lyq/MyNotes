## 题意

有 n 个网络节点（编号 1..n），`times[i] = [u, v, w]` 表示信号从 u 传到 v 需要 w 时间（有向边，w ≥ 0）。从节点 k 发出一个信号，问所有节点都收到信号最少需要多久；如果有节点永远收不到，返回 -1。本质是：求单源最短路后，取所有最短距离的最大值。

```
输入：times = [[1,2,4],[1,3,1],[3,2,2],[2,4,1]], n = 4, k = 1
输出：4
解释：1->3->2 用时 3 比直达 1->2 的 4 更快，再 2->4 到达 4 用时 4
```

```
输入：times = [[1,2,5]], n = 3, k = 1
输出：-1
解释：节点 3 没有入边，收不到信号
```

## 思路

边权非负的单源最短路，标准答案就是 **Dijkstra**。它的贪心依据是：在所有"还没确定"的节点里，当前距离最小的那个，不可能再被别的路径变得更短（因为绕路只会加上非负的边权），所以可以把它"定下来"，再用它去松弛邻居。

朴素实现每轮线性扫一遍找最小，O(n²)；用**小根堆**保存 (距离, 节点)，每次弹出最小的，就是 O((n + m) log m)。堆里可能有同一节点的旧记录，弹出时发现 `d > dist[u]` 直接跳过即可（懒删除）。

:::tip 关键点
堆优化 Dijkstra 三件套：`dist` 初始化为无穷、起点为 0；弹出时"过期记录跳过"；松弛成功才入堆。最后答案是 `max(dist)`，只要有一个仍是无穷就返回 -1。
:::

用例子 1 推演（堆中元素写成 距离:节点）：

```
弹出   dist[1..4]        入堆
0:1    [0,4,1,INF]       4:2 1:3
1:3    [0,3,1,INF]       3:2      (1+2 < 4)
3:2    [0,3,1,4]         4:4
4:2    过期(4 > 3)跳过
4:4    [0,3,1,4]         -
max = 4
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int networkDelayTime(int[][] times, int n, int k) {
        // 邻接表：graph[u] 存 {v, w}
        List<int[]>[] graph = new ArrayList[n + 1];
        for (int i = 1; i <= n; i++) graph[i] = new ArrayList<>();
        for (int[] t : times) graph[t[0]].add(new int[]{t[1], t[2]});

        int[] dist = new int[n + 1];
        Arrays.fill(dist, Integer.MAX_VALUE);
        dist[k] = 0;
        // 小根堆，元素为 {距离, 节点}
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> Integer.compare(a[0], b[0]));
        pq.offer(new int[]{0, k});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int d = cur[0], u = cur[1];
            if (d > dist[u]) continue; // 过期记录，跳过
            for (int[] e : graph[u]) {
                int v = e[0], nd = d + e[1];
                if (nd < dist[v]) { // 松弛成功才入堆
                    dist[v] = nd;
                    pq.offer(new int[]{nd, v});
                }
            }
        }
        int ans = 0;
        for (int i = 1; i <= n; i++) {
            if (dist[i] == Integer.MAX_VALUE) return -1; // 有节点不可达
            ans = Math.max(ans, dist[i]);
        }
        return ans;
    }
}
```

## 复杂度

- 时间 O((n + m) log m)：每条边最多让一个元素入堆一次（m 为边数），每次堆操作 log m。
- 空间 O(n + m)：邻接表 + 堆 + dist 数组。

## 易错点

- 节点编号从 1 开始，数组都开 `n + 1`，统计答案时从 1 遍历，别把下标 0 的 INF 算进去。
- 忘了"过期记录跳过"不会错但会变慢；而如果用 `visited` 数组，要在**弹出时**标记，不能在入堆时标记。
- `d + w` 在 `d` 为 `Integer.MAX_VALUE` 时会溢出成负数；本写法只用弹出的有限距离去松弛，所以安全。
- Dijkstra 只适用于非负边权；有负权边要用 Bellman-Ford / SPFA。
- 题目要的是"所有节点都收到"，所以答案是最短距离的**最大值**，不是和。

## 其他解法

节点少、图稠密（n 只有 100 左右）时，朴素 O(n²) Dijkstra 用邻接矩阵反而更简单：每轮线性找出未确定节点里距离最小的一个。

```java
import java.util.*;

class Solution {
    public int networkDelayTime(int[][] times, int n, int k) {
        final int INF = Integer.MAX_VALUE / 2; // 留余量防止相加溢出
        int[][] g = new int[n + 1][n + 1];
        for (int[] row : g) Arrays.fill(row, INF);
        for (int[] t : times) g[t[0]][t[1]] = t[2];
        int[] dist = new int[n + 1];
        Arrays.fill(dist, INF);
        dist[k] = 0;
        boolean[] done = new boolean[n + 1];
        for (int round = 0; round < n; round++) {
            // 找出未确定节点中距离最小的
            int u = -1;
            for (int i = 1; i <= n; i++) {
                if (!done[i] && (u == -1 || dist[i] < dist[u])) u = i;
            }
            if (dist[u] == INF) break; // 剩下的都不可达
            done[u] = true;
            for (int v = 1; v <= n; v++) {
                dist[v] = Math.min(dist[v], dist[u] + g[u][v]); // 松弛
            }
        }
        int ans = 0;
        for (int i = 1; i <= n; i++) ans = Math.max(ans, dist[i]);
        return ans == INF ? -1 : ans;
    }
}
```

## 举一反三

- [[algo:number-of-islands]] / [[algo:rotting-oranges]]：边权全为 1 时，BFS 就是最短路，Dijkstra 退化成普通队列。
- [[algo:course-schedule]]：同样先建邻接表，但做的是拓扑排序。
- [[algo:find-median-from-data-stream]]：堆的另一种典型用法。
- 工程上最短路对应路由选择（OSPF 协议就基于 Dijkstra）、地图导航、以及微服务调用链中估算关键路径耗时。

## 一句话记忆

非负权单源最短路用 Dijkstra：小根堆每次弹出最近的点定下来，过期记录跳过，松弛成功才入堆。
