## 题意

链表的每个结点除了 `next`，还有一个 `random` 指针，可以指向链表中任意结点或者为 null。要求做一份**深拷贝**：新链表的结点全部是新建的，新结点的 `next`、`random` 都必须指向新链表里对应的结点，不能指回原链表。返回新链表的头。

```
输入：[[4,null],[6,2],[1,0]]
（每项是 [val, random 指向的下标]：结点 6 的 random 指向 1，结点 1 的 random 指向 4）
输出：结构完全相同的新链表 [[4,null],[6,2],[1,0]]，且没有任何一个结点与原链表共用

输入：[]
输出：[]
```

## 思路

**难点**：复制 `next` 很简单，一边走一边新建就行；但 `random` 可能指向后面还没创建的结点，也可能指向前面的结点，我们得知道"原结点 X 对应的新结点是谁"。

**哈希表**：第一遍遍历，为每个原结点创建新结点，存进 `Map<原结点, 新结点>`；第二遍遍历，`copy.next = map.get(old.next)`，`copy.random = map.get(old.random)`。O(n) 时间 O(n) 空间，清晰好写，面试首选先说它。

**O(1) 额外空间**：把"映射关系"直接编码在链表结构里。

:::tip 关键点
交织法三步：1）在每个原结点后面插入它的拷贝：`A -> A' -> B -> B'`，这样 `X.next` 就是 X 的拷贝；2）设置 random：`X'.random = X.random == null ? null : X.random.next`；3）把两条链拆开，恢复原链表。
:::

推演（原链 4 -> 6 -> 1，6.random = 1，1.random = 4）：

```
第1步  4 -> 4' -> 6 -> 6' -> 1 -> 1'
第2步  6'.random = 6.random.next = 1'
       1'.random = 1.random.next = 4'
       4'.random = null
第3步  原链 4 -> 6 -> 1
       新链 4' -> 6' -> 1'
```

## Java 题解

```java
import java.util.*;

class Solution {
    public Node copyRandomList(Node head) {
        if (head == null) return null;
        // 1. 在每个原结点后插入它的拷贝
        for (Node p = head; p != null; p = p.next.next) {
            Node copy = new Node(p.val);
            copy.next = p.next;
            p.next = copy;
        }
        // 2. 拷贝结点的 random = 原结点 random 的下一个（即其拷贝）
        for (Node p = head; p != null; p = p.next.next) {
            p.next.random = (p.random == null) ? null : p.random.next;
        }
        // 3. 拆分两条链，同时恢复原链表
        Node newHead = head.next;
        for (Node p = head; p != null; p = p.next) {
            Node copy = p.next;
            p.next = copy.next;
            copy.next = (copy.next == null) ? null : copy.next.next;
        }
        return newHead;
    }
}
```

## 复杂度

- 时间 O(n)：三趟线性遍历。
- 空间 O(1)：除了必须返回的新结点，没有额外容器。

## 易错点

- 第 2 步不能和第 3 步合并：拆分时后面结点的 random 可能指向前面已经拆开的结点，此时 `random.next` 已经不是它的拷贝了。
- `random` 为 null 时要单独处理，不能直接 `.next`。
- 拆分时最后一个拷贝结点的 `next` 要置为 null（`copy.next` 为 null 的判断）。
- 必须恢复原链表，否则调用方的原数据被破坏（LeetCode 也会检查）。
- 哈希表版本里 `map.get(null)` 返回 null，正好对应 random 为空的情况，不用特判。

## 其他解法

哈希表两遍遍历，最好写也最不容易错。

```java
import java.util.*;

class Solution {
    public Node copyRandomList(Node head) {
        Map<Node, Node> map = new HashMap<>();
        // 第一遍：为每个原结点创建拷贝
        for (Node p = head; p != null; p = p.next) map.put(p, new Node(p.val));
        // 第二遍：连接 next 和 random，get(null) 返回 null
        for (Node p = head; p != null; p = p.next) {
            Node copy = map.get(p);
            copy.next = map.get(p.next);
            copy.random = map.get(p.random);
        }
        return map.get(head);
    }
}
```

## 举一反三

- 克隆图（LeetCode 133，不在本题单）：图的深拷贝同样是"原结点 -> 新结点"的哈希映射 + 遍历。
- [[algo:lru-cache]]：同样依赖"哈希表存结点引用"来实现 O(1) 定位。
- 后端联系：对象深拷贝（含循环引用的对象图）的序列化框架，就是用 `IdentityHashMap` 记录"已拷贝过的对象"，思路和哈希解法一样。

## 一句话记忆

先在每个结点后面插个分身，分身的 random 就是原 random 的下一个，最后把两条链拆开。
