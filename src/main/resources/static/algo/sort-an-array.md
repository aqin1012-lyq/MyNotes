## 题意

给一个整数数组，把它按升序排好后返回。要求不用内置排序，自己实现一个 O(n log n) 的排序算法。数据规模到 5×10⁴ 级别，而且测试里会有已经有序、大量重复甚至全部相同的数组。这题是手写快排 / 归并 / 堆排的练兵场。

```
输入：nums = [5,1,4,2,4]
输出：[1,2,4,4,5]
```

```
输入：nums = [3,3,3,3]
输出：[3,3,3,3]
解释：全部相同的输入是朴素快排的噩梦
```

## 思路

冒泡、选择、插入排序都是 O(n²)，5×10⁴ 的数据会超时，所以要从三种 O(n log n) 的排序里选：**快排**（原地、常数小、最常被要求手写）、**归并**（稳定、最坏也是 O(n log n)，但要 O(n) 辅助空间）、**堆排**（原地、最坏 O(n log n)，但缓存不友好、常数大）。

快排的核心是 partition：选一个 pivot，把数组分成"小于 / 等于 / 大于"几段，再递归排两边。它的复杂度完全取决于每次划分是否均衡。

:::warn 为什么朴素快排在 LeetCode 上会超时
- 固定选第一个或最后一个元素做 pivot：遇到**已经有序**的大数组，每次只分出 1 个元素，递归深度 n，总时间 O(n²)，还可能栈溢出。解决：**随机选 pivot**。
- 就算随机选 pivot，经典的两路 partition（小于放左、大于等于放右）遇到**全部相同**的数组，所有元素都落到同一边，依旧 O(n²)。解决：**三路划分**（或者 Hoare 式双指针，遇到相等也停下交换，让相等元素均匀分到两边）。
:::

:::tip 关键点
随机 pivot + 三路划分：维护 `[l, lt)` < pivot、`[lt, i)` == pivot、`(gt, r]` > pivot 三段；扫描结束后只递归 `< pivot` 和 `> pivot` 两段，等于 pivot 的整段一次就位，全相同数组 O(n) 结束。
:::

`[5,1,4,2,4]`，假设随机选中 pivot = 4 的三路划分过程：

```
数组            lt i gt  动作
[5,1,4,2,4]     0  0  4  5>4, 与 gt 交换, gt--
[4,1,4,2,5]     0  0  3  4==4, i++
[4,1,4,2,5]     0  1  3  1<4, 与 lt 交换, lt++ i++
[1,4,4,2,5]     1  2  3  4==4, i++
[1,4,4,2,5]     1  3  3  2<4, 与 lt 交换, lt++ i++
[1,2,4,4,5]     2  4  3  i > gt 结束
递归 [0,1] 和 [4,4]，中间 [2,3] 已就位
```

## Java 题解

```java
import java.util.*;

class Solution {
    private final Random random = new Random();

    public int[] sortArray(int[] nums) {
        quickSort(nums, 0, nums.length - 1);
        return nums;
    }

    private void quickSort(int[] a, int l, int r) {
        if (l >= r) return;
        // 随机选 pivot，避免有序输入退化成 O(n²)
        int p = a[l + random.nextInt(r - l + 1)];
        // 三路划分：[l,lt) < p, [lt,i) == p, (gt,r] > p
        int lt = l, i = l, gt = r;
        while (i <= gt) {
            if (a[i] < p) {
                swap(a, lt++, i++);
            } else if (a[i] > p) {
                swap(a, i, gt--); // 换过来的元素还没看过，i 不动
            } else {
                i++;
            }
        }
        // 等于 pivot 的整段已就位，只递归两侧
        quickSort(a, l, lt - 1);
        quickSort(a, gt + 1, r);
    }

    private void swap(int[] a, int i, int j) {
        int t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
}
```

## 复杂度

- 时间：期望 O(n log n)。随机 pivot 让"每次都选到极值"的概率极低；三路划分让重复元素不再拖累，全相同时一轮 O(n) 即结束。最坏理论上仍是 O(n²)，但概率可忽略。
- 空间：期望 O(log n) 的递归栈，原地排序无额外数组。
- 快排不稳定（相等元素的相对顺序可能改变）。

## 易错点

