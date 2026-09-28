## 题意

面试官常说："评论、昵称要做敏感词过滤，词库有几万个词，每条文本要找出所有命中的词并替换成 `*`，怎么做才快？如果用户在词中间插空格或符号（比如 `坏 蛋`、`坏*蛋`）怎么办？"要实现：加载词库；`contains(text)` 判断是否命中；`findAll(text)` 返回命中的词；`replace(text)` 把命中部分替换成 `*`；匹配忽略大小写、跳过词中间的干扰符号，同一位置优先匹配最长的词。

## 思路

**面试官想考什么**：把"多模式串匹配"问题建模成 Trie（前缀树）；知道 Trie 就是 DFA 的一种；能说出 AC 自动机的改进；以及工程上的干扰字符、大小写、全半角处理。

| 方案 | 做法 | 复杂度（文本长 n，词数 k，词长 L） | 评价 |
|---|---|---|---|
| 逐词 `indexOf` | 对每个敏感词在文本里查一遍 | O(k × n × L) | 词库大时太慢 |
| 正则 `a\|b\|c...` | 所有词拼成一个正则 | 取决于正则引擎，词多时回溯严重 | 难维护，性能不可控 |
| Trie / DFA | 词库建成前缀树，从文本每个位置出发沿树走 | O(n × L)，与词数 k 无关 | 实现简单，最常用 |
| AC 自动机 | Trie + fail 指针，失配时不回退文本指针 | O(n + 命中数) | 最快，实现稍复杂 |

:::tip 关键点
词库建成 Trie，每个结点标记"是否是某个词的结尾"。扫描文本时，从每个起点 i 沿 Trie 往下走，**记录最后一次遇到词尾的位置**（最长匹配），走不下去就停；命中则跳到匹配结尾继续，否则 i + 1。遇到干扰字符（非字母数字）时，如果已经在词中间就**跳过它继续走**，如果还在起点就不从它开始。匹配前统一转小写。
:::

推演：词库 {坏人, 坏蛋, 坏蛋蛋, 傻瓜}，文本 `你是坏*蛋蛋吧`：

```
i  char  walk in trie                         result
0  你    no child                              skip
1  是    no child                              skip
2  坏    坏 -> * noise skip -> 蛋(end) -> 蛋(end) -> 吧 stop
         last end at index 5                   hit "坏*蛋蛋", i = 6
6  吧    no child                              skip
```

## Java 题解

```java
import java.util.*;

class SensitiveWordFilter {
    // Trie 结点：子结点用 HashMap，适合中文这种大字符集
    private static final class TrieNode {
        final Map<Character, TrieNode> children = new HashMap<>();
        boolean end; // 是否为某个敏感词的结尾
    }

    private final TrieNode root = new TrieNode();

    SensitiveWordFilter(Collection<String> words) {
        for (String w : words) addWord(w);
    }

    public void addWord(String word) {
        TrieNode cur = root;
        for (char c : word.toCharArray()) {
            c = Character.toLowerCase(c);
            if (isNoise(c)) continue; // 词库里的符号也忽略
            cur = cur.children.computeIfAbsent(c, k -> new TrieNode());
        }
        if (cur != root) cur.end = true;
    }

    // 干扰字符：非字母、非数字（中文汉字属于 letter）
    private static boolean isNoise(char c) {
        return !Character.isLetterOrDigit(c);
    }

    // 从 start 开始的最长匹配，返回结束下标（不含），没有命中返回 -1
    private int matchAt(String text, int start) {
        if (isNoise(text.charAt(start))) return -1; // 不从干扰字符开始
        TrieNode cur = root;
        int end = -1;
        for (int j = start; j < text.length(); j++) {
            char c = Character.toLowerCase(text.charAt(j));
            if (isNoise(c)) continue; // 词中间的干扰字符跳过
            cur = cur.children.get(c);
            if (cur == null) break;
            if (cur.end) end = j + 1; // 记录最长的词尾
        }
        return end;
    }

    public boolean contains(String text) {
        for (int i = 0; i < text.length(); i++) if (matchAt(text, i) > 0) return true;
        return false;
    }

    public List<String> findAll(String text) {
        List<String> hits = new ArrayList<>();
        for (int i = 0; i < text.length(); ) {
            int e = matchAt(text, i);
            if (e > 0) { hits.add(text.substring(i, e)); i = e; } // 命中后跳过整个词
            else i++;
        }
        return hits;
    }

    public String replace(String text, char mask) {
        StringBuilder sb = new StringBuilder(text);
        for (int i = 0; i < text.length(); ) {
            int e = matchAt(text, i);
            if (e > 0) {
                for (int k = i; k < e; k++) sb.setCharAt(k, mask);
                i = e;
            } else i++;
        }
        return sb.toString();
    }
}

public class SensitiveWordFilterDemo {
    // 暴力对照：每个位置找能匹配上的最长词（只用于无干扰字符的随机测试）
    static List<String> brute(List<String> words, String text) {
        List<String> hits = new ArrayList<>();
        for (int i = 0; i < text.length(); ) {
            String best = null;
            for (String w : words) if (text.startsWith(w, i) && (best == null || w.length() > best.length())) best = w;
            if (best != null) { hits.add(best); i += best.length(); } else i++;
        }
        return hits;
    }

    public static void main(String[] args) {
        SensitiveWordFilter f = new SensitiveWordFilter(List.of("坏人", "坏蛋", "坏蛋蛋", "傻瓜", "SB"));
        String text = "你是坏*蛋蛋吧，别学傻 瓜，sb 也不行，好人不管。";
        System.out.println("contains : " + f.contains(text));
        System.out.println("findAll  : " + f.findAll(text));
        System.out.println("replace  : " + f.replace(text, '*'));
        System.out.println("clean    : " + f.contains("今天天气不错！"));

        // 随机对照：小字母表随机词库和文本，与暴力结果比较 2000 次
        Random r = new Random(42);
        for (int t = 0; t < 2000; t++) {
            List<String> words = new ArrayList<>();
            for (int k = 0; k < 5; k++) words.add(randomStr(r, 1 + r.nextInt(3)));
            String s = randomStr(r, 30);
            List<String> got = new SensitiveWordFilter(words).findAll(s);
            if (!got.equals(brute(words, s))) throw new AssertionError(words + " " + s + " " + got);
        }
        System.out.println("2000 random cases match brute force");
    }

    static String randomStr(Random r, int len) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < len; i++) sb.append((char) ('a' + r.nextInt(3)));
        return sb.toString();
    }
}
```

