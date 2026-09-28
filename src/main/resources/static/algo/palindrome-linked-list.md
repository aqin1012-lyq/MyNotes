## 题意

给一条单链表，判断它从前往后读和从后往前读的值序列是否完全一样，返回 `true` / `false`。结点数至少 1 个，值是 0–9 的数字。进阶要求 O(n) 时间、O(1) 额外空间。

```
输入：head = [3,5,8,5,3]
输出：true

输入：head = [2,6,6,1]
输出：false
解释：倒着读是 [1,6,6,2]，和原序列不同。
```

## 思路

**暴力**：把值全部复制到 `ArrayList`，再用左右双指针往中间比。O(n) 时间 O(n) 空间，写起来最稳。

**瓶颈**：单链表不能倒着走，所以才需要额外数组。如果能让后半段"倒过来"，就能直接和前半段逐个比较。

:::tip 关键点
三步走：1）快慢指针找中点；2）原地反转后半段；3）两个指针从头和从后半段新头同时往后比。比完最好再把后半段反转回去，恢复原链表（面试时主动提一句是加分项）。
:::

推演 `[3,5,8,5,3]`：

```
找中点：slow 从 3 开始，fast 每次两步
  slow=3(第1个)  fast=3(第1个)
  slow=5(第2个)  fast=8(第3个)
  slow=8(第3个)  fast=3(第5个)  fast.next 为 null，停
前半段尾 = slow = 8，反转 slow.next 之后：
  前半段: 3 -> 5 -> 8
  后半段: 3 -> 5          反转后的新头
比较：3==3, 5==5，后半段走完 -> true
```

奇数长度时正中间的结点归前半段，不参与比较，不影响结果。

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean isPalindrome(ListNode head) {
        // 1. 快慢指针找前半段的尾结点（奇数时是正中间，偶数时是左中点）
        ListNode slow = head, fast = head;
        while (fast.next != null && fast.next.next != null) {
            slow = slow.next;
            fast = fast.next.next;
        }
        // 2. 反转后半段
        ListNode second = reverse(slow.next);
        // 3. 逐个比较，以后半段长度为准
        boolean ok = true;
        ListNode p = head, q = second;
        while (q != null) {
            if (p.val != q.val) { ok = false; break; }
            p = p.next;
            q = q.next;
        }
        // 4. 恢复原链表
        slow.next = reverse(second);
        return ok;
    }

    private ListNode reverse(ListNode head) {
        ListNode prev = null;
        while (head != null) {
            ListNode next = head.next;
            head.next = prev;
            prev = head;
            head = next;
        }
        return prev;
    }
}
```

## 复杂度

- 时间 O(n)：找中点 n/2，反转 n/2，比较 n/2，恢复 n/2。
- 空间 O(1)：只改指针，没有额外容器。

## 易错点

- 快慢指针的循环条件决定中点落在哪。这里用 `fast.next != null && fast.next.next != null`，偶数长度时 slow 停在左中点，后半段从 `slow.next` 开始，刚好对半分。
- 比较时以后半段为准（`q != null`），因为奇数长度时前半段多一个中间结点。
- 反转后如果不恢复，调用方拿到的链表就被破坏了；实际业务代码里修改入参是大忌。
- 只有一个结点时 `slow.next` 为 null，反转空链表返回 null，比较循环不执行，直接返回 true。

## 其他解法

复制到数组再双指针，O(n) 空间，但不改动原链表，面试时可以先说这个再优化。

```java
import java.util.*;

class Solution {
    public boolean isPalindrome(ListNode head) {
        List<Integer> vals = new ArrayList<>();
        for (ListNode p = head; p != null; p = p.next) vals.add(p.val);
        // 左右双指针向中间收拢
        for (int i = 0, j = vals.size() - 1; i < j; i++, j--) {
            if (!vals.get(i).equals(vals.get(j))) return false;
        }
        return true;
    }
}
```

## 举一反三

- [[algo:reverse-linked-list]]：本题第 2 步就是它。
- [[algo:linked-list-cycle]]：快慢指针的另一种用法。
- [[algo:sort-list]]：归并排序同样要用快慢指针把链表从中间劈开。

## 一句话记忆

快慢指针找中点，反转后半段，头尾对着比，比完记得翻回去。
