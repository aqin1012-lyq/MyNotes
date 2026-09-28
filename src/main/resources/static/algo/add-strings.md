## 题意

给两个用字符串表示的非负整数 `num1`、`num2`（可能很长，远超 long 的范围，没有多余的前导零），返回它们的和，同样用字符串表示。不能用 `BigInteger`，也不能把整个字符串直接转成整数。

```
输入：num1 = "4567", num2 = "895"
输出："5462"
```

```
输入：num1 = "999", num2 = "1"
输出："1000"
解释：最高位还有进位，结果比两个输入都长
```

## 思路

直接转成 long 相加会溢出，所以只能模拟小学竖式加法：**从最低位（字符串末尾）开始**，两个数各取一位，加上进位，得到当前位 `sum % 10` 和新进位 `sum / 10`，一路往高位走。

两个串长度不同怎么办？短的那个走完后当作 0 继续。循环条件写成 `i >= 0 || j >= 0 || carry != 0`，就能把"长度不等"和"最后还有进位"两个边界一并处理掉。结果是从低位往高位生成的，最后反转一次。

:::tip 关键点
双指针从尾部往前，越界的一方补 0；循环条件带上 `carry != 0`；StringBuilder 追加后整体 reverse。
:::

用 `"4567" + "895"` 推演：

```
i  j   a  b  carry_in  sum  写入  carry_out
3  2   7  5  0         12   2     1
2  1   6  9  1         16   6     1
1  0   5  8  1         14   4     1
0  -1  4  0  1         5    5     0
追加顺序 "2645" -> 反转得 "5462"
```

## Java 题解

```java
import java.util.*;

class Solution {
    public String addStrings(String num1, String num2) {
        StringBuilder sb = new StringBuilder();
        int i = num1.length() - 1, j = num2.length() - 1, carry = 0;
        // 任一串还有数字或还有进位就继续
        while (i >= 0 || j >= 0 || carry != 0) {
            int a = i >= 0 ? num1.charAt(i--) - '0' : 0; // 越界补 0
            int b = j >= 0 ? num2.charAt(j--) - '0' : 0;
            int sum = a + b + carry;
            sb.append((char) ('0' + sum % 10)); // 当前位
            carry = sum / 10;                    // 进位
        }
        return sb.reverse().toString(); // 低位在前，反转回来
    }
}
```

## 复杂度

- 时间 O(max(m, n))：每一位处理一次，最后反转一次。
- 空间 O(1) 额外空间（不计结果字符串本身；StringBuilder 就是结果）。

## 易错点

- 忘了最后的进位：`"999" + "1"` 会得到 `"000"`。
- 字符转数字要减 `'0'`，直接用 `charAt(i)` 得到的是 ASCII 码（`'7'` 是 55）。
- `sb.append(sum % 10)` 追加 int 也可以，但别写成 `sb.append('0' + sum % 10)`——`char + int` 结果是 int，会追加出 "50" 这样的数字串。
- 用 `sb.insert(0, ...)` 每次头插是 O(n²)，先 append 再 reverse 才是线性。
- 两个 `"0"` 相加结果是 `"0"`，这个写法天然正确，不会产生空串或多余前导零。

## 举一反三

- [[algo:add-two-numbers]]：链表版的大数相加，数字逆序存储，思路完全一样。
- [[algo:string-to-integer-atoi]]：同样逐位处理数字字符。
- 字符串相乘（大数乘法）可以把本题当成子过程：逐位相乘后错位累加。
- 工程上金额、超长 ID 这类场景 Java 通常直接用 `BigDecimal` / `BigInteger`，其内部就是按"大基数"的数组逐段做进位运算，原理和这里一样。

## 一句话记忆

双指针从尾往前、越界补 0、循环带上进位，最后 reverse。
