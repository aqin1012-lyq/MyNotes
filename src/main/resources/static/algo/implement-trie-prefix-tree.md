## 题意

实现前缀树类 `Trie`，支持三个操作：`insert(word)` 插入一个单词；`search(word)` 判断这个完整单词是否被插入过；`startsWith(prefix)` 判断是否有任何已插入的单词以 `prefix` 开头。单词只含小写字母，长度不超过 2000，总调用次数约 3 万次。

```
操作：Trie()
insert("card")
search("card")     -> true
search("car")      -> false   （"car" 只是前缀，没被当作单词插入过）
startsWith("car")  -> true
insert("car")
search("car")      -> true
startsWith("cat")  -> false
```

## 思路

**暴力**：用 `HashSet<String>` 存单词，`search` 是 O(L)，但 `startsWith` 只能遍历所有单词逐个比较前缀，O(N·L)。

**关键观察**：很多单词共享前缀（card、care、car 都以 "car" 开头），可以把公共前缀只存一份，组织成一棵树：从根往下每一条边代表一个字符，从根到某结点的路径就是一个前缀。

:::tip 关键点
每个结点有 26 个孩子指针（`children[c - 'a']`）和一个 `isEnd` 标记。`search` 和 `startsWith` 的走法完全相同，都是沿着字符往下走；区别只在最后：`search` 要求停下的结点 `isEnd == true`，`startsWith` 只要路径存在即可。
:::

插入 "card" 和 "car" 后的树（`*` 表示 isEnd）：

```
root
 └─ c
     └─ a
         └─ r *
             └─ d *
```

- `search("car")`：插入 "car" 之前，r 结点没有 `*`，返回 false；插入之后返回 true。
- `startsWith("cat")`：走到 a 之后没有 t 这个孩子，返回 false。

## Java 题解

```java
import java.util.*;

class Trie {
    private final Trie[] children = new Trie[26]; // 每个结点 26 个孩子
    private boolean isEnd;                         // 是否有单词在此结束

    public Trie() {}

    public void insert(String word) {
        Trie node = this;
        for (char ch : word.toCharArray()) {
            int i = ch - 'a';
            if (node.children[i] == null) node.children[i] = new Trie(); // 路径不存在就新建
            node = node.children[i];
        }
        node.isEnd = true; // 标记单词结尾
    }

    public boolean search(String word) {
        Trie node = find(word);
        return node != null && node.isEnd; // 必须是完整单词
    }

    public boolean startsWith(String prefix) {
        return find(prefix) != null; // 路径存在即可
    }

    // 沿着字符串往下走，走不通返回 null
    private Trie find(String s) {
        Trie node = this;
        for (char ch : s.toCharArray()) {
            node = node.children[ch - 'a'];
            if (node == null) return null;
        }
        return node;
    }
}
```

## 复杂度

- 时间：三个操作都是 O(L)，L 为字符串长度，与已存单词的数量无关。
- 空间：插入的所有单词字符总数为 S 时，最多 O(S) 个结点，每个结点 26 个指针，即 O(26·S)。

## 易错点

- `search` 忘了检查 `isEnd`，会把前缀误判为单词（上例中插入 "car" 之前 `search("car")` 会错误返回 true）。
- `isEnd` 不能用"是否是叶子结点"代替："car" 是单词，但 r 结点下面还有 d。
- 插入时路径已存在就沿用，不能每次都新建结点覆盖，否则会把别的单词的子树丢掉。
- 字符集如果不止小写字母（中文、大小写混合），`Trie[26]` 就不够用，要换成 `HashMap<Character, Trie>`。

## 其他解法

孩子用 `HashMap` 存储，适合字符集大或很稀疏的场景，省空间但常数略大。

```java
import java.util.*;

class Trie {
    private final Map<Character, Trie> children = new HashMap<>();
    private boolean isEnd;

    public Trie() {}

    public void insert(String word) {
        Trie node = this;
        for (char ch : word.toCharArray()) {
            node = node.children.computeIfAbsent(ch, k -> new Trie()); // 没有就创建
        }
        node.isEnd = true;
    }

    public boolean search(String word) {
        Trie node = find(word);
        return node != null && node.isEnd;
    }

    public boolean startsWith(String prefix) {
        return find(prefix) != null;
    }

    private Trie find(String s) {
        Trie node = this;
        for (char ch : s.toCharArray()) {
            node = node.children.get(ch);
            if (node == null) return null;
        }
        return node;
    }
}
```

## 举一反三

- [[algo:word-search]]：网格中找多个单词的进阶版（LeetCode 212）就是 Trie + DFS 回溯。
- [[algo:lru-cache]]、[[algo:min-stack]]：同属数据结构设计题。
- 后端联系：敏感词过滤（多模式匹配，进一步可升级为 AC 自动机）、搜索框自动补全、路由的最长前缀匹配（IP 路由表、Gin/httprouter 等 Web 框架的路由树）都是 Trie。

## 一句话记忆

每个结点 26 个孩子加一个结尾标记，沿着字符往下走，search 看结尾标记，startsWith 只看路通不通。
