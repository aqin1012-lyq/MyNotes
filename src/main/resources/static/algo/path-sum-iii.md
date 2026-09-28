## 题意

给一棵二叉树和目标值 targetSum，统计有多少条路径的节点值之和等于 targetSum。路径不必从根开始、也不必在叶子结束，但必须**自上而下**（只能从父节点走向子节点）。节点值可正可负，累加可能超出 int。

```
输入：root = [5,3,-2,2,1,null,5], targetSum = 3
输出：3
解释：三条路径是 [3]、[5,-2]、[-2,5]；注意 2 和 1 是兄弟节点，不能连成一条路径
```

## 思路

暴力：以每个节点为起点向下 DFS，累加路径和，等于目标就计数。起点 n 个，每个向下最多 h 步，总体 O(n·h)，最坏 O(n²)。

优化的关键是把「树上的一条向下路径」看成「根到当前节点这条链上的一段连续子数组」。这就回到了 [[algo:subarray-sum-equals-k]]：**前缀和 + 哈希表**。

DFS 时维护从根到当前节点的前缀和 cur。以当前节点为终点、和为 target 的路径条数，就等于这条链上「前缀和为 cur - target」的祖先位置的个数。用 HashMap 记录链上每个前缀和出现的次数。

:::tip 关键点
树上向下路径 = 根到当前节点链上的一段区间。前缀和 + 哈希表，并且**回溯时要把当前前缀和的计数减掉**，保证哈希表里只有当前这条链上的祖先。
:::

推演（map 初始为 {0:1}，表示「空前缀」；need = cur - target）：

```
node   cur   need  map[need]  total
5      5     2     0          0
3      8     5     1          1      路径 [3]
2      10    7     0          1
1      9     6     0          1
-2     3     0     1          2      路径 [5,-2]
5      8     5     1          3      路径 [-2,5]
```

处理完 3 的子树回溯时，前缀和 8 被移出 map；所以走到右边时，map 里只剩 {0,5,3}，不会把左子树的前缀和误算进来。

## Java 题解

```java
import java.util.*;

class Solution {
    public int pathSum(TreeNode root, int targetSum) {
        Map<Long, Integer> prefix = new HashMap<>();
        // 空前缀：让「从根开始」的路径也能被统计
        prefix.put(0L, 1);
        return dfs(root, 0L, targetSum, prefix);
    }

    private int dfs(TreeNode node, long cur, int target, Map<Long, Integer> prefix) {
        if (node == null) return 0;
        cur += node.val;
        // 以当前节点结尾、和为 target 的路径数
        int count = prefix.getOrDefault(cur - target, 0);
        // 当前前缀和加入，供子孙使用
        prefix.merge(cur, 1, Integer::sum);
        count += dfs(node.left, cur, target, prefix);
        count += dfs(node.right, cur, target, prefix);
        // 回溯：离开当前节点，前缀和移出
        prefix.merge(cur, -1, Integer::sum);
        return count;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点访问一次，哈希表操作 O(1)。
- 空间 O(h)：哈希表里只保存当前链上的前缀和，加上递归栈，都是 O(h)，最坏 O(n)。

## 易错点

- 忘记 `prefix.put(0L, 1)`，从根节点出发的路径会统计不到。
- 忘记回溯减计数，兄弟子树的前缀和会互相污染，结果偏大。
- 必须**先查 `cur - target` 再把 cur 放进 map**；顺序反了，target 为 0 时会把「空路径」算进去。
- 前缀和用 `long`：节点值在 ±10^9 量级时，一条链的累加会溢出 int。

## 其他解法

双重 DFS 暴力，O(n²) 但很好写，面试可以先说它再优化：

```java
import java.util.*;

class Solution {
    public int pathSum(TreeNode root, int targetSum) {
        if (root == null) return 0;
        // 以 root 为起点的路径数 + 左右子树里的路径数
        return from(root, targetSum) + pathSum(root.left, targetSum) + pathSum(root.right, targetSum);
    }

    // 从 node 出发向下，和为 remain 的路径数
    private int from(TreeNode node, long remain) {
        if (node == null) return 0;
        int cnt = node.val == remain ? 1 : 0;
        return cnt + from(node.left, remain - node.val) + from(node.right, remain - node.val);
    }
}
```

## 举一反三

- 数组版原题：[[algo:subarray-sum-equals-k]]，这题就是把它搬到了树的每条根到叶子的链上。
- 「进入时加、离开时减」的回溯写法和 [[algo:permutations]] 等回溯题一脉相承。
- 前缀和 ↔ 后端里的区间统计（按天累计 PV，任意区间做减法）。

## 一句话记忆

树上前缀和：查 cur - target 的次数，进节点加入 map，出节点移除。
