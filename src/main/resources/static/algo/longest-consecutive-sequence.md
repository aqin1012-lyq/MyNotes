## 题意

给一个未排序的整数数组，找出其中数值上连续（每次 +1）的最长一串数字有多长，这些数字在原数组里的位置不要求相邻。要求时间复杂度 O(n)，重复元素只算一次。

```
输入：nums = [10,4,20,1,3,2]
输出：4
解释：1,2,3,4 是最长的连续数字
```

```
输入：nums = [7,7,8,-1,0,9]
输出：3
解释：7,8,9（重复的 7 只算一次）；-1,0 长度只有 2
```

## 思路

最直观的是先排序，再扫一遍统计连续段，O(n log n)，但题目要求 O(n)。

不排序的话，对每个数 x 都往上数 `x+1, x+2, ...` 是否存在——用 HashSet 可以 O(1) 判断存在性。但如果每个数都往上数，`[1,2,3,...,n]` 会退化成 O(n²)：从 1 数 n 步，从 2 数 n-1 步……

优化点：**只从序列的起点开始数**。x 是起点当且仅当 `x-1` 不在集合里。这样每个连续段只会被完整走一遍，所有数加起来总共被访问 O(n) 次。

:::tip 关键点
`!set.contains(x - 1)` 这一句判断把 O(n²) 砍成 O(n)：每个数最多被"作为起点检查一次 + 被某个起点向上数到一次"。
:::

用 `[10,4,20,1,3,2]` 推演，set = {10,4,20,1,3,2}：

```
x    x-1 in set?  action
10   no (9)       start: 10 -> len 1
4    yes (3)      skip
20   no (19)      start: 20 -> len 1
1    no (0)       start: 1,2,3,4 -> len 4
3    yes (2)      skip
2    yes (1)      skip
best = 4
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int longestConsecutive(int[] nums) {
        Set<Integer> set = new HashSet<>();
        for (int x : nums) set.add(x); // 去重 + O(1) 查询
        int best = 0;
        // 遍历 set 而不是 nums，避免大量重复元素重复检查
        for (int x : set) {
            // 只有 x-1 不存在时，x 才是一段连续序列的起点
            if (set.contains(x - 1)) continue;
            int cur = x, len = 1;
            while (set.contains(cur + 1)) {
                cur++;
                len++;
            }
            best = Math.max(best, len);
        }
        return best;
    }
}
```

## 复杂度

- 时间 O(n)：建 set O(n)；外层循环每个元素一次，内层 while 只在起点处展开，每个元素最多被 while 访问一次，总计 O(n)。
- 空间 O(n)：HashSet 存储所有不同元素。

## 易错点

- 忘了"只从起点开始数"的判断，代码能过小数据，但最坏会退化成 O(n²)，面试官一定会追问。
- 外层遍历 `nums` 而不是 `set` 时，如果有大量重复的起点（如一万个 1 加一条长链），会重复展开同一条链；遍历 `set` 更稳。
- 空数组要返回 0，`best` 初始化为 0 即可自然覆盖。
- `x - 1` / `cur + 1` 在 `Integer.MIN_VALUE` / `MAX_VALUE` 附近会溢出绕回，一般题目范围不会触发，但要能说清楚。

## 其他解法

排序后一次扫描：O(n log n)，不满足题目要求，但写法简单、空间 O(1)（不计排序栈），实际工程中也很常用。

```java
import java.util.*;

class Solution {
    public int longestConsecutive(int[] nums) {
        if (nums.length == 0) return 0;
        Arrays.sort(nums);
        int best = 1, len = 1;
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] == nums[i - 1]) continue;      // 重复值跳过，不打断
            if (nums[i] == nums[i - 1] + 1) len++;     // 连续，长度 +1
            else len = 1;                              // 断开，重新计数
            best = Math.max(best, len);
        }
        return best;
    }
}
```

## 举一反三

- [[algo:two-sum]]：同样利用哈希结构把"某个值在不在"变成 O(1)。
- [[algo:first-missing-positive]]：也是在未排序数组里找"连续正整数"相关的性质，但要求 O(1) 额外空间，用原地哈希。
- 工程里类似的场景：统计用户"最长连续签到天数"，把签到日期放进集合后，从"前一天没签到"的日期开始往后数。

## 一句话记忆

放进 HashSet，只从 `x-1` 不存在的起点往上数，每个数只走一次。
