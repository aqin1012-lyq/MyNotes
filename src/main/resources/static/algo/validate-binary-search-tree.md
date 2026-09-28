## 题意

判断一棵二叉树是不是合法的二叉搜索树：对每个节点，它**整个左子树**的所有值都严格小于它，**整个右子树**的所有值都严格大于它。节点值可能取到 int 的最小值和最大值。

```
输入：root = [10,5,15,null,null,12,20]
输出：true

输入：root = [10,5,15,null,null,8,20]
输出：false
解释：8 是 15 的左孩子，局部看 8 < 15 没问题，但 8 位于根 10 的右子树里，却比 10 小
```

## 思路

最容易踩的坑是只比较父子：`left.val < root.val < right.val`。第二个例子就能骗过这种写法。

正确做法一：**给每个节点传一个允许的取值区间 (low, high)**。根节点区间是 (-∞, +∞)；往左走，上界收紧为当前值；往右走，下界收紧为当前值。任一节点落在区间外就不合法。

正确做法二：利用「BST 的中序遍历严格递增」，中序遍历时记录上一个值，发现不递增就返回 false。

:::tip 关键点
BST 的约束是「祖先传下来的区间」而不是「父子关系」。往下递归时把上下界带下去；或者用中序遍历严格递增来判断。
:::

第二个例子按区间推演：

```
node  range             result
10    (-inf, +inf)      ok
5     (-inf, 10)        ok
15    (10, +inf)        ok
8     (10, 15)          8 <= 10, 不合法
```

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean isValidBST(TreeNode root) {
        // 用 long 做边界，避免节点值恰好是 Integer.MIN_VALUE / MAX_VALUE
        return check(root, Long.MIN_VALUE, Long.MAX_VALUE);
    }

    // 判断以 node 为根的子树是否所有值都在开区间 (low, high) 内且各自合法
    private boolean check(TreeNode node, long low, long high) {
        if (node == null) return true;
        if (node.val <= low || node.val >= high) return false;
        // 往左走上界收紧，往右走下界收紧
        return check(node.left, low, node.val) && check(node.right, node.val, high);
    }
}
```

## 复杂度

- 时间 O(n)：每个节点检查一次。
- 空间 O(h)：递归栈深度为树高。

## 易错点

- 只比较父子会漏掉「隔代」违规，必须带上祖先传下来的区间。
- 边界用 `Integer.MIN_VALUE` 作初值时，节点值正好等于它会被误判；用 `long` 边界或用 `null` 表示无界。
- BST 要求严格小于/大于，相等也不合法，所以是 `<=` 和 `>=` 判失败。

## 其他解法

中序遍历迭代版，检查序列是否严格递增：

```java
import java.util.*;

class Solution {
    public boolean isValidBST(TreeNode root) {
        Deque<TreeNode> stack = new ArrayDeque<>();
        TreeNode cur = root;
        // 上一个访问的节点，初始为空
        TreeNode prev = null;
        while (cur != null || !stack.isEmpty()) {
            while (cur != null) {
                stack.push(cur);
                cur = cur.left;
            }
            cur = stack.pop();
            // 中序必须严格递增
            if (prev != null && cur.val <= prev.val) return false;
            prev = cur;
            cur = cur.right;
        }
        return true;
    }
}
```

用 `prev` 节点而不是 `long` 型的 prev 值，就完全不用担心 int 极值问题。

## 举一反三

- 中序有序这一性质还用于 [[algo:kth-smallest-element-in-a-bst]]；中序迭代模板见 [[algo:binary-tree-inorder-traversal]]。
- 「递归时往下传约束」的思路也出现在 [[algo:path-sum-iii]]（往下传前缀和）。

## 一句话记忆

BST 看祖先区间不看父子：往下传 (low, high)，或中序严格递增。
