## 题意

给一个非负整数数组 `nums`，你一开始站在下标 0。`nums[i]` 表示在位置 i 时**最多**能向后跳几步（可以跳 1 到 `nums[i]` 之间的任意步数）。判断能否到达最后一个下标。

```
输入：nums = [3,0,2,0,1]
输出：true
解释：0 → 2（跳 2 步）→ 4（跳 2 步）
```

```
输入：nums = [2,1,0,3]
输出：false
解释：无论怎么跳，最远只能到下标 2，而 nums[2] = 0 过不去
```

## 思路

暴力想法是 DFS / DP：`can[i]` 表示能否从 i 到终点，每个位置尝试所有步数，最坏 O(n²)。

换个角度，不关心"具体怎么跳"，只关心"最远能到哪"。如果位置 i 可达，那么 `[i, i + nums[i]]` 之间的所有位置也都可达（因为可以跳任意小于上限的步数）。所以可达区域一定是一段从 0 开始的**连续前缀**，只要维护这个前缀的右端 `reach`：

- 从左到右遍历，若 `i > reach`，说明 i 根本走不到，后面更走不到，返回 false。
- 否则用 `i + nums[i]` 更新 `reach`；一旦 `reach >= n - 1` 就可以提前返回 true。

:::tip 关键点
可达位置是连续的一段，只需维护"当前能到的最远下标" `reach`；遍历中出现 `i > reach` 就断了。
:::

`nums = [3,0,2,0,1]` 推演：

```
i nums[i] i<=reach? reach更新
0 3       0<=0 是   max(0,3) = 3
1 0       1<=3 是   max(3,1) = 3
2 2       2<=3 是   max(3,4) = 4  >= 4, 返回 true
```

`nums = [2,1,0,3]` 推演：

```
i nums[i] i<=reach? reach更新
0 2       是        2
1 1       是        2
2 0       是        2
3 3       3>2 否    返回 false
```

## Java 题解

```java
import java.util.*;

class Solution {
    public boolean canJump(int[] nums) {
        int reach = 0; // 目前能到达的最远下标
        for (int i = 0; i < nums.length; i++) {
            if (i > reach) return false;          // 走不到 i，后面也走不到
            reach = Math.max(reach, i + nums[i]); // 从 i 出发能扩展到的最远处
            if (reach >= nums.length - 1) return true; // 已经能覆盖终点
        }
        return true;
    }
}
```

## 复杂度

- 时间 O(n)：一次遍历。
- 空间 O(1)。

## 易错点

- 判断条件是 `reach >= n - 1`（最后一个**下标**），不是 `>= n`。
- 必须先判断 `i > reach` 再用 `nums[i]` 更新；否则会用一个根本到不了的位置去扩展 reach。
- 长度为 1 的数组已经站在终点，应该返回 true，上面的写法第一轮就会返回 true。
- `nums[i]` 是最大步数不是固定步数，所以才能保证可达区域连续。

## 其他解法

倒着贪心：维护"能到达终点的最左位置" `last`，从右往左，若 `i + nums[i] >= last` 就把 `last` 更新为 i，最后看 `last == 0`。思路对称，同样 O(n)。

## 举一反三

- [[algo:jump-game-ii]]：同样维护最远边界，但要求最少跳几次，按"层"来数。
- [[algo:merge-intervals]]：每个位置对应区间 `[i, i + nums[i]]`，本题就是判断这些区间从 0 开始能否连续覆盖到终点。
- [[algo:partition-labels]]：同样一边遍历一边维护"当前段必须延伸到的最远位置"。

## 一句话记忆

维护能到的最远下标 `reach`，遍历时 `i > reach` 就失败，`reach >= n-1` 就成功。
