## 题意

给定一棵二叉树，求它的最大深度：从根节点走到最远叶子节点，路径上一共经过多少个节点。空树深度为 0，只有根节点时深度为 1。

```
输入：root = [4,2,6,null,null,5,7,null,null,null,9]
输出：4
解释：最长路径是 4 → 6 → 7 → 9，共 4 个节点
```

## 思路

最朴素的想法是枚举每一条根到叶子的路径，记录最长的那条，这其实已经是 DFS 了。更好的写法是换一个角度：**把问题交给子树**。

一棵树的深度 = max(左子树深度, 右子树深度) + 1。空树深度是 0，这就是递归出口。这种「先拿到子树的答案，再在当前节点合并」的写法叫后序式递归，是二叉树题最核心的模板。

:::tip 关键点
不要想「怎么遍历」，而是想「如果左右子树的答案已经知道了，当前节点的答案怎么算」。深度 = 1 + max(左, 右)。
:::

对例子自底向上推演：

```
node   left    right   return
9      0       0       1
5      0       0       1
7      0       1       2
6      1       2       3
2      0       0       1
4      1       3       4
```

也可以用 BFS 层序遍历：一层一层地扫，扫了几层深度就是几。

## Java 题解

```java
import java.util.*;

class Solution {
    public int maxDepth(TreeNode root) {
        // 空树深度为 0，递归出口
        if (root == null) return 0;
        // 先拿到左右子树的深度，再在当前节点合并
        int left = maxDepth(root.left);
        int right = maxDepth(root.right);
        return Math.max(left, right) + 1;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点访问一次。
- 空间 O(h)：递归栈深度等于树高，最坏退化成链为 O(n)。

## 易错点

- 空树返回 0 而不是 1，否则所有深度都会多算。
- 注意「深度」按节点数计，不是按边数计；[[algo:diameter-of-binary-tree]] 则是按边数计，别混。
- 极端退化的链状树很深时递归可能栈溢出，面试可以主动提一句 BFS 版本没有这个问题。

## 其他解法

BFS 层序遍历，每处理完一整层深度加一：

```java
import java.util.*;

class Solution {
    public int maxDepth(TreeNode root) {
        if (root == null) return 0;
        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root);
        int depth = 0;
        while (!queue.isEmpty()) {
            // 当前队列里恰好是一整层
            int size = queue.size();
            for (int i = 0; i < size; i++) {
                TreeNode node = queue.poll();
                if (node.left != null) queue.offer(node.left);
                if (node.right != null) queue.offer(node.right);
            }
            depth++;
        }
        return depth;
    }
}
```

## 举一反三

- 同样「子树返回值 + 当前节点合并」的模板：[[algo:diameter-of-binary-tree]]、[[algo:binary-tree-maximum-path-sum]]、[[algo:symmetric-tree]]。
- 按层计数的 BFS 写法直接延伸到 [[algo:binary-tree-level-order-traversal]] 和 [[algo:binary-tree-right-side-view]]。

## 一句话记忆

深度 = 1 + max(左深度, 右深度)，空树为 0。
