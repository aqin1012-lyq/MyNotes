## 题意

给一个元素**互不相同**的整数数组 `nums`，返回它的所有排列（每个元素恰好用一次，顺序不同算不同排列），结果顺序不限。数组长度很小（不超过 6）。

```
输入：nums = [4,7,9]
输出：[[4,7,9],[4,9,7],[7,4,9],[7,9,4],[9,4,7],[9,7,4]]
解释：3 个数共 3! = 6 种排列
```

```
输入：nums = [5]
输出：[[5]]
```

## 思路

排列可以看成"一个格子一个格子地填"：第 1 格有 n 种选法，第 2 格从剩下的 n-1 个里选……这天然是一棵决策树，叶子就是一个完整排列。暴力写 n 层 for 循环不可行（n 不固定），所以用递归来表达"再往下填一格"。

递归到某一层时需要知道：当前路径 `path` 已经填了哪些数、哪些数还没用过（`used[]`）。每层遍历所有数，跳过已用的，选一个加入路径 → 递归 → 撤销选择，这就是回溯的"做选择 / 撤销选择"。

:::tip 关键点
回溯模板 = 路径 + 选择列表 + 结束条件。排列问题每层都从**所有**元素里挑，用 `used[]` 排除已选；路径长度等于 n 时收集一份**拷贝**。
:::

用 `[4,7,9]` 推演决策树的前几步：

```
[]
├─ [4]
│   ├─ [4,7] -> [4,7,9]  收集
│   └─ [4,9] -> [4,9,7]  收集
├─ [7]
│   ├─ [7,4] -> [7,4,9]
│   └─ [7,9] -> [7,9,4]
└─ [9] ...
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<Integer>> permute(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        backtrack(nums, new boolean[nums.length], new ArrayList<>(), res);
        return res;
    }

    private void backtrack(int[] nums, boolean[] used, List<Integer> path, List<List<Integer>> res) {
        // 结束条件：每个位置都填满了
        if (path.size() == nums.length) {
            res.add(new ArrayList<>(path)); // 必须拷贝
            return;
        }
        for (int i = 0; i < nums.length; i++) {
            if (used[i]) continue; // 已经在路径里
            // 做选择
            used[i] = true;
            path.add(nums[i]);
            backtrack(nums, used, path, res);
            // 撤销选择
            path.remove(path.size() - 1);
            used[i] = false;
        }
    }
}
```

## 复杂度

- 时间 O(n × n!)：共 n! 个叶子，每个叶子拷贝路径要 O(n)。
- 空间 O(n)：递归深度、`path` 和 `used` 都是 O(n)（不计结果本身）。

## 易错点

- 收集结果时写成 `res.add(path)` 会让所有结果指向同一个 list，最后全是空的，必须 `new ArrayList<>(path)`。
- `path.remove(path.size() - 1)` 按下标删除；如果写成 `path.remove(Integer.valueOf(x))` 也行，但写成 `path.remove(x)`（int）会被当成下标。
- 撤销选择时 `used[i] = false` 别忘，否则后续分支会少元素。
- 本题元素互不相同；如果有重复元素（全排列 II），需要先排序并跳过"同层相同且前一个未用"的元素。

## 其他解法

交换法：把 `nums[first..]` 看作待填区，依次把每个元素换到 `first` 位置，递归处理 `first+1`，回来后再换回去。不需要 `used[]`，但输出顺序不是字典序。

```java
import java.util.*;

class Solution {
    public List<List<Integer>> permute(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        dfs(nums, 0, res);
        return res;
    }

    private void dfs(int[] nums, int first, List<List<Integer>> res) {
        if (first == nums.length) {
            List<Integer> one = new ArrayList<>();
            for (int x : nums) one.add(x);
            res.add(one);
            return;
        }
        for (int i = first; i < nums.length; i++) {
            swap(nums, first, i);   // 把 nums[i] 放到当前位置
            dfs(nums, first + 1, res);
            swap(nums, first, i);   // 换回来，恢复现场
        }
    }

    private void swap(int[] a, int i, int j) {
        int t = a[i]; a[i] = a[j]; a[j] = t;
    }
}
```

## 举一反三

- [[algo:subsets]]：同样是回溯，但子集用 `start` 下标控制"只往后选"，每个节点都收集。
- [[algo:combination-sum]]：组合类回溯，靠 `start` 去重，靠剪枝提速。
- [[algo:n-queens]]：逐行放皇后，本质是带约束的排列。
- [[algo:next-permutation]]：不枚举全部，只求字典序的下一个排列。

## 一句话记忆

排列回溯：每层从所有数里挑一个没用过的，`used[]` 标记，填满就收集拷贝，回来记得撤销。
