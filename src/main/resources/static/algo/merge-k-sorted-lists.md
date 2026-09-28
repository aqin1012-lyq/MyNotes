## 题意

给一个数组 `lists`，里面有 k 条各自已按升序排好的单链表（某些可能为空，数组本身也可能为空）。把它们合并成一条升序链表并返回。k 最多约 10^4，所有链表的结点总数 N 也在 10^4 量级。

```
输入：lists = [[2,6,9],[1,7],[4,5,8]]
输出：[1,2,4,5,6,7,8,9]

输入：lists = [[],[]]
输出：[]
```

## 思路

**逐条合并**：结果链表先和第 1 条合并，再和第 2 条合并……每次合并都要把越来越长的结果重新走一遍，总时间 O(kN)。

**瓶颈**：每一步我们只想知道"k 个链表头中最小的是谁"。线性扫描 k 个头是 O(k)，而小顶堆可以做到 O(log k)。

:::tip 关键点
把每条链表的头结点放进按 `val` 排序的小顶堆。每次弹出堆顶（全局最小）接到结果尾部，如果它还有 `next`，就把 `next` 放入堆。堆里始终最多 k 个结点，总共弹出 N 次，O(N log k)。
:::

推演 `[[2,6,9],[1,7],[4,5,8]]`：

```
堆中(值)     弹出  放入   结果
{2,1,4}      1     7      1
{2,4,7}      2     6      1,2
{4,6,7}      4     5      1,2,4
{5,6,7}      5     8      1,2,4,5
{6,7,8}      6     9      1,2,4,5,6
{7,8,9}      7     -      ...,7
{8,9}        8     -      ...,8
{9}          9     -      ...,9
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode mergeKLists(ListNode[] lists) {
        // 小顶堆，按结点值排序
        PriorityQueue<ListNode> pq = new PriorityQueue<>((a, b) -> Integer.compare(a.val, b.val));
        for (ListNode head : lists) {
            if (head != null) pq.offer(head); // 空链表不入堆
        }
        ListNode dummy = new ListNode(0), tail = dummy;
        while (!pq.isEmpty()) {
            ListNode min = pq.poll();       // 当前全局最小
            tail.next = min;
            tail = min;
            if (min.next != null) pq.offer(min.next); // 补上该链表的下一个结点
        }
        return dummy.next;
    }
}
```

## 复杂度

- 时间 O(N log k)：N 个结点各入堆出堆一次，堆大小不超过 k。
- 空间 O(k)：堆中最多 k 个结点。

## 易错点

- 空链表（null）直接 `offer` 会在比较时空指针，必须先过滤。
- 比较器写成 `a.val - b.val` 在值域很大时可能溢出，用 `Integer.compare` 更稳。
- `lists` 为空数组时，堆为空，返回 `dummy.next` 即 null，不需要特判。
- 逐条合并看起来简单，但 O(kN) 在 k 很大时会超时，面试要能说出为什么要优化。

## 其他解法

分治两两合并：像归并排序一样，把 k 条链表对半分，递归合并左半和右半，最后用 [[algo:merge-two-sorted-lists]] 合并两个结果。共 log k 层，每层合并总量 N，也是 O(N log k)，额外空间只有递归栈 O(log k)。

```java
import java.util.*;

class Solution {
    public ListNode mergeKLists(ListNode[] lists) {
        if (lists.length == 0) return null;
        return merge(lists, 0, lists.length - 1);
    }

    // 合并 lists[lo..hi]
    private ListNode merge(ListNode[] lists, int lo, int hi) {
        if (lo == hi) return lists[lo];
        int mid = (lo + hi) >>> 1;
        return mergeTwo(merge(lists, lo, mid), merge(lists, mid + 1, hi));
    }

    private ListNode mergeTwo(ListNode a, ListNode b) {
        ListNode dummy = new ListNode(0), tail = dummy;
        while (a != null && b != null) {
            if (a.val <= b.val) { tail.next = a; a = a.next; }
            else { tail.next = b; b = b.next; }
            tail = tail.next;
        }
        tail.next = (a != null) ? a : b;
        return dummy.next;
    }
}
```

## 举一反三

- [[algo:merge-two-sorted-lists]]：k = 2 的情况。
- [[algo:sort-list]]：分治合并的结构与归并排序相同。
- [[algo:kth-largest-element-in-an-array]]、[[algo:top-k-frequent-elements]]：同样用堆维护"当前最值"。
- 后端联系：分库分表后多个分片各自返回有序结果，中间件（如 ShardingSphere）做流式归并时就是用优先队列维护各分片的游标；外部排序的多路归并、LSM 树的多个 SSTable 合并也是同一模式。

## 一句话记忆

k 个链表头放进小顶堆，弹一个最小的接上，再把它的下一个塞回去。
