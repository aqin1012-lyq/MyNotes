## 题意

给一棵二叉树，把它「镜像」过来：每个节点的左右孩子互换，返回翻转后的根节点。空树直接返回 null。

```
输入：root = [6,3,9,1,4,8]
输出：[6,9,3,null,8,4,1]
解释：6 的左右子树互换；3 和 9 各自的孩子也互换，8 原本是 9 的左孩子，翻转后成了右孩子
```

## 思路

整棵树镜像，等价于：**每个节点都把自己的左右指针交换一次**。至于先交换当前节点还是先处理子树，都可以，只要每个节点恰好交换一次。

递归写法：交换当前节点的左右孩子，然后分别递归翻转左右子树（前序）；或者先翻转左右子树，再把结果交叉挂回来（后序）。

:::tip 关键点
「翻转整棵树」拆成「每个节点交换左右孩子」，遍历顺序随意（前序、后序、层序都行），但中序要小心：交换后原来的左子树跑到了右边，会被处理两次。
:::

```
before:        after:
      6              6
    /   \          /   \
   3     9        9     3
  / \   /          \   / \
 1   4 8            8 4   1
```

## Java 题解

```java
import java.util.*;

class Solution {
    public TreeNode invertTree(TreeNode root) {
        if (root == null) return null;
        // 先递归翻转左右子树（后序）
        TreeNode left = invertTree(root.left);
        TreeNode right = invertTree(root.right);
        // 再把翻转好的子树交叉挂回来
        root.left = right;
        root.right = left;
        return root;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点处理一次。
- 空间 O(h)：递归栈深度为树高；BFS 写法最坏为一层的宽度 O(n)。

## 易错点

- 直接写 `root.left = invertTree(root.right); root.right = invertTree(root.left);` 是错的：第二句拿到的 `root.left` 已经被改掉了。要先用临时变量存住。
- 用中序（左 → 交换 → 右）会把同一棵子树翻两次，结果等于没翻。
- 返回值是根节点，别忘了 `return root`。

## 其他解法

BFS 迭代：层序遍历每个节点，出队时交换它的左右孩子。

```java
import java.util.*;

class Solution {
    public TreeNode invertTree(TreeNode root) {
        if (root == null) return null;
        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root);
        while (!queue.isEmpty()) {
            TreeNode node = queue.poll();
            // 交换当前节点的左右孩子
            TreeNode tmp = node.left;
            node.left = node.right;
            node.right = tmp;
            if (node.left != null) queue.offer(node.left);
            if (node.right != null) queue.offer(node.right);
        }
        return root;
    }
}
```

## 举一反三

- 判断一棵树是否是自己的镜像：[[algo:symmetric-tree]]，思路是同时比较一对镜像位置的节点。
- 对每个节点做局部操作再递归的模板，还可以看 [[algo:flatten-binary-tree-to-linked-list]]。

## 一句话记忆

每个节点交换一次左右孩子，先存临时变量，别用中序。
