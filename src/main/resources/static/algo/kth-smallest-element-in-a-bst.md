## 题意

给一棵二叉搜索树和整数 k（1 ≤ k ≤ 节点数），返回树中第 k 小的节点值。进阶追问：如果树会被频繁增删，又要频繁查第 k 小，怎么优化？

```
输入：root = [8,4,11,2,6,null,13], k = 4
输出：8
解释：从小到大依次是 2、4、6、8、11、13，第 4 个是 8
```

## 思路

暴力：把所有值取出来排序，取第 k 个，O(n log n)，完全没用上 BST 的性质。

BST 的中序遍历就是升序序列，所以**中序遍历到第 k 个节点时直接返回**即可。用迭代中序还有个好处：找到就能立刻停，不用走完整棵树，时间是 O(h + k)。

:::tip 关键点
BST + 「第几小」= 中序遍历计数，数到 k 就停。
:::

推演（迭代中序）：

```
pop    2   4   6   8
count  1   2   3   4   -> return 8
```

进阶：如果要频繁查询，可以在每个节点上额外维护「以它为根的子树节点数 size」。在某节点处，若左子树大小 L 满足 L + 1 == k，答案就是它；k ≤ L 往左走；否则 k 减去 L + 1 往右走。这样单次查询 O(h)，增删时沿路径更新 size 即可。

## Java 题解

```java
import java.util.*;

class Solution {
    public int kthSmallest(TreeNode root, int k) {
        Deque<TreeNode> stack = new ArrayDeque<>();
        TreeNode cur = root;
        while (cur != null || !stack.isEmpty()) {
            // 一路向左压栈
            while (cur != null) {
                stack.push(cur);
                cur = cur.left;
            }
            cur = stack.pop();
            // 中序第 k 个就是答案，找到立即返回
            if (--k == 0) return cur.val;
            cur = cur.right;
        }
        return -1; // 题目保证 k 合法，不会走到这里
    }
}
```

## 复杂度

- 时间 O(h + k)：先下降到最左节点花 O(h)，之后再弹出 k 个节点。
- 空间 O(h)：栈深度为树高。

## 易错点

- 计数时机在「弹出节点时」，不是入栈时；入栈顺序不是有序的。
- 递归写法找到答案后要能提前结束，否则即使记录了答案也会把整棵树走完。
- k 是从 1 开始数的，`--k == 0` 和 `k-- == 0` 差一位，写之前想清楚。

## 其他解法

递归中序 + 计数，用成员变量记录剩余次数和结果：

```java
import java.util.*;

class Solution {
    private int count;
    private int ans;

    public int kthSmallest(TreeNode root, int k) {
        count = k;
        inorder(root);
        return ans;
    }

    private void inorder(TreeNode node) {
        // count 已经为 0 说明答案找到了，剪枝
        if (node == null || count == 0) return;
        inorder(node.left);
        if (count == 0) return;
        if (--count == 0) {
            ans = node.val;
            return;
        }
        inorder(node.right);
    }
}
```

## 举一反三

- 中序有序的另一个应用是 [[algo:validate-binary-search-tree]]。
- 如果不是 BST 而是普通数组求第 k 大/小，就用堆或快速选择：[[algo:kth-largest-element-in-an-array]]。
- 进阶里「节点带子树大小」就是顺序统计树的思想；Redis 跳表的 span 字段让 `ZRANK` 能按排名定位，是同一个道理。

## 一句话记忆

BST 第 k 小 = 中序遍历数到第 k 个。
