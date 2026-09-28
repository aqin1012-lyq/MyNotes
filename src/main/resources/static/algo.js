/*
 * 刷题题单。题解在 algo/<slug>.md（自己转述的题意 + 原创思路与 Java 题解），判题请去力扣官网。
 * 做题记录保存在 study/algo.tsv。
 */
const HOT100_CATEGORIES = [
  { id: 'hash', title: '哈希' },
  { id: 'two-pointers', title: '双指针' },
  { id: 'sliding-window', title: '滑动窗口' },
  { id: 'substring', title: '子串' },
  { id: 'array', title: '普通数组' },
  { id: 'matrix', title: '矩阵' },
  { id: 'linked-list', title: '链表' },
  { id: 'tree', title: '二叉树' },
  { id: 'graph', title: '图论' },
  { id: 'backtracking', title: '回溯' },
  { id: 'binary-search', title: '二分查找' },
  { id: 'stack', title: '栈' },
  { id: 'heap', title: '堆' },
  { id: 'greedy', title: '贪心' },
  { id: 'dp', title: '动态规划' },
  { id: 'dp-2d', title: '多维动态规划' },
  { id: 'tricks', title: '技巧' },
];

const EXTRA_CATEGORIES = [
  { id: 'concurrency', title: '并发手写' },
  { id: 'design', title: '手写组件' },
  { id: 'algo-gap', title: '补充算法' },
  { id: 'massive-data', title: '海量数据场景' },
  { id: 'acm', title: 'ACM 模式' },
];

// [力扣题号（没有则 null）, slug, 标题, 难度 E/M/H, 分类]
const EXTRA = [
  [1114, 'print-in-order', '按序打印', 'E', 'concurrency'],
  [1115, 'print-foobar-alternately', '交替打印 FooBar', 'M', 'concurrency'],
  [1116, 'print-zero-even-odd', '打印零与奇偶数', 'M', 'concurrency'],
  [1195, 'fizz-buzz-multithreaded', '交替打印字符串', 'M', 'concurrency'],
  [1117, 'building-h2o', 'H2O 生成', 'M', 'concurrency'],
  [1226, 'the-dining-philosophers', '哲学家进餐', 'M', 'concurrency'],
  [null, 'three-threads-print-abc', '三个线程轮流打印 ABC', 'M', 'concurrency'],
  [null, 'producer-consumer', '生产者-消费者', 'M', 'concurrency'],
  [null, 'bounded-blocking-queue', '手写有界阻塞队列', 'M', 'concurrency'],
  [null, 'thread-safe-singleton', '线程安全的单例', 'E', 'concurrency'],
  [null, 'parallel-calls-aggregate', '并行调用多个服务并汇总结果', 'M', 'concurrency'],

  [460, 'lfu-cache', 'LFU 缓存', 'H', 'design'],
  [null, 'rate-limiter', '手写限流器（固定窗口 / 滑动窗口 / 令牌桶）', 'M', 'design'],
  [null, 'simple-thread-pool', '手写简易线程池', 'H', 'design'],
  [null, 'consistent-hashing', '一致性哈希（带虚拟节点）', 'M', 'design'],
  [null, 'timing-wheel', '时间轮定时器', 'H', 'design'],
  [null, 'snowflake-id', '雪花算法 ID 生成器', 'M', 'design'],
  [null, 'sensitive-word-filter', '敏感词过滤（Trie）', 'M', 'design'],

  [547, 'number-of-provinces', '省份数量（并查集）', 'M', 'algo-gap'],
  [684, 'redundant-connection', '冗余连接（并查集）', 'M', 'algo-gap'],
  [743, 'network-delay-time', '网络延迟时间（Dijkstra）', 'M', 'algo-gap'],
  [28, 'find-the-index-of-the-first-occurrence-in-a-string', '找出字符串中第一个匹配项的下标（KMP）', 'E', 'algo-gap'],
  [516, 'longest-palindromic-subsequence', '最长回文子序列（区间 DP）', 'M', 'algo-gap'],
  [912, 'sort-an-array', '排序数组（手写快排 / 归并 / 堆排）', 'M', 'algo-gap'],
  [151, 'reverse-words-in-a-string', '反转字符串中的单词', 'M', 'algo-gap'],
  [8, 'string-to-integer-atoi', '字符串转换整数 (atoi)', 'M', 'algo-gap'],
  [415, 'add-strings', '字符串相加', 'E', 'algo-gap'],

  [null, 'massive-top-k', '10 亿个数中找最大的 K 个', 'M', 'massive-data'],
  [null, 'external-sort', '内存放不下的大文件排序', 'M', 'massive-data'],
  [null, 'bitmap-bloom-filter', '海量数据去重与存在判断（BitMap / 布隆过滤器）', 'M', 'massive-data'],
  [null, 'most-frequent-ip', '超大日志中出现次数最多的 IP', 'M', 'massive-data'],

  [null, 'acm-io-template', 'ACM 模式输入输出模板', 'E', 'acm'],
];

