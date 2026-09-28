## 题意

判断一棵二叉树是否左右对称：沿着经过根节点的竖直中线对折，左右两半的结构和节点值都完全重合。返回 true 或 false。

```
输入：root = [7,5,5,2,6,6,2]
输出：true

输入：root = [7,5,5,null,6,null,6]
输出：false
解释：左边的 6 挂在 5 的右侧，右边的 6 也挂在 5 的右侧，对折后位置对不上
```

## 思路

一个直观的暴力法：把树翻转一份拷贝，再比较两棵树是否相同；或者分别做「左根右」和「右根左」遍历再比较序列（还得带上 null 占位才不出错）。这些都能做，但要额外空间且容易写错。

更直接的做法是：对称就是**左子树和右子树互为镜像**。定义 `isMirror(a, b)`：两棵树互为镜像，当且仅当 a、b 根值相等，并且 a 的左和 b 的右互为镜像、a 的右和 b 的左互为镜像。

:::tip 关键点
递归函数一次比较**一对**节点，而不是一个节点：外侧对外侧 (a.left, b.right)，内侧对内侧 (a.right, b.left)。
:::

对第一个例子：

```
isMirror(5, 5)             值相等
  isMirror(2, 2) -> true   外侧，都是叶子
  isMirror(6, 6) -> true   内侧，都是叶子
=> true
```

第二个例子中，比较外侧时左边的 5.left 是 null，右边的 5.right 是 6，一空一不空，直接返回 false。

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean isSymmetric(TreeNode root) {
        if (root == null) return true;
        return isMirror(root.left, root.right);
    }

    // 判断两棵树是否互为镜像
    private boolean isMirror(TreeNode a, TreeNode b) {
        // 都为空：对称
        if (a == null && b == null) return true;
        // 只有一个为空，或者值不同：不对称
        if (a == null || b == null || a.val != b.val) return false;
        // 外侧对外侧，内侧对内侧
        return isMirror(a.left, b.right) && isMirror(a.right, b.left);
    }
}
```

## 复杂度

- 时间 O(n)：每个节点最多被比较一次。
- 空间 O(h)：递归栈深度为树高。

## 易错点

- 先判「都为空」再判「一个为空」，顺序反了会空指针。
- 配对是 (左.左, 右.右) 和 (左.右, 右.左)，写成 (左.左, 右.左) 就变成判断两棵树相同了。
- 只比较中序遍历序列是不够的：不同结构可能有相同的中序序列。

## 其他解法

迭代版：用队列成对放入需要比较的节点，每次取出一对来比较。

```java
import java.util.*;

class Solution {
    public boolean isSymmetric(TreeNode root) {
        if (root == null) return true;
        Queue<TreeNode> queue = new LinkedList<>();
        queue.offer(root.left);
        queue.offer(root.right);
        while (!queue.isEmpty()) {
            // 每次取出一对镜像位置的节点
            TreeNode a = queue.poll();
            TreeNode b = queue.poll();
            if (a == null && b == null) continue;
            if (a == null || b == null || a.val != b.val) return false;
            queue.offer(a.left);
            queue.offer(b.right);
            queue.offer(a.right);
            queue.offer(b.left);
        }
        return true;
    }
}
```

注意这里要用 `LinkedList`，因为 `ArrayDeque` 不允许放 null。

## 举一反三

- 和 [[algo:invert-binary-tree]] 是一对：对称树 = 左子树翻转后等于右子树。
- 「递归函数同时接收两个节点」的写法也出现在判断两棵树相同、子树判断等题里。

## 一句话记忆

对称就是左右子树互为镜像：值相等，外侧配外侧，内侧配内侧。