## 复杂度

- 建树：O(词库总字符数)。
- 查询：从每个起点最多走 L 步（L 为最长敏感词的长度），总共 O(n × L)，与词库大小无关；AC 自动机可降到 O(n + 命中数)。
- 资源估算：5 万个词、平均 4 个字，最多 20 万个 Trie 结点；每个结点一个 HashMap（空 HashMap 对象约 48 字节，加上 Entry 与 Character 装箱），整体约几十 MB。内存敏感时可以把子结点改成按字符排序的数组 + 二分，或使用双数组 Trie（Double-Array Trie）压缩。

## 易错点

- 找到第一个词尾就返回：`坏蛋蛋` 只会命中 `坏蛋`，漏掉更长的词；要一直走到走不下去，记录最后一个词尾。
- 命中后 `i++` 而不是跳到词尾：同一段文字被重复命中、替换次数翻倍。
- 走不下去时直接从失配位置继续：`aab` 在词库 {ab} 下，从 0 出发走到第二个 a 失配，如果不回到 i + 1 重新开始就会漏掉 `ab`（这正是 AC 自动机用 fail 指针解决的问题）。
- 干扰字符从起点就开始跳过：会把前面的符号也替换掉；应该只在词中间跳过。
- 大小写、全角半角、繁简体没有统一：`ＳＢ`、`Sb` 都能绕过，匹配前要对文本和词库做同样的归一化。

## 追问

:::details AC 自动机比 Trie 好在哪？
朴素 Trie 在某个起点失配后，要从下一个起点重新开始，文本字符会被重复扫描；AC 自动机为每个结点预先计算 fail 指针（指向"当前已匹配串的最长真后缀"所在结点），失配时沿 fail 跳转而不回退文本指针，整体只扫描文本一遍，O(n + 命中数)。词库大、文本长、吞吐要求高时用它。
:::

:::details 词库需要热更新怎么办？
不要在原 Trie 上边改边查。常见做法是后台构建一棵新 Trie，构建完成后用一个 `volatile` 引用原子替换旧树（写时复制），查询线程始终读到完整的一棵树。
:::

:::details 用户用拼音、谐音、拆字（如"亻尔"）绕过怎么办？
Trie 只能处理字面匹配。可以在词库中加入拼音、同音字、拆字变体，或在匹配前把文本转成拼音再匹配；更复杂的变形需要借助机器学习模型与人工审核，敏感词过滤通常只是第一道防线。
:::

:::details 为什么说 Trie 就是 DFA？
每个 Trie 结点就是一个状态，边上的字符是状态转移条件，词尾结点是接受状态；在文本上沿着边走，就是在运行这个确定有限自动机。不少文章说的"DFA 敏感词过滤"就是这种 Trie 实现。
:::

## 举一反三

- [[algo:implement-trie-prefix-tree]]：本题的基础数据结构，先写熟 insert / search / startsWith。
- [[algo:find-the-index-of-the-first-occurrence-in-a-string]]：单模式串匹配的 KMP，它的 next 数组与 AC 自动机的 fail 指针是同一个思想。
- [[algo:word-break]]：同样是"从每个位置出发，看能匹配词典中的哪些词"。
- 工程对应：Hutool 的 `SensitiveUtil` 基于 WordTree（Trie）实现；搜索框的前缀联想、路由表的最长前缀匹配也都用到 Trie。

## 一句话记忆

词库建 Trie，文本从每个位置沿树走、记最长词尾，命中就跳到词尾；中间符号跳过、大小写统一；想更快就上 AC 自动机。
