## 题意

给一个严格升序的整数数组，用它的全部元素构造一棵**高度平衡**的二叉搜索树（任意节点左右子树高度差不超过 1），返回根节点。答案不唯一，任意一种合法结果都可以。

```
输入：nums = [1,3,5,7,9,11]
输出：[5,1,9,null,3,7,11]
解释：取中间偏左的 5 作根，左边 [1,3] 建左子树，右边 [7,9,11] 建右子树，递归下去
```

## 思路

如果按顺序依次插入 BST，升序数组会退化成一条链，高度 n，不满足平衡。

关键观察：BST 的中序遍历就是升序数组，所以**数组里任意一个元素作根，它左边的元素都应在左子树、右边的都在右子树**。要平衡，就让左右两边个数尽量相等，也就是**选中点作根**。然后左半段、右半段各自是同样的子问题，递归即可。

:::tip 关键点
「有序数组 + 平衡」= 每次取中点作根，左右两半递归建树，和二分查找是同一个结构。
:::

推演（区间用下标 [l, r]，mid = (l + r) / 2）：

```
build(0,5)  mid=2  root=5
  build(0,1)  mid=0  root=1
    build(1,1)  mid=1  root=3   (1 的右孩子)
  build(3,5)  mid=4  root=9
    build(3,3)  root=7
    build(5,5)  root=11
```

## Java 题解

```java
import java.util.*;

class Solution {
    public TreeNode sortedArrayToBST(int[] nums) {
        return build(nums, 0, nums.length - 1);
    }

    // 用 nums[l..r] 构造平衡 BST
    private TreeNode build(int[] nums, int l, int r) {
        if (l > r) return null;
        // 取中点作根，保证左右两边元素个数最多差 1
        int mid = l + (r - l) / 2;
        TreeNode root = new TreeNode(nums[mid]);
        root.left = build(nums, l, mid - 1);
        root.right = build(nums, mid + 1, r);
        return root;
    }
}
```

## 复杂度

- 时间 O(n)：每个元素恰好生成一个节点。
- 空间 O(log n)：树是平衡的，递归深度为 O(log n)（不计结果树本身）。

## 易错点

- 用闭区间 `[l, r]` 时终止条件是 `l > r`；如果用左闭右开 `[l, r)`，终止条件是 `l >= r`，两种写法别混用。
- 中点写成 `l + (r - l) / 2` 防溢出是个好习惯（这题数组不大，但面试官会看）。
- 不要用 `Arrays.copyOfRange` 切数组递归，会多出 O(n log n) 的复制开销，传下标就够了。

## 举一反三

- 反向操作是 [[algo:binary-tree-inorder-traversal]]：BST 中序遍历回到有序数组。
- 「用下标区间递归建树」的套路也用在 [[algo:construct-binary-tree-from-preorder-and-inorder-traversal]] 和归并排序 [[algo:sort-list]] 中。
- 平衡树保证 O(log n) 查找，这正是数据库 B+ 树索引、Java `TreeMap`（红黑树）要维持平衡的原因。

## 一句话记忆

有序数组建平衡 BST：取中点作根，左右两半递归。