window.ALGO = {
  sets: [
    { id: 'hot100', title: 'LeetCode 热题 100', categories: HOT100_CATEGORIES,
      desc: '力扣官方高频题单，覆盖面试最常考的 17 类题型。国内面试“刷题”首选。' },
    { id: 'java-extra', title: 'Java 面试补充', categories: EXTRA_CATEGORIES,
      desc: '热题 100 没覆盖、但 Java 后端面试常考的：并发手写、手写组件、补充算法、海量数据场景题和 ACM 模式。没有题号的是面试常见手写题，没有官方判题，用题解里的 main 自测。' },
  ],

  // 复习间隔（天）：连续第 n 次做出来后，隔 REVIEW[n-1] 天再复习；全部通过视为“已掌握”
  review: [1, 3, 7, 14, 30, 60],

  // [题号, slug, 标题, 难度 E/M/H, 分类]
  problems: [...[
    [1, 'two-sum', '两数之和', 'E', 'hash'],
    [49, 'group-anagrams', '字母异位词分组', 'M', 'hash'],
    [128, 'longest-consecutive-sequence', '最长连续序列', 'M', 'hash'],

    [283, 'move-zeroes', '移动零', 'E', 'two-pointers'],
    [11, 'container-with-most-water', '盛最多水的容器', 'M', 'two-pointers'],
    [15, '3sum', '三数之和', 'M', 'two-pointers'],
    [42, 'trapping-rain-water', '接雨水', 'H', 'two-pointers'],

    [3, 'longest-substring-without-repeating-characters', '无重复字符的最长子串', 'M', 'sliding-window'],
    [438, 'find-all-anagrams-in-a-string', '找到字符串中所有字母异位词', 'M', 'sliding-window'],

    [560, 'subarray-sum-equals-k', '和为 K 的子数组', 'M', 'substring'],
    [239, 'sliding-window-maximum', '滑动窗口最大值', 'H', 'substring'],
    [76, 'minimum-window-substring', '最小覆盖子串', 'H', 'substring'],

    [53, 'maximum-subarray', '最大子数组和', 'M', 'array'],
    [56, 'merge-intervals', '合并区间', 'M', 'array'],
    [189, 'rotate-array', '轮转数组', 'M', 'array'],
    [238, 'product-of-array-except-self', '除自身以外数组的乘积', 'M', 'array'],
    [41, 'first-missing-positive', '缺失的第一个正数', 'H', 'array'],

    [73, 'set-matrix-zeroes', '矩阵置零', 'M', 'matrix'],
    [54, 'spiral-matrix', '螺旋矩阵', 'M', 'matrix'],
    [48, 'rotate-image', '旋转图像', 'M', 'matrix'],
    [240, 'search-a-2d-matrix-ii', '搜索二维矩阵 II', 'M', 'matrix'],

    [160, 'intersection-of-two-linked-lists', '相交链表', 'E', 'linked-list'],
    [206, 'reverse-linked-list', '反转链表', 'E', 'linked-list'],
    [234, 'palindrome-linked-list', '回文链表', 'E', 'linked-list'],
    [141, 'linked-list-cycle', '环形链表', 'E', 'linked-list'],
    [142, 'linked-list-cycle-ii', '环形链表 II', 'M', 'linked-list'],
    [21, 'merge-two-sorted-lists', '合并两个有序链表', 'E', 'linked-list'],
    [2, 'add-two-numbers', '两数相加', 'M', 'linked-list'],
    [19, 'remove-nth-node-from-end-of-list', '删除链表的倒数第 N 个结点', 'M', 'linked-list'],
    [24, 'swap-nodes-in-pairs', '两两交换链表中的节点', 'M', 'linked-list'],
    [25, 'reverse-nodes-in-k-group', 'K 个一组翻转链表', 'H', 'linked-list'],
    [138, 'copy-list-with-random-pointer', '随机链表的复制', 'M', 'linked-list'],
    [148, 'sort-list', '排序链表', 'M', 'linked-list'],
    [23, 'merge-k-sorted-lists', '合并 K 个升序链表', 'H', 'linked-list'],
    [146, 'lru-cache', 'LRU 缓存', 'M', 'linked-list'],

    [94, 'binary-tree-inorder-traversal', '二叉树的中序遍历', 'E', 'tree'],
    [104, 'maximum-depth-of-binary-tree', '二叉树的最大深度', 'E', 'tree'],
    [226, 'invert-binary-tree', '翻转二叉树', 'E', 'tree'],
    [101, 'symmetric-tree', '对称二叉树', 'E', 'tree'],
    [543, 'diameter-of-binary-tree', '二叉树的直径', 'E', 'tree'],
    [102, 'binary-tree-level-order-traversal', '二叉树的层序遍历', 'M', 'tree'],
    [108, 'convert-sorted-array-to-binary-search-tree', '将有序数组转换为二叉搜索树', 'E', 'tree'],
    [98, 'validate-binary-search-tree', '验证二叉搜索树', 'M', 'tree'],
    [230, 'kth-smallest-element-in-a-bst', '二叉搜索树中第 K 小的元素', 'M', 'tree'],
    [199, 'binary-tree-right-side-view', '二叉树的右视图', 'M', 'tree'],
    [114, 'flatten-binary-tree-to-linked-list', '二叉树展开为链表', 'M', 'tree'],
    [105, 'construct-binary-tree-from-preorder-and-inorder-traversal', '从前序与中序遍历序列构造二叉树', 'M', 'tree'],
    [437, 'path-sum-iii', '路径总和 III', 'M', 'tree'],
    [236, 'lowest-common-ancestor-of-a-binary-tree', '二叉树的最近公共祖先', 'M', 'tree'],
    [124, 'binary-tree-maximum-path-sum', '二叉树中的最大路径和', 'H', 'tree'],

    [200, 'number-of-islands', '岛屿数量', 'M', 'graph'],
    [994, 'rotting-oranges', '腐烂的橘子', 'M', 'graph'],
    [207, 'course-schedule', '课程表', 'M', 'graph'],
    [208, 'implement-trie-prefix-tree', '实现 Trie (前缀树)', 'M', 'graph'],

    [46, 'permutations', '全排列', 'M', 'backtracking'],
    [78, 'subsets', '子集', 'M', 'backtracking'],
    [17, 'letter-combinations-of-a-phone-number', '电话号码的字母组合', 'M', 'backtracking'],
    [39, 'combination-sum', '组合总和', 'M', 'backtracking'],
    [22, 'generate-parentheses', '括号生成', 'M', 'backtracking'],
    [79, 'word-search', '单词搜索', 'M', 'backtracking'],
    [131, 'palindrome-partitioning', '分割回文串', 'M', 'backtracking'],
    [51, 'n-queens', 'N 皇后', 'H', 'backtracking'],

    [35, 'search-insert-position', '搜索插入位置', 'E', 'binary-search'],
    [74, 'search-a-2d-matrix', '搜索二维矩阵', 'M', 'binary-search'],
    [34, 'find-first-and-last-position-of-element-in-sorted-array', '在排序数组中查找元素的第一个和最后一个位置', 'M', 'binary-search'],
    [33, 'search-in-rotated-sorted-array', '搜索旋转排序数组', 'M', 'binary-search'],
    [153, 'find-minimum-in-rotated-sorted-array', '寻找旋转排序数组中的最小值', 'M', 'binary-search'],
    [4, 'median-of-two-sorted-arrays', '寻找两个正序数组的中位数', 'H', 'binary-search'],

    [20, 'valid-parentheses', '有效的括号', 'E', 'stack'],
    [155, 'min-stack', '最小栈', 'M', 'stack'],
    [394, 'decode-string', '字符串解码', 'M', 'stack'],
    [739, 'daily-temperatures', '每日温度', 'M', 'stack'],
    [84, 'largest-rectangle-in-histogram', '柱状图中最大的矩形', 'H', 'stack'],

    [215, 'kth-largest-element-in-an-array', '数组中的第K个最大元素', 'M', 'heap'],
    [347, 'top-k-frequent-elements', '前 K 个高频元素', 'M', 'heap'],
    [295, 'find-median-from-data-stream', '数据流的中位数', 'H', 'heap'],

    [121, 'best-time-to-buy-and-sell-stock', '买卖股票的最佳时机', 'E', 'greedy'],
    [55, 'jump-game', '跳跃游戏', 'M', 'greedy'],
    [45, 'jump-game-ii', '跳跃游戏 II', 'M', 'greedy'],
    [763, 'partition-labels', '划分字母区间', 'M', 'greedy'],

    [70, 'climbing-stairs', '爬楼梯', 'E', 'dp'],
    [118, 'pascals-triangle', '杨辉三角', 'E', 'dp'],
    [198, 'house-robber', '打家劫舍', 'M', 'dp'],
    [279, 'perfect-squares', '完全平方数', 'M', 'dp'],
    [322, 'coin-change', '零钱兑换', 'M', 'dp'],
    [139, 'word-break', '单词拆分', 'M', 'dp'],
    [300, 'longest-increasing-subsequence', '最长递增子序列', 'M', 'dp'],
    [152, 'maximum-product-subarray', '乘积最大子数组', 'M', 'dp'],
    [416, 'partition-equal-subset-sum', '分割等和子集', 'M', 'dp'],
    [32, 'longest-valid-parentheses', '最长有效括号', 'H', 'dp'],

    [62, 'unique-paths', '不同路径', 'M', 'dp-2d'],
    [64, 'minimum-path-sum', '最小路径和', 'M', 'dp-2d'],
    [5, 'longest-palindromic-substring', '最长回文子串', 'M', 'dp-2d'],
    [1143, 'longest-common-subsequence', '最长公共子序列', 'M', 'dp-2d'],
    [72, 'edit-distance', '编辑距离', 'M', 'dp-2d'],

    [136, 'single-number', '只出现一次的数字', 'E', 'tricks'],
    [169, 'majority-element', '多数元素', 'E', 'tricks'],
    [75, 'sort-colors', '颜色分类', 'M', 'tricks'],
    [31, 'next-permutation', '下一个排列', 'M', 'tricks'],
    [287, 'find-the-duplicate-number', '寻找重复数', 'M', 'tricks'],
  ].map(p => [...p, 'hot100']), ...EXTRA.map(p => [...p, 'java-extra'])]
    .map(([no, slug, title, diff, cat, set]) => ({
      no, slug, title, diff, cat, set, url: no ? `https://leetcode.cn/problems/${slug}/` : null,
    })),
};
