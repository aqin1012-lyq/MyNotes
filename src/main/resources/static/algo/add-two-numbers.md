## 题意

两个非负整数分别用单链表表示，**个位在链表头**，每个结点存一位数字（0–9）。求两数之和，同样以"个位在前"的链表形式返回。除了数字 0 本身，输入不会有前导零。链表最长 100 位，所以不能转成 `long` 直接相加。

```
输入：l1 = [5,8,3]，l2 = [7,4]
输出：[2,3,4]
解释：385 + 47 = 432，个位在前就是 [2,3,4]。

输入：l1 = [9,9]，l2 = [1]
输出：[0,0,1]
解释：99 + 1 = 100，最高位的进位要单独补一个结点。
```

## 思路

**暴力**：把两条链表转成整数相加再拆回去。100 位远超 `long` 范围，只能用 `BigInteger`，面试里不可取。

**模拟竖式加法**：链表恰好是从个位开始存的，和我们手算竖式的顺序一致。两个指针同步往后走，每一位算 `x + y + carry`，当前位是和对 10 取余，新进位是和除以 10。某条链先走完时，就把它的这一位当作 0。

:::tip 关键点
循环条件写成 `l1 != null || l2 != null || carry != 0`，一次性处理"两条链长度不同"和"最后还剩进位"两种情况，不需要循环后再补判断。
:::

推演 `[5,8,3] + [7,4]`：

```
位   x   y   carry入   sum   写入   carry出
个   5   7   0         12    2      1
十   8   4   1         13    3      1
百   3   0   1         4     4      0
结束，结果 [2,3,4]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public ListNode addTwoNumbers(ListNode l1, ListNode l2) {
        ListNode dummy = new ListNode(0);
        ListNode tail = dummy;
        int carry = 0;
        // 任一链表没走完，或者还有进位，都要继续
        while (l1 != null || l2 != null || carry != 0) {
            int sum = carry;
            if (l1 != null) { sum += l1.val; l1 = l1.next; }
            if (l2 != null) { sum += l2.val; l2 = l2.next; }
            tail.next = new ListNode(sum % 10); // 当前位
            tail = tail.next;
            carry = sum / 10;                   // 新的进位
        }
        return dummy.next;
    }
}
```

## 复杂度

- 时间 O(max(m, n))：每一位处理一次，最多多一位进位。
- 空间 O(1)：不算返回的结果链表，只用了常数变量。

## 易错点

- 最高位进位漏掉：`99 + 1` 算出来是 `[0,0]` 而不是 `[0,0,1]`。
- 两条链长度不同时，对 null 取 `val` 空指针。
- 试图转成 `int` / `long` 相加，长链表直接溢出。
- 进位最多是 1（9 + 9 + 1 = 19），不需要考虑更大的进位。

## 举一反三

- [[algo:merge-two-sorted-lists]]：同样是哑结点 + 双指针同步推进。
- [[algo:reverse-linked-list]]：如果数字是高位在前存储（LeetCode 445），可以先反转两条链再用本题的做法，或者用两个栈。
- 后端联系：大数运算（金额精度、`BigInteger`/`BigDecimal` 的内部实现）本质就是按位模拟加法与进位。

## 一句话记忆

从个位开始按竖式加，谁空了就当 0，条件里带上 carry，最后的进位就不会丢。
