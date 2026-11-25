---
node: d3
title: 链表：把连续打散成节点
type: practice
duration: 60
---

## 先说结论

链表把数组那一排格子打散成一个个节点，每个节点自带"下一站在哪"。代价是每个节点多一个 8 字节的 `next` 指针，收益是插入删除不用整体搬家。但别急着欢呼：链表找第 i 个必须走 i 步，而且节点分散在堆上，CPU 缓存基本帮不上忙——这才是它真正的软肋。

## 节点就是数据加下一站

```c
typedef struct Node {
    int val;
    struct Node *next;
} Node;
```

`Node *head` 是链表的入口。`head == NULL` 就是空表；最后一个节点的 `next` 也是 `NULL`，表示到此为止。访问成员用 `p->val`，它等价于 `(*p).val`，只是少写一层括号。

<svg class="diagram" viewBox="0 0 760 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="单链表由 head 指针和分散的节点组成，删除中间节点需要改前驱的 next">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="22">head 只是指针，内容都在堆上的节点里</text>
    <rect class="box acc" x="8" y="34" width="80" height="40" rx="6"/><text class="label" x="48" y="59" text-anchor="middle">head</text>
    <g class="arrow"><path d="M88 54h26"/><path d="M250 54h28"/><path d="M410 54h28"/><path d="M570 54h28"/></g>
    <g class="arrowhead"><path d="M118 54l-7-4v8z"/><path d="M282 54l-7-4v8z"/><path d="M442 54l-7-4v8z"/><path d="M602 54l-7-4v8z"/></g>
    <rect class="box" x="118" y="34" width="132" height="40" rx="6"/><text class="label" x="170" y="59" text-anchor="middle">10</text><text class="sub" x="214" y="59" font-size="10" text-anchor="middle">next</text>
    <rect class="box" x="278" y="34" width="132" height="40" rx="6"/><text class="label" x="330" y="59" text-anchor="middle">20</text><text class="sub" x="374" y="59" font-size="10" text-anchor="middle">next</text>
    <rect class="box" x="438" y="34" width="132" height="40" rx="6"/><text class="label" x="490" y="59" text-anchor="middle">30</text><text class="sub" x="534" y="59" font-size="10" text-anchor="middle">next</text>
    <rect class="box" x="598" y="34" width="132" height="40" rx="6"/><text class="label" x="650" y="59" text-anchor="middle">40</text><text class="sub" x="694" y="59" font-size="10" text-anchor="middle">NULL</text>
    <text class="sub" x="118" y="94" font-size="11">0x8a0</text>
    <text class="sub" x="278" y="94" font-size="11">0x930</text>
    <text class="sub" x="438" y="94" font-size="11">0x7c0</text>
    <text class="sub" x="598" y="94" font-size="11">0x610</text>
    <text class="sub" x="8" y="116" font-size="11">地址互不相邻：想找第 3 个，只能从 head 走两步，不能算出来</text>
    <text class="label" x="8" y="152">删除中间节点：prev->next = cur->next，再 free(cur)</text>
    <rect class="box" x="118" y="168" width="132" height="40" rx="6"/><text class="label" x="170" y="193" text-anchor="middle">prev</text><text class="sub" x="214" y="193" font-size="10" text-anchor="middle">next</text>
    <rect class="box acc" x="278" y="168" width="132" height="40" rx="6"/><text class="label" x="330" y="193" text-anchor="middle">cur（要删）</text>
    <rect class="box" x="438" y="168" width="132" height="40" rx="6"/><text class="label" x="490" y="193" text-anchor="middle">40</text>
    <g class="arrow"><path d="M250 188q94 -78 188 0"/></g>
    <g class="arrowhead"><path d="M438 188l-7-4v8z"/></g>
    <text class="sub" x="8" y="238" font-size="11">cur 被摘掉，但它的地址还在变量里，必须 free 才不泄漏</text>
  </g>
</svg>

## 头插 O(1)，尾插 O(n)

头插最短：新节点的 `next` 指向旧头，再把 `head` 指到新节点。尾插得先走到最后一个节点，所以是 O(n)——除非你额外维护一个 `tail` 指针。

```c
#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int val;
    struct Node *next;
} Node;

Node *push_front(Node *head, int v) {
    Node *n = malloc(sizeof *n);
    if (!n) return head;          /* 失败时原链表不动 */
    n->val = v;
    n->next = head;
    return n;                     /* 新头必须由调用者接住 */
}

Node *push_back(Node *head, int v) {
    Node *n = malloc(sizeof *n);
    if (!n) return head;
    n->val = v;
    n->next = NULL;
    if (!head) return n;          /* 空表：新节点就是头 */
    Node *cur = head;
    while (cur->next) cur = cur->next;
    cur->next = n;
    return head;
}
```

修改头的操作必须写成 `head = push_front(head, x)`：C 参数是值传递，函数里改 `head` 不影响外面。想省掉返回值，可以传 `Node **`，或者加一个不存数据的哨兵节点（dummy head），让真头永远是 `dummy->next`。

## 删除：前驱和头删必须分开想

单链表只有向后的指针，所以删一个节点时必须拿到它的**前驱**，才能把 `prev->next` 接到 `cur->next`。头节点没有前驱，只能单独处理——这一步漏掉，代码删不掉第一个元素。

