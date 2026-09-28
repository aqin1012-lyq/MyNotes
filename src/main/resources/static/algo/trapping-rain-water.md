## 题意

数组 `height` 描述一排宽度为 1 的柱子高度。下雨后，柱子之间的凹槽会积水，求总共能接多少单位的雨水。数组元素都是非负整数。

```
输入：height = [3,0,1,0,4,1,2]
输出：9
解释：各位置积水 [0,3,2,3,0,1,0]，合计 9
```

```
输入：height = [1,2,3]
输出：0
解释：一直上升，没有凹槽
```

## 思路

先想清楚**单个位置**能存多少水：位置 i 上方的水面高度取决于它左边最高的柱子和右边最高的柱子中**较矮**的那个，所以

`water[i] = min(leftMax[i], rightMax[i]) - height[i]`（这里 leftMax/rightMax 包含 i 自己，结果不会为负）。

- 暴力：对每个 i 向左、向右各扫一遍找最大值，O(n²)。
- 预处理：先从左到右算出 `leftMax[]`，从右到左算出 `rightMax[]`，再扫一遍求和，O(n) 时间、O(n) 空间。
- 双指针：能不能不存数组？观察到只需要"两者中较小的那个"。左右指针向中间走，维护 `lMax`、`rMax`。如果 `lMax < rMax`，那对左指针 `l` 来说，它真正的右侧最大值只会 ≥ `rMax` > `lMax`，所以 `l` 的水位就是 `lMax`，可以立刻结算并 `l++`；反之结算右边。

:::tip 关键点
水位由短板决定。双指针时哪边的已知最大值更小，那一边的水位就已经确定了——另一边无论还有什么柱子，只会更高，不会拉低它。
:::

推演 `[3,0,1,0,4,1,2]`：

```
l  r  lMax rMax  settle      add  total
0  6  3    2     r: 2-2      0    0
0  5  3    2     r: 2-1      1    1
0  4  3    4     l: 3-3      0    1
1  4  3    4     l: 3-0      3    4
2  4  3    4     l: 3-1      2    6
3  4  3    4     l: 3-0      3    9
4  4  l == r, stop
```

（表中 lMax/rMax 为本步用当前 `height[l]`、`height[r]` 更新之后的值。）

## Java 题解

```java
import java.util.*;

class Solution {
    public int trap(int[] height) {
        int l = 0, r = height.length - 1;
        int lMax = 0, rMax = 0, total = 0;
        while (l < r) {
            // 先用当前柱子更新两侧已知最大值
            lMax = Math.max(lMax, height[l]);
            rMax = Math.max(rMax, height[r]);
            if (lMax < rMax) {
                // 左边短板更低：l 的水位确定为 lMax
                total += lMax - height[l];
                l++;
            } else {
                // 右边短板更低（或相等）：r 的水位确定为 rMax
                total += rMax - height[r];
                r--;
            }
        }
        return total;
    }
}
```

## 复杂度

- 时间 O(n)：两个指针合计走 n-1 步。
- 空间 O(1)：只用了几个变量；预处理数组版本是 O(n)。

## 易错点

- 水位是 `min(左最大, 右最大)`，不是左右相邻柱子的高度。
- 双指针里比较的是 `lMax` 和 `rMax`（也可以比较 `height[l]` 和 `height[r]`），**不是**只看其中一边。
- 先更新 `lMax/rMax` 再结算，这样 `lMax - height[l]` 天然 ≥ 0，不需要额外判断负数。
- 首尾两根柱子永远存不了水，长度小于 3 的数组答案一定是 0。

## 其他解法

单调栈：按"层"横向计算。维护一个高度递减的栈，遇到更高的柱子时，弹出的栈顶就是凹槽底，和新栈顶、当前柱子围成一层水。

```java
import java.util.*;

class Solution {
    public int trap(int[] height) {
        Deque<Integer> stack = new ArrayDeque<>(); // 存下标，对应高度单调递减
        int total = 0;
        for (int i = 0; i < height.length; i++) {
            while (!stack.isEmpty() && height[i] > height[stack.peek()]) {
                int bottom = stack.pop();          // 凹槽底
                if (stack.isEmpty()) break;        // 左边没有墙，存不住水
                int left = stack.peek();
                int w = i - left - 1;
                int h = Math.min(height[left], height[i]) - height[bottom];
                total += w * h;                    // 按层累加
            }
            stack.push(i);
        }
        return total;
    }
}
```

## 举一反三

- [[algo:container-with-most-water]]：同样是"短板决定水位"+ 相向双指针，但只选两根线。
- [[algo:largest-rectangle-in-histogram]]：单调栈解法的姊妹题，找每根柱子左右第一个更矮的。
- [[algo:daily-temperatures]]：单调栈基础题，找右边第一个更大的元素。

## 一句话记忆

每格水位 = 左右最高的较小者；双指针谁的已知最大值小就先结算谁。
