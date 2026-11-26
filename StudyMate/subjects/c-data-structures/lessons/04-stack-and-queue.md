---
node: d4
title: 栈与队列：用两种结构实现四种操作
type: practice
duration: 55
---

## 先说结论

栈和队列都不是新发明，它们只是"被限制住的线性表"：栈只允许在一端进出，后进先出（LIFO）；队列一头进、另一头出，先进先出（FIFO）。限制听起来是退步，实际上是把接口收窄到一个语义，让你在括号匹配、广度优先搜索这类问题里不用再操心顺序。

两种容器都可以用数组或链表实现。数组版快、省内存，但要处理容量；链表版不用扩容，但每个节点多一个指针。循环队列是数组版队列的关键技巧。

## 栈：只在一端动手

栈只需要一个下标 `top`，它表示"下一个空位"，也等于当前元素个数。入栈写 `data[top++] = v`，出栈写 `v = data[--top]`，两行就是全部核心。

```c
#include <stdlib.h>

typedef struct {
    int *data;
    size_t cap;
    size_t top;      /* 元素个数，也是下一个空位的下标 */
} Stack;

int stack_init(Stack *s, size_t cap) {
    s->data = malloc(cap * sizeof *s->data);
    if (!s->data) return 0;
    s->cap = cap;
    s->top = 0;
    return 1;
}

int stack_push(Stack *s, int v) {
    if (s->top == s->cap) return 0;     /* 满了，拒绝而不是覆盖 */
    s->data[s->top++] = v;
    return 1;
}

int stack_pop(Stack *s, int *out) {
    if (s->top == 0) return 0;          /* 空栈，别让 top 减到负数 */
    *out = s->data[--s->top];
    return 1;
}
```

`top` 是 `size_t`（无符号），空栈时再减就回绕成巨大值，所以判空必须放在自减之前。这个细节在 32 位机器上尤其容易把程序写飞。

## 队列：一头进，一头出

队列有两个下标：`front` 指向队头元素，`rear` 指向下一个空位。入队在 `rear` 处写，`rear++`；出队读 `front`，`front++`。如果只用一条直线数组，出队几次之后 `front` 一路向右，前面空出一大片却永远用不上——这就是"假溢出"。

解决办法是把数组当成环：下标加到末尾就回到 0，用取模实现。

<svg class="diagram" viewBox="0 0 760 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="栈在 top 端进出，循环队列用取模回绕">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="20">栈：只在 top 一端进出（LIFO）</text>
    <rect class="box" x="90" y="40" width="120" height="38" rx="5"/><text class="sub" x="150" y="63" text-anchor="middle" font-size="11">空</text>
    <rect class="box" x="90" y="84" width="120" height="38" rx="5"/><text class="sub" x="150" y="107" text-anchor="middle" font-size="11">空（下一个空位）</text>
    <rect class="box acc" x="90" y="128" width="120" height="38" rx="5"/><text class="label" x="150" y="151" text-anchor="middle">30（栈顶）</text>
    <rect class="box" x="90" y="172" width="120" height="38" rx="5"/><text class="label" x="150" y="195" text-anchor="middle">20</text>
    <rect class="box" x="90" y="216" width="120" height="38" rx="5"/><text class="label" x="150" y="239" text-anchor="middle">10（栈底）</text>
    <text class="sub" x="70" y="63" font-size="10" text-anchor="end">a[4]</text>
    <text class="sub" x="70" y="151" font-size="10" text-anchor="end">a[2]</text>
    <text class="sub" x="70" y="239" font-size="10" text-anchor="end">a[0]</text>
    <g class="arrow"><path d="M224 148h30"/><path d="M224 107h30"/></g>
    <g class="arrowhead"><path d="M224 107l7-4v8z"/><path d="M254 148l-7-4v8z"/></g>
    <text class="sub" x="258" y="112" font-size="11">push 从这里进</text>
    <text class="sub" x="258" y="153" font-size="11">pop 也从这里出</text>
    <text class="sub" x="8" y="282" font-size="11">top 指向第一个空位，不是最后一个元素</text>
    <text class="label" x="390" y="20">循环队列：front 出、rear 进</text>
    <rect class="box" x="420" y="50" width="70" height="38" rx="5"/><text class="sub" x="455" y="73" text-anchor="middle" font-size="10">0 空</text>
    <rect class="box" x="500" y="50" width="70" height="38" rx="5"/><text class="sub" x="535" y="73" text-anchor="middle" font-size="10">1 空</text>
    <rect class="box" x="580" y="50" width="70" height="38" rx="5"/><text class="sub" x="615" y="73" text-anchor="middle" font-size="10">2 空</text>
    <rect class="box acc" x="580" y="150" width="70" height="38" rx="5"/><text class="label" x="615" y="173" text-anchor="middle">3 = 7</text>
    <rect class="box" x="500" y="150" width="70" height="38" rx="5"/><text class="label" x="535" y="173" text-anchor="middle">4 = 8</text>
    <rect class="box" x="420" y="150" width="70" height="38" rx="5"/><text class="label" x="455" y="173" text-anchor="middle">5 = 9</text>
    <g class="arrow"><path d="M490 69h10"/><path d="M570 69h10"/><path d="M615 88v62"/><path d="M580 169h-10"/><path d="M500 169h-10"/></g>
    <g class="arrowhead"><path d="M500 69l-7-4v8z"/><path d="M580 69l-7-4v8z"/><path d="M615 150l-4-7h8z"/><path d="M570 169l7-4v8z"/><path d="M490 169l7-4v8z"/></g>
    <g class="loop"><path d="M455 150v-62"/></g>
    <g class="arrowhead"><path d="M455 88l-4 7h8z"/></g>
    <text class="sub" x="660" y="173" font-size="10" text-anchor="start">front</text>
    <text class="sub" x="455" y="38" font-size="10" text-anchor="middle">rear（下一个空位）</text>
    <text class="sub" x="390" y="282" font-size="11">下标 5 之后回到 0：靠 (i + 1) % cap 完成回绕</text>
    <text class="sub" x="390" y="300" font-size="11">容量 6 只能存 5 个：留一格区分"空"和"满"</text>
  </g>
