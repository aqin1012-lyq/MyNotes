## 题意

给一个 m × n 的整数矩阵，只要某个元素是 0，就把它所在的整行和整列全部改成 0。必须原地修改。进阶要求：只用 O(1) 额外空间。

```
输入：matrix = [[5,0,7],
               [2,4,6],
               [9,8,0]]
输出：[[0,0,0],
      [2,0,0],
      [0,0,0]]
```

```
输入：matrix = [[1,2],[3,4]]
输出：[[1,2],[3,4]]
解释：没有 0，不变
```

## 思路

最容易犯的错：边扫边置零。这样新写进去的 0 会被当成"原本的 0"，导致整个矩阵被错误清零。所以必须**先记录，再置零**。

- 方法一：复制整个矩阵，O(mn) 空间。
- 方法二：用两个布尔数组 `row[m]`、`col[n]` 记录哪些行、列需要置零，O(m + n) 空间。
- 方法三：O(1) 空间——**把第一行和第一列当作标记数组**。`matrix[i][0] == 0` 表示第 i 行要置零，`matrix[0][j] == 0` 表示第 j 列要置零。但第一行、第一列自己原本有没有 0 的信息会被覆盖，所以先用两个布尔变量单独记下来，最后再处理它们。

:::tip 关键点
借用第一行/第一列当标记位，先用两个变量保存它们自己的原始状态；处理顺序是：内部区域 → 第一行/第一列，否则标记会被提前破坏。
:::

推演例 1：

```
step 1  firstRowZero = true (0 at [0][1]), firstColZero = false
step 2  scan inner: [2][2]==0 -> mark matrix[2][0]=0, matrix[0][2]=0
        first row: 5 0 0      first col: 5 2 0
step 3  fill inner by marks:
        row 2 marked -> [2][1]=0 ; col 1 marked -> [1][1]=0 ; col 2 marked -> [1][2]=0
step 4  firstRowZero -> row 0 all 0
result  [[0,0,0],[2,0,0],[0,0,0]]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public void setZeroes(int[][] matrix) {
        int m = matrix.length, n = matrix[0].length;
        // 1. 先记住第一行、第一列本身是否有 0
        boolean firstRowZero = false, firstColZero = false;
        for (int j = 0; j < n; j++) if (matrix[0][j] == 0) firstRowZero = true;
        for (int i = 0; i < m; i++) if (matrix[i][0] == 0) firstColZero = true;
        // 2. 用第一行/第一列做标记
        for (int i = 1; i < m; i++) {
            for (int j = 1; j < n; j++) {
                if (matrix[i][j] == 0) {
                    matrix[i][0] = 0;
                    matrix[0][j] = 0;
                }
            }
        }
        // 3. 根据标记把内部区域置零
        for (int i = 1; i < m; i++) {
            for (int j = 1; j < n; j++) {
                if (matrix[i][0] == 0 || matrix[0][j] == 0) matrix[i][j] = 0;
            }
        }
        // 4. 最后处理第一行、第一列
        if (firstRowZero) for (int j = 0; j < n; j++) matrix[0][j] = 0;
        if (firstColZero) for (int i = 0; i < m; i++) matrix[i][0] = 0;
    }
}
```

## 复杂度

- 时间 O(mn)：矩阵扫描常数遍。
- 空间 O(1)：只用了两个布尔变量。

## 易错点

- 边扫描边置零会"传染"，必须先标记后置零。
- 第一行/第一列的原始状态要在做标记**之前**保存，否则分不清 `matrix[0][j] == 0` 是原本就是 0 还是标记出来的。
- 第一行/第一列必须**最后**处理；如果先把第一行清零，所有列都会被误判为需要置零。
- 内部区域的循环从下标 1 开始，别把第一行第一列也卷进去。

## 其他解法

O(m + n) 空间的标记数组版：面试中先写出这个，再优化到 O(1) 也是很好的节奏。

```java
import java.util.*;

class Solution {
    public void setZeroes(int[][] matrix) {
        int m = matrix.length, n = matrix[0].length;
        boolean[] row = new boolean[m], col = new boolean[n];
        // 先记录哪些行、列出现过 0
        for (int i = 0; i < m; i++)
            for (int j = 0; j < n; j++)
                if (matrix[i][j] == 0) { row[i] = true; col[j] = true; }
        // 再统一置零
        for (int i = 0; i < m; i++)
            for (int j = 0; j < n; j++)
                if (row[i] || col[j]) matrix[i][j] = 0;
    }
}
```

## 举一反三

- [[algo:first-missing-positive]]：同样是"借用输入数组本身存标记"来省空间。
- 同类技巧：原地更新时需要区分"旧状态"和"新状态"，就要先标记或者用额外位编码。
- [[algo:rotate-image]]、[[algo:spiral-matrix]]：矩阵类原地操作，都要注意处理顺序。

## 一句话记忆

先记录再置零；想省空间就拿第一行第一列当标记，它们自己的状态先存进两个变量、最后处理。
