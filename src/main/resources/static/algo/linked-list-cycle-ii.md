## 题意

给一条单链表，如果它有环，返回**环的第一个结点**（从 head 出发第一次进入环时经过的那个结点）；没有环返回 `null`。不允许修改链表，进阶要求 O(1) 空间。

```
输入：head = [5,1,7,3,8]，pos = 2（尾结点 8 连回下标 2 的结点 7）
输出：值为 7 的结点

输入：head = [5]，pos = -1
输出：null
```

## 思路

**哈希**：沿着链表走，第一个"第二次被访问"的结点就是入口。O(n) 空间。

**O(1) 空间**：先用 [[algo:linked-list-cycle]] 的快慢指针判断有没有环并得到相遇点，再利用一个距离关系定位入口。

设 head 到入口距离 a，入口到相遇点距离 b，环长 L。相遇时 slow 走了 a + b，fast 走了 a + b + kL（多绕了 k 圈），又因为 fast 走的是 slow 的两倍：

```
2(a + b) = a + b + kL
      a  = kL - b
         = (k - 1)L + (L - b)
```

`L - b` 正好是从相遇点继续往前走回到入口的距离。

:::tip 关键点
相遇后，把一个指针放回 head，另一个留在相遇点，两者都改成每次走 1 步。head 那个走 a 步到入口时，另一个走了 (k-1) 圈再加 L-b 步，也恰好到入口，于是它们在入口处相遇。
:::

推演 `[5,1,7,3,8]`，8 -> 7，a = 2，L = 3：

```
阶段一  slow  fast
0       5     5
1       1     7
2       7     8
3       3     3      相遇
阶段二  p     q
0       5     3      p 回到 head
1       1     8
2       7     7      相遇，入口是 7
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode detectCycle(ListNode head) {
        ListNode slow = head, fast = head;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) {
                // 有环：一个指针回到起点，两者同速前进，相遇处即入口
                ListNode p = head;
                while (p != slow) {
                    p = p.next;
                    slow = slow.next;
                }
                return p;
            }
        }
        return null; // 无环
    }
}
```

## 复杂度

- 时间 O(n)：阶段一不超过 O(n)，阶段二走 a 步。
- 空间 O(1)。

## 易错点

- 阶段二两个指针都是**每次 1 步**，不是 fast 继续走 2 步。
- 相遇点不等于入口，直接返回相遇点是最常见的错误。
- 入口恰好是 head 时（a = 0），由 a = kL - b 得 b 是 L 的整数倍，相遇点就是 head 本身，第二个 `while` 一次都不执行，直接返回 head，不需要特判。
- 推导中 `k >= 1`，不要假设 fast 只多绕了一圈，公式里的 `(k-1)L` 已经兜住了多圈的情况。

## 其他解法

哈希集合：第一个重复出现的结点就是入口。

```java
import java.util.*;

class Solution {
    public ListNode detectCycle(ListNode head) {
        Set<ListNode> seen = new HashSet<>();
        for (ListNode p = head; p != null; p = p.next) {
            if (!seen.add(p)) return p; // 第一次重复出现的就是入口
        }
        return null;
    }
}
```

## 举一反三

- [[algo:linked-list-cycle]]：本题的阶段一。
- [[algo:find-the-duplicate-number]]：数组值当作 next 指针，重复数字就是环入口，代码和本题几乎一样。
- [[algo:intersection-of-two-linked-lists]]：同样是"两个指针走相同距离后相遇"。

## 一句话记忆

快慢相遇后，一个回起点，两个一起一步一步走，再相遇就是入口。
