---
node: d2
title: 指针、动态内存与手动扩容
type: concept
duration: 55
---

## 先说结论

数组的死穴是长度写死。要让它运行时长大，C 只给三样东西：`malloc` 要内存、`realloc` 换尺寸、`free` 还回去。所谓"动态数组"就是**一个指针加两个数**：`data` 指向堆上缓冲区，`size` 记用了多少格，`cap` 记最多能放多少格。

堆上的每块内存都有主人：谁 `malloc`，谁负责 `free`。C 不替你记账，漏一次是泄漏，多一次是崩溃。

## 指针记的是位置，不是数据

`int x = 42; int *p = &x;` 里，`x` 是 4 字节的整数，`p` 是 8 字节的地址。`*p` 是"顺着地址找过去"，`&x` 是"把 x 的地址拿出来"。指针变量自己也有地址，这就是二级指针的全部含义。

<svg class="diagram" viewBox="0 0 760 270" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="动态数组由栈上的结构体和堆上的缓冲区组成">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="22">栈上的 IntVec v（24 字节）</text>
    <rect class="box" x="8" y="34" width="176" height="92" rx="6"/>
    <text class="label" x="22" y="60">data = 0x7f20</text>
    <text class="sub" x="22" y="80" font-size="11.5">size = 3</text>
    <text class="sub" x="22" y="100" font-size="11.5">cap  = 4</text>
    <text class="label" x="248" y="22">堆上的缓冲区：malloc 来的 4 个 int</text>
    <rect class="box acc" x="248" y="34" width="76" height="44" rx="6"/><text class="label" x="286" y="61" text-anchor="middle">10</text>
    <rect class="box acc" x="330" y="34" width="76" height="44" rx="6"/><text class="label" x="368" y="61" text-anchor="middle">20</text>
    <rect class="box acc" x="412" y="34" width="76" height="44" rx="6"/><text class="label" x="450" y="61" text-anchor="middle">30</text>
    <rect class="box" x="494" y="34" width="76" height="44" rx="6"/><text class="sub" x="532" y="61" text-anchor="middle">未使用</text>
    <text class="sub" x="248" y="96" font-size="11">0x7f20</text>
    <text class="sub" x="570" y="96" font-size="11" text-anchor="end">0x7f30 止</text>
    <g class="arrow"><path d="M184 66h60"/></g>
    <g class="arrowhead"><path d="M248 66l-7-4v8z"/></g>
    <text class="sub" x="8" y="126" font-size="11">data 只是一根线：它指向的那 16 字节不在结构体里</text>
    <text class="label" x="8" y="168">push 第 5 个：满了，realloc 换一整块更大的内存</text>
    <rect class="loop" x="8" y="180" width="146" height="42" rx="6"/>
    <text class="sub" x="81" y="206" font-size="11" text-anchor="middle">旧块 4 格（已经 free）</text>
    <g class="loop"><path d="M154 201h42"/></g>
    <g class="arrowhead"><path d="M200 201l-7-4v8z"/></g>
    <rect class="box acc" x="204" y="180" width="56" height="42" rx="5"/><text class="label" x="232" y="206" text-anchor="middle">10</text>
    <rect class="box acc" x="264" y="180" width="56" height="42" rx="5"/><text class="label" x="292" y="206" text-anchor="middle">20</text>
    <rect class="box acc" x="324" y="180" width="56" height="42" rx="5"/><text class="label" x="352" y="206" text-anchor="middle">30</text>
    <rect class="box acc" x="384" y="180" width="56" height="42" rx="5"/><text class="label" x="412" y="206" text-anchor="middle">40</text>
    <rect class="box" x="444" y="180" width="56" height="42" rx="5"/><text class="sub" x="472" y="206" font-size="10" text-anchor="middle">空</text>
    <rect class="box" x="504" y="180" width="56" height="42" rx="5"/><text class="sub" x="532" y="206" font-size="10" text-anchor="middle">空</text>
    <rect class="box" x="564" y="180" width="56" height="42" rx="5"/><text class="sub" x="592" y="206" font-size="10" text-anchor="middle">空</text>
    <rect class="box" x="624" y="180" width="56" height="42" rx="5"/><text class="sub" x="652" y="206" font-size="10" text-anchor="middle">空</text>
    <text class="sub" x="8" y="248" font-size="11.5">搬 3 个旧元素是 O(n)；但每翻倍一次才搬一次，均摊每次 push 仍是 O(1)</text>
  </g>
