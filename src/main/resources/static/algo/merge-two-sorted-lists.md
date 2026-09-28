## 题意

给两条已经按非递减顺序排好的单链表，把它们合并成一条新的有序链表并返回头结点。新链表直接复用原来的结点拼接即可，不需要新建结点。两条链表都可能为空。

```
输入：list1 = [2,5,9]，list2 = [1,5,6,12]
输出：[1,2,5,5,6,9,12]

输入：list1 = []，list2 = [3]
输出：[3]
```

## 思路

**暴力**：把所有值收集起来排序再建链表，O((m+n) log(m+n))，浪费了"已经有序"这个条件。

**优化**：这就是归并排序里的 merge 步骤。两个指针分别指向两条链当前最小的结点，每次取较小的那个接到结果尾部，然后那条链的指针前进。某条链走完后，另一条剩下的部分整体接上即可（它本身有序且都更大）。

:::tip 关键点
用一个哑结点 `dummy` 作为结果链表的"假头"，`tail` 指向结果的尾部。这样不用特判"结果链表还是空的时候头结点是谁"，最后返回 `dummy.next`。
:::

推演：

```
p1   p2   取   结果
2    1    1    1
2    5    2    1,2
5    5    5    1,2,5        相等时取 list1 的
9    5    5    1,2,5,5
9    6    6    1,2,5,5,6
9    12   9    1,2,5,5,6,9
null 12   --   直接接上 12
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        ListNode dummy = new ListNode(0); // 哑结点，省去头结点特判
        ListNode tail = dummy;
        while (list1 != null && list2 != null) {
            // 取较小的结点接到尾部；相等时取 list1，保证稳定
            if (list1.val <= list2.val) {
                tail.next = list1;
                list1 = list1.next;
            } else {
                tail.next = list2;
                list2 = list2.next;
            }
            tail = tail.next;
        }
        // 剩余部分整体接上
        tail.next = (list1 != null) ? list1 : list2;
        return dummy.next;
    }
}
```

## 复杂度

- 时间 O(m + n)：每个结点被接一次。
- 空间 O(1)：只改指针（递归写法是 O(m + n) 栈空间）。

## 易错点

- 忘记 `tail = tail.next`，结果永远只有一个结点。
- 循环结束后忘记接上剩余部分，丢掉尾巴。
- 返回 `dummy` 而不是 `dummy.next`，结果前面多一个 0。
- 两条都为空时，`tail.next = null`，返回 null，正确。

## 其他解法

递归：较小的头结点作为结果的头，它的 `next` 等于"剩下的部分合并的结果"。写起来很短，但递归深度 O(m + n)。

```java
import java.util.*;

class Solution {
    public ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        if (list1 == null) return list2;
        if (list2 == null) return list1;
        // 较小者做头，后面交给递归
        if (list1.val <= list2.val) {
            list1.next = mergeTwoLists(list1.next, list2);
            return list1;
        }
        list2.next = mergeTwoLists(list1, list2.next);
        return list2;
    }
}
```

## 举一反三

- [[algo:merge-k-sorted-lists]]：K 路归并，两两合并或用小顶堆。
- [[algo:sort-list]]：链表归并排序，merge 部分就是本题。
- [[algo:merge-intervals]]：同样是"有序序列合并"的思路。
- 后端联系：多个有序分片的结果做归并（分库分表后的 ORDER BY + LIMIT 合并、LSM 树的 compaction）都是这一步。

## 一句话记忆

哑结点起头，谁小接谁，一方用完另一方整体接上。
