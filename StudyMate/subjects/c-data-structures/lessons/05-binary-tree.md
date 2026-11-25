---
node: d5
title: 树与二叉树：递归结构
type: concept
duration: 60
---

## 先说结论

树是一个自己包含自己的结构：每个节点 = 一个值 + 若干棵子树。二叉树把它限制成最多两个孩子，换来一套极简的表示——两个指针 `left`、`right`，空就是 `NULL`。

遍历只有一件事要决定：**什么时候访问根节点**。先访问根是前序，中间访问是中序，最后访问是后序。层序则是另一种思路：按深度一层层扫，靠队列实现。所有遍历都是 O(n)，因为每个节点恰好访问一次。

## 一个节点，两个指针

```c
typedef struct TreeNode {
    int val;
    struct TreeNode *left;
    struct TreeNode *right;
} TreeNode;
```

判断叶子很简单：`!t->left && !t->right`。判断空树也简单：`t == NULL`。这两个条件就是所有树算法的终止条件，写递归时先想清楚它们，剩下的就是"对左子树做同样的事，对右子树做同样的事"。

<svg class="diagram" viewBox="0 0 760 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="三层二叉树与三种深度优先遍历的顺序">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="20">三层满二叉树：根是 1，每个节点最多两个孩子</text>
    <rect class="box acc" x="290" y="28" width="80" height="36" rx="6"/><text class="label" x="330" y="52" text-anchor="middle">1（根）</text>
    <rect class="box" x="130" y="98" width="80" height="36" rx="6"/><text class="label" x="170" y="122" text-anchor="middle">2</text>
    <rect class="box" x="450" y="98" width="80" height="36" rx="6"/><text class="label" x="490" y="122" text-anchor="middle">3</text>
    <rect class="box" x="40" y="168" width="80" height="36" rx="6"/><text class="label" x="80" y="192" text-anchor="middle">4</text>
    <rect class="box" x="200" y="168" width="80" height="36" rx="6"/><text class="label" x="240" y="192" text-anchor="middle">5</text>
    <rect class="box" x="360" y="168" width="80" height="36" rx="6"/><text class="label" x="400" y="192" text-anchor="middle">6</text>
    <rect class="box" x="520" y="168" width="80" height="36" rx="6"/><text class="label" x="560" y="192" text-anchor="middle">7</text>
    <g class="arrow"><path d="M310 64L188 98"/><path d="M350 64L472 98"/><path d="M150 134L92 168"/><path d="M190 134L232 168"/><path d="M470 134L412 168"/><path d="M510 134L552 168"/></g>
    <text class="sub" x="238" y="84" font-size="10">left</text>
    <text class="sub" x="424" y="84" font-size="10">right</text>
    <text class="label" x="8" y="238">前序：1 2 4 5 3 6 7　　中序：4 2 5 1 6 3 7　　后序：4 5 2 6 7 3 1</text>
    <text class="sub" x="8" y="260" font-size="11">同一棵树，只换根的访问时机，就得到三种序列；每个节点都恰好出现一次</text>
  </g>
</svg>

## 三种深度优先遍历

递归版只有三行差异，但含义完全不同。前序适合复制树、打印目录结构；中序在二叉搜索树上会得到升序；后序适合释放整棵树——先放孩子，再放父节点。

```c
#include <stdio.h>

typedef struct TreeNode {
    int val;
    struct TreeNode *left;
    struct TreeNode *right;
} TreeNode;

void preorder(const TreeNode *t) {
    if (!t) return;
    printf("%d ", t->val);      /* 根 */
    preorder(t->left);
    preorder(t->right);
}

void inorder(const TreeNode *t) {
    if (!t) return;
    inorder(t->left);
    printf("%d ", t->val);      /* 根 */
    inorder(t->right);
}

void postorder(const TreeNode *t) {
    if (!t) return;
    postorder(t->left);
    postorder(t->right);
    printf("%d ", t->val);      /* 根 */
}
```

对图里那棵树，前序是 `1 2 4 5 3 6 7`，中序是 `4 2 5 1 6 3 7`，后序是 `4 5 2 6 7 3 1`。建议自己遮住答案走一遍——遍历顺序是后面所有树算法（求高度、统计节点、判断平衡）的地基。

## 递归的真相是一个栈

递归不是魔法，函数调用本身就借助系统栈保存"回到哪里、局部变量是什么"。所以任何递归遍历都能换成显式栈，区别只是你要自己管这个栈。

