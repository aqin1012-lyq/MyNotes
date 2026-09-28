## 题意

给一棵二叉树，按层从上到下、每层从左到右输出节点值，每一层单独放在一个列表里，最终返回列表的列表。空树返回空列表。

```
输入：root = [8,4,12,null,6,10]
输出：[[8],[4,12],[6,10]]
解释：第一层只有 8；第二层 4、12；第三层是 4 的右孩子 6 和 12 的左孩子 10
```

## 思路

按层访问天然对应 BFS：用队列，先进先出，保证上一层的节点先于下一层被处理。难点在于「怎么知道一层到哪里结束」。

技巧是：**在开始处理某一层之前，先记下队列当前的大小 size**。此时队列里恰好是这一整层的节点，连续弹出 size 个就是这一层；它们的孩子入队后排在后面，属于下一层，不会混进来。

:::tip 关键点
每轮循环开头 `int size = queue.size()` 把层「冻结」住，内层循环只处理 size 个节点。这是所有按层 BFS 题的通用模板。
:::

推演：

```
round queue         size  level      enqueue
1     [8]           1     [8]        4,12
2     [4,12]        2     [4,12]     6,10
3     [6,10]        2     [6,10]     -
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<Integer>> levelOrder(TreeNode root) {
        List<List<Integer>> res = new ArrayList<>();
        if (root == null) return res;
        Queue<TreeNode> queue = new ArrayDeque<>();
        queue.offer(root);
        while (!queue.isEmpty()) {
            // 冻结当前层的节点数
            int size = queue.size();
            List<Integer> level = new ArrayList<>(size);
            for (int i = 0; i < size; i++) {
                TreeNode node = queue.poll();
                level.add(node.val);
                // 孩子入队，属于下一层
                if (node.left != null) queue.offer(node.left);
                if (node.right != null) queue.offer(node.right);
            }
            res.add(level);
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点入队出队各一次。
- 空间 O(n)：队列最多同时存放一层的节点，满二叉树最后一层约 n/2 个。

## 易错点

- 内层循环必须用提前保存的 `size`，不能写 `i < queue.size()`，因为循环中队列大小一直在变。
- 空树要提前返回，否则 `queue.offer(null)` 在 `ArrayDeque` 上会直接抛异常。
- 孩子为空时不入队，否则后面要到处判空。

## 其他解法

DFS 也能做：递归时带上深度 depth，第一次到达某个深度时新建一个列表，然后把节点值加到 `res.get(depth)` 中。因为先左后右，每层内部顺序依然正确。

```java
import java.util.*;

class Solution {
    public List<List<Integer>> levelOrder(TreeNode root) {
        List<List<Integer>> res = new ArrayList<>();
        dfs(root, 0, res);
        return res;
    }

    private void dfs(TreeNode node, int depth, List<List<Integer>> res) {
        if (node == null) return;
        // 第一次来到这一层，建一个新列表
        if (depth == res.size()) res.add(new ArrayList<>());
        res.get(depth).add(node.val);
        dfs(node.left, depth + 1, res);
        dfs(node.right, depth + 1, res);
    }
}
```

## 举一反三

- 只取每层最后一个：[[algo:binary-tree-right-side-view]]；数层数：[[algo:maximum-depth-of-binary-tree]]。
- 网格上的多源 BFS、按「轮」扩散同样用 size 分层：[[algo:rotting-oranges]]。
- 后端里按层遍历的思路常用于组织架构树、类目树逐级展开，以及依赖图的分批处理。

## 一句话记忆

队列 BFS，每层开头记下 size，只弹 size 个。
