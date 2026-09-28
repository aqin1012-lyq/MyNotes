## 题意

给一棵二叉树的根节点，按「左子树 → 根 → 右子树」的顺序返回所有节点值组成的列表。树可能为空，节点数最多一百个左右。递归写法很简单，面试官通常会追问：能不能不用递归？

```
输入：root = [5,3,8,null,4,7]
输出：[3,4,5,7,8]
解释：5 的左子树是 3(右孩子 4)，右子树是 8(左孩子 7)，先把左边走完 3、4，再输出 5，最后 7、8
```

## 思路

递归版就是定义本身：`inorder(左)`，记录根，`inorder(右)`。它的本质是系统调用栈帮你记住了「回来时要处理的根」。

迭代版就是把这个调用栈手动模拟出来：从当前节点开始一路往左走，把沿途节点压栈；走到空时弹出栈顶——它的左子树已经处理完了，于是记录它，然后转向它的右子树，重复上面的过程。

:::tip 关键点
中序迭代 = 「一路向左压栈，弹出即访问，然后转向右孩子」。栈里存的永远是「左边还没走完、自己还没访问」的祖先节点。
:::

用例子推演（cur 表示当前指针）：

```
step  stack    output        动作
1     [5,3]    []            压 5、压 3，一路向左
2     [5]      [3]           3 无左孩子，弹出 3
3     [5,4]    [3]           转向 3 的右孩子 4，压 4
4     [5]      [3,4]         弹出 4，右孩子为空
5     []       [3,4,5]       弹出 5，转向 8
6     [8,7]    [3,4,5]       压 8、压 7
7     []       [3,4,5,7,8]   弹出 7，再弹出 8
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<Integer> inorderTraversal(TreeNode root) {
        List<Integer> res = new ArrayList<>();
        Deque<TreeNode> stack = new ArrayDeque<>();
        TreeNode cur = root;
        while (cur != null || !stack.isEmpty()) {
            // 一路向左，把沿途节点压栈
            while (cur != null) {
                stack.push(cur);
                cur = cur.left;
            }
            // 左边走到头了，弹出的节点左子树已处理完，访问它
            cur = stack.pop();
            res.add(cur.val);
            // 转向右子树，继续同样的过程
            cur = cur.right;
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点恰好入栈一次、出栈一次。
- 空间 O(h)：栈深度等于树高，平衡树为 O(log n)，退化成链时为 O(n)。

## 易错点

- 外层循环条件是 `cur != null || !stack.isEmpty()`，只写其中一个会漏节点（比如弹完根之后栈空，但右子树还没走）。
- 弹出后必须把 `cur` 赋成 `cur.right`，哪怕它是 null；不要写成「右孩子不为空才赋值」，否则会重复压栈同一个节点死循环。
- Java 里用 `ArrayDeque` 当栈，不要用老的 `Stack` 类（同步开销，面试官会注意到）。

## 其他解法

递归版，最直观，面试先写它再改迭代：

```java
import java.util.*;

class Solution {
    public List<Integer> inorderTraversal(TreeNode root) {
        List<Integer> res = new ArrayList<>();
        dfs(root, res);
        return res;
    }

    private void dfs(TreeNode node, List<Integer> res) {
        if (node == null) return;
        dfs(node.left, res);   // 左
        res.add(node.val);     // 根
        dfs(node.right, res);  // 右
    }
}
```

还有 Morris 遍历可以做到 O(1) 额外空间：利用叶子节点空着的右指针临时指回中序后继，遍历完再改回来。了解思路即可。

## 举一反三

- 二叉搜索树的中序遍历是升序序列，这是 [[algo:validate-binary-search-tree]] 和 [[algo:kth-smallest-element-in-a-bst]] 的基础。
- 「手动模拟调用栈」的思路同样适用于前序、后序遍历，以及 [[algo:flatten-binary-tree-to-linked-list]]。

## 一句话记忆

一路向左压栈，弹出即访问，再转向右孩子。
