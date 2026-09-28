## 题意

给一条单链表，把它按结点值升序排好并返回新的头结点。结点数最多 5 万，值可能为负。进阶：O(n log n) 时间，并尽量只用常数额外空间。

```
输入：head = [7,-2,5,0,3]
输出：[-2,0,3,5,7]

输入：head = [1]
输出：[1]
```

## 思路

**暴力**：值读进数组，`Arrays.sort` 后写回。O(n) 空间，而且没有体现链表操作能力。

**选哪种排序**：快排依赖随机访问和交换，在链表上不划算；堆排序同理。**归并排序**只需要"从中间拆开"和"合并两条有序链"，这两件事链表都很擅长，而且合并时只改指针，不需要额外数组。

:::tip 关键点
自顶向下归并：1）快慢指针找中点并断开成两半；2）递归排序两半；3）用 [[algo:merge-two-sorted-lists]] 合并。找中点时让 fast 从 `head.next` 出发，这样两个结点时 slow 停在第一个，能把链表正确一分为二，不会无限递归。
:::

推演 `[7,-2,5,0,3]`：

```
拆分                      合并
[7,-2,5,0,3]
[7,-2,5]   [0,3]
[7,-2] [5] [0] [3]
[7] [-2]
                          [-2,7]
                          [-2,5,7]   [0,3]
                          [-2,0,3,5,7]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode sortList(ListNode head) {
        if (head == null || head.next == null) return head; // 0 或 1 个结点已有序
        // 1. 快慢指针找中点，fast 从 head.next 出发，slow 停在左半段末尾
        ListNode slow = head, fast = head.next;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
        }
        ListNode right = slow.next;
        slow.next = null; // 断开成两条链
        // 2. 分别排序  3. 合并
        return merge(sortList(head), sortList(right));
    }

    private ListNode merge(ListNode a, ListNode b) {
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

## 复杂度

- 时间 O(n log n)：递归 log n 层，每层合并总共 O(n)。
- 空间 O(log n)：递归栈深度。想要严格 O(1) 需要用自底向上的迭代写法（见其他解法）。

## 易错点

- fast 从 `head` 出发时，两个结点的链表 slow 会停在第二个结点，右半段为空，左半段还是两个结点，导致无限递归、栈溢出。
- 拆分后忘记 `slow.next = null`，左半段没有真正断开。
- 合并时用 `<=` 保证稳定性（相等元素保持原相对顺序）。
- 自底向上写法里切分函数要返回"剩余部分的头"并把当前段断开，边界最容易写错。

## 其他解法

自底向上迭代归并：先把相邻的长度为 1 的段两两合并，再合并长度为 2 的段，然后 4、8……直到段长不小于链表长度。没有递归，额外空间 O(1)。

```java
import java.util.*;

class Solution {
    public ListNode sortList(ListNode head) {
        int n = 0;
        for (ListNode p = head; p != null; p = p.next) n++;
        ListNode dummy = new ListNode(0, head);
        for (int step = 1; step < n; step <<= 1) {
            ListNode prev = dummy, cur = dummy.next;
            while (cur != null) {
                ListNode left = cur;
                ListNode right = split(left, step);  // 切出第一段，返回第二段开头
                cur = split(right, step);            // 切出第二段，返回剩余部分
                prev.next = merge(left, right);      // 合并两段接到 prev 后面
                while (prev.next != null) prev = prev.next; // prev 移到已合并部分的末尾
            }
        }
        return dummy.next;
    }

    // 从 head 起保留 step 个结点并断开，返回之后部分的头
    private ListNode split(ListNode head, int step) {
        for (int i = 1; head != null && i < step; i++) head = head.next;
        if (head == null) return null;
        ListNode rest = head.next;
        head.next = null;
        return rest;
    }

    private ListNode merge(ListNode a, ListNode b) {
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

- [[algo:merge-two-sorted-lists]]：归并的 merge 步骤。
- [[algo:merge-k-sorted-lists]]：分治合并 K 条链，和归并排序的结构相同。
- [[algo:palindrome-linked-list]]：同样用快慢指针找中点。
- 后端联系：外部排序（数据量超过内存时先分块排序再多路归并）、`Collections.sort` 对象排序使用的 TimSort，都以归并为核心。

## 一句话记忆

链表排序就用归并：快慢指针劈两半，递归排好，再像合并两条有序链那样拼起来。
