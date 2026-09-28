## 题意

给一个整数数组，把所有的 0 挪到数组末尾，非零元素之间的先后顺序必须保持不变。必须**原地**修改，不能拷贝出一个新数组。

```
输入：nums = [4,0,0,7,0,2]
输出：[4,7,2,0,0,0]
```

```
输入：nums = [0,0,1]
输出：[1,0,0]
```

## 思路

暴力做法：每遇到一个 0，就把它后面的元素整体左移一位，再把 0 放到最后，最坏 O(n²)。或者开一个新数组先放非零再补零，但违反原地要求。

换个视角：这其实是一个"**保序过滤**"——把所有非零元素按原顺序紧凑地放到数组前面，剩下的位置自然就是 0。用快慢双指针：

- `fast` 扫描整个数组；
- `slow` 指向下一个非零元素应该放的位置；
- `fast` 遇到非零就和 `slow` 位置交换，`slow++`。

:::tip 关键点
`[0, slow)` 始终是已处理好的非零元素，`[slow, fast)` 始终全是 0。交换只是把"第一个 0"和"当前非零"对调，所以非零元素的相对顺序不会变。
:::

推演 `[4,0,0,7,0,2]`：

```
fast  nums[fast]  slow(before)  array after
0     4           0             [4,0,0,7,0,2]  swap self
1     0           1             [4,0,0,7,0,2]
2     0           1             [4,0,0,7,0,2]
3     7           1             [4,7,0,0,0,2]
4     0           2             [4,7,0,0,0,2]
5     2           2             [4,7,2,0,0,0]
```

## Java 题解

```java
import java.util.*;

class Solution {
    public void moveZeroes(int[] nums) {
        int slow = 0; // 下一个非零元素该放的位置
        for (int fast = 0; fast < nums.length; fast++) {
            if (nums[fast] != 0) {
                // 当前非零元素换到 slow 处，slow 处原来一定是 0（或者就是自己）
                if (fast != slow) {
                    int tmp = nums[slow];
                    nums[slow] = nums[fast];
                    nums[fast] = tmp;
                }
                slow++;
            }
        }
    }
}
```

## 复杂度

- 时间 O(n)：fast 只扫一遍，每步常数次操作。
- 空间 O(1)：只用了两个指针。

## 易错点

- 不能用"首尾双指针"把尾部元素换到前面，那样会打乱非零元素的相对顺序。
- 交换写法中 `fast == slow` 时自己换自己没问题，加 `if` 只是少做几次无用写入。
- 用"先覆盖再补零"的写法时，别忘了最后把 `[slow, n)` 全部置 0，否则末尾残留旧值。

## 其他解法

先覆盖再补零：非零元素依次写到前面，最后把剩余位置填 0。写入次数更直观，但总写入次数固定为 n。

```java
import java.util.*;

class Solution {
    public void moveZeroes(int[] nums) {
        int slow = 0;
        for (int x : nums) {
            if (x != 0) nums[slow++] = x; // 非零元素紧凑地写到前面
        }
        while (slow < nums.length) nums[slow++] = 0; // 剩余位置补 0
    }
}
```

## 举一反三

- [[algo:sort-colors]]：同样是原地把元素分区，只不过分成三段，用三个指针。
- [[algo:3sum]]、[[algo:container-with-most-water]]：双指针的另一种形态——首尾相向。
- 快慢指针"保序过滤"就是原地版的 `list.removeIf(x -> x == 0)`，`ArrayList.removeIf` 内部就是这样紧凑搬移元素的。

## 一句话记忆

慢指针标记下一个非零位，快指针遇到非零就换过去，0 自然被挤到末尾。
