## 题意

把一棵二叉树**原地**改造成一条「链表」：仍然用 TreeNode，所有节点的 left 置为 null，right 指向下一个节点，节点顺序与原树的前序遍历（根 → 左 → 右）一致。函数不返回值。进阶：额外空间 O(1)。

```
输入：root = [3,9,6,1,2,null,8]
输出：[3,null,9,null,1,null,2,null,6,null,8]
解释：前序顺序是 3、9、1、2、6、8，展开后每个节点只剩右指针依次相连
```

## 思路

最简单的做法：先前序遍历把节点存进 List，再依次把它们连起来。O(n) 时间但要 O(n) 额外空间。

要做到 O(1) 空间，看单个节点 cur 该怎么处理：前序中，cur 后面紧跟的是它的左子树，左子树走完之后才轮到右子树。而**左子树在前序里的最后一个节点**，是左子树里「一路向右走到底」的那个节点（记作 pre）。所以：

1. 把 cur 的右子树接到 pre.right 上；
2. 把整个左子树挪到 cur.right，cur.left 置空；
3. cur 往右走一步，重复。

:::tip 关键点
找到左子树的最右节点 pre，把右子树挂到 pre 后面，再把左子树整体搬到右边。每个节点只做一次这种「搬运」，就是 O(1) 空间（和 Morris 遍历同源）。
:::

推演：

```
cur=3  pre=2  2.right=6  3.right=9  3.left=null
       chain: 3 -> 9(left 1, right 2 -> 6 -> 8)
cur=9  pre=1  1.right=2  9.right=1  9.left=null
       chain: 3 -> 9 -> 1 -> 2 -> 6 -> 8
cur=1,2,6,8   left is null, move right
```

## Java 题解

```java
import java.util.*;

class Solution {
    public void flatten(TreeNode root) {
        TreeNode cur = root;
        while (cur != null) {
            if (cur.left != null) {
                // 找左子树在前序中的最后一个节点：一路向右到底
                TreeNode pre = cur.left;
                while (pre.right != null) pre = pre.right;
                // 右子树接到 pre 后面
                pre.right = cur.right;
                // 左子树搬到右边，左指针置空
                cur.right = cur.left;
                cur.left = null;
            }
            // 沿着已经展开的链往下走
            cur = cur.right;
        }
    }
}
```

## 复杂度

- 时间 O(n)：每个节点作为 cur 一次；寻找 pre 时走过的右链上的节点，之后不会再作为「右链」被重复走（每条边最多被扫两次）。
- 空间 O(1)：只用了几个指针。

## 易错点

- 忘记 `cur.left = null`，结果里残留左指针，判题会失败。
- 先把 `cur.right = cur.left` 再去接右子树，会把原右子树弄丢；必须先 `pre.right = cur.right`。
- 递归写法如果按「根 → 左 → 右」前序边遍历边改指针，右孩子会被覆盖；要么先保存左右孩子，要么倒过来做。

## 其他解法

逆前序递归：按「右 → 左 → 根」遍历，用 prev 记住上一个处理的节点，把当前节点的 right 指向 prev。这样处理顺序正好是前序的倒序，链表从尾巴往头拼。

```java
import java.util.*;

class Solution {
    private TreeNode prev = null;

    public void flatten(TreeNode root) {
        if (root == null) return;
        // 倒着处理：先右、再左、最后根
        flatten(root.right);
        flatten(root.left);
        root.right = prev;
        root.left = null;
        prev = root;
    }
}
```

## 举一反三

- 前序遍历本身：参考 [[algo:binary-tree-inorder-traversal]] 的栈模拟思路。
- 同样是「原地改指针」的链表题：[[algo:reverse-linked-list]]。
- 利用空右指针做线索的思想就是 Morris 遍历。

## 一句话记忆

左子树最右节点接住右子树，左子树整体搬到右边，cur 右移。
