---
node: d1
title: 数据结构到底是什么：内存、类型与数组
type: concept
duration: 50
---

## 先说结论

数据结构不是"链表、树、图"这些名词的总和，而是一句话：**你决定数据在内存里怎么摆，以及你能对它做哪些操作**。摆法决定代价——同样是"存 100 个 int"，摆成一排和摆成一串，查第 50 个的速度差 50 倍。

C 语言特别适合学这件事，因为它不替你隐藏任何东西：没有容器、没有自动扩容、没有垃圾回收。你写 `int a[100]`，你就真的拿到 400 字节连续内存。所以这一课不从链表开始，从**内存**开始。

## 一排格子：数组的真实形态

<svg class="diagram" viewBox="0 0 760 250" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="数组是连续内存，链表是分散节点用指针相连">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="24">int a[5]，每个占 4 字节，地址连续</text>
    <rect class="box acc" x="8" y="36" width="64" height="42" rx="6"/><text class="label" x="40" y="62" text-anchor="middle">a[0]</text>
    <rect class="box acc" x="78" y="36" width="64" height="42" rx="6"/><text class="label" x="110" y="62" text-anchor="middle">a[1]</text>
    <rect class="box acc" x="148" y="36" width="64" height="42" rx="6"/><text class="label" x="180" y="62" text-anchor="middle">a[2]</text>
    <rect class="box acc" x="218" y="36" width="64" height="42" rx="6"/><text class="label" x="250" y="62" text-anchor="middle">a[3]</text>
    <rect class="box acc" x="288" y="36" width="64" height="42" rx="6"/><text class="label" x="320" y="62" text-anchor="middle">a[4]</text>
    <text class="sub" x="8" y="98" font-size="11">0x1000</text>
    <text class="sub" x="288" y="98" font-size="11" text-anchor="end">a[4] 在 0x1010，数组止于 0x1014</text>
    <text class="label" x="8" y="138">链表：5 个节点，地址互不相邻，靠 next 串起来</text>
    <rect class="box" x="8" y="150" width="88" height="46" rx="6"/><text class="label" x="52" y="172" text-anchor="middle">data</text><text class="sub" x="52" y="188" text-anchor="middle" font-size="10">next →</text>
    <rect class="box" x="176" y="150" width="88" height="46" rx="6"/><text class="label" x="220" y="172" text-anchor="middle">data</text><text class="sub" x="220" y="188" text-anchor="middle" font-size="10">next →</text>
    <rect class="box" x="344" y="150" width="88" height="46" rx="6"/><text class="label" x="388" y="172" text-anchor="middle">data</text><text class="sub" x="388" y="188" text-anchor="middle" font-size="10">next →</text>
    <rect class="box" x="512" y="150" width="88" height="46" rx="6"/><text class="label" x="556" y="172" text-anchor="middle">data</text><text class="sub" x="556" y="188" text-anchor="middle" font-size="10">next = NULL</text>
    <g class="arrow"><path d="M96 173h80"/><path d="M264 173h80"/><path d="M432 173h80"/></g>
    <g class="arrowhead"><path d="M176 173l-6-4v8z"/><path d="M344 173l-6-4v8z"/><path d="M512 173l-6-4v8z"/></g>
    <text class="sub" x="8" y="222" font-size="11.5">访问 a[i]：算一次地址就能取到（O(1)）；访问链表第 i 个：必须从头一个个走（O(n)）</text>
  </g>
</svg>

上面两块图，是后面所有结构的母题：**连续 vs 分散**。连续 → 定位快、插入慢；分散 → 插入快、定位慢。后面的链表、树、哈希，无非是在这两者之间做不同的折中。

## 地址算术：为什么 a[i] 是一次计算

C 标准只保证一件事：数组元素按顺序紧挨着放。于是取第 i 个元素不需要"找"，只需要算：

```c
int a[5] = {10, 20, 30, 40, 50};
int *p = a;            /* a 退化为指向首元素的指针 */
printf("%d\n", *(p + 2));   /* 30：指针加 2，实际地址 + 8 字节 */
printf("%d\n", a[2]);       /* 完全等价，a[i] 就是 *(a + i) */
```

`p + 2` 里的 `2` 不是 2 字节，是 **2 个元素**：编译器按 `sizeof(int)` 自动乘。这也是为什么数组下标必须从 0 开始——`a[i]` 的地址是 `首地址 + i × 元素大小`，从 0 起算才不用减一。

::: key 一句话记住
`a[i]` ≡ `*(a + i)`。所以"随机访问是 O(1)"不是魔法，是一次乘法和一次加法。
:::

::: warn 越界不是"多读一点"
C 不检查下标。`a[10]` 会老老实实算出 `首地址 + 40` 字节，然后读写那块内存——那里可能是别的变量、可能是函数返回地址。读和写都是未定义行为（UB）：读出来可能是垃圾值，也可能当场崩溃，或者被优化器按"不会发生"处理；写进去还可能改掉别的变量或返回地址。
:::

