## 题意

给出同一棵二叉树的前序遍历数组和中序遍历数组，还原出这棵树并返回根节点。树中节点值互不相同，两个数组长度相同。

```
输入：preorder = [5,2,1,4,9,7], inorder = [1,2,4,5,7,9]
输出：[5,2,9,1,4,7]
解释：前序第一个 5 是根；在中序中 5 左边的 [1,2,4] 是左子树，右边的 [7,9] 是右子树
```

## 思路

两个遍历各有分工：

- 前序的**第一个元素一定是根**。
- 在中序里找到根的位置 idx，**左边都是左子树，右边都是右子树**，于是也知道了左子树的大小 leftSize = idx - inStart。
- 前序中，根后面紧跟着 leftSize 个左子树节点，再后面是右子树节点。

这样左右子树在两个数组中的区间都确定了，递归即可。暴力做法是每次线性扫描中序找根，最坏 O(n²)；**用 HashMap 预存「值 → 中序下标」**，查找变 O(1)，总体 O(n)。

:::tip 关键点
前序定根，中序分左右，左子树大小 leftSize 把前序区间切开。值唯一，所以用哈希表 O(1) 定位根在中序中的位置。
:::

推演（区间为闭区间下标）：

```
pre[0..5] in[0..5]  root=5 idx=3 leftSize=3
  L: pre[1..3]=[2,1,4]  in[0..2]=[1,2,4]  root=2
  R: pre[4..5]=[9,7]    in[4..5]=[7,9]    root=9, 7 是左孩子
```

## Java 题解

```java
import java.util.*;

class Solution {
    private Map<Integer, Integer> inIndex;
    private int[] preorder;

    public TreeNode buildTree(int[] preorder, int[] inorder) {
        this.preorder = preorder;
        // 预存中序中每个值的位置，O(1) 找根
        inIndex = new HashMap<>();
        for (int i = 0; i < inorder.length; i++) inIndex.put(inorder[i], i);
        return build(0, preorder.length - 1, 0, inorder.length - 1);
    }

    // 用 preorder[ps..pe] 和 inorder[is..ie] 构造子树
    private TreeNode build(int ps, int pe, int is, int ie) {
        if (ps > pe) return null;
        // 前序第一个是根
        TreeNode root = new TreeNode(preorder[ps]);
        int idx = inIndex.get(root.val);
        int leftSize = idx - is;
        // 前序：根之后 leftSize 个是左子树，剩下的是右子树
        root.left = build(ps + 1, ps + leftSize, is, idx - 1);
        root.right = build(ps + leftSize + 1, pe, idx + 1, ie);
        return root;
    }
}
```

## 复杂度

- 时间 O(n)：每个节点创建一次，找根位置 O(1)。
- 空间 O(n)：哈希表 O(n)，递归栈 O(h)。

## 易错点

- 前序区间要用 leftSize 来切，不能直接拿中序下标 idx 当前序下标用，两个数组的偏移不同。
- 区间边界是最容易错的地方：左子树前序是 `[ps+1, ps+leftSize]`，右子树前序是 `[ps+leftSize+1, pe]`，写之前画一下。
- 这个方法依赖节点值唯一；如果有重复值，哈希表定位会出错，题目才会特意保证互不相同。
- 只有前序 + 后序时一般无法唯一确定一棵树（缺少左右划分的信息），中序是关键。

## 举一反三

- 同样「用下标区间递归建树」：[[algo:convert-sorted-array-to-binary-search-tree]]（那里根取中点，这里根由前序给出）。
- 中序与后序构造、前序与后序构造是同一个套路的变体。
- 后端里把「扁平存储的序列」还原成树，比如把数据库里的菜单表、评论表还原成树形结构，也是同一个「先定根、再分组」的思想。

## 一句话记忆

前序定根，中序分左右，leftSize 切前序，哈希表秒定位。
