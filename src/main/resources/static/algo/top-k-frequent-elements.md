## 题意

给一个整数数组 nums 和整数 k，返回出现次数最多的 k 个元素，顺序任意。题目保证答案唯一（第 k 名和第 k+1 名的频率不会相同）。进阶要求时间复杂度优于 O(n log n)。

```
输入：nums = [4,4,4,6,6,9,9,9,9,2], k = 2
输出：[9,4]
解释：9 出现 4 次，4 出现 3 次，6 出现 2 次，2 出现 1 次，前两名是 9 和 4
```

## 思路

第一步毫无疑问：用 HashMap 统计每个元素的频率。设不同元素有 m 个。

第二步是在 m 个「(元素, 频率)」里取频率最高的 k 个：

- 暴力：按频率排序，O(m log m)，不满足进阶要求（最坏 m = n）。
- **小根堆**：维护大小为 k 的小根堆，按频率比较，堆顶是当前 Top K 里频率最低的「门槛」。新元素频率超过门槛就替换，O(m log k)。
- **桶排序**：频率的取值范围只有 1 到 n，可以开 n + 1 个桶，`bucket[f]` 放所有频率为 f 的元素，然后从高频桶往低频桶收集，凑够 k 个就停，O(n)。

:::tip 关键点
Top K 频率 = 计数（HashMap）+ 选前 K（小根堆 O(n log k)，或按频率分桶 O(n)）。频率的取值有上界 n，这是能用桶排序的前提。
:::

桶排序推演：

```
count: 4->3, 6->2, 9->4, 2->1
bucket[1]=[2] bucket[2]=[6] bucket[3]=[4] bucket[4]=[9]
from high to low: take 9, take 4 -> k reached
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int[] topKFrequent(int[] nums, int k) {
        // 1. 统计频率
        Map<Integer, Integer> count = new HashMap<>();
        for (int x : nums) count.merge(x, 1, Integer::sum);
        // 2. 小根堆按频率排序，堆顶是 Top K 中频率最低的
        PriorityQueue<int[]> heap = new PriorityQueue<>((a, b) -> a[1] - b[1]);
        for (Map.Entry<Integer, Integer> e : count.entrySet()) {
            heap.offer(new int[]{e.getKey(), e.getValue()});
            // 超过 k 个就把频率最低的踢掉
            if (heap.size() > k) heap.poll();
        }
        // 3. 堆里剩下的就是答案
        int[] res = new int[k];
        for (int i = 0; i < k; i++) res[i] = heap.poll()[0];
        return res;
    }
}
```

## 复杂度

- 小根堆：时间 O(n + m log k)，m 为不同元素个数；空间 O(m + k)。
- 桶排序：时间 O(n)，空间 O(n)。

## 易错点

- 找频率**最高**的 k 个，用的是**小**根堆（堆顶是门槛），和 [[algo:kth-largest-element-in-an-array]] 同理；用大根堆就得把所有元素都放进去，变成 O(m log m)。
- 比较器 `a[1] - b[1]` 在频率这种非负小整数上没问题；比较任意 int 时减法可能溢出，稳妥写法是 `Integer.compare(a[1], b[1])`。
- 桶的大小要开 n + 1，因为频率可以等于 n（数组全是同一个数）。

## 其他解法

桶排序，严格 O(n)：

```java
import java.util.*;

class Solution {
    public int[] topKFrequent(int[] nums, int k) {
        Map<Integer, Integer> count = new HashMap<>();
        for (int x : nums) count.merge(x, 1, Integer::sum);
        // bucket[f] 存放所有出现 f 次的元素，频率最大为 n
        List<List<Integer>> bucket = new ArrayList<>();
        for (int f = 0; f <= nums.length; f++) bucket.add(new ArrayList<>());
        for (Map.Entry<Integer, Integer> e : count.entrySet()) {
            bucket.get(e.getValue()).add(e.getKey());
        }
        // 从高频到低频收集，凑够 k 个就停
        int[] res = new int[k];
        int idx = 0;
        for (int f = nums.length; f >= 1 && idx < k; f--) {
            for (int x : bucket.get(f)) {
                if (idx == k) break;
                res[idx++] = x;
            }
        }
        return res;
    }
}
```

## 举一反三

- 选第 K 大的底层问题：[[algo:kth-largest-element-in-an-array]]；也可以对 (元素, 频率) 做快速选择，期望 O(n)。
- 「HashMap 计数」是很多题的第一步，比如 [[algo:group-anagrams]]。
- 后端里的热搜榜、热门商品 Top N、接口调用量排行都是这个模型；数据量极大时会用 Count-Min Sketch 近似计数 + 小根堆，或 Redis ZSET 的 `ZREVRANGE` 维护排行。

## 一句话记忆

先 HashMap 计数，再用大小为 k 的小根堆（或按频率分桶）挑出前 k。
