## 题意

给一组只含小写字母的字符串，把"字母异位词"归到同一组：两个字符串如果用到的字母以及每个字母的次数完全一样（只是顺序不同），就算异位词。返回分组结果，组的顺序、组内顺序都无所谓。

```
输入：strs = ["tea","ate","bat","eat","tab","cat"]
输出：[["tea","ate","eat"],["bat","tab"],["cat"]]
解释：tea/ate/eat 都由 a,e,t 各一个组成；bat/tab 都由 a,b,t 组成
```

```
输入：strs = ["", "b", ""]
输出：[["",""],["b"]]
```

## 思路

暴力做法：拿每个字符串和已有的每一组的代表比较"是不是异位词"（排序后比较或计数比较），组越多越慢，最坏 O(n² · k)。

瓶颈在于"两两比较"。换个角度：给每个字符串算一个**标准形式（key）**，异位词的 key 相同、非异位词的 key 不同。那么分组就变成了 `Map<key, List<String>>` 的一次遍历。

key 有两种常见算法：

- 排序：把字符数组排序后转成字符串，`"eat" → "aet"`，代价 O(k log k)。
- 计数：统计 26 个字母出现次数，拼成 `"1#0#0#0#1#...#1"` 这样的串，代价 O(k)。

:::tip 关键点
分组问题 = 找一个"等价类的标准代表"做哈希 key。异位词的不变量是"字母多重集"，排序后的串或 26 维计数都能唯一表示它。
:::

用排序 key 推演：

```
str   key   map after
tea   aet   {aet:[tea]}
ate   aet   {aet:[tea,ate]}
bat   abt   {aet:[tea,ate], abt:[bat]}
eat   aet   {aet:[tea,ate,eat], abt:[bat]}
tab   abt   {aet:[...], abt:[bat,tab]}
cat   act   {aet:[...], abt:[...], act:[cat]}
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<List<String>> groupAnagrams(String[] strs) {
        Map<String, List<String>> groups = new HashMap<>();
        for (String s : strs) {
            // 排序后的字符串作为异位词的统一 key
            char[] cs = s.toCharArray();
            Arrays.sort(cs);
            String key = new String(cs);
            // 没有这个 key 就新建一个组，再把 s 放进去
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(s);
        }
        return new ArrayList<>(groups.values());
    }
}
```

## 复杂度

- 时间 O(n · k log k)：n 个字符串，每个长度最多 k，排序 k log k；哈希 key 的计算和比较是 O(k)。
- 空间 O(n · k)：map 中存了所有字符串以及它们的 key。

## 易错点

- `char[]` 不能直接当 HashMap 的 key：数组的 `hashCode/equals` 是按引用算的，必须转成 `String`（或 `Arrays.toString`）。
- 计数法拼 key 时要加分隔符，否则 `[1,11]` 和 `[11,1]` 这类计数拼出来可能撞车。
- 空字符串也是合法输入，它们自成一组，别被特殊处理掉。
- `groups.values()` 返回的是视图，需要 `new ArrayList<>(...)` 包一层才符合返回类型。

## 其他解法

计数 key：字符串很长时 O(k) 比 O(k log k) 更好。

```java
import java.util.*;

class Solution {
    public List<List<String>> groupAnagrams(String[] strs) {
        Map<String, List<String>> groups = new HashMap<>();
        for (String s : strs) {
            int[] cnt = new int[26];
            for (char c : s.toCharArray()) cnt[c - 'a']++;
            // 用分隔符拼接 26 个计数，避免不同计数拼出相同的串
            StringBuilder sb = new StringBuilder();
            for (int x : cnt) sb.append(x).append('#');
            groups.computeIfAbsent(sb.toString(), k -> new ArrayList<>()).add(s);
        }
        return new ArrayList<>(groups.values());
    }
}
```

## 举一反三

- [[algo:find-all-anagrams-in-a-string]]：同样用 26 维计数判断异位词，只不过套在滑动窗口里。
- [[algo:two-sum]]：同样是"算一个 key，用哈希表 O(1) 查找/归类"。
- 后端里"按规范化后的 key 分组"很常见，比如对手机号、邮箱先做归一化（去空格、转小写）再去重或聚合，和 SQL 的 `GROUP BY` 思想一致。

## 一句话记忆

给每个字符串算一个"排序后/计数后"的标准 key，用 HashMap 按 key 分组。