</svg>

图里 `v` 在栈上，函数返回就消失；4 个 int 在堆上，是另一次分配。**结构体和缓冲区是两处内存**：缓冲区必须 `free`，结构体本身如果是 `malloc` 来的也要单独 `free`。

## malloc 的三条铁律

`malloc` 返回 `void *`，失败返回 `NULL`。三件事必须做：检查返回值、算对字节数、用完释放。

```c
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int n = 0;
    if (scanf("%d", &n) != 1 || n <= 0) return 1;

    int *a = malloc((size_t)n * sizeof *a);   /* sizeof *a 比 sizeof(int) 更难写错 */
    if (a == NULL) {                          /* 铁律一：检查返回值 */
        fprintf(stderr, "malloc failed\n");
        return 1;
    }

    for (int i = 0; i < n; i++) a[i] = i;
    printf("%d\n", a[n - 1]);

    free(a);                                  /* 铁律三：配对释放 */
    a = NULL;                                 /* 置空，后面误用会立刻崩，而不是悄悄写坏内存 */
    return 0;
}
```

`calloc` 会清零，`malloc` 不会；结构体初始化建议用 `= {0}` 或 `calloc`，能省掉一半诡异 bug。

::: warn 字节数要用 size_t 算
`n * sizeof(int)` 里 `sizeof` 的类型是 `size_t`，`n` 会先被转成无符号再参与乘法——所以负的 `n` 会变成一个天文数字。乘积本身在 `size_t` 里计算，64 位下大 `n` 一般不会在 int 范围内溢出，但 32 位下仍可能回绕。先校验 `n > 0`，再写 `(size_t)n * sizeof *a`；`malloc(0)` 合法，但别解引用它的返回值。
:::

## realloc：换尺寸，不是"变大"

`realloc(p, new_size)` 的语义是：**申请一块 new_size 的新内存，把 p 指向的旧内容尽量搬过去，然后释放旧块，返回新地址**。它可能原地加长，也可能整块搬到别处，所以返回值必须接住，而且不能直接覆盖原指针。

```c
#include <stdlib.h>

/* 返回新缓冲区；失败时返回 NULL，且旧指针 old 仍然有效 */
static int *grow(int *old, size_t oldcap, size_t newcap) {
    int *p = realloc(old, newcap * sizeof *p);
    if (p == NULL) return NULL;      /* 旧块没被释放，调用者还能继续用或 free */
    (void)oldcap;                    /* 这里用不到，仅示意接口 */
    return p;
}
```

::: warn 不要写 `p = realloc(p, ...)`
如果 `realloc` 失败返回 NULL，原指针就被 NULL 覆盖了，那块内存从此没人知道地址——泄漏，而且程序还继续往 NULL 写。正确顺序是先存到临时变量，成功了再赋回。
:::

容量翻倍不是随便选的美学。假设每次只加 1 格，push n 次要搬 1+2+…+n 次，总代价 O(n²)；每次翻倍，总搬运量不超过 2n，均摊到每次 push 就是 O(1)。**单次最坏仍然是 O(n)，但摊还下来很便宜。**

## 手写 IntVec：一个能长大的数组

把前面的东西拼起来，就是一个最小可用的动态数组。注意容量为 0 时 `realloc(NULL, size)` 等价于 `malloc(size)`，所以初始化只需要 `= {0}`。

```c
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    int *data;
    size_t size;
    size_t cap;
} IntVec;

static int vec_reserve(IntVec *v, size_t need) {
    if (need <= v->cap) return 1;
    size_t newcap = v->cap ? v->cap * 2 : 4;
    while (newcap < need) newcap *= 2;
    int *p = realloc(v->data, newcap * sizeof *p);
    if (p == NULL) return 0;
    v->data = p;
    v->cap = newcap;
    return 1;
}

int vec_push(IntVec *v, int x) {
    if (!vec_reserve(v, v->size + 1)) return 0;
    v->data[v->size++] = x;
    return 1;
}

int vec_get(const IntVec *v, size_t i, int *out) {
    if (i >= v->size) return 0;
    *out = v->data[i];
    return 1;
}

void vec_free(IntVec *v) {
    free(v->data);
    v->data = NULL;
    v->size = v->cap = 0;
}

int main(void) {
    IntVec v = {0};
    for (int i = 0; i < 20; i++) {
        if (!vec_push(&v, i * i)) { fprintf(stderr, "out of memory\n"); return 1; }
    }
    int last = 0;
    if (vec_get(&v, v.size - 1, &last)) printf("size=%zu cap=%zu last=%d\n", v.size, v.cap, last);
    vec_free(&v);
    return 0;
}
```

