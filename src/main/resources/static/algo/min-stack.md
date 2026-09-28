## 题意

设计一个栈，除了常规的 `push`、`pop`、`top` 之外，还要支持 `getMin()` 返回当前栈中的最小元素，并且**所有操作都要 O(1)**。调用 pop、top、getMin 时保证栈非空。

```
操作：push(4), push(6), push(2), getMin(), pop(), getMin(), top()
输出：[null, null, null, 2, null, 4, 6]
解释：压入 4、6、2 后最小是 2；弹出 2 之后，最小值要「恢复」成 4
```

## 思路

只用一个变量 min 记录最小值是不行的：push 时更新很容易，但 pop 掉的恰好是最小值时，你不知道「上一个最小值」是多少，只能 O(n) 重新扫描。

关键在于：栈是后进先出的，**每个元素在栈中时，它下面的元素是固定不变的**。所以可以在压入每个元素时，顺便记下「压入它之后整个栈的最小值」。弹出时一并弹掉，下面那一层记录的就是之前的最小值，自动恢复。

实现上用两个栈：数据栈 + 最小值栈，两者同步 push / pop，最小值栈的栈顶永远是当前最小值。

:::tip 关键点
让每一层都记住「截至这一层的最小值」，用空间换时间。辅助栈与数据栈同进同出，getMin 就是看辅助栈栈顶。
:::

推演：

```
op        data       minStack   getMin
push 4    [4]        [4]
push 6    [4,6]      [4,4]
push 2    [4,6,2]    [4,4,2]    2
pop       [4,6]      [4,4]      4
```

## Java 题解

```java
import java.util.*;

class MinStack {
    private final Deque<Integer> data = new ArrayDeque<>();
    // 每一层记录「截至这一层」的最小值
    private final Deque<Integer> mins = new ArrayDeque<>();

    public MinStack() {
    }

    public void push(int val) {
        data.push(val);
        // 新的最小值 = min(新元素, 之前的最小值)
        mins.push(mins.isEmpty() ? val : Math.min(val, mins.peek()));
    }

    public void pop() {
        // 两个栈同步弹出，最小值自动恢复
        data.pop();
        mins.pop();
    }

    public int top() {
        return data.peek();
    }

    public int getMin() {
        return mins.peek();
    }
}
```

## 复杂度

- 时间：所有操作 O(1)。
- 空间 O(n)：辅助栈与数据栈等长。

## 易错点

- 只用一个 min 变量，pop 掉最小值后无法恢复。
- 辅助栈如果只在「新值 ≤ 当前最小」时才压入（省空间的写法），那么 pop 时要判断相等才弹，且条件必须是 `<=` 而不是 `<`，否则重复的最小值被弹掉一个后，最小值就丢了。
- 如果用 `Integer` 对象比较 `data.peek() == mins.peek()`，超过 127 的值会因为缓存失效而比较引用出错，要用 `equals` 或拆箱。上面的同步写法没有这个问题。

## 其他解法

只用一个栈、除栈本身外只要 O(1) 额外空间：栈里存「当前值与压入前最小值的差」，并用一个变量 min 保存当前最小值。差为负说明这个元素刷新了最小值，弹出时用它把旧的最小值还原回来。差值可能超出 int，所以用 long。

```java
import java.util.*;

class MinStack {
    // 存 val - 压入前的最小值
    private final Deque<Long> diffs = new ArrayDeque<>();
    private long min;

    public MinStack() {
    }

    public void push(int val) {
        if (diffs.isEmpty()) {
            diffs.push(0L);
            min = val;
        } else {
            long d = val - min;
            diffs.push(d);
            // 差为负说明刷新了最小值
            if (d < 0) min = val;
        }
    }

    public void pop() {
        long d = diffs.pop();
        // 弹出的是当时的最小值，还原成之前的最小值
        if (d < 0) min = min - d;
    }

    public int top() {
        long d = diffs.peek();
        // 差为负时，这个元素本身就是当前最小值
        return (int) (d < 0 ? min : min + d);
    }

    public int getMin() {
        return (int) min;
    }
}
```

## 举一反三

- 同样「给数据结构附加信息以 O(1) 回答查询」的设计题：[[algo:lru-cache]]、[[algo:find-median-from-data-stream]]。
- 滑动窗口最大值 [[algo:sliding-window-maximum]] 用单调队列维护最值，是这题在队列上的升级版。
- 后端里，带撤销功能的编辑器、事务回滚中的「每一步记住当时状态」，都是同一个思想。

## 一句话记忆

辅助栈同步记录「截至每一层的最小值」，弹出时最小值自动恢复。
