## 题意

给一条单链表和一个整数 `n`，删掉**从尾部数第 n 个**结点，返回删除后的头结点。保证 `1 <= n <= 链表长度`。进阶：只遍历一趟。

```
输入：head = [8,3,6,1,4]，n = 2
输出：[8,3,6,4]
解释：倒数第 2 个是 1。

输入：head = [7,2]，n = 2
输出：[2]
解释：倒数第 2 个就是头结点本身。
```

## 思路

**两趟遍历**：第一趟求长度 L，倒数第 n 个就是正数第 L - n + 1 个，第二趟走到它的前一个结点删掉即可。完全可行，只是要走两遍。

**一趟**：删除一个结点需要找到它的**前驱**。如果让 fast 先走 n + 1 步，再让 slow 和 fast 一起走，fast 走到 null 时，slow 恰好停在倒数第 n 个结点的前驱上，因为两者之间始终隔着 n 个结点。

:::tip 关键点
slow 从哑结点 `dummy` 出发（而不是 head），这样当要删的是头结点时，slow 停在 dummy 上，`slow.next = slow.next.next` 也能正确删掉头，最后返回 `dummy.next`。
:::

推演 `[8,3,6,1,4]`，n = 2，fast 先从 dummy 走 n + 1 = 3 步：

```
         slow    fast
先走后    dummy   6
同走 1    8       1
同走 2    3       4
同走 3    6       null   停
slow = 6，删除 slow.next（值 1） -> [8,3,6,4]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode removeNthFromEnd(ListNode head, int n) {
        ListNode dummy = new ListNode(0, head); // 哑结点，统一处理删头的情况
        ListNode slow = dummy, fast = dummy;
        // fast 先走 n + 1 步，使 slow 和 fast 之间隔 n 个结点
        for (int i = 0; i <= n; i++) fast = fast.next;
        // 同步前进，fast 到 null 时 slow 是待删结点的前驱
        while (fast != null) {
            slow = slow.next;
            fast = fast.next;
        }
        slow.next = slow.next.next; // 删除倒数第 n 个
        return dummy.next;
    }
}
```

## 复杂度

- 时间 O(L)：一趟遍历。
- 空间 O(1)。

## 易错点

- 从 head 出发而不是 dummy，删头结点时找不到前驱，还得单独特判。
- fast 先走 n 步还是 n + 1 步取决于起点和循环条件，要自己用最短的例子（如 `[7,2]`，n = 2）验证一遍，不要死记。
- 返回 `head` 而不是 `dummy.next`：删的是头结点时，`head` 已经被删了。

## 举一反三

- [[algo:linked-list-cycle]]、[[algo:palindrome-linked-list]]：同样是快慢双指针，只是这里两者速度相同、间距固定。
- [[algo:intersection-of-two-linked-lists]]：先让长的走差值步再一起走，和本题"先走 n 步"是一回事。

## 一句话记忆

哑结点起步，fast 先走 n+1 步，一起走到底，slow 就停在要删结点的前面。