</svg>

## 循环队列：取模是关键

判断队满有两种常见写法。第一种是额外维护一个 `size`，空和满都靠它判断；第二种是**故意留一个空位**：`rear` 永远指向空位，所以 `(rear + 1) % cap == front` 就表示满。下面用第二种，代码更短，也是教材标准写法。

```c
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    int *buf;
    size_t cap;      /* 实际容量，最多存 cap - 1 个元素 */
    size_t front;    /* 队头元素下标 */
    size_t rear;     /* 下一个空位下标 */
} CQueue;

int cq_init(CQueue *q, size_t cap) {
    if (cap < 2) return 0;                       /* 至少要能留出一格 */
    q->buf = malloc(cap * sizeof *q->buf);
    if (!q->buf) return 0;
    q->cap = cap;
    q->front = q->rear = 0;
    return 1;
}

int cq_empty(const CQueue *q) { return q->front == q->rear; }
int cq_full(const CQueue *q)  { return (q->rear + 1) % q->cap == q->front; }

int cq_push(CQueue *q, int v) {
    if (cq_full(q)) return 0;
    q->buf[q->rear] = v;
    q->rear = (q->rear + 1) % q->cap;
    return 1;
}

int cq_pop(CQueue *q, int *out) {
    if (cq_empty(q)) return 0;
    *out = q->buf[q->front];
    q->front = (q->front + 1) % q->cap;
    return 1;
}

void cq_print(const CQueue *q) {
    for (size_t i = q->front; i != q->rear; i = (i + 1) % q->cap)
        printf("%d ", q->buf[i]);
    printf("\n");
}

void cq_free(CQueue *q) {
    free(q->buf);
    q->buf = NULL;
    q->cap = q->front = q->rear = 0;
}

int main(void) {
    CQueue q;
    if (!cq_init(&q, 5)) return 1;               /* 最多存 4 个 */
    for (int i = 1; i <= 4; i++) cq_push(&q, i);
    int x = 0;
    cq_pop(&q, &x);                              /* 弹出 1，front 前移 */
    printf("pop=%d, queue: ", x);
    cq_print(&q);                                /* 2 3 4 */
    printf("push5=%d\n", cq_push(&q, 5));
    printf("push6=%d\n", cq_push(&q, 6));        /* 满了，返回 0 */
    cq_print(&q);                                /* 2 3 4 5，rear 已回绕到 0 */
    cq_free(&q);
    return 0;
}
```

`front == rear` 是空，`(rear + 1) % cap == front` 是满，这两个条件不会混淆，因为满的时候永远隔着那一格空位。代价是浪费一个 `int` 的空间——用一格换掉一个分支判断，很划算。

::: warn 别把 cap 和元素上限搞混
`cap = 5` 只能存 4 个元素。如果你按"5 个都能存"来设计，最后一次 push 会把队头和队尾写成同一个值，队列看起来突然变空。分配时多要一格，或者改用 `size` 计数方案。
:::

