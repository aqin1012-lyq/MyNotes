## 题意

实现容量固定的 LFU（最不经常使用）缓存 `LFUCache(capacity)`：`get(key)` 命中返回值、否则 -1；`put(key, value)` 插入或更新。满了要插入新 key 时，淘汰**被访问次数最少**的 key；如果次数最少的有多个，淘汰其中**最久没被访问**的那个。`get` 和 `put`（包括更新）都算一次访问，新插入的 key 访问次数为 1。两个操作都要求平均 O(1)。

```
操作：LFUCache(2)
put(1,10)  put(2,20)       次数 1:1, 2:1
get(1)   -> 10             次数 1:2, 2:1
put(3,30)                  淘汰次数最少的 2；次数 1:2, 3:1
get(2)   -> -1
get(3)   -> 30             次数 1:2, 3:2
put(4,40)                  1 和 3 都是 2 次，1 更久没用，淘汰 1
get(1)   -> -1
get(3)   -> 30
get(4)   -> 40
```

## 思路

**暴力**：每个 key 记录 (次数, 最后访问时间)，淘汰时遍历找最小，O(n)。用 `TreeSet` 按 (次数, 时间) 排序可以做到 O(log n)。

**怎么到 O(1)**：把 key 按访问次数分桶，每个桶内部按访问时间排序（就是一个小 LRU）；再记住当前最小次数 `minFreq`。

- `keyToVal`、`keyToFreq`：O(1) 查值和次数。
- `freqToKeys`：次数 -> 该次数下的 key 集合，用 `LinkedHashSet` 保持插入顺序，第一个元素就是最久未访问的。
- 访问一个 key：从 `freq` 桶移到 `freq+1` 桶；如果旧桶空了且 `freq == minFreq`，`minFreq++`。
- 插入新 key：淘汰 `freqToKeys[minFreq]` 的第一个元素，然后新 key 放进 1 号桶，`minFreq = 1`。

:::tip 关键点
`minFreq` 只会在两种情况下变化：①访问使最小桶变空，它恰好 +1（被访问的 key 刚好进入 freq+1 桶）；②插入新 key，它必然变成 1。所以不需要遍历就能维护最小值，这是 O(1) 的关键。
:::

推演（桶内从左到右是 旧 -> 新）：

```
op          buckets                    minFreq
put(1,10)   f1:[1]                     1
put(2,20)   f1:[1,2]                   1
get(1)      f1:[2]  f2:[1]             1
put(3,30)   evict 2; f1:[3] f2:[1]     1
get(3)      f2:[1,3]                   2   (f1 empty)
put(4,40)   evict 1; f1:[4] f2:[3]     1
```

## Java 题解

```java
import java.util.*;

class LFUCache {
    private final int capacity;
    private final Map<Integer, Integer> keyToVal = new HashMap<>();
    private final Map<Integer, Integer> keyToFreq = new HashMap<>();
    // 次数 -> key 集合，LinkedHashSet 保持访问顺序，头部最旧
    private final Map<Integer, LinkedHashSet<Integer>> freqToKeys = new HashMap<>();
    private int minFreq = 0;

    public LFUCache(int capacity) {
        this.capacity = capacity;
    }

    public int get(int key) {
        Integer val = keyToVal.get(key);
        if (val == null) return -1;
        touch(key);
        return val;
    }

    public void put(int key, int value) {
        if (capacity <= 0) return;
        if (keyToVal.containsKey(key)) { // 更新也算一次访问
            keyToVal.put(key, value);
            touch(key);
            return;
        }
        if (keyToVal.size() == capacity) evict();
        keyToVal.put(key, value);
        keyToFreq.put(key, 1);
        freqToKeys.computeIfAbsent(1, f -> new LinkedHashSet<>()).add(key);
        minFreq = 1; // 新 key 次数为 1，一定是最小
    }

    // 访问次数 +1：从 freq 桶挪到 freq+1 桶的末尾
    private void touch(int key) {
        int freq = keyToFreq.get(key);
        keyToFreq.put(key, freq + 1);
        LinkedHashSet<Integer> set = freqToKeys.get(freq);
        set.remove(key);
        if (set.isEmpty()) {
            freqToKeys.remove(freq);
            if (freq == minFreq) minFreq++;
        }
        freqToKeys.computeIfAbsent(freq + 1, f -> new LinkedHashSet<>()).add(key);
    }

    // 淘汰最小次数桶里最旧的 key
    private void evict() {
        LinkedHashSet<Integer> set = freqToKeys.get(minFreq);
        int victim = set.iterator().next();
        set.remove(victim);
        if (set.isEmpty()) freqToKeys.remove(minFreq);
        keyToVal.remove(victim);
        keyToFreq.remove(victim);
    }
}
```

