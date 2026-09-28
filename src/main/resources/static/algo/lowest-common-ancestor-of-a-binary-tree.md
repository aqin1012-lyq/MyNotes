## 题意

给一棵二叉树（不是 BST）和树中两个不同的节点 p、q，找出它们的最近公共祖先：既是 p 的祖先又是 q 的祖先、且深度最大的节点。一个节点也算是它自己的祖先。所有节点值互不相同，p 和 q 一定存在。

```
输入：root = [10,4,7,1,6,8,2,null,null,3,9], p = 3, q = 1
输出：4
解释：3 在 4 的右子树（6 的左孩子）里，1 是 4 的左孩子，最近的共同祖先是 4

输入：同一棵树，p = 6, q = 9
输出：6
解释：9 是 6 的孩子，6 本身就是 9 的祖先
```

## 思路

暴力：分别求出根到 p、根到 q 的路径（或者用哈希表记录每个节点的父亲），再从 p 往上走，标记所有祖先，然后从 q 往上走，遇到的第一个被标记的节点就是答案。O(n) 时间，O(n) 额外空间，也是一个合格的解法。

更简洁的是一次后序递归。定义 `lca(node)`：在以 node 为根的子树里找 p 和 q：

- node 为空，或者 node 就是 p 或 q，直接返回 node。
- 否则分别去左右子树找，得到 left 和 right。
- 左右都非空：p、q 分居两侧，node 就是最近公共祖先。
- 只有一边非空：答案（或者找到的那个节点）在那一边，把它往上返回。

:::tip 关键点
返回值的含义是「这棵子树里找到的 p、q 或它们的 LCA」。左右都有返回值时当前节点就是 LCA；否则把非空的那个往上传。
:::

推演（p = 3, q = 1）：

```
node  left   right  return
1     -      -      1      (hit q)
3     -      -      3      (hit p)
9     null   null   null
6     3      null   3
4     1      3      4      <- both sides, LCA
7     null   null   null
10    4      null   4
```

## Java 题解

```java
import java.util.*;

class Solution {
    public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
        // 空树，或者当前节点就是 p / q，直接返回
        if (root == null || root == p || root == q) return root;
        TreeNode left = lowestCommonAncestor(root.left, p, q);
        TreeNode right = lowestCommonAncestor(root.right, p, q);
        // p、q 分别在左右两侧，当前节点就是最近公共祖先
        if (left != null && right != null) return root;
        // 否则把找到的那一边往上传
        return left != null ? left : right;
    }
}
```

## 复杂度

- 时间 O(n)：最坏每个节点访问一次。
- 空间 O(h)：递归栈深度为树高。

## 易错点

- 遇到 p 就直接返回，不再往下找 q，这是对的：如果 q 在 p 的子树里，答案就是 p；如果不在，q 会在别处被找到，最终在更高的节点汇合。
- 比较的是节点引用 `root == p`，不是值；题目值唯一时比较值也行，但引用更准确。
- 这个写法依赖「p、q 都一定在树里」；如果可能不存在，需要额外记录是否真的找到了两个。
- 如果是 BST，可以利用大小关系：p、q 都小于 root 就往左，都大于就往右，否则 root 就是答案，不用遍历整棵树。

## 举一反三

- 同样是「后序递归，根据左右子树的返回值决定当前返回什么」：[[algo:diameter-of-binary-tree]]、[[algo:binary-tree-maximum-path-sum]]。
- 「从两个节点往上走找第一个交点」的暴力思路，就是链表版的 [[algo:intersection-of-two-linked-lists]]。
- 后端里组织架构中「两个员工的最近共同上级」、Git 里两个分支的 merge-base，都是 LCA 问题。

## 一句话记忆

后序找 p、q：左右都找到则当前是 LCA，否则把找到的那边往上传。
