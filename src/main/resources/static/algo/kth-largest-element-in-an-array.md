## 题意

给一个整数数组 nums 和整数 k，返回数组排序后第 k 大的元素（按排序位置算，重复元素各占一位，不是第 k 个不同的值）。要求尽量做到 O(n) 时间。

```
输入：nums = [7,2,9,4,9,1], k = 2
输出：9
解释：从大到小是 9,9,7,4,2,1，第 2 大仍是 9（重复值各算一个）

输入：nums = [7,2,9,4,9,1], k = 4
输出：4
```

## 思路

暴力：整体排序后取 `nums[n - k]`，O(n log n)。面试官通常会要求更好的做法。

**做法一：大小为 k 的小根堆**。维护「目前见过的最大的 k 个数」，堆顶是这 k 个里最小的。新来的数比堆顶大，就替换掉堆顶。扫完后堆顶就是第 k 大。O(n log k)，适合数据量大、k 小、甚至是数据流的场景。

**做法二：快速选择（quickselect）**。借用快排的 partition：选一个基准把数组分成「大于基准 / 等于基准 / 小于基准」三段，然后只需要进入第 k 大所在的那一段继续找，另一段直接丢掉。平均每次问题规模减半，期望 O(n)。

:::tip 关键点
Top K 两板斧：小根堆（O(n log k)，可处理流式数据）和快速选择（期望 O(n)，只进一边递归）。快速选择要随机选基准并做三路划分，否则遇到有序或大量重复的数据会退化成 O(n²)。
:::

快速选择推演（k = 4，找第 4 大，三路划分为「大 | 等 | 小」）：

```
nums=[7,2,9,4,9,1] pivot=4
  big=[7,9,9]  eq=[4]  small=[2,1]
  k=4 > |big|=3, k <= |big|+|eq|=4  -> answer is 4
```

## Java 题解

原地快速选择，按从大到小的顺序三路划分，第 k 大就是降序下标 k - 1 处的元素：

```java
import java.util.*;

class Solution {
    private final Random random = new Random();

    public int findKthLargest(int[] nums, int k) {
        int target = k - 1; // 降序排列后的目标下标
        int lo = 0, hi = nums.length - 1;
        while (true) {
            // 随机选基准，避免有序数据退化
            int pivot = nums[lo + random.nextInt(hi - lo + 1)];
            // 三路划分：[lo,lt) 大于 pivot，[lt,gt] 等于，(gt,hi] 小于
            int lt = lo, i = lo, gt = hi;
            while (i <= gt) {
                if (nums[i] > pivot) swap(nums, lt++, i++);
                else if (nums[i] < pivot) swap(nums, i, gt--);
                else i++;
            }
            // 只进入目标所在的那一段
            if (target < lt) hi = lt - 1;
            else if (target > gt) lo = gt + 1;
            else return pivot;
        }
    }

    private void swap(int[] a, int i, int j) {
        int t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
}
```

## 复杂度

- 快速选择：期望时间 O(n)（n + n/2 + n/4 + ... ≈ 2n），最坏 O(n²) 但随机化后概率极低；空间 O(1)。
- 小根堆：时间 O(n log k)，空间 O(k)。

## 易错点

- 小根堆还是大根堆别搞反：找第 k **大**用大小为 k 的**小**根堆，堆顶是门槛。
- 快速选择不随机化，遇到已排序数组会退化成 O(n²)；只做两路划分，遇到大量重复元素（比如全是同一个数）也会退化，三路划分可以解决。
- 三路划分中，和 `gt` 交换后 `i` 不能自增，因为换过来的元素还没检查过。
- 第 k 大对应升序下标 `n - k`，对应降序下标 `k - 1`，换算别错位。

## 其他解法

小根堆，代码短，面试中最稳妥的写法：

```java
import java.util.*;

class Solution {
    public int findKthLargest(int[] nums, int k) {
        // 小根堆保存目前最大的 k 个数，堆顶是其中最小的
        PriorityQueue<Integer> heap = new PriorityQueue<>();
        for (int x : nums) {
            if (heap.size() < k) {
                heap.offer(x);
            } else if (x > heap.peek()) {
                // 比门槛大，替换掉堆顶
                heap.poll();
                heap.offer(x);
            }
        }
        return heap.peek();
    }
}
```

## 举一反三

- 按频率的 Top K：[[algo:top-k-frequent-elements]]；BST 上的第 k 小：[[algo:kth-smallest-element-in-a-bst]]。
- 快速选择的 partition 和快速排序同源；多路合并用堆：[[algo:merge-k-sorted-lists]]。
- 后端里的热门商品排行、慢 SQL Top N、日志里访问量最高的 IP，海量数据流式处理时都用「大小为 K 的小根堆」。

## 一句话记忆

第 k 大：大小为 k 的小根堆守门槛，或随机三路快速选择只走一边。
