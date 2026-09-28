## 题意

给一个元素**互不相同**的整数数组 `nums`，返回它的全部子集（幂集），包括空集和它自己。结果里不能有重复子集，顺序不限。

```
输入：nums = [2,5,8]
输出：[[],[2],[2,5],[2,5,8],[2,8],[5],[5,8],[8]]
解释：3 个元素，每个选或不选，共 2^3 = 8 个子集
```

```
输入：nums = [6]
输出：[[],[6]]
```

## 思路

最直观的想法：每个元素只有"选 / 不选"两种状态，n 个元素就是 2^n 种组合。可以用二进制枚举，也可以用回溯。

回溯写法和排列的区别在于**子集不关心顺序**：`[2,5]` 和 `[5,2]` 是同一个子集。为了不重复，规定只能按下标递增的顺序选：递归时传入 `start`，本层只从 `start` 往后挑。另外，子集没有"填满"这个结束条件，决策树上**每个节点**本身就是一个合法子集，所以进入递归时就收集。

:::tip 关键点
组合 / 子集类回溯用 `start` 保证"只往后选"来去重；子集在每个节点都收集，而不是只在叶子收集。
:::

用 `[2,5,8]` 推演（括号里是收集到的子集）：

```
dfs(start=0) ([])
├─ 选2 dfs(1) ([2])
│   ├─ 选5 dfs(2) ([2,5])
│   │   └─ 选8 dfs(3) ([2,5,8])
│   └─ 选8 dfs(3) ([2,8])
├─ 选5 dfs(2) ([5])
│   └─ 选8 dfs(3) ([5,8])
└─ 选8 dfs(3) ([8])
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<Integer>> subsets(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        dfs(nums, 0, new ArrayList<>(), res);
        return res;
    }

    private void dfs(int[] nums, int start, List<Integer> path, List<List<Integer>> res) {
        // 每个节点都是一个子集，进来就收集
        res.add(new ArrayList<>(path));
        // 只从 start 往后选，避免 [2,5] 和 [5,2] 重复
        for (int i = start; i < nums.length; i++) {
            path.add(nums[i]);
            dfs(nums, i + 1, path, res); // 注意是 i + 1，不是 start + 1
            path.remove(path.size() - 1);
        }
    }
}
```

## 复杂度

- 时间 O(n × 2^n)：共 2^n 个子集，每个拷贝最多 O(n)。
- 空间 O(n)：递归深度和 `path` 最多 n（不计结果）。

## 易错点

- 递归参数写成 `start + 1` 而不是 `i + 1`，会产生重复子集。
- 只在 `path.size() == n` 时收集就只剩全集一个结果了；子集要在每个节点收集。
- 别忘了空集 `[]` 也是答案，写法上第一次进入 `dfs` 就会收集它。
- 如果元素有重复（子集 II），要先排序，并在同一层跳过 `i > start && nums[i] == nums[i-1]`。

## 其他解法

二进制枚举：用 `mask` 从 0 到 2^n - 1，第 i 位为 1 就表示选 `nums[i]`。代码短，适合 n 较小的场景。

```java
import java.util.*;

class Solution {
    public List<List<Integer>> subsets(int[] nums) {
        int n = nums.length;
        List<List<Integer>> res = new ArrayList<>();
        for (int mask = 0; mask < (1 << n); mask++) {
            List<Integer> one = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                // 第 i 位为 1 表示选中 nums[i]
                if ((mask >> i & 1) == 1) one.add(nums[i]);
            }
            res.add(one);
        }
        return res;
    }
}
```

## 举一反三

- [[algo:permutations]]：排列每层从全部元素里选，用 `used[]`；子集用 `start`。
- [[algo:combination-sum]]：组合类回溯，同样靠 `start` 去重，加上和的剪枝。
- [[algo:letter-combinations-of-a-phone-number]]：每层的选择来自不同的集合，也是决策树遍历。
- 工程里"权限组合、优惠券叠加方案、特性开关组合测试"都可以看成子集枚举，但要注意 2^n 爆炸。

## 一句话记忆

子集回溯：`start` 只往后选防重复，每个节点都收集一次。