- 与 gt 交换后 **i 不能自增**：从右边换过来的元素还没比较过。
- 与 lt 交换后 i 和 lt 都要自增：换过来的一定是等于 pivot 的元素（或 i == lt 时就是自己）。
- pivot 要先把**值**取出来存到变量里，而不是记下标——划分过程中那个位置的元素会被换走。
- `random.nextInt(r - l + 1)` 别写成 `nextInt(r - l)`，否则永远选不到下标 r 的元素。
- 面试手写时常见的两路 Lomuto 写法能通过普通数据，但在全相同的数组上会 O(n²)，这正是 LeetCode 912 专门卡的点。

## 其他解法

### 归并排序

稳定，最坏也是 O(n log n)，代价是 O(n) 辅助数组。先递归排好左右两半，再用双指针合并两个有序段。辅助数组只分配一次，避免每层递归都 new。

```java
import java.util.*;

class Solution {
    public int[] sortArray(int[] nums) {
        int[] tmp = new int[nums.length]; // 只分配一次的辅助数组
        mergeSort(nums, 0, nums.length - 1, tmp);
        return nums;
    }

    private void mergeSort(int[] a, int l, int r, int[] tmp) {
        if (l >= r) return;
        int mid = l + (r - l) / 2;
        mergeSort(a, l, mid, tmp);
        mergeSort(a, mid + 1, r, tmp);
        if (a[mid] <= a[mid + 1]) return; // 已经有序，省掉合并
        int i = l, j = mid + 1, k = l;
        while (i <= mid && j <= r) {
            // 用 <= 保证稳定：相等时先取左边
            tmp[k++] = a[i] <= a[j] ? a[i++] : a[j++];
        }
        while (i <= mid) tmp[k++] = a[i++];
        while (j <= r) tmp[k++] = a[j++];
        System.arraycopy(tmp, l, a, l, r - l + 1);
    }
}
```

### 堆排序

原地、最坏 O(n log n)、不稳定。先自底向上建大根堆（O(n)），然后反复把堆顶最大值换到末尾、堆大小减 1、再对新堆顶下沉。

```java
import java.util.*;

class Solution {
    public int[] sortArray(int[] nums) {
        int n = nums.length;
        // 从最后一个非叶子节点开始下沉，建大根堆
        for (int i = n / 2 - 1; i >= 0; i--) siftDown(nums, i, n);
        for (int end = n - 1; end > 0; end--) {
            swap(nums, 0, end);      // 最大值放到末尾
            siftDown(nums, 0, end);  // 剩余 [0,end) 重新调整
        }
        return nums;
    }

    private void siftDown(int[] a, int i, int size) {
        while (2 * i + 1 < size) {
            int child = 2 * i + 1;
            if (child + 1 < size && a[child + 1] > a[child]) child++; // 取较大的孩子
            if (a[i] >= a[child]) break;
            swap(a, i, child);
            i = child;
        }
    }

    private void swap(int[] a, int i, int j) {
        int t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
}
```

| 算法 | 平均 | 最坏 | 额外空间 | 稳定 |
|---|---|---|---|---|
| 快排（随机+三路） | O(n log n) | O(n²)（概率极低） | O(log n) | 否 |
| 归并 | O(n log n) | O(n log n) | O(n) | 是 |
| 堆排 | O(n log n) | O(n log n) | O(1) | 否 |

## 举一反三

- [[algo:sort-colors]]：三路划分本身就是荷兰国旗问题。
- [[algo:kth-largest-element-in-an-array]]：快排的 partition 只递归一边就是快速选择，期望 O(n)。
- [[algo:sort-list]]：链表上首选归并排序。
- [[algo:merge-k-sorted-lists]] / [[algo:external-sort]]：归并的"合并有序段"推广到 K 路，就是外部排序的核心。
- JDK 里 `Arrays.sort(int[])` 用双轴快排（Dual-Pivot Quicksort），`Arrays.sort(Object[])` / `Collections.sort` 用 TimSort（归并 + 插入的稳定排序），因为对象排序要求稳定。

## 一句话记忆

快排三件套：随机 pivot 防有序、三路划分防重复、只递归两侧；要稳定选归并，要 O(1) 空间且最坏有保证选堆排。
