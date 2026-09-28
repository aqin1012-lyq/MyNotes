## 题意

给一个 m × n 的整数矩阵，它的每一行从左到右升序，每一列从上到下升序（但下一行的开头不一定比上一行的结尾大）。判断目标值 `target` 是否在矩阵里，返回 true/false。

```
输入：matrix = [[2, 5, 9,14],
               [3, 7,11,18],
               [6,10,16,21],
               [13,17,20,25]], target = 10
输出：true
```

```
输入：同上矩阵, target = 12
输出：false
```

## 思路

- 暴力：全部扫一遍，O(mn)，完全没用上有序性。
- 每行二分：对每一行做一次二分查找，O(m log n)，用上了行有序，但没用上列有序。

最优解是从**右上角**出发（或左下角）。右上角这个元素很特别：它是所在行的最大值、所在列的最小值。拿它和 target 比较：

- 相等：找到了；
- 比 target 大：它所在的这一**列**往下只会更大，整列都可以排除，向左走一格；
- 比 target 小：它所在的这一**行**往左只会更小，整行都可以排除，向下走一格。

每一步都排除一整行或一整列，最多走 m + n 步。

:::tip 关键点
从右上角看，矩阵就像一棵二叉搜索树：往左变小、往下变大。每次比较都能排除一行或一列。左上角和右下角不行，因为两个方向同增或同减，无法判断该往哪走。
:::

推演 target = 10：

```
pos    value  compare  move
(0,3)  14     > 10     left
(0,2)  9      < 10     down
(1,2)  11     > 10     left
(1,1)  7      < 10     down
(2,1)  10     = 10     found
```

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean searchMatrix(int[][] matrix, int target) {
        int m = matrix.length, n = matrix[0].length;
        // 从右上角出发：往左变小，往下变大
        int i = 0, j = n - 1;
        while (i < m && j >= 0) {
            int v = matrix[i][j];
            if (v == target) {
                return true;
            } else if (v > target) {
                j--; // 当前列往下都更大，排除这一列
            } else {
                i++; // 当前行往左都更小，排除这一行
            }
        }
        return false;
    }
}
```

## 复杂度

- 时间 O(m + n)：每步 i 增加或 j 减少，最多 m + n 步。
- 空间 O(1)。

## 易错点

- 起点选左上角或右下角是错的：两个方向都变大（或都变小），无法做出唯一的决策。
- 循环条件 `i < m && j >= 0`，两个边界都要检查。
- 别把它和"搜索二维矩阵 I"（LeetCode 74，整个矩阵按行首尾相接完全有序）混淆：那题可以当成一维数组做一次二分，本题不行。

## 其他解法

逐行二分：O(m log n)，当 n 远大于 m 时也不错。

```java
import java.util.*;

class Solution {
    public boolean searchMatrix(int[][] matrix, int target) {
        for (int[] row : matrix) {
            // 每一行单独有序，直接二分
            int lo = 0, hi = row.length - 1;
            while (lo <= hi) {
                int mid = lo + (hi - lo) / 2;
                if (row[mid] == target) return true;
                if (row[mid] < target) lo = mid + 1;
                else hi = mid - 1;
            }
        }
        return false;
    }
}
```

## 举一反三

- [[algo:search-a-2d-matrix]]：整体有序的版本，直接二分。
- [[algo:container-with-most-water]]、[[algo:two-sum]]（有序数组版）：同样是"一次比较排除一整批候选"的双指针思路。
- 延伸：本题的"右上角走法"也可以用来统计矩阵中 ≤ x 的元素个数。

## 一句话记忆

从右上角出发，大了往左、小了往下，每步排除一行或一列。