`sizeof` 能帮你在编译期确认布局：

```c
int a[5];
printf("%zu\n", sizeof(a));        /* 20：整个数组的字节数 */
printf("%zu\n", sizeof(a) / sizeof(a[0]));  /* 5：元素个数，惯用写法 */
```

注意 `sizeof(a)` 只在**数组还在**的时候有效。把数组传给函数，它会退化成指针：

```c
void f(int arr[5]) {          /* 这里的 5 编译器直接忽略 */
    printf("%zu\n", sizeof(arr));   /* 8：指针大小，不是 20 */
}
```

这是 C 新手最常踩的坑之一：**函数里拿不到数组长度**，必须另外传一个 `n`。你以后写的每个数据结构接口，几乎都要带长度参数，原因就在这里。

## 结构体：自己设计一种"格子"

数组只能装同类型的东西。要装"一个学生 = 学号 + 成绩 + 姓名"，就得用结构体自己排版：

```c
struct Student {
    int   id;        /* 0-3   */
    float score;     /* 4-7   */
    char  name[12];  /* 8-19  */
};                   /* 总共 20 字节 */
```

但内存不是你想要多少就给多少，编译器会做**对齐（padding）**：

```c
struct Bad {
    char  c;    /* 1 字节，后面补 3 字节空洞 */
    int   i;    /* 必须落在 4 的倍数上 */
    char  d;    /* 1 字节，尾部再补 3 字节 */
};              /* sizeof = 12，不是 6 */
```

::: note 为什么会有空洞
CPU 读 4 字节整数时要求地址是 4 的倍数，否则要么变慢、要么直接报错。补齐是为了让每个成员都落在自己的对齐边界上。所以结构体成员**从大到小排**通常更省内存：`{int, char, char}` 只需 8 字节，换成 `{char, int, char}` 就要 12 字节——把 4 字节成员排在一起，空洞最少。
:::

## 三种代价，一张表

| 操作 | 数组（连续） | 链表（分散） |
| --- | --- | --- |
| 按下标访问第 i 个 | O(1) | O(n) |
| 在头部插入 | O(n)（要整体后移） | O(1) |
| 在中间插入 | O(n) | O(1)（已持有前驱指针时） |
| 内存占用 | 紧凑，无额外开销 | 每个节点多一个指针 |
| 扩容 | 可能整体搬迁（realloc） | 天然逐个申请 |

::: key 选择的唯一标准
看你的操作里**哪个最多**。查得多、改得少 → 数组；插删频繁、顺序访问为主 → 链表。没有"更好的数据结构"，只有"更贴合你访问模式的结构"。
:::

这一课不需要你立刻写出链表。先建立两个直觉：**数据结构是内存布局的选择**；**复杂度是这种布局的必然结果**。下一课我们会用 `malloc` 把"固定大小的数组"变成"能长大的数组"，你会亲手遇到扩容那一刻的搬迁成本。

## 练习

::: exercise 练习 1：算地址
`double a[8]` 的首地址是 `0x2000`，`sizeof(double)` 为 8。`a[5]` 的地址是多少？`&a[5] - &a[2]` 等于多少？

::: answer
- `a[5]` 地址 = `0x2000 + 5 × 8` = `0x2028`。
- `&a[5] - &a[2]` = 3。指针相减得到的是**元素个数**，不是字节数；编译器已经替你除了 `sizeof(double)`。

判断标准：地址计算要乘元素大小，指针相减不用乘。
:::
:::

::: exercise 练习 2：结构体大小
```c
struct A { char c; int i; char d; };
struct B { int i; char c; char d; };
```
两者 `sizeof` 分别是多少？为什么？

::: answer
- `struct A`：`c` 后补 3 字节，`i` 占 4，`d` 后补 3 字节 → **12**。
- `struct B`：`i` 占 4，`c`、`d` 各 1 字节，尾部补 2 字节使整体是 4 的倍数 → **8**。

同样三个成员，顺序不同差 4 字节。规则：成员按大小从大到小排，空洞最少。
:::
:::

::: exercise 练习 3：这个函数哪里错了
```c
void print_all(int arr[]) {
    for (int i = 0; i < sizeof(arr) / sizeof(arr[0]); i++)
        printf("%d ", arr[i]);
}
```

::: answer
`arr` 在参数位置已经退化成 `int *`，`sizeof(arr)` 是 8（64 位下指针大小），`sizeof(arr[0])` 是 4，循环条件变成 `i < 2`——只打印两个元素，而且看起来"没报错"，最难查。

修法：把长度作为参数传进来 `void print_all(int arr[], int n)`，循环写 `i < n`。
:::
:::

::: selfcheck 自检
- [ ] 我能解释 `a[i]` 为什么是 O(1)
- [ ] 我知道数组作为参数会退化成指针，长度必须另传
- [ ] 我能算出带 padding 的结构体大小，并说出调整顺序的收益
- [ ] 我能用"查得多还是改得多"来选数组或链表
:::