```c
void preorder_iter(const TreeNode *root) {
    const TreeNode *stack[64];
    int top = 0;
    if (root) stack[top++] = root;
    while (top > 0) {
        const TreeNode *t = stack[--top];
        printf("%d ", t->val);
        if (t->right) stack[top++] = t->right;   /* 先压右 */
        if (t->left)  stack[top++] = t->left;    /* 后压左，左先出栈 */
    }
}

void inorder_iter(const TreeNode *root) {
    const TreeNode *stack[64];
    int top = 0;
    const TreeNode *cur = root;
    while (cur || top > 0) {
        while (cur) {                 /* 一路向左，把路径压栈 */
            stack[top++] = cur;
            cur = cur->left;
        }
        cur = stack[--top];
        printf("%d ", cur->val);      /* 左子树走完了，访问根 */
        cur = cur->right;             /* 再转向右子树 */
    }
}
```

对照着看：前序迭代是"弹出即访问，然后按相反顺序压孩子"；中序迭代是"先把整条左链压进去，弹出来访问，再走向右孩子"。递归版里那个看不见的栈，在这里变成了数组和 `top`。

::: note 栈容量写死是教学简化
上面的 `stack[64]` 只适合小树。真实代码里栈深度等于树高，最坏是 n（退化成一条链）。要么按节点数分配，要么用可增长的动态栈，否则长链树会把栈写穿。
:::

## 层序遍历：用队列按层扫

层序不是深度优先，它要的是"先第一层、再第二层"。做法是队列：根入队，然后每次出队一个节点，把它的孩子依次入队。这样同一层的节点会在同一批里被处理。

```c
void level_order(const TreeNode *root) {
    const TreeNode *queue[64];
    int head = 0, tail = 0;
    if (root) queue[tail++] = root;
    while (head < tail) {
        const TreeNode *t = queue[head++];
        printf("%d ", t->val);
        if (t->left)  queue[tail++] = t->left;
        if (t->right) queue[tail++] = t->right;
    }
}
```

输出是 `1 2 3 4 5 6 7`。如果想按层换行，得记录每层的大小：进循环前先取 `level_size = tail - head`，只处理这么多节点，处理完打印一个换行。这个技巧在"求树的宽度""按层收集节点"里反复出现。

## 高度、复杂度与退化

求高度是最短的递归练习：

```c
int height(const TreeNode *t) {
    if (!t) return 0;
    int l = height(t->left);
    int r = height(t->right);
    return (l > r ? l : r) + 1;
}
```

时间 O(n)。三种遍历也都是 O(n) 时间、O(h) 栈空间（h 是树高），层序的空间是 O(w)（w 是最大层宽）。看起来很美，但树可能**退化**：往二叉搜索树（BST）里按顺序插入 1、2、3、4，树会长成一条向右的链，高度 n，查找/插入从平均 O(log n) 退化成最坏 O(n)，递归还会爆栈。

::: warn 递归深度等于树高
平衡树的 h 约等于 log₂n，10 万个节点也只递归 17 层；退化链的 h 等于 n，10 万个节点就递归 10 万层，默认栈通常撑不住。处理可能退化的树时，要么保证平衡，要么改用显式栈/ Morris 遍历。
:::

这也是为什么平衡树、红黑树值得单独存在：它们不是让二叉树"更高级"，而是花钱（旋转）买一个"高度别变成 n"的承诺，把最坏查找压回 O(log n)。

## 练习

::: exercise 练习 1：写出三种序列
用上面图里的树（根 1，左 2 右 3；2 的孩子是 4、5；3 的孩子是 6、7），写出前序、中序、后序序列。

::: answer
- 前序：`1 2 4 5 3 6 7`
- 中序：`4 2 5 1 6 3 7`
- 后序：`4 5 2 6 7 3 1`

判断标准：每个序列长度都是 7、每个数字出现一次；后序的最后一个一定是根 1。
:::
:::

::: exercise 练习 2：为什么先压右再压左
前序迭代里，如果把两行压栈的顺序对调（先压左、后压右），输出会变成什么？为什么？

::: answer
输出会变成 `1 3 7 6 2 5 4`，也就是"根—右—左"的镜像顺序。因为栈是后进先出，最后压进去的最先弹出；想先访问左子树，就必须让左孩子后压、右孩子先压。

判断标准：能说出"弹栈顺序与压栈顺序相反"，而不是死记代码行序。
:::
:::

::: exercise 练习 3：统计叶子节点
写一个递归函数，返回二叉树的叶子节点个数。空树返回 0。

::: answer
```c
int count_leaves(const TreeNode *t) {
    if (!t) return 0;
    if (!t->left && !t->right) return 1;
    return count_leaves(t->left) + count_leaves(t->right);
}
```
判断标准：空树返回 0；单个节点返回 1；叶子判断是"左右都为空"，不能用"左为空或右为空"。时间复杂度 O(n)，每个节点访问一次。
:::
:::

::: selfcheck 自检
- [ ] 我能不看图写出三种 DFS 序列，并解释名字来自根的访问时机
- [ ] 我能写出前序迭代，并解释"先压右后压左"
- [ ] 我能写出中序迭代的"一路向左"循环
- [ ] 我知道递归深度等于树高，退化树会爆栈
:::
