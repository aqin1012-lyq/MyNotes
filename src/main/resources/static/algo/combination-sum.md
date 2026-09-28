## 题意

给一个元素**互不相同**的正整数数组 `candidates` 和一个目标值 `target`，找出所有和为 `target` 的组合。同一个数可以**重复使用任意次**；两个组合只要各数字出现次数相同就算同一个，不能重复输出。

```
输入：candidates = [5,3,4], target = 8
输出：[[3,5],[4,4]]
解释：3+5 = 8，4+4 = 8；[5,3] 与 [3,5] 算同一个组合
```

```
输入：candidates = [4], target = 3
输出：[]
```

## 思路

暴力想法是每层都从所有数里选，直到和 ≥ target。但这样 `[3,5]` 和 `[5,3]` 会被当成两条路径各收集一次，需要额外去重。

和 [[algo:subsets]] 一样，用 `start` 规定"只能选下标 ≥ start 的数"，组合里的数就按下标非递减排列，天然不重复。区别在于**可以重复选**，所以递归时传 `i` 而不是 `i + 1`。

再加一个剪枝：先把数组排序，当 `remain - candidates[i] < 0` 时，后面更大的数也不可能，直接 `break`。

:::tip 关键点
可重复选 → 递归传 `i`；不可重复选 → 传 `i + 1`。排序后遇到超过剩余值的数直接 break，是这题最有效的剪枝。
:::

排序后 `[3,4,5]`，target = 8 推演（remain 为剩余值）：

```
[] remain=8
├─ 3 remain=5
│   ├─ 3 remain=2  -> 3,4,5 都 > 2, break
│   ├─ 4 remain=1  -> break
│   └─ 5 remain=0  => 收集 [3,5]
├─ 4 remain=4
│   └─ 4 remain=0  => 收集 [4,4]
└─ 5 remain=3      -> 5 > 3, break
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<Integer>> combinationSum(int[] candidates, int target) {
        Arrays.sort(candidates); // 排序后才能 break 剪枝
        List<List<Integer>> res = new ArrayList<>();
        dfs(candidates, 0, target, new ArrayList<>(), res);
        return res;
    }

    private void dfs(int[] c, int start, int remain, List<Integer> path, List<List<Integer>> res) {
        if (remain == 0) {
            res.add(new ArrayList<>(path));
            return;
        }
        for (int i = start; i < c.length; i++) {
            // 剪枝：当前数已经超过剩余值，后面更大的也不行
            if (c[i] > remain) break;
            path.add(c[i]);
            // 传 i：同一个数还可以继续选
            dfs(c, i, remain - c[i], path, res);
            path.remove(path.size() - 1);
        }
    }
}
```

## 复杂度

- 时间：取决于解的个数，上界大约是 O(S)，S 为所有可行路径长度之和；粗略可以说是指数级，剪枝让实际搜索量远小于上界。
- 空间 O(target / min)：递归深度最多是用最小的数凑满 target 的次数（不计结果）。

## 易错点

- 递归传 `i + 1` 就变成"每个数只能用一次"，会漏掉 `[4,4]` 这种解。
- 从 `0` 而不是 `start` 开始循环，会输出 `[3,5]` 和 `[5,3]` 两个重复组合。
- 没排序就用 `break` 剪枝是错的，未排序时只能 `continue`。
- 收集时要拷贝 `new ArrayList<>(path)`。
- 变体"组合总和 II"：每个数只能用一次且数组有重复，需要传 `i + 1` 并跳过同层相同值。

## 举一反三

- [[algo:subsets]]：同样用 `start` 去重，只是没有目标和。
- [[algo:permutations]]：排列关心顺序，用 `used[]` 而不是 `start`。
- [[algo:coin-change]]：同样是"硬币可重复使用凑金额"，但只求最少个数，用 DP 而不是枚举全部方案。
- [[algo:partition-equal-subset-sum]]：每个数只能用一次的"凑目标和"，用 0-1 背包 DP。
- 业务上类似"用若干种面额的优惠券凑满减门槛"，需要列出全部方案时就是这类回溯。

## 一句话记忆

排序 + `start` 防重复 + 传 `i` 允许重复选 + 超过剩余值就 break。
