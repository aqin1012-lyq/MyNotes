## 题意

给一个整数数组，找出所有和为 0 的三元组 `[a, b, c]`，三个数必须来自三个不同的下标。结果里不能有重复的三元组（同样的三个值只算一次），返回顺序不限。

```
输入：nums = [-2,0,1,1,2,-1,-1]
输出：[[-2,0,2],[-2,1,1],[-1,-1,2],[-1,0,1]]
```

```
输入：nums = [0,0,0,0]
输出：[[0,0,0]]
解释：虽然有多种下标组合，但值相同的三元组只保留一个
```

## 思路

暴力三层循环 O(n³)，还要用 Set 去重，又慢又麻烦。

第一步优化：**先排序**。排序有两个好处：一是可以用相向双指针，二是相同的值挨在一起，去重只需要"跳过和前一个相同的值"。

第二步：固定最小的那个数 `nums[i]`，问题就变成在 `i` 右侧的有序区间里找两数之和等于 `-nums[i]`，用 `l = i+1, r = n-1` 相向双指针 O(n) 解决。总体 O(n²)。

:::tip 关键点
排序 + 固定一个 + 双指针，去重发生在两个地方：外层 `i` 跳过与 `nums[i-1]` 相同的值；找到一组解后，`l`、`r` 各自跳过相同的值。
:::

排序后 `[-2,-1,-1,0,1,1,2]`，推演 i=0（nums[i]=-2，目标 l+r 之和为 2）：

```
l  r  nums[l] nums[r]  sum   action
1  6  -1      2        -1    too small, l++
2  6  -1      2        -1    too small, l++
3  6  0       2        0     hit [-2,0,2], l->4, r->5
4  5  1       1        0     hit [-2,1,1], l and r cross
stop
```

i=1（-1）继续得到 `[-1,-1,2]`、`[-1,0,1]`；i=2 与 i=1 值相同，直接跳过。

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<Integer>> threeSum(int[] nums) {
        List<List<Integer>> res = new ArrayList<>();
        Arrays.sort(nums);
        int n = nums.length;
        for (int i = 0; i < n - 2; i++) {
            // 最小的数都大于 0，后面不可能凑出 0
            if (nums[i] > 0) break;
            // 外层去重：同一个值只当一次"第一个数"
            if (i > 0 && nums[i] == nums[i - 1]) continue;
            int l = i + 1, r = n - 1;
            while (l < r) {
                int sum = nums[i] + nums[l] + nums[r];
                if (sum < 0) {
                    l++;
                } else if (sum > 0) {
                    r--;
                } else {
                    res.add(Arrays.asList(nums[i], nums[l], nums[r]));
                    // 内层去重：跳过与当前 l、r 相同的值
                    while (l < r && nums[l] == nums[l + 1]) l++;
                    while (l < r && nums[r] == nums[r - 1]) r--;
                    l++;
                    r--;
                }
            }
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(n²)：排序 O(n log n)；外层 n 次，每次双指针 O(n)。
- 空间 O(log n)：排序所需的栈空间（不计结果列表）。

## 易错点

- 外层去重要和**前一个**比较（`nums[i] == nums[i-1]`），不能和后一个比较，否则会漏掉 `[-1,-1,2]` 这种第一个和第二个数相同的解。
- 内层去重必须在**找到解之后**做，并且跳完之后还要再 `l++`、`r--` 一次。
- `nums[i] > 0` 可以提前 break，但不能写成 `>= 0`，`[0,0,0]` 是合法解。
- 用 `HashSet<List<Integer>>` 去重虽然能过，但面试官通常希望看到排序跳过重复的做法。

## 举一反三

- [[algo:two-sum]]：三数之和的内层就是有序数组上的两数之和。
- [[algo:container-with-most-water]]、[[algo:trapping-rain-water]]：同样的相向双指针，靠"移动哪一边"排除候选。
- 四数之和就是再套一层循环，思路完全相同：排序 + 固定 k-2 个数 + 双指针，同时注意 int 溢出。

## 一句话记忆

排序后固定第一个数，剩下两个用相向双指针找，三处跳过重复值。