## 复杂度

- 时间：`get`、`put` 平均 O(1)。哈希表操作 O(1)，`LinkedHashSet` 的 remove/add/取第一个元素都是 O(1)。
- 空间 O(capacity)：三个哈希表加上桶里的 key。

## 易错点

- 容量为 0：`put` 直接返回，否则 `evict` 会在空桶上取元素。
- 更新已有 key 时忘了增加访问次数，或者误把它当新 key 触发淘汰。
- 先插入新 key 再淘汰：新 key 次数为 1，可能恰好把自己淘汰掉，必须**先淘汰再插入**。
- 桶变空时只删桶不更新 `minFreq`，下次淘汰去一个不存在的桶里取元素。
- 平手时要淘汰最久未访问的：桶内必须保持访问顺序（`LinkedHashSet` 或双向链表），用 `HashSet` 会随机淘汰。

## 其他解法

手写双向链表版：每个次数一条带哨兵的双向链表（尾部最新），结点存 key、value、freq。面试官要求"不用 LinkedHashSet"时写这个。

```java
import java.util.*;

class LFUCache {
    private static class Entry {
        int key, val, freq = 1;
        Entry prev, next;
        Entry(int key, int val) { this.key = key; this.val = val; }
    }

    // 带哨兵的双向链表：head.next 最旧，tail.prev 最新
    private static class DList {
        final Entry head = new Entry(0, 0), tail = new Entry(0, 0);
        int size;
        DList() { head.next = tail; tail.prev = head; }
        void addLast(Entry e) {
            e.prev = tail.prev; e.next = tail;
            tail.prev.next = e; tail.prev = e;
            size++;
        }
        void remove(Entry e) {
            e.prev.next = e.next; e.next.prev = e.prev;
            size--;
        }
        Entry first() { return head.next; }
    }

    private final int capacity;
    private final Map<Integer, Entry> map = new HashMap<>();
    private final Map<Integer, DList> freqMap = new HashMap<>();
    private int minFreq;

    public LFUCache(int capacity) {
        this.capacity = capacity;
    }

    public int get(int key) {
        Entry e = map.get(key);
        if (e == null) return -1;
        touch(e);
        return e.val;
    }

    public void put(int key, int value) {
        if (capacity <= 0) return;
        Entry e = map.get(key);
        if (e != null) {
            e.val = value;
            touch(e);
            return;
        }
        if (map.size() == capacity) { // 先淘汰
            DList list = freqMap.get(minFreq);
            Entry victim = list.first();
            list.remove(victim);
            map.remove(victim.key);
        }
        e = new Entry(key, value);
        map.put(key, e);
        freqMap.computeIfAbsent(1, f -> new DList()).addLast(e);
        minFreq = 1;
    }

    private void touch(Entry e) {
        DList list = freqMap.get(e.freq);
        list.remove(e);
        if (list.size == 0 && e.freq == minFreq) minFreq++;
        e.freq++;
        freqMap.computeIfAbsent(e.freq, f -> new DList()).addLast(e);
    }
}
```

## 举一反三

- [[algo:lru-cache]]：LFU 的每个桶就是一个 LRU；先掌握 LRU 再做本题。
- [[algo:top-k-frequent-elements]]：同样是"按频次分桶"的思想。
- 后端联系：Redis 的 `allkeys-lfu` 淘汰策略并不精确计数，而是用 8 bit 的对数计数器近似访问频次，并随时间衰减，避免历史热点永远不被淘汰；Caffeine 用 Count-Min Sketch 估算频次（W-TinyLFU）。

## 一句话记忆

key 查值和次数，次数分桶、桶内按时间排序，再记住 minFreq：访问就挪到下一个桶，满了就踢最小桶里最旧的。