`vec_push` 失败时返回 0，表保持原样，调用者可以决定重试还是报错。**接口用返回值报告失败，而不是直接 abort**。

## 三个一定会踩的坑

第一，**返回局部变量的地址**。`int *f(void) { int a[10]; return a; }` 函数一返回，栈帧就作废，指针悬空。要返回数组就 `malloc`，并让调用者 `free`。

第二，**free 之后继续用**。`free(p)` 后 p 里通常还留着原地址，但按 C 标准这个值已经不确定；内存已还给分配器，可能立刻被下一次 `malloc` 拿去用。养成 `p = NULL` 的习惯，至少让误用变成段错误而不是数据错乱。

第三，**同一个指针 free 两次**。第二次是未定义行为，常见于两个结构体共用一个指针。约定所有权：一块内存只有一个主人，别人只借不还。

::: key 所有权约定
函数返回 `malloc` 出来的指针，就是把所有权交给调用者；只借指针参数用，就绝不 `free`。写接口时先回答"这块内存谁负责释放"，比事后查泄漏轻松十倍。
:::

## 练习

::: exercise 练习 1：找出这段代码的隐患
```c
int n;
scanf("%d", &n);
int *a = malloc(n * sizeof(int));
for (int i = 0; i < n; i++) a[i] = i;
```

::: answer
至少三处：
1. `n` 没校验：负数会被转成巨大的 `size_t` 去请求内存，`n == 0` 拿到的是 `malloc(0)` 的指针；应提前只接受 `n > 0`。
2. `malloc` 返回值没检查，内存不足时 `a` 是 NULL，循环里写 `a[i]` 直接崩。
3. 没有 `free(a)`，程序结束时泄漏。

判断标准：读入的数据先校验范围，分配后先判 NULL，离开作用域前配对释放。
:::
:::

::: exercise 练习 2：算均摊代价
从一个容量为 1、已经有 1 次分配的空表开始，每次满了就把容量翻倍。连续 push 1000 个元素（假设内存足够），一共发生几次扩容？总共搬动多少个旧元素？单次最坏和均摊复杂度各是多少？

::: answer
- 容量序列 1 → 2 → 4 → … → 1024，共 **10 次**扩容（1→2 第 1 次，512→1024 第 10 次）。
- 搬运总量 1+2+4+…+512 = **1023** 个，不超过 2N。
- 单次最坏 O(n)（那次从 512 搬到 1024），但均摊 O(1)。

判断标准：能说出"总搬运量 < 2N 所以均摊常数"，而不是只说"翻倍比较快"。
:::
:::

::: exercise 练习 3：谁该 free
```c
#include <stdlib.h>
#include <string.h>

char *make_name(void) {
    char *s = malloc(16);
    strcpy(s, "ds");
    return s;
}

int main(void) {
    char *a = make_name();
    char *b = "ds";
    free(a);
    free(b);
    return 0;
}
```
哪一行有问题？为什么？

::: answer
`free(b)` 是未定义行为。`b` 指向字符串字面量，位于静态存储区，不是 `malloc`/`calloc`/`realloc` 返回的块，堆管理器没有它的记录。`a` 反而必须 free，因为 `make_name` 把所有权交给了调用者。

判断标准：只有从 `malloc` 家族拿到的指针才能 free，且一块内存只能 free 一次；字面量、数组名、栈变量地址一律不能 free。
:::
:::

::: selfcheck 自检
- [ ] 我能画出"栈上结构体 + 堆上缓冲区"，并说清两处内存分别由谁释放
- [ ] 我写 malloc 时会检查 NULL、用 sizeof *p 算字节、配对 free
- [ ] 我能解释为什么 realloc 的结果不能直接赋回原指针
- [ ] 我能算出翻倍扩容的均摊复杂度，并说出单次最坏情况
:::
