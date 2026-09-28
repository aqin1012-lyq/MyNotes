## 题意

设计一个数据结构 MedianFinder，支持两个操作：`addNum(num)` 从数据流中加入一个整数，`findMedian()` 返回目前所有数的中位数。个数为奇数时是中间那个数，为偶数时是中间两个数的平均值（返回 double）。两种操作会交替调用很多次。

```
操作：addNum(5), findMedian(), addNum(1), findMedian(), addNum(8), findMedian()
输出：[null, 5.0, null, 3.0, null, 5.0]
解释：{5} 中位数 5；{1,5} 中位数 (1+5)/2 = 3；{1,5,8} 中位数 5
```

## 思路

暴力一：每次 findMedian 都排序，O(n log n)。暴力二：维护有序数组，插入时二分找位置，但数组插入要搬移元素，仍是 O(n)。

中位数只关心「中间」，不需要整体有序。把所有数切成两半：

- **较小的一半**放进**大根堆** small，堆顶是这一半里最大的；
- **较大的一半**放进**小根堆** large，堆顶是这一半里最小的。

只要保证 small 的所有元素 ≤ large 的所有元素，并且两边个数相等或 small 多一个，那么中位数就只和两个堆顶有关：奇数个时是 small 的堆顶，偶数个时是两个堆顶的平均值。

插入时怎么维护这两个条件？一个不容易出错的写法：**新数先放进 small，再把 small 的堆顶（最大值）挪到 large**，这保证了有序性；如果此时 large 比 small 多，再把 large 的堆顶挪回 small，保证数量关系。

:::tip 关键点
大根堆存较小的一半，小根堆存较大的一半，两边数量差不超过 1。中位数只看两个堆顶。插入时「先进 small，挪堆顶到 large，数量失衡再挪回来」。
:::

推演：

```
op       small(max-heap)  large(min-heap)  median
add 5    [5]              []               5.0
add 1    [1]              [5]              (1+5)/2 = 3.0
add 8    [5,1]            [8]              5.0
```

加入 8 的过程：8 进 small 得 [8,1]，挪 8 到 large 得 small=[1]，large=[5,8]；large 多了，挪 5 回 small，得 small=[5,1]，large=[8]。

## Java 题解

```java
import java.util.*;

class MedianFinder {
    // 较小的一半，大根堆，堆顶是这一半的最大值
    private final PriorityQueue<Integer> small = new PriorityQueue<>(Collections.reverseOrder());
    // 较大的一半，小根堆，堆顶是这一半的最小值
    private final PriorityQueue<Integer> large = new PriorityQueue<>();

    public MedianFinder() {
    }

    public void addNum(int num) {
        // 先进 small，再把 small 的最大值挪到 large，保证 small 全部 <= large
        small.offer(num);
        large.offer(small.poll());
        // 保证 small 的个数 >= large，且最多多一个
        if (large.size() > small.size()) {
            small.offer(large.poll());
        }
    }

    public double findMedian() {
        if (small.size() > large.size()) return small.peek();
        // 偶数个：两个堆顶取平均，先转 double 防止整数除法和溢出
        return ((double) small.peek() + large.peek()) / 2.0;
    }
}
```

## 复杂度

- addNum：O(log n)，常数次堆的插入 / 删除。
- findMedian：O(1)，只看堆顶。
- 空间 O(n)：所有数都存在两个堆里。

## 易错点

- 大根堆要传 `Collections.reverseOrder()`，Java 的 `PriorityQueue` 默认是小根堆。
- 不能只按数量交替放进两个堆，必须保证「small 全部 ≤ large」，否则堆顶就不是中位数了。
- 求平均时 `(small.peek() + large.peek()) / 2` 是整数除法，并且两个大 int 相加会溢出；先转成 double 或 long。
- 两个堆的大小约定（奇数时多的那个在 small）要在 addNum 和 findMedian 里保持一致。

## 举一反三

- 堆的基础用法：[[algo:kth-largest-element-in-an-array]]、[[algo:top-k-frequent-elements]]。
- 另一道「中位数」题是 [[algo:median-of-two-sorted-arrays]]，那里数据静态有序，用二分切分；本题数据流式到来，用双堆切分。思想都是「把数据切成左右两半」。
- 进阶：如果所有数都在 0~100 之间，可以用计数数组，O(1) 插入、O(100) 查询。
- 后端场景：监控系统里实时统计接口响应时间的中位数（P50）；更一般的 P99 等分位数在海量数据下通常用 t-digest 等近似算法。

## 一句话记忆

大根堆装小的一半，小根堆装大的一半，数量差不超过 1，中位数看堆顶。
