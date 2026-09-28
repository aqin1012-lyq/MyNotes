## 题意

给一条单链表的头结点，把整条链表的指向全部反过来，返回新的头结点（也就是原来的尾结点）。链表可能为空，结点数最多几千个。

```
输入：head = [4,7,1,9]
输出：[9,1,7,4]

输入：head = [5]
输出：[5]
```

## 思路

**暴力**：把所有值读进数组，再倒着新建一条链表，或者倒着把值写回去。O(n) 空间，而且面试官要的显然不是这个。

**瓶颈**：单链表只能往后走，一旦把 `cur.next` 改掉，就再也找不到后面的结点了。所以改指针之前必须先把"后路"存下来。

:::tip 关键点
维护三个指针：`prev`（已经反转好的部分的头）、`cur`（当前要处理的结点）、`next`（后路）。每一步：先存 `next = cur.next`，再让 `cur.next = prev`，然后 `prev`、`cur` 各前进一格。循环结束时 `prev` 就是新头。
:::

推演 `[4,7,1,9]`：

```
轮次  prev          cur   操作后已反转部分
初始  null          4
1     4             7     4 -> null
2     7             1     7 -> 4 -> null
3     1             9     1 -> 7 -> 4 -> null
4     9             null  9 -> 1 -> 7 -> 4 -> null
```

`cur` 变成 null 时退出，返回 `prev`（值为 9 的结点）。

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode reverseList(ListNode head) {
        ListNode prev = null, cur = head;
        while (cur != null) {
            ListNode next = cur.next; // 先保存后路
            cur.next = prev;          // 反转当前结点的指向
            prev = cur;               // prev 前进
            cur = next;               // cur 前进
        }
        return prev; // prev 是新的头结点
    }
}
```

## 复杂度

- 时间 O(n)：每个结点只访问一次。
- 空间 O(1)：只用了常数个指针。

## 易错点

- 忘记先保存 `cur.next` 就改指针，链表直接断掉。
- 返回 `cur` 而不是 `prev`：循环结束时 `cur` 已经是 null。
- 原头结点的 `next` 必须变成 null，`prev` 初始化为 null 正好保证了这一点，否则会成环。
- 递归写法里忘了 `head.next = null`，同样会在头两个结点之间成环。

## 其他解法

递归：先把 `head.next` 之后的部分反转好，此时 `head.next` 是那一段的尾巴，让它指回 `head` 即可。代码短，但递归深度是 O(n)，链表很长时有栈溢出风险。

```java
import java.util.*;

class Solution {
    public ListNode reverseList(ListNode head) {
        if (head == null || head.next == null) return head; // 空或只有一个结点
        ListNode newHead = reverseList(head.next); // 反转后面的部分
        head.next.next = head; // 让后一个结点指回自己
        head.next = null;      // 断开原来的指向，防止成环
        return newHead;
    }
}
```

## 举一反三

- [[algo:reverse-nodes-in-k-group]]：分段反转，每段内部就是本题。
- [[algo:palindrome-linked-list]]：反转后半段再和前半段比较。
- [[algo:swap-nodes-in-pairs]]：k = 2 的分段反转。
- [[algo:add-two-numbers]]：如果数字是正序存储，常见做法就是先反转。

## 一句话记忆

先存后路、再掉头、prev 和 cur 一起往前挪，最后 prev 就是新头。
