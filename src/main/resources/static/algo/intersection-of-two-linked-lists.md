## 题意

给两条单链表的头结点 `headA`、`headB`，它们可能在某个结点处"汇合"，汇合之后的部分是同一批结点（是同一个对象，不是值相等）。返回第一个公共结点；如果两条链表根本不相交，返回 `null`。要求不能修改链表结构，最好做到 O(1) 额外空间。

```
输入：A = 7 -> 3 -> 8 -> 5 -> 9，B = 2 -> 8 -> 5 -> 9（从值 8 的结点开始两条链共用）
输出：值为 8 的那个结点
解释：A 独有部分长 2，B 独有部分长 1，公共部分 8 -> 5 -> 9 长 3。

输入：A = 1 -> 2，B = 6 -> 4 -> 3（不相交）
输出：null
```

## 思路

**暴力**：对 A 的每个结点，遍历 B 看有没有同一个对象，O(m·n)。

**哈希**：先把 A 的所有结点放进 `HashSet`，再遍历 B，第一个出现在集合里的结点就是答案。O(m+n) 时间，但要 O(m) 空间。

**瓶颈**：两条链长度不同，指针没法"对齐"地同时走到交点。如果能让两个指针走过相同的总路程再到交点，就能同时到达。

:::tip 关键点
设 A 独有长度 a，B 独有长度 b，公共长度 c。指针 p 走完 A 后跳到 B 头，q 走完 B 后跳到 A 头。两者走到交点时都走了 a + c + b 步，于是必然同时到达。不相交时 c = 0，两者都走 a + b 步后同时变成 null，循环也会结束。
:::

用例子推演（a = 2，b = 1，c = 3）：

```
步数  p 所在    q 所在
0     A:7       B:2
1     A:3       B:8
2     A:8       B:5
3     A:5       B:9
4     A:9       null
5     null      A:7
6     B:2       A:3
7     B:8       A:8     相遇，返回 8
```

注意"走到 null 再跳"这一步也算一步，这样不相交时两者会同时为 null。

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode getIntersectionNode(ListNode headA, ListNode headB) {
        ListNode p = headA, q = headB;
        // 两个指针都走 a + b + c 步后必然相遇（不相交时同时为 null）
        while (p != q) {
            // 走到尽头就换到另一条链的头部
            p = (p == null) ? headB : p.next;
            q = (q == null) ? headA : q.next;
        }
        return p;
    }
}
```

## 复杂度

- 时间 O(m + n)：每个指针最多走 m + n 步。
- 空间 O(1)：只用了两个指针。

## 易错点

- 比较的是结点引用 `p != q`，不是 `p.val`，值相同不代表是同一个结点。
- 换链时要写成"走到 null 再跳"（`p == null ? headB : p.next`），如果写成"到最后一个结点就直接跳"，不相交时两个指针永远不会同时为 null，会死循环。
- 任一链表为空时，上面的写法也能自然返回 null，不需要特判。

## 其他解法

先分别求出两条链的长度，让长的那条先走差值步，然后两个指针一起走，第一个相等的结点就是交点。思路更直白，代码稍长。

```java
import java.util.*;

class Solution {
    public ListNode getIntersectionNode(ListNode headA, ListNode headB) {
        int lenA = length(headA), lenB = length(headB);
        // 长的一条先走差值步，让两者到尾部的距离相同
        while (lenA > lenB) { headA = headA.next; lenA--; }
        while (lenB > lenA) { headB = headB.next; lenB--; }
        while (headA != headB) {
            headA = headA.next;
            headB = headB.next;
        }
        return headA;
    }

    private int length(ListNode h) {
        int n = 0;
        for (; h != null; h = h.next) n++;
        return n;
    }
}
```

## 举一反三

- [[algo:linked-list-cycle-ii]]：同样是"让两个指针走相同路程后相遇"的思想，用来找环的入口。
- [[algo:lowest-common-ancestor-of-a-binary-tree]]：如果树结点有父指针，求最近公共祖先就退化成本题。

## 一句话记忆

你走完我的路，我走完你的路，a + c + b 步后我们在交点相遇。
