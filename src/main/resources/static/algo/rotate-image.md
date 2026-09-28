## 题意

给一个 n × n 的方阵表示一张图片，把它顺时针旋转 90 度。必须**原地**修改，不能另开一个矩阵。

```
输入：matrix = [[1,2,3],
               [4,5,6],
               [7,8,9]]
输出：[[7,4,1],
      [8,5,2],
      [9,6,3]]
```

```
输入：matrix = [[1,2],[3,4]]
输出：[[3,1],[4,2]]
```

## 思路

先找坐标规律：顺时针旋转 90 度后，原来的 `(i, j)` 跑到 `(j, n-1-i)`，也就是"原来的第 i 行变成新的倒数第 i 列"。

如果允许额外空间，开一个新矩阵按这个公式填即可。原地的话有两种思路：

- **转置 + 每行翻转**：转置把 `(i, j)` 变成 `(j, i)`，再左右翻转把 `(j, i)` 变成 `(j, n-1-i)`，两步组合正好是顺时针 90 度。
- **四元素轮换**：一次旋转会让 4 个位置形成一个环，用一个临时变量把它们依次挪动。

转置 + 翻转最好记，也最不容易写错。

:::tip 关键点
顺时针 90° = 沿主对角线转置 + 每行左右翻转。（逆时针 90° = 转置 + 上下翻转。）
:::

推演：

```
original      transpose     reverse rows
1 2 3         1 4 7         7 4 1
4 5 6   ->    2 5 8   ->    8 5 2
7 8 9         3 6 9         9 6 3
```

## Java 题解

```java
import java.util.*;

class Solution {
    public void rotate(int[][] matrix) {
        int n = matrix.length;
        // 1. 沿主对角线转置：只交换上三角，避免换回去
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                int t = matrix[i][j];
                matrix[i][j] = matrix[j][i];
                matrix[j][i] = t;
            }
        }
        // 2. 每一行左右翻转
        for (int[] row : matrix) {
            for (int l = 0, r = n - 1; l < r; l++, r--) {
                int t = row[l];
                row[l] = row[r];
                row[r] = t;
            }
        }
    }
}
```

## 复杂度

- 时间 O(n²)：每个元素被交换常数次。
- 空间 O(1)：原地交换。

## 易错点

- 转置时内层循环要从 `j = i + 1` 开始，如果 `j` 从 0 开始，每对元素会被交换两次，等于没换。
- 翻转方向别搞反：顺时针是"转置 + 左右翻转"，逆时针是"转置 + 上下翻转"（或者"左右翻转 + 转置"）。
- 四元素轮换写法里，外层只遍历 `n/2` 圈，内层范围容易写错，所以面试优先写转置 + 翻转。

## 其他解法

四元素轮换：每次把一个环上的 4 个元素同时转到位。

```java
import java.util.*;

class Solution {
    public void rotate(int[][] matrix) {
        int n = matrix.length;
        for (int i = 0; i < n / 2; i++) {             // 第 i 圈
            for (int j = i; j < n - 1 - i; j++) {     // 圈上每个起点
                int t = matrix[i][j];                        // 暂存上
                matrix[i][j] = matrix[n - 1 - j][i];         // 左 -> 上
                matrix[n - 1 - j][i] = matrix[n - 1 - i][n - 1 - j]; // 下 -> 左
                matrix[n - 1 - i][n - 1 - j] = matrix[j][n - 1 - i]; // 右 -> 下
                matrix[j][n - 1 - i] = t;                    // 上 -> 右
            }
        }
    }
}
```

## 举一反三

- [[algo:rotate-array]]：一维数组的旋转同样拆成多次翻转来组合。
- [[algo:spiral-matrix]]：同样按"圈"处理矩阵。
- [[algo:set-matrix-zeroes]]：矩阵原地操作的另一类题。

## 一句话记忆

顺时针转 90 度 = 先沿主对角线转置，再把每行左右翻转。
