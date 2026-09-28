## 题意

给一个数组 `nums` 和一个非负整数 `k`，把数组整体向右循环移动 k 步：每一步最后一个元素跑到最前面。要求原地修改，k 可能大于数组长度。

```
输入：nums = [1,2,3,4,5,6], k = 2
输出：[5,6,1,2,3,4]
```

```
输入：nums = [7,8,9], k = 4
输出：[9,7,8]
解释：移动 4 步等价于移动 4 % 3 = 1 步
```

## 思路

暴力：每次右移一步（把最后一个拿出来，其余整体后移），重复 k 次，O(n · k)。

开辅助数组：元素 i 的新位置是 `(i + k) % n`，拷一份再写回，O(n) 时间但 O(n) 空间。

原地 O(1) 空间的经典技巧——**三次翻转**。右移 k 位的结果，就是把"后 k 个"整体搬到前面，同时两段内部顺序不变：

1. 翻转整个数组：后 k 个跑到前面了，但两段内部都是倒序的；
2. 翻转前 k 个：恢复第一段内部顺序；
3. 翻转后 n-k 个：恢复第二段内部顺序。

:::tip 关键点
(A B) 要变成 (B A)：先整体翻转得到 (B' A')，再分别翻转每段得到 (B A)。先 `k %= n` 处理 k 大于 n 的情况。
:::

推演 `[1,2,3,4,5,6], k = 2`：

```
start            1 2 3 4 5 6     A = 1 2 3 4, B = 5 6
reverse all      6 5 4 3 2 1
reverse [0,1]    5 6 4 3 2 1
reverse [2,5]    5 6 1 2 3 4     done
```

## Java 题解

```java
import java.util.*;

class Solution {
    public void rotate(int[] nums, int k) {
        int n = nums.length;
        k %= n;                     // k 可能大于 n
        reverse(nums, 0, n - 1);    // 整体翻转
        reverse(nums, 0, k - 1);    // 翻转前 k 个
        reverse(nums, k, n - 1);    // 翻转剩下的 n-k 个
    }

    private void reverse(int[] a, int i, int j) {
        while (i < j) {
            int t = a[i];
            a[i++] = a[j];
            a[j--] = t;
        }
    }
}
```

## 复杂度

- 时间 O(n)：每个元素被交换常数次（共翻转约 2n 个元素）。
- 空间 O(1)：原地交换。

## 易错点

- 忘了 `k %= n`，k 大于 n 时下标越界。
- 右移和左移的翻转顺序不一样：右移是"先整体、再前 k、再后 n-k"；左移 k 位是"先前 k、再后 n-k、最后整体"。
- k 为 0 或 n 的倍数时，`reverse(nums, 0, -1)` 自然什么都不做，不需要特判。

## 其他解法

辅助数组：直观，O(n) 空间。

```java
import java.util.*;

class Solution {
    public void rotate(int[] nums, int k) {
        int n = nums.length;
        int[] tmp = new int[n];
        for (int i = 0; i < n; i++) {
            tmp[(i + k) % n] = nums[i]; // 元素 i 右移 k 位后的新位置
        }
        System.arraycopy(tmp, 0, nums, 0, n);
    }
}
```

## 举一反三

- [[algo:rotate-image]]：矩阵旋转同样可以拆成"转置 + 翻转"两步组合。
- [[algo:reverse-linked-list]]：翻转操作的链表版，旋转链表也可以借鉴"找断点再拼接"。
- 循环缓冲区（环形队列）用 `(i + k) % n` 计算下标，和这里的取模是同一思路。

## 一句话记忆

右移 k 位 = 整体翻转 + 翻转前 k 个 + 翻转后 n-k 个，先 k %= n。
