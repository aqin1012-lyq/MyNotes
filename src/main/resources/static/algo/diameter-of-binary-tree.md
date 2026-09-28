## 题意

给一棵二叉树，求任意两个节点之间最长路径的长度，长度按**边数**计算。这条路径不一定经过根节点。

```
输入：root = [1,2,null,3,4,5,null,null,6]
输出：4
解释：最长路径是 5 → 3 → 2 → 4 → 6，共 4 条边，完全没经过根节点 1
```

## 思路

暴力法：对每个节点，算出它左右子树的深度，经过它的最长路径就是「左深度 + 右深度」，取所有节点的最大值。但如果每个节点都单独调一次求深度，会重复计算，最坏 O(n²)。

优化：求深度本身就是一次后序遍历，**在求深度的同一趟递归里顺手更新直径**即可。递归函数返回「以当前节点为端点向下的最长链节点数」（即深度），同时用全局变量记录 `左深度 + 右深度` 的最大值。

:::tip 关键点
递归的「返回值」和「要求的答案」不是一个东西：返回给父节点的只能是一条单边链（深度），而经过当前节点拐弯的路径（左 + 右）只能用来更新全局答案。
:::

推演（depth 为返回值，左+右 为经过该节点的路径边数）：

```
node   left    right   l+r    return
5      0       0       0      1
6      0       0       0      1
3      1       0       1      2
4      0       1       1      2
2      2       2       4      3    <- diameter
1      3       0       3      4
```

## Java 题解

```java
import java.util.*;

class Solution {
    private int best = 0;

    public int diameterOfBinaryTree(TreeNode root) {
        best = 0;
        depth(root);
        return best;
    }

    // 返回以 node 为起点向下的最长链的节点数（即深度）
    private int depth(TreeNode node) {
        if (node == null) return 0;
        int left = depth(node.left);
        int right = depth(node.right);
        // 经过 node 拐弯的路径边数 = 左深度 + 右深度
        best = Math.max(best, left + right);
        // 返回给父节点时只能选一边
        return Math.max(left, right) + 1;
    }
}
```

## 复杂度

- 时间 O(n)：一次后序遍历，每个节点只访问一次。
- 空间 O(h)：递归栈深度为树高。

## 易错点

- 直径按边数算，所以用 `left + right`，不是 `left + right + 1`。
- 直径不一定过根节点，只算 `depth(root.left) + depth(root.right)` 会错（如上面的例子，答案在节点 2 处）。
- 用成员变量存答案时，如果同一个 Solution 对象被复用会残留上次的值；所以在入口处先重置 `best = 0`。

## 举一反三

- 一模一样的「返回单边、更新拐弯」模板：[[algo:binary-tree-maximum-path-sum]]，只是把深度换成了路径和，并且要处理负数。
- 求深度的基础题是 [[algo:maximum-depth-of-binary-tree]]。

## 一句话记忆

后序求深度，顺手用 左深度 + 右深度 更新全局最大值。
