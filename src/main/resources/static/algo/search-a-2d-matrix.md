## 题意

给一个 m×n 的整数矩阵，满足两个性质：每一行从左到右升序；每一行的第一个数都大于上一行的最后一个数。判断 `target` 是否在矩阵中。要求 O(log(m×n))。

```
输入：matrix = [[2,5,8],
                [11,14,17],
                [20,23,26]], target = 14
输出：true
```

```
输入：同上 matrix，target = 15
输出：false
```

## 思路

逐个遍历是 O(mn)。先二分找行、再在行里二分，是 O(log m + log n)，已经够好，但要写两次二分。

更简洁的观察：由于"下一行开头 > 上一行结尾"，把矩阵按行拼起来就是一个长度 `m×n` 的**完全升序**的一维数组。只要把一维下标 `k` 映射回二维坐标：`row = k / n`，`col = k % n`，就能直接在 `[0, m×n - 1]` 上做一次普通二分。

:::tip 关键点
矩阵整体有序 = 一维有序数组。下标映射 `k → (k / n, k % n)`，其中 n 是**列数**。
:::

`target = 14` 推演（n = 3）：

```
lo hi mid (row,col) 值   比较
0  8  4   (1,1)     14   相等 -> true
```

`target = 15` 推演：

```
lo hi mid (row,col) 值   比较
0  8  4   (1,1)     14   14 < 15, lo = 5
5  8  6   (2,0)     20   20 > 15, hi = 5
5  5  5   (1,2)     17   17 > 15, hi = 4
lo > hi 结束 -> false
```

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean searchMatrix(int[][] matrix, int target) {
        int m = matrix.length, n = matrix[0].length;
        // 在闭区间 [0, m*n-1] 上二分
        int lo = 0, hi = m * n - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            int val = matrix[mid / n][mid % n]; // 一维下标映射到二维
            if (val == target) {
                return true;
            } else if (val < target) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return false;
    }
}
```

## 复杂度

- 时间 O(log(m×n))：对 m×n 个元素做一次二分。
- 空间 O(1)。

## 易错点

- 映射时除以、取模的都是**列数 n**，不是行数 m；写成 `mid / m` 在非方阵时会出错。
- 闭区间写法 `hi = m * n - 1`、`while (lo <= hi)`、`hi = mid - 1` 要配套使用。
- 本题和 [[algo:search-a-2d-matrix-ii]] 不同：那题只保证行、列分别有序，不能拉平，要从右上角开始走"阶梯"。
- 极端大矩阵时 `m * n` 可能溢出 int，本题数据范围不会，但面试可以提一句。

## 举一反三

- [[algo:search-a-2d-matrix-ii]]：只有行列各自有序，用右上角出发的 O(m+n) 走法。
- [[algo:search-insert-position]]：最基础的一维二分模板。
- [[algo:kth-smallest-element-in-a-bst]]：有序结构中按排名找元素，和"下标映射"一样考察对有序性的利用。
- 分页查询里把"第 k 条记录"换算成"第几页第几条"，用的也是 `k / pageSize`、`k % pageSize` 这套映射。

## 一句话记忆

矩阵按行拼起来整体有序，把 `mid` 映射成 `(mid / n, mid % n)` 做一次普通二分。
