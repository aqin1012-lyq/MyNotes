## 题意

二叉树中的「路径」是任意一串沿父子边相连的节点，每个节点最多出现一次，路径至少包含一个节点，不要求经过根。求所有路径中节点值之和的最大值。节点值可以为负。

```
输入：root = [2,-6,5,4,-1,3,-8]
输出：10
解释：最优路径是 3 → 5 → 2，和为 10；想把左边的 4 接进来就得经过 -6，反而更小

输入：root = [-4,-2,-7]
输出：-2
解释：全是负数时，最优路径只包含最大的那个节点
```

## 思路

暴力：枚举每个节点作为路径的「最高点」（拐弯点），再分别求它向左、向右能延伸出的最大单边和，O(n²)。

优化方法和 [[algo:diameter-of-binary-tree]] 完全一致：一次后序遍历，递归函数返回「从当前节点出发向下的最大单边路径和」（给父节点用），同时在当前节点处计算「以它为拐弯点的路径和」更新全局答案。

多出来的一个细节是负数：如果某一侧的单边和是负的，接上它只会让和变小，**不如不接**，所以取 `max(0, 子树贡献)`。

:::tip 关键点
返回给父节点的是单边：`node.val + max(0, 左贡献, 右贡献)`；更新答案用的是拐弯路径：`node.val + max(0, 左) + max(0, 右)`。负贡献直接丢弃。
:::

推演第一个例子（gain 为返回给父节点的单边贡献）：

```
node  L gain  R gain  path via node      gain
4     0       0       4                  4
-1    0       0       -1                 -1
-6    4       0(-1)   -6+4+0 = -2        -2
3     0       0       3                  3
-8    0       0       -8                 -8
5     3       0(-8)   5+3+0 = 8          8
2     0(-2)   8       2+0+8 = 10         10   <- max
```

## Java 题解

```java
import java.util.*;

class Solution {
    private int best;

    public int maxPathSum(TreeNode root) {
        // 答案至少是某个节点的值，初始化为最小值而不是 0
        best = Integer.MIN_VALUE;
        gain(root);
        return best;
    }

    // 返回从 node 出发向下的最大单边路径和
    private int gain(TreeNode node) {
        if (node == null) return 0;
        // 负贡献不如不要
        int left = Math.max(0, gain(node.left));
        int right = Math.max(0, gain(node.right));
        // 以 node 为拐弯点的路径，更新全局答案
        best = Math.max(best, node.val + left + right);
        // 返回给父节点只能选一边
        return node.val + Math.max(left, right);
    }
}
```

## 复杂度

- 时间 O(n)：每个节点访问一次。
- 空间 O(h)：递归栈深度为树高。

## 易错点

- `best` 初始化成 0 是错的：全负数的树答案是负数（第二个例子应为 -2）。
- 返回值不能是 `node.val + left + right`：一条路径经过父节点后不能在当前节点再分叉。
- 对子树贡献取 `max(0, ...)`，但当前节点自身的值即使为负也必须算上，因为路径至少包含一个节点，且要经过它。
- 题目的数据范围保证和不会超出 int；如果放宽范围要换 `long`。

## 举一反三

- 模板完全相同，只是没有负数问题：[[algo:diameter-of-binary-tree]]。
- 「负贡献就丢弃」的贪心思想和一维的 [[algo:maximum-subarray]]（Kadane 算法）一脉相承，这题就是它的树形版本。
- 同样用后序返回值决策的：[[algo:lowest-common-ancestor-of-a-binary-tree]]。

## 一句话记忆

后序求单边最大贡献（负的丢掉），在每个节点用 左 + 自己 + 右 更新答案。
