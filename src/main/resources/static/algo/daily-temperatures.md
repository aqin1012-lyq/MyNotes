## 题意

给一个数组 temperatures 表示每天的气温，对每一天求：要再等几天才会出现**严格更高**的气温。如果之后再也没有更高的气温，填 0。返回同样长度的答案数组。

```
输入：temperatures = [70,65,68,72,69,75,71]
输出：[3,1,1,2,1,0,0]
解释：第 0 天 70 度，要等到第 3 天的 72 度，等 3 天；第 5 天 75 度之后没有更高的，填 0
```

## 思路

暴力：对每一天向后扫描，找到第一个更高的温度，O(n²)。长度到 10^5 时会超时。

瓶颈在于向后扫描时做了大量重复比较。换个视角：**从左往右扫，把「还没找到答案的日子」存起来**。今天的温度如果比其中一些日子高，那今天就是它们的答案。

哪些日子会被今天「解决」？观察可知，还没找到答案的日子，它们的温度一定是**从栈底到栈顶单调不增**的（如果后面的某天更高，前面那天早就被它解决了）。所以只要从栈顶开始比较，比今天低的全部弹出并记录答案，遇到不比今天低的就停。这就是**单调栈**。

:::tip 关键点
「下一个更大元素」= 单调递减栈。栈里存下标（既能取温度又能算天数差），当前元素比栈顶大就不断弹出并结算，最后把自己压栈。
:::

推演（栈中存下标，括号里是温度）：

```
i  temp  pop & answer                 stack after
0  70    -                            [0(70)]
1  65    -                            [0(70),1(65)]
2  68    ans[1]=2-1=1                 [0(70),2(68)]
3  72    ans[2]=1, ans[0]=3           [3(72)]
4  69    -                            [3(72),4(69)]
5  75    ans[4]=1, ans[3]=2           [5(75)]
6  71    -                            [5(75),6(71)]
end: 5, 6 remain, ans stays 0
```

## Java 题解

```java
import java.util.*;

class Solution {
    public int[] dailyTemperatures(int[] temperatures) {
        int n = temperatures.length;
        int[] ans = new int[n];
        // 单调栈：存还没等到更高温度的下标，对应温度从底到顶单调不增
        Deque<Integer> stack = new ArrayDeque<>();
        for (int i = 0; i < n; i++) {
            // 今天比栈顶那天热：栈顶那天的答案就是今天
            while (!stack.isEmpty() && temperatures[i] > temperatures[stack.peek()]) {
                int prev = stack.pop();
                ans[prev] = i - prev;
            }
            stack.push(i);
        }
        // 栈里剩下的日子没有更高温度，ans 默认就是 0
        return ans;
    }
}
```

## 复杂度

- 时间 O(n)：虽然有内层 while，但每个下标最多入栈一次、出栈一次，总操作次数 ≤ 2n。
- 空间 O(n)：最坏温度单调递减时所有下标都在栈里。

## 易错点

- 栈里要存**下标**而不是温度，否则算不出等了几天。
- 比较用严格大于 `>`：温度相等不算「更高」，相等的日子要继续留在栈里。
- 别被内层 while 骗了以为是 O(n²)，面试时要能讲清楚「每个元素只进出栈一次」的均摊分析。

## 其他解法

从右往左扫，栈里维护「右边可能成为答案的候选日子」：比今天低或相等的候选永远不会成为更左边日子的答案（今天比它们更近且不低），直接弹掉；弹完后栈顶就是今天的答案。

```java
import java.util.*;

class Solution {
    public int[] dailyTemperatures(int[] temperatures) {
        int n = temperatures.length;
        int[] ans = new int[n];
        Deque<Integer> stack = new ArrayDeque<>();
        for (int i = n - 1; i >= 0; i--) {
            // 不比今天高的候选，对左边的日子也没用了
            while (!stack.isEmpty() && temperatures[stack.peek()] <= temperatures[i]) {
                stack.pop();
            }
            // 栈顶就是右边第一个更高的日子
            ans[i] = stack.isEmpty() ? 0 : stack.peek() - i;
            stack.push(i);
        }
        return ans;
    }
}
```

## 举一反三

- 单调栈的进阶应用：[[algo:largest-rectangle-in-histogram]]（找左右两侧第一个更矮的柱子）、[[algo:trapping-rain-water]]。
- 单调队列版本：[[algo:sliding-window-maximum]]。
- 后端场景：股票/监控指标里「多久之后突破当前值」这种查询，可以离线用单调栈一次算完。

## 一句话记忆

下一个更大元素用单调递减栈：比栈顶大就弹出结算，栈里存下标。
