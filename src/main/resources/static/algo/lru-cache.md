## 题意

实现一个容量固定的 LRU（最近最少使用）缓存类 `LRUCache`：构造时给定正整数容量；`get(key)` 存在则返回值，否则返回 -1；`put(key, value)` 插入或更新键值。插入导致超出容量时，要淘汰**最久没被访问过**的那个键。`get` 和 `put` 都算"访问"，且两者都必须是平均 O(1)。

```
操作：LRUCache(2)
put(5, 50)          缓存 {5}
put(8, 80)          缓存 {5, 8}，8 最新
get(5)   -> 50      5 变成最新，顺序 8, 5
put(3, 30)          超容量，淘汰最久未用的 8，缓存 {5, 3}
get(8)   -> -1
put(5, 55)          更新 5 的值并变为最新，顺序 3, 5
put(1, 10)          淘汰 3，缓存 {5, 1}
get(3)   -> -1
get(5)   -> 55
```

## 思路

**暴力**：用一个列表按访问时间排队，每次访问把元素挪到队尾、淘汰队首。列表里查找某个 key 是 O(n)，挪动也是 O(n)。

**拆解需求**：要 O(1) 做到两件事：①按 key 找到数据 ——> 哈希表；②维护访问顺序，并能 O(1) 把任意一个元素挪到"最新"、O(1) 删掉"最旧" ——> 双向链表（知道结点本身就能 O(1) 删除它）。

:::tip 关键点
哈希表 `key -> 链表结点`，双向链表按访问时间排列：头部是最新，尾部是最旧。用两个哨兵结点 `head`、`tail` 省去所有空指针判断。任何访问都做"从原位置摘下 + 插到头部"，淘汰就删 `tail.prev`，同时记得从哈希表里删掉它的 key（所以结点里要存 key）。
:::

用上面的例子推演（链表从左到右是 新 -> 旧）：

```
操作          链表(新->旧)   说明
put(5,50)     5
put(8,80)     8 5
get(5)        5 8            5 移到头部
put(3,30)     3 5            插入 3，size>2，删尾部 8
get(8)        3 5            不存在，-1
put(5,55)     5 3            更新值并移到头部
put(1,10)     1 5            插入 1，删尾部 3
get(3)        1 5            -1
get(5)        5 1            返回 55
```

## Java 题解

```java
import java.util.*;

class LRUCache {
    // 双向链表结点，存 key 是为了淘汰时能从 map 中删除
    private static class Node {
        int key, val;
        Node prev, next;
        Node(int key, int val) { this.key = key; this.val = val; }
    }

    private final int capacity;
    private final Map<Integer, Node> map = new HashMap<>();
    private final Node head = new Node(0, 0); // 哨兵：head.next 是最新
    private final Node tail = new Node(0, 0); // 哨兵：tail.prev 是最旧

    public LRUCache(int capacity) {
        this.capacity = capacity;
        head.next = tail;
        tail.prev = head;
    }

    public int get(int key) {
        Node node = map.get(key);
        if (node == null) return -1;
        moveToHead(node); // 访问过，变成最新
        return node.val;
    }

    public void put(int key, int value) {
        Node node = map.get(key);
        if (node != null) {
            node.val = value; // 已存在：更新值并移到头部
            moveToHead(node);
            return;
        }
        node = new Node(key, value);
        map.put(key, node);
        addToHead(node);
        if (map.size() > capacity) {
            Node lru = tail.prev; // 最久未使用
            remove(lru);
            map.remove(lru.key);
        }
    }

    private void addToHead(Node node) {
        node.prev = head;
        node.next = head.next;
        head.next.prev = node;
        head.next = node;
    }

    private void remove(Node node) {
        node.prev.next = node.next;
        node.next.prev = node.prev;
    }

    private void moveToHead(Node node) {
        remove(node);
        addToHead(node);
    }
}
```

## 复杂度

- 时间：`get`、`put` 都是 O(1)。哈希表定位结点 O(1)，双向链表摘除和插入只改常数个指针。
- 空间 O(capacity)：哈希表和链表各存最多 capacity + 1 个元素（插入后立刻淘汰）。

## 易错点

- 结点里不存 key：淘汰尾结点时不知道该从 map 删哪个 key。
- `put` 已存在的 key 时只更新值、忘了移到头部；或者误把它当新元素再插一次，导致链表里有两个结点。
- `addToHead` 中四条指针的顺序：先设置新结点自己的 `prev/next`，再改 `head.next.prev`，最后改 `head.next`；如果先改 `head.next`，就找不到原来的第一个结点了。
- 先淘汰后插入 vs 先插入后淘汰：本写法先插入再检查 `size > capacity`，逻辑简单；如果先淘汰，要注意"更新已有 key"时不能淘汰。
- 不用哨兵结点的话，头尾为空的情况要写一堆 if，极易出错。

## 其他解法

JDK 的 `LinkedHashMap` 本身就是"哈希表 + 双向链表"。构造时传 `accessOrder = true`，每次 `get`/`put` 都会把条目移到链表尾部（尾部是最新）；再重写 `removeEldestEntry`，在插入后元素数超过容量时返回 true，它就会自动删掉最旧的条目。面试中可以先说这个，但面试官通常会要求手写上面的版本。

```java
import java.util.*;

class LRUCache extends LinkedHashMap<Integer, Integer> {
    private final int capacity;

    public LRUCache(int capacity) {
        super(16, 0.75f, true); // accessOrder = true：按访问顺序排列
        this.capacity = capacity;
    }

    public int get(int key) {
        return super.getOrDefault(key, -1); // getOrDefault 命中时同样会调整顺序
    }

    public void put(int key, int value) {
        super.put(key, value);
    }

    @Override
    protected boolean removeEldestEntry(Map.Entry<Integer, Integer> eldest) {
        return size() > capacity; // 超出容量时淘汰最旧的条目
    }
}
```

## 举一反三

- [[algo:copy-list-with-random-pointer]]：同样是"哈希表存结点引用"。
- [[algo:min-stack]]：另一道经典的数据结构设计题，考察如何用辅助结构让每个操作都是 O(1)。
- 后端联系：`LinkedHashMap` 的 accessOrder 模式、MyBatis 的 `LruCache`、Guava/Caffeine 本地缓存都基于这个思路；Redis 的 `allkeys-lru` 为了省内存用的是"随机采样近似 LRU"，MySQL InnoDB 缓冲池则用"冷热分区的 LRU 链表"防止全表扫描把热数据挤出去。

## 一句话记忆

哈希表负责 O(1) 找到结点，双向链表负责 O(1) 调整顺序；访问就挪到头，满了就删尾。
