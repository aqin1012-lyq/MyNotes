## 题意

想象你站在一棵二叉树的右侧往左看，每一层只能看到最靠右的那个节点。从上到下返回你能看到的节点值。注意最右边的节点不一定在右子树里。

```
输入：root = [1,2,3,4,null,null,null,7]
输出：[1,3,4,7]
解释：第三、四层只有左子树有节点（4 和 7），从右边看过去挡住它们的东西不存在，所以能看到
```

## 思路

「每一层最右边」直接对应层序遍历：按层 BFS，每层的最后一个节点就是答案。

很多人第一反应是「一路往右走」，这是错的：右子树比左子树矮时，更深的层只能看到左子树的节点，例子里的 4 和 7 就是这样。

DFS 也可以：按「根 → 右 → 左」的顺序遍历，同时带着深度。**每个深度第一次被访问到的节点**就是那一层最右边的节点。

:::tip 关键点
右视图 = 每层最后一个节点。BFS 取每层末尾；DFS 先右后左，每层第一次到达时记录。
:::

BFS 推演：

```
lv  nodes     last
0   [1]       1
1   [2,3]     3
2   [4]       4
3   [7]       7
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<Integer> rightSideView(TreeNode root) {
        List<Integer> res = new ArrayList<>();
        if (root == null) return res;
        Queue<TreeNode> queue = new ArrayDeque<>();
        queue.offer(root);
        while (!queue.isEmpty()) {
            int size = queue.size();
            for (int i = 0; i < size; i++) {
                TreeNode node = queue.poll();
                // 本层最后一个节点就是从右边看到的
                if (i == size - 1) res.add(node.val);
                if (node.left != null) queue.offer(node.left);
                if (node.right != null) queue.offer(node.right);
            }
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点访问一次。
- 空间 O(n)：BFS 队列最多存一层；DFS 写法为 O(h) 的递归栈。

## 易错点

- 只沿着右指针走会漏掉「右子树更矮」时左侧露出来的节点。
- BFS 里入队顺序是先左后右，所以最右的是每层**最后**一个；如果改成先右后左入队，就要取每层第一个，两者别混。
- DFS 必须先递归右子树，否则拿到的是左视图。

## 其他解法

DFS，先右后左，每层第一次到达时记录：

```java
import java.util.*;

class Solution {
    public List<Integer> rightSideView(TreeNode root) {
        List<Integer> res = new ArrayList<>();
        dfs(root, 0, res);
        return res;
    }

    private void dfs(TreeNode node, int depth, List<Integer> res) {
        if (node == null) return;
        // 该深度第一次到达，一定是最右边的节点
        if (depth == res.size()) res.add(node.val);
        dfs(node.right, depth + 1, res);
        dfs(node.left, depth + 1, res);
    }
}
```

## 举一反三

- 母题是 [[algo:binary-tree-level-order-traversal]]，这题只是在每层取末尾。
- 求深度也是同样的分层框架：[[algo:maximum-depth-of-binary-tree]]。

## 一句话记忆

按层 BFS 取每层最后一个，或先右后左 DFS 取每层第一个。
