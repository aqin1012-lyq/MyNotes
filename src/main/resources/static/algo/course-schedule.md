## 题意

一共有 `numCourses` 门课，编号 0 到 n-1。`prerequisites` 中每一项 `[a, b]` 表示"想学 a 必须先学完 b"。判断能不能把所有课都学完，能就返回 `true`。本质是：这张有向图里有没有环。

```
输入：numCourses = 4，prerequisites = [[1,0],[2,1],[3,1],[3,2]]
输出：true
解释：一种可行顺序是 0 -> 1 -> 2 -> 3。

输入：numCourses = 3，prerequisites = [[0,2],[1,0],[2,1]]
输出：false
解释：0 依赖 2，2 依赖 1，1 依赖 0，形成环。
```

## 思路

把课程看成结点，`[a, b]` 看成一条边 `b -> a`（先修指向后修）。能学完所有课，等价于这张有向图**没有环**，也等价于存在一个**拓扑序**。

**暴力**：对每门课 DFS 看能不能绕回自己，重复搜索很多，最坏 O(n·(n+e))。

**拓扑排序（Kahn 算法）**：入度为 0 的课没有任何先修要求，可以直接学。学完它，就把它指向的课的入度减 1；新出现入度为 0 的课放进队列。最后如果学过的课数等于总数，说明无环。

:::tip 关键点
环上的结点入度永远不会减到 0（总有一个环上的前驱没学），所以它们永远进不了队列。只要统计出队的结点数是否等于 `numCourses`，就能判断有没有环。
:::

推演第一个例子（边 0->1, 1->2, 1->3, 2->3）：

```
初始入度  0:0  1:1  2:1  3:2      队列 [0]
出队 0    1 的入度 -> 0            队列 [1]    已学 1
出队 1    2 -> 0，3 -> 1           队列 [2]    已学 2
出队 2    3 -> 0                   队列 [3]    已学 3
出队 3                             队列 []     已学 4 == 4 -> true
```

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        // 建邻接表：先修课 -> 后续课，并统计入度
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) graph.add(new ArrayList<>());
        int[] indegree = new int[numCourses];
        for (int[] p : prerequisites) {
            graph.get(p[1]).add(p[0]);
            indegree[p[0]]++;
        }
        // 所有入度为 0 的课先入队
        Deque<Integer> queue = new ArrayDeque<>();
        for (int i = 0; i < numCourses; i++) {
            if (indegree[i] == 0) queue.offer(i);
        }
        int learned = 0;
        while (!queue.isEmpty()) {
            int cur = queue.poll();
            learned++;
            for (int next : graph.get(cur)) {
                if (--indegree[next] == 0) queue.offer(next); // 先修全部完成
            }
        }
        return learned == numCourses; // 有环时环上的课永远学不到
    }
}
```

## 复杂度

- 时间 O(V + E)：建图 O(E)，每个结点入队一次，每条边被处理一次。
- 空间 O(V + E)：邻接表和入度数组。

## 易错点

- 边的方向搞反：`[a, b]` 是"b 是 a 的先修"，边是 `b -> a`，入度加在 a 上。方向反了对本题的有无环判断碰巧不影响，但求具体学习顺序（LeetCode 210）时就会出错。
- 忘记没有任何先修关系的孤立课程，它们入度为 0，也要入队计数。
- DFS 写法里只用 `visited` 布尔数组无法区分"正在当前路径上"和"已经确认安全"，必须用三种状态。
- 用邻接矩阵建图在课程多、边少时浪费空间，邻接表更合适。

## 其他解法

DFS 三色标记：0 = 未访问，1 = 在当前递归路径上，2 = 已确认从它出发不会有环。DFS 中如果遇到状态为 1 的结点，说明沿着路径绕回来了，有环。

```java
import java.util.*;

class Solution {
    private List<List<Integer>> graph;
    private int[] state; // 0 未访问，1 访问中，2 已完成

    public boolean canFinish(int numCourses, int[][] prerequisites) {
        graph = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) graph.add(new ArrayList<>());
        for (int[] p : prerequisites) graph.get(p[1]).add(p[0]);
        state = new int[numCourses];
        for (int i = 0; i < numCourses; i++) {
            if (hasCycle(i)) return false;
        }
        return true;
    }

    private boolean hasCycle(int u) {
        if (state[u] == 1) return true;  // 回到当前路径上的结点，有环
        if (state[u] == 2) return false; // 之前已确认安全
        state[u] = 1;
        for (int v : graph.get(u)) {
            if (hasCycle(v)) return true;
        }
        state[u] = 2; // 所有后继都安全，标记完成
        return false;
    }
}
```

## 举一反三

- [[algo:linked-list-cycle]]：链表判环，是"每个结点只有一条出边"的特殊图。
- [[algo:rotting-oranges]]：同样是基于队列的 BFS。
- 后端联系：Maven/Gradle 依赖解析、Spring 检测 Bean 循环依赖、任务调度系统（如 Airflow DAG）确定执行顺序、数据库死锁检测（等待图有环）都是拓扑排序或有向图判环。

## 一句话记忆

先修指向后修建图，入度为 0 的先学，学完给后续课减入度，能学完全部就无环。