## 链表版：不用扩容，但要管好尾指针

栈的链表版只用头插和头删，两边都是 O(1)，最省心。队列的链表版需要在尾部插入，所以必须维护 `tail`；出队时如果删掉了最后一个节点，`tail` 必须同步置 `NULL`，否则它就成了悬空指针。使用前先 `lq_init(&q)` 把两个指针清零，否则它们是未初始化的野指针。

```c
typedef struct QNode {
    int val;
    struct QNode *next;
} QNode;

typedef struct {
    QNode *head;    /* 出队端 */
    QNode *tail;    /* 入队端 */
} LQueue;

void lq_init(LQueue *q) {
    q->head = q->tail = NULL;
}

int lq_push(LQueue *q, int v) {
    QNode *n = malloc(sizeof *n);
    if (!n) return 0;
    n->val = v;
    n->next = NULL;
    if (q->tail) q->tail->next = n;
    else q->head = n;          /* 空队列：新节点同时是头和尾 */
    q->tail = n;
    return 1;
}

int lq_pop(LQueue *q, int *out) {
    if (!q->head) return 0;
    QNode *p = q->head;
    *out = p->val;
    q->head = p->next;
    if (!q->head) q->tail = NULL;   /* 删空了，尾指针必须归零 */
    free(p);
    return 1;
}
```

## 四种实现，一张表

| 需求 | 选择 | 理由 |
| --- | --- | --- |
| 括号匹配、撤销、表达式求值、DFS | 栈 | 后进先出正好对应"最近未处理" |
| BFS、任务排队、打印缓冲区 | 队列 | 先进先出保证按到达顺序处理 |
| 长度可预估、追求速度 | 数组（循环队列） | 连续内存，无每节点指针开销 |
| 长度变化大、不想整块搬迁 | 链表 | 单次操作 O(1)，不会扩容搬家 |

栈和队列的所有核心操作都是 O(1)；O(n) 只出现在"遍历整个容器"或"用链表实现却每次都要走到尾部"这类实现细节上。**结构本身不慢，慢的是你没维护好指针。**

## 练习

::: exercise 练习 1：跟踪循环队列
容量 `cap = 5`（最多存 4 个）的循环队列，初始 `front = rear = 0`。依次执行 push(1)、push(2)、push(3)、push(4)、pop、push(5)。写出最后的 `front`、`rear` 和队列内容（从队头到队尾）。

::: answer
- push 1..4 后：`front = 0`，`rear = 4`，队列 1 2 3 4，此时满。
- pop 后：`front = 1`，队列 2 3 4。
- push 5：`buf[4] = 5`，`rear = (4 + 1) % 5 = 0`。
- 最终 `front = 1`、`rear = 0`，队列 2 3 4 5。

判断标准：`rear` 回绕到 0 而不是变成 5；队列内容按 `front` 到 `rear` 的环上顺序读，不是按物理下标从小到大。
:::
:::

::: exercise 练习 2：括号匹配的栈顶
用栈判断 `{[]()}` 是否配对。扫描到 `)` 时，栈顶应该是什么？如果此时栈是空的，说明什么？扫描结束后栈应该是什么状态？

::: answer
- 扫描到 `)` 时，栈顶必须是 `(`；不是就说明括号嵌套顺序错了。
- 栈空说明右括号比左括号多，直接判不合法。
- 全部扫描完，栈必须为空，否则还有左括号没闭合。

判断标准：能同时说清"类型匹配"和"数量平衡"两件事，缺一不可。
:::
:::

::: exercise 练习 3：尾指针忘了置空
`lq_pop` 里删掉队列最后一个节点时，如果省略 `if (!q->head) q->tail = NULL;`，下一次 `lq_push` 会发生什么？

::: answer
`tail` 还指向已经 `free` 掉的节点，`q->tail->next = n` 就是 use-after-free，可能写坏别的内存，也可能当场崩。更隐蔽的情况是那块内存还没被复用，程序看起来正常，直到某次分配后才炸。

判断标准：能指出这是悬空指针问题，并说出"删空时头尾都要归零"。
:::
:::

::: selfcheck 自检
- [ ] 我能用数组写出栈，并解释 `top` 指向第一个空位
- [ ] 我能默写循环队列的满/空判断和两处取模
- [ ] 我知道 `cap` 与最多元素数差 1，并能说清为什么要留一格
- [ ] 我能用链表实现队列，且记得删空时把 `tail` 置 NULL
:::
