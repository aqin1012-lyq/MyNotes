## 题意

给一个整数数组 `nums` 和一个目标值 `target`，找出数组里两个**不同位置**的元素，使它们的和等于 `target`，返回这两个下标（顺序无所谓）。题目保证恰好有一组解，同一个元素不能用两次。

```
输入：nums = [5,8,2,4], target = 9
输出：[0,3]
解释：nums[0] + nums[3] = 5 + 4 = 9
```

```
输入：nums = [6,6], target = 12
输出：[0,1]
解释：值相同但下标不同，可以配对
```

## 思路

暴力做法是两层循环枚举所有 (i, j)，判断 `nums[i] + nums[j] == target`，时间 O(n²)。瓶颈在于：对每个 `nums[j]`，我们都在线性地回头找"有没有一个数等于 `target - nums[j]`"。

"查某个值是否出现过、在哪"正是哈希表的强项。一边遍历一边把 `值 → 下标` 放进 HashMap，走到 `j` 时先查补数 `target - nums[j]` 是否已经在表里，在就直接返回；不在再把自己放进去。

:::tip 关键点
先查再放：保证查到的补数一定来自当前元素**之前**的位置，天然避免同一个元素用两次，也能正确处理 `[6,6]` 这种重复值。
:::

用例子 `nums = [5,8,2,4], target = 9` 推演：

```
j  nums[j]  need  map(before)          action
0  5        4     {}                   放入 5->0
1  8        1     {5:0}                放入 8->1
2  2        7     {5:0,8:1}            放入 2->2
3  4        5     {5:0,8:1,2:2}        命中 5 -> [0,3]
```


## Java 题解

```java
import java.util.*;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        // 值 -> 下标，只存当前位置之前出现过的元素
        Map<Integer, Integer> seen = new HashMap<>();
        for (int j = 0; j < nums.length; j++) {
            int need = target - nums[j];
            // 先查：补数是否在前面出现过
            Integer i = seen.get(need);
            if (i != null) {
                return new int[]{i, j};
            }
            // 后放：避免自己和自己配对
            seen.put(nums[j], j);
        }
        return new int[0]; // 题目保证有解，走不到这里
    }
}
```

## 复杂度

- 时间 O(n)：只遍历一次，每次 HashMap 的 get/put 均摊 O(1)。
- 空间 O(n)：最坏情况下几乎所有元素都要进表。

## 易错点

- 先 put 再 get 会导致 `target = 2 * nums[j]` 时把自己和自己配对，比如 `[3,5], target = 6` 会错误返回 `[0,0]`。
- 如果先把所有元素放进表再查，重复值会被后面的下标覆盖，需要额外判断 `i != j`，不如边遍历边查简洁。
- 用 `seen.get(need)` 拿 `Integer` 后判 null，别直接拆箱成 `int`，否则 NPE。
- 题目要的是**下标**，不要先排序再双指针——排序会打乱下标，除非额外记录原下标。

## 举一反三

- [[algo:3sum]]：数组有序后固定一个数，剩下的变成有序数组上的两数之和，用双指针。
- [[algo:subarray-sum-equals-k]]：同样是"边走边查补数"，只不过查的是前缀和 `pre - k`。
- [[algo:longest-consecutive-sequence]]：用 HashSet 把"查某个数在不在"降到 O(1)。
- 工程上这就是典型的"用空间换时间"：把 O(n) 的线性查找换成哈希索引，和给数据库列加索引、用 Redis 做查询缓存是一个思路。

## 一句话记忆

边遍历边把"值→下标"放进哈希表，先查补数再放自己。