```c
Node *remove_first(Node *head, int v) {
    Node *prev = NULL;
    Node *cur = head;
    while (cur && cur->val != v) {
        prev = cur;
        cur = cur->next;
    }
    if (!cur) return head;              /* 没找到 */
    if (!prev) head = cur->next;        /* 特判：删的是头节点 */
    else prev->next = cur->next;
    free(cur);
    return head;
}
```

::: warn 先接链，再 free
顺序反了就是 use-after-free：`free(cur)` 之后再读 `cur->next` 属于未定义行为。先把 `cur->next` 存下来或先改好前驱的指针，最后才 `free`。
:::

还有一个常被问的取巧办法：给你一个指向待删节点的指针 `p`（且不是尾节点），可以把它后继的 `val` 拷到 `p` 里，然后删掉后继，时间是 O(1)。代价是节点身份变了——如果外部还保存着那个后继节点的指针，就会指向一块已释放的内存。

## 反转：三个指针接力

反转是链表最经典的练习。核心是每轮先保存后继，再把当前节点的 `next` 掉头，最后两个指针一起前移。

```c
Node *reverse(Node *head) {
    Node *prev = NULL;
    Node *cur = head;
    while (cur) {
        Node *next = cur->next;   /* 先存，否则掉头后就找不回来了 */
        cur->next = prev;
        prev = cur;
        cur = next;
    }
    return prev;                  /* 循环结束时 cur 是 NULL，prev 是新头 */
}
```

时间 O(n)，额外空间 O(1)。递归版也能写，但栈深度是 n，长链表会爆栈——这就是"能用循环就别用递归"的场合。

## 链表和数组，别迷信 O(1)

| 操作 | 数组 | 单链表 |
| --- | --- | --- |
| 访问第 i 个 | O(1) | O(n) |
| 头部插入 | O(n) | O(1) |
| 尾部插入 | O(1)（有 size） | O(n)（无尾指针） |
| 删除已知节点 | O(n)（要搬元素） | O(1)（已知前驱） |
| 每元素额外开销 | 0 | 一个指针（8 字节） |
| 缓存友好度 | 高 | 低 |

所谓"链表插入 O(1)"有个隐藏前提：你已经站在插入位置上，并且手里有前驱。如果只给你一个下标，光走过去就是 O(n)。所以真实场景里，链表适合"边遍历边插删""长度事先不知道""插入位置由指针直接给出"的场合；如果主要操作是按下标随机读、或者数据量很大又只读，数组往往更快——连续内存的预取能力不是理论复杂度能体现的。

::: key 选型口诀
要随机读、要省内存、数据量固定 → 数组。要频繁在已知位置插删、长度不可预测 → 链表。两者都能用时，先测，别凭"链表插入快"这句口号做决定。
:::

## 练习

::: exercise 练习 1：跟踪反转
对链表 `1 → 2 → 3 → 4 → NULL` 执行上面的 `reverse`。第一轮循环结束后，`prev` 和 `cur` 分别指向哪个节点？全部结束后返回的指针指向谁？

::: answer
第一轮：`next` 先存 2，节点 1 的 `next` 改成 NULL，`prev` 指向节点 1，`cur` 指向节点 2。全部结束后 `cur == NULL`，`prev` 指向节点 4，也就是新的头，链变成 `4 → 3 → 2 → 1 → NULL`。

判断标准：能说清"每轮先存 next 再改指针"，且知道返回值是 prev 而不是 cur。
:::
:::

::: exercise 练习 2：这个头删写错在哪
```c
Node *remove_head(Node *head) {
    free(head);
    head = head->next;
    return head;
}
```
指出问题并给出正确写法。

::: answer
`free(head)` 之后 `head->next` 是 use-after-free：那块内存已经还给分配器，内容可能被覆盖。必须先保存后继再释放。

```c
Node *remove_head(Node *head) {
    if (!head) return NULL;
    Node *p = head;
    head = head->next;
    free(p);
    return head;
}
```
判断标准：空表先返回 NULL；先移动 head 或先存 next，最后 free 旧头。
:::
:::

::: exercise 练习 3：快慢指针找中点
```c
Node *middle(Node *head) {
    Node *slow = head, *fast = head;
    while (fast && fast->next) {
        slow = slow->next;
        fast = fast->next->next;
    }
    return slow;
}
```
长度为 5 和长度为 4 的链表，分别返回第几个节点？如果想让偶数长度返回靠前的那个中点，循环条件怎么改？

::: answer
- 5 个节点：返回第 **3** 个（正中间）。
- 4 个节点：返回第 **3** 个，也就是两个中间点里靠后的那个。因为 fast 从 1 跳到 3 再跳到 NULL，slow 走了两步。

想返回靠前的中点，把条件改成 `while (fast && fast->next && fast->next->next)`；`fast` 判空不能省，否则空表会解引用 NULL。这样 4 个节点返回第 2 个，5 个节点仍返回第 3 个。

判断标准：能画出两个指针的步数，而不是背结论。
:::
:::

::: selfcheck 自检
- [ ] 我能写出头插、尾插，并说清为什么要 `head = f(head, ...)`
- [ ] 我删除节点时会特判"删的是头节点"，并且先接链再 free
- [ ] 我能徒手写出三指针反转，并说出每轮为什么要先存 next
- [ ] 我知道"插入 O(1)"的前提是已经持有前驱，不会被复杂度标签骗
:::
