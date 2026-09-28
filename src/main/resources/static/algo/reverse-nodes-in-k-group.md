## 题意

给一条单链表和正整数 `k`，从头开始每 `k` 个结点作为一组，把每组内部的顺序反转；最后如果剩下不足 `k` 个结点，这一段保持原样。要求真正调整结点，不能只改值；进阶要求 O(1) 额外空间。

```
输入：head = [3,8,1,6,2,9,4]，k = 3
输出：[1,8,3,9,2,6,4]
解释：[3,8,1] -> [1,8,3]，[6,2,9] -> [9,2,6]，剩下的 [4] 不足 3 个，不动。

输入：head = [5,7]，k = 1
输出：[5,7]
```

## 思路

**借助数组/栈**：每次把 k 个结点压栈再弹出重新连接，逻辑清晰但要 O(k) 空间。

**原地分段反转**：把问题拆成重复的小步骤：

1. 从当前组的前驱 `prev` 出发，往后数 k 个结点找到本组尾 `end`；不足 k 个直接结束。
2. 记下下一组的开头 `next = end.next`，把本组断开，用 [[algo:reverse-linked-list]] 的方法反转。
3. 反转后原来的组头 `start` 变成了组尾，把它接回：`prev.next = end`，`start.next = next`。
4. `prev = start`，继续下一组。

:::tip 关键点
每组反转需要记住四个结点：前驱 `prev`、组头 `start`、组尾 `end`、后继 `next`。反转完成后"头尾互换"，用 `prev.next = end` 和 `start.next = next` 接回原链。哑结点让第一组和其他组的处理完全一致。
:::

推演 `[3,8,1,6,2,9,4]`，k = 3：

```
轮  prev   start  end  next  接回后
1   dummy  3      1    6     dummy -> 1 -> 8 -> 3 -> 6 ...
2   3      6      9    4     ... 3 -> 9 -> 2 -> 6 -> 4
3   6      4      -          往后不足 3 个，结束
结果 [1,8,3,9,2,6,4]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode reverseKGroup(ListNode head, int k) {
        ListNode dummy = new ListNode(0, head);
        ListNode prev = dummy; // 当前组的前驱
        while (true) {
            // 1. 从 prev 往后数 k 个，找到本组的尾结点
            ListNode end = prev;
            for (int i = 0; i < k && end != null; i++) end = end.next;
            if (end == null) break; // 不足 k 个，保持原样
            // 2. 记录组头和下一组开头，断开后反转本组
            ListNode start = prev.next, next = end.next;
            end.next = null;
            reverse(start);
            // 3. 接回：前驱指向新组头 end，原组头 start 变成组尾接上后继
            prev.next = end;
            start.next = next;
            // 4. 前驱移动到本组的新尾部
            prev = start;
        }
        return dummy.next;
    }

    private ListNode reverse(ListNode head) {
        ListNode pre = null;
        while (head != null) {
            ListNode nxt = head.next;
            head.next = pre;
            pre = head;
            head = nxt;
        }
        return pre;
    }
}
```

## 复杂度

- 时间 O(n)：每个结点被"数"一次、反转一次。
- 空间 O(1)：只用常数个指针。

## 易错点

- 数 k 个时要从 `prev` 出发走 k 步，走到的是组尾；从 `prev.next` 出发会多数一个。
- 反转前要先 `end.next = null` 断开，否则反转函数会一路反转到链表末尾。
- 反转后忘记 `start.next = next`，整条链在这一组之后断掉。
- `prev` 更新为 `start`（反转后的组尾），不是 `end`。
- 剩余不足 k 个时不能反转，必须先数够再动手。

## 其他解法

递归：先检查前 k 个是否存在，反转这 k 个，然后原组头的 `next` 接上"剩余部分递归处理的结果"。代码更短，但递归深度 n/k，空间不是 O(1)。

```java
import java.util.*;

class Solution {
    public ListNode reverseKGroup(ListNode head, int k) {
        ListNode tail = head;
        for (int i = 0; i < k; i++) {
            if (tail == null) return head; // 不足 k 个，原样返回
            tail = tail.next;
        }
        // 反转 [head, tail) 这 k 个结点，pre 初始为后续部分的处理结果
        ListNode pre = reverseKGroup(tail, k), cur = head;
        while (cur != tail) {
            ListNode nxt = cur.next;
            cur.next = pre;
            pre = cur;
            cur = nxt;
        }
        return pre; // 本组新头
    }
}
```

## 举一反三

- [[algo:reverse-linked-list]]：每组内部的操作。
- [[algo:swap-nodes-in-pairs]]：k = 2 的特例。
- [[algo:rotate-array]]：同样是"分段反转"的技巧，只是作用在数组上。

## 一句话记忆

哑结点当前驱，数够 k 个就断开、反转、头尾接回，前驱挪到组尾，不够 k 个就收工。
