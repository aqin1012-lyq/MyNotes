## 题意

给一个 m 行 n 列的矩阵，从左上角出发，按顺时针螺旋的顺序（向右 → 向下 → 向左 → 向上，一圈一圈往里收）把所有元素依次放进一个列表返回。

```
输入：matrix = [[1,2,3,4],
               [5,6,7,8],
               [9,10,11,12]]
输出：[1,2,3,4,8,12,11,10,9,5,6,7]
```

```
输入：matrix = [[1],[2],[3]]
输出：[1,2,3]
解释：只有一列，一路向下
```

## 思路

这题没有算法上的难点，考的是**边界控制**。最稳的写法是维护四条边界 `top, bottom, left, right`，一圈分四步：

1. 沿 `top` 行从 `left` 走到 `right`，然后 `top++`；
2. 沿 `right` 列从 `top` 走到 `bottom`，然后 `right--`；
3. 如果还有行（`top <= bottom`），沿 `bottom` 行从 `right` 走到 `left`，然后 `bottom--`；
4. 如果还有列（`left <= right`），沿 `left` 列从 `bottom` 走到 `top`，然后 `left++`。

每走完一条边就把对应边界往里收一格，边界交错时结束。

:::tip 关键点
第 3、4 步前要重新检查边界：矩阵只剩一行或一列时，前两步已经走完了，不检查就会反向重复读取。
:::

推演 3×4 的例子：

```
round 1  top=0 bottom=2 left=0 right=3
  right along row 0:     1 2 3 4        top -> 1
  down along col 3:      8 12           right -> 2
  left along row 2:      11 10 9        bottom -> 1
  up along col 0:        5              left -> 1
round 2  top=1 bottom=1 left=1 right=2
  right along row 1:     6 7            top -> 2
  down along col 2:      (none)         right -> 1
  top > bottom, stop
```

## Java 题解

```java
import java.util.*;

class Solution {
    public List<Integer> spiralOrder(int[][] matrix) {
        List<Integer> res = new ArrayList<>();
        int top = 0, bottom = matrix.length - 1;
        int left = 0, right = matrix[0].length - 1;
        while (top <= bottom && left <= right) {
            // 1. 上边：从左到右
            for (int j = left; j <= right; j++) res.add(matrix[top][j]);
            top++;
            // 2. 右边：从上到下
            for (int i = top; i <= bottom; i++) res.add(matrix[i][right]);
            right--;
            // 3. 下边：从右到左（还剩行时才走）
            if (top <= bottom) {
                for (int j = right; j >= left; j--) res.add(matrix[bottom][j]);
                bottom--;
            }
            // 4. 左边：从下到上（还剩列时才走）
            if (left <= right) {
                for (int i = bottom; i >= top; i--) res.add(matrix[i][left]);
                left++;
            }
        }
        return res;
    }
}
```

## 复杂度

- 时间 O(mn)：每个元素恰好访问一次。
- 空间 O(1)：除结果列表外只用了四个边界变量。

## 易错点

- 第 3、4 步漏掉 `if` 边界检查，单行/单列矩阵会重复输出，如 `[[1,2,3]]` 变成 `[1,2,3,2,1]`。
- 每条边走完**立刻**收缩对应边界，下一条边的起点才不会重复拿到角上的元素。
- 循环条件是 `top <= bottom && left <= right`，两个条件都要有。

## 举一反三

- [[algo:rotate-image]]：同样按"一圈一圈"处理矩阵，边界控制思路一致。
- [[algo:set-matrix-zeroes]]：矩阵原地操作，关注处理顺序。
- 螺旋矩阵 II（LeetCode 59，按螺旋顺序填数）用完全相同的四边界模板。

## 一句话记忆

四条边界 top/bottom/left/right，右下左上各走一条边就收缩一格，后两步先查边界。
