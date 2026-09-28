## 题意

给一条单链表，从头开始每两个相邻结点交换位置（第 1、2 个互换，第 3、4 个互换……），返回新的头结点。如果最后剩一个落单的结点，保持不动。必须真的交换结点，不能只交换结点里的值。

```
输入：head = [4,9,2,7,5]
输出：[9,4,7,2,5]
解释：(4,9) 换成 (9,4)，(2,7) 换成 (7,2)，5 落单不动。

输入：head = []
输出：[]
```

## 思路

**偷懒做法**：只交换 `val`。题目明确禁止，而且真实场景里结点可能携带大量数据，交换值不可行。

**指针操作**：交换一对结点 `a -> b` 时，真正要改的有三根指针：前驱指向 b、b 指向 a、a 指向下一对的开头。关键是要拿到"前驱"，所以用哑结点 `dummy` 作为第一对的前驱，然后每处理完一对，前驱就移动到这一对交换后的尾部（也就是 a）。

:::tip 关键点
在一对 `prev -> a -> b -> next` 中，按顺序改：`a.next = b.next`、`b.next = a`、`prev.next = b`，然后 `prev = a`。先改谁后改谁要保证每一步都不丢后路，画个图最保险。
:::

推演 `[4,9,2,7,5]`：

```
prev    a  b   交换后
dummy   4  9   dummy -> 9 -> 4 -> 2 -> 7 -> 5
4       2  7   ... 9 -> 4 -> 7 -> 2 -> 5
2       5  -   b 为 null，结束
结果 [9,4,7,2,5]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode swapPairs(ListNode head) {
        ListNode dummy = new ListNode(0, head);
        ListNode prev = dummy; // 当前这一对的前驱
        while (prev.next != null && prev.next.next != null) {
            ListNode a = prev.next, b = a.next;
            // 三步改指针：a 指向下一对，b 指向 a，前驱指向 b
            a.next = b.next;
            b.next = a;
            prev.next = b;
            prev = a; // a 成为下一对的前驱
        }
        return dummy.next;
    }
}
```

## 复杂度

- 时间 O(n)：每个结点访问一次。
- 空间 O(1)：迭代只用常数指针（递归写法为 O(n) 栈空间）。

## 易错点

- 先写 `prev.next = b` 再写 `a.next = b.next` 没问题，但如果先写 `b.next = a`，就丢失了 b 原来的后继，后面 `a.next = b.next` 会成环。
- 交换后 `prev` 应该移到 `a`（交换后在后面的那个），不是 `b`。
- 循环条件要同时检查 `prev.next` 和 `prev.next.next`，奇数长度时最后一个结点不能动。

## 其他解法

递归：交换前两个结点，第一个结点的 `next` 接上"剩余部分两两交换后的结果"。

```java
import java.util.*;

class Solution {
    public ListNode swapPairs(ListNode head) {
        if (head == null || head.next == null) return head; // 不足两个，不交换
        ListNode second = head.next;
        head.next = swapPairs(second.next); // 剩余部分先交换好
        second.next = head;
        return second; // 原来的第二个成为新头
    }
}
```

## 举一反三

- [[algo:reverse-nodes-in-k-group]]：本题是 k = 2 的特例，通用做法是"分段反转再接回去"。
- [[algo:reverse-linked-list]]：链表指针操作的基本功。

## 一句话记忆

哑结点当前驱，每对改三根指针，前驱挪到这一对的尾巴上。
