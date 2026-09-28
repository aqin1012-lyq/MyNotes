## 题意

给一条单链表的头结点，判断沿着 `next` 一直走会不会绕回之前走过的结点（即链表中是否有环），有就返回 `true`。题目里用 `pos` 表示尾结点连回的位置，但它只是用来描述测试数据的，函数里拿不到。进阶要求 O(1) 空间。

```
输入：head = [6,2,9,4]，pos = 1（尾结点 4 的 next 指回下标 1 的结点 2）
输出：true

输入：head = [6,2]，pos = -1（无环）
输出：false
```

## 思路

**哈希**：一边走一边把结点放进 `HashSet`，如果遇到已经在集合里的结点，说明有环；走到 null 说明无环。O(n) 空间。

**瓶颈**：想要 O(1) 空间，就不能记录访问过谁。那就换个角度：有环时一直走永远走不到头，能不能让两个指针在环里"撞上"？

:::tip 关键点
Floyd 判圈（龟兔赛跑）：slow 每次走 1 步，fast 每次走 2 步。无环时 fast 先走到 null；有环时两者都进环后，fast 每一步都比 slow 多靠近 1 格，距离从 d 变为 d-1、d-2……一定会变成 0，不会"跳过去"。
:::

推演 `[6,2,9,4]`，4 -> 2 成环：

```
步   slow  fast
0    6     6
1    2     9
2    9     2      (9 -> 4 -> 2)
3    4     4      (2 -> 9 -> 4)  相遇 -> true
```

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean hasCycle(ListNode head) {
        ListNode slow = head, fast = head;
        // fast 每次走两步，先判断它和它的下一个是否为空
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) return true; // 在环内相遇
        }
        return false; // fast 走到了尽头，说明无环
    }
}
```

## 复杂度

- 时间 O(n)：无环时 fast 走 n/2 轮；有环时 slow 进环后最多一圈内就会被追上。
- 空间 O(1)：只有两个指针。

## 易错点

- 循环条件必须同时检查 `fast` 和 `fast.next`，否则 `fast.next.next` 会空指针。
- 相等判断要放在移动之后；如果先判断 `slow == fast`，初始时两者都在 head，会直接误判为有环。
- 比较的是引用而不是 `val`，链表中可能有重复值。

## 其他解法

哈希集合，思路最直白，O(n) 空间。`Set.add` 返回 false 说明这个结点之前出现过。

```java
import java.util.*;

class Solution {
    public boolean hasCycle(ListNode head) {
        Set<ListNode> seen = new HashSet<>();
        for (ListNode p = head; p != null; p = p.next) {
            if (!seen.add(p)) return true; // 第二次见到同一个结点
        }
        return false;
    }
}
```

## 举一反三

- [[algo:linked-list-cycle-ii]]：在本题基础上再找出环的入口。
- [[algo:find-the-duplicate-number]]：把数组下标看成 next 指针，就变成了找环入口的问题。
- 后端联系：检测服务调用链、依赖注入里的循环依赖，本质也是判环（图上更常用拓扑排序或 DFS 染色，见 [[algo:course-schedule]]）。

## 一句话记忆

快的走两步、慢的走一步，有环必相遇，无环快的先撞墙。
