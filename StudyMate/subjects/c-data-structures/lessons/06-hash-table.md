---
node: d6
title: 哈希表：用空间换时间
type: concept
duration: 55
---

## 先说结论

哈希表拿空间换时间：先准备一排桶，再用哈希函数把 key 算成一个桶下标，于是"查找"变成"算下标 + 在桶里翻一翻"。理想情况下这是 O(1)，比链表的 O(n) 和平衡二叉树的 O(log n) 都快。

但冲突躲不掉：key 有无穷多个，桶只有有限个，必有多个 key 落到同一个桶。拉链法（separate chaining）就一句话——每个桶挂一条链表，冲突的排队。

## 桶数组，每个桶挂一条链

结构是两层：`Entry **buckets` 是桶数组，每个元素是一条链的头；`Entry` 里存 key、计数和 `next`。查找分两步：算 `hash(key) % nbuckets` 找到桶，再顺着链比较 key。

<svg class="diagram" viewBox="0 0 760 330" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="哈希表的桶数组与拉链结构">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="20">桶数组 cap = 8，下标 = hash(key) % 8</text>
    <rect class="box" x="80" y="32" width="90" height="26" rx="4"/><text class="sub" x="125" y="50" text-anchor="middle" font-size="11">桶 0</text>
    <rect class="box acc" x="80" y="64" width="90" height="26" rx="4"/><text class="label" x="125" y="82" text-anchor="middle" font-size="11">桶 1</text>
    <rect class="box" x="80" y="96" width="90" height="26" rx="4"/><text class="sub" x="125" y="114" text-anchor="middle" font-size="11">桶 2</text>
    <rect class="box" x="80" y="128" width="90" height="26" rx="4"/><text class="sub" x="125" y="146" text-anchor="middle" font-size="11">桶 3</text>
    <rect class="box acc" x="80" y="160" width="90" height="26" rx="4"/><text class="label" x="125" y="178" text-anchor="middle" font-size="11">桶 4</text>
    <rect class="box" x="80" y="192" width="90" height="26" rx="4"/><text class="sub" x="125" y="210" text-anchor="middle" font-size="11">桶 5</text>
    <rect class="box acc" x="80" y="224" width="90" height="26" rx="4"/><text class="label" x="125" y="242" text-anchor="middle" font-size="11">桶 6</text>
    <rect class="box" x="80" y="256" width="90" height="26" rx="4"/><text class="sub" x="125" y="274" text-anchor="middle" font-size="11">桶 7</text>
    <rect class="box" x="210" y="64" width="150" height="26" rx="4"/><text class="label" x="285" y="82" text-anchor="middle" font-size="11">"apple": 3</text>
    <rect class="box" x="390" y="64" width="150" height="26" rx="4"/><text class="label" x="465" y="82" text-anchor="middle" font-size="11">"banana": 2</text>
    <rect class="box" x="210" y="160" width="150" height="26" rx="4"/><text class="label" x="285" y="178" text-anchor="middle" font-size="11">"cat": 1</text>
    <rect class="box" x="210" y="224" width="150" height="26" rx="4"/><text class="label" x="285" y="242" text-anchor="middle" font-size="11">"dog": 5</text>
    <rect class="box" x="390" y="224" width="150" height="26" rx="4"/><text class="label" x="465" y="242" text-anchor="middle" font-size="11">"door": 1</text>
    <g class="arrow"><path d="M170 77h36"/><path d="M360 77h26"/><path d="M170 173h36"/><path d="M170 237h36"/><path d="M360 237h26"/></g>
    <g class="arrowhead"><path d="M210 77l-7-4v8z"/><path d="M390 77l-7-4v8z"/><path d="M210 173l-7-4v8z"/><path d="M210 237l-7-4v8z"/><path d="M390 237l-7-4v8z"/></g>
    <text class="sub" x="552" y="82" font-size="11">next = NULL</text>
    <text class="sub" x="552" y="178" font-size="11">next = NULL</text>
    <text class="sub" x="552" y="242" font-size="11">next = NULL</text>
    <text class="sub" x="8" y="306" font-size="11">负载因子 = 元素数 / 桶数；超过 0.75 就把桶数翻倍，所有 key 重新取模挂链</text>
  </g>
</svg>

图里 2 个 key（apple、banana）挤在桶 1，查找 `banana` 要先算到桶 1，再比较 `apple`、`banana` 两次。链的长度就是冲突的代价，所以哈希表的核心指标是**平均链长**。

## 哈希函数：要快，也要散

哈希函数不是加密，它只需要两件事：算得快、分布均匀。字符串最常用的 djb2 是一行循环：

```c
static unsigned long hash_str(const char *s) {
    unsigned long h = 5381;
    while (*s) h = h * 33 + (unsigned char)*s++;
    return h;
}
```

三个细节：用无符号类型算，避免溢出 UB；把 `char` 转成 `unsigned char`；乘 33 让编译器优化，不用手写 `h << 5`。

::: warn 哈希值不是下标
`hash_str` 的返回值可能是 64 位、可能很大，必须 `% nbuckets` 才能当下标用。`nbuckets` 换成 2 的幂时可以写成 `& (nbuckets - 1)`，但那等于只取低位，对分布不好的哈希函数更危险；初学阶段老老实实用取模。
:::

## 负载因子 0.75 与再哈希

负载因子 `α = size / nbuckets`，也就是平均每个桶挂几个元素。α 越大，链越长，查找越接近 O(n)；α 太小，桶大量空着，浪费内存。拉链法常用的阈值是 **0.75**：一旦插入后负载因子会超过 0.75，就把桶数翻倍。

扩容不能只重新分配桶数组——**模数变了，每个 key 的下标都可能变**，必须把每个 Entry 重新算下标、重新挂链。这就是再哈希（rehash）。

```c
static int ht_resize(HashTable *ht, size_t newn) {
    Entry **nb = calloc(newn, sizeof *nb);
    if (!nb) return 0;
    for (size_t i = 0; i < ht->nbuckets; i++) {
        Entry *e = ht->buckets[i];
        while (e) {
            Entry *next = e->next;                   /* 先存，挂到新桶会改 next */
            size_t idx = hash_str(e->key) % newn;
            e->next = nb[idx];
            nb[idx] = e;
            e = next;
        }
    }
    free(ht->buckets);
    ht->buckets = nb;
    ht->nbuckets = newn;
    return 1;
}
```

一次 rehash 是 O(n)，但桶数翻倍后要再插入 n 个元素才会触发下一次，均摊到每次插入仍是 O(1)。这跟第 2 课动态数组的翻倍扩容是同一个套路。

## 完整实现：add / get / remove

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Entry {
    char *key;
    int count;
    struct Entry *next;
} Entry;

typedef struct {
    Entry **buckets;
    size_t nbuckets;
    size_t size;
} HashTable;

static unsigned long hash_str(const char *s) {
    unsigned long h = 5381;
    while (*s) h = h * 33 + (unsigned char)*s++;
    return h;
}

static int ht_resize(HashTable *ht, size_t newn) {
    Entry **nb = calloc(newn, sizeof *nb);
    if (!nb) return 0;
    for (size_t i = 0; i < ht->nbuckets; i++) {
        Entry *e = ht->buckets[i];
        while (e) {
            Entry *next = e->next;
            size_t idx = hash_str(e->key) % newn;
            e->next = nb[idx];
            nb[idx] = e;
            e = next;
        }
    }
    free(ht->buckets);
    ht->buckets = nb;
    ht->nbuckets = newn;
    return 1;
}

int ht_add(HashTable *ht, const char *key, int delta) {
    if (ht->nbuckets == 0) {
        ht->buckets = calloc(16, sizeof *ht->buckets);
        if (!ht->buckets) return 0;
        ht->nbuckets = 16;
    }

    size_t idx = hash_str(key) % ht->nbuckets;
    for (Entry *e = ht->buckets[idx]; e; e = e->next) {
        if (strcmp(e->key, key) == 0) {
            e->count += delta;           /* 已有 key：只更新，size 不变 */
            return 1;
        }
    }

    /* 只有新建 Entry 才检查负载因子，更新已有 key 不会触发扩容 */
    if ((ht->size + 1) * 4 > ht->nbuckets * 3) {
        if (!ht_resize(ht, ht->nbuckets * 2)) return 0;
        idx = hash_str(key) % ht->nbuckets;   /* 模数变了，下标必须重算 */
    }

    Entry *e = malloc(sizeof *e);
    if (!e) return 0;
    size_t len = strlen(key);
    e->key = malloc(len + 1);
    if (!e->key) { free(e); return 0; }
    memcpy(e->key, key, len + 1);       /* key 必须复制一份 */
    e->count = delta;
    e->next = ht->buckets[idx];
    ht->buckets[idx] = e;
    ht->size++;
    return 1;
}

int ht_get(const HashTable *ht, const char *key, int *out) {
    if (ht->nbuckets == 0) return 0;
    size_t idx = hash_str(key) % ht->nbuckets;
    for (const Entry *e = ht->buckets[idx]; e; e = e->next) {
        if (strcmp(e->key, key) == 0) {
            *out = e->count;
            return 1;
        }
    }
    return 0;
}

int ht_remove(HashTable *ht, const char *key) {
    if (ht->nbuckets == 0) return 0;
    size_t idx = hash_str(key) % ht->nbuckets;
    Entry **pp = &ht->buckets[idx];      /* 指向"指向当前节点的指针" */
    while (*pp) {
        Entry *e = *pp;
        if (strcmp(e->key, key) == 0) {
            *pp = e->next;               /* 桶头删除和中间删除同一行搞定 */
            free(e->key);
            free(e);
            ht->size--;
            return 1;
        }
        pp = &e->next;
    }
    return 0;
}

void ht_free(HashTable *ht) {
    for (size_t i = 0; i < ht->nbuckets; i++) {
        Entry *e = ht->buckets[i];
        while (e) {
            Entry *next = e->next;
            free(e->key);
            free(e);
            e = next;
        }
    }
    free(ht->buckets);
    ht->buckets = NULL;
    ht->nbuckets = ht->size = 0;
}
```

`ht_remove` 里的 `Entry **pp` 是 C 处理链表删除的经典技巧：`pp` 指向"装着当前节点地址的位置"，于是删桶头和删链中节点都用同一句 `*pp = e->next`，不必特判头节点。第 3 课用 `prev` 特判头删，这里用二级指针消灭特判，两种写法都值得会。

## 四个容易翻车的地方

第一，**key 是借来的指针**。传进来若是栈上临时缓冲区，之后被覆盖，表里的 `key` 就指向垃圾。插入时必须复制，删除时把副本 `free`。

第二，**删除只摘链不释放**。`*pp = e->next` 只是把节点从链上摘掉，`e` 和 `e->key` 还占着内存，必须逐个释放。

第三，**rehash 时缓存了旧桶指针**。扩容后 `buckets` 指向新数组，旧桶指针失效，也不能假设下标不变。

第四，**遍历顺序不可依赖**。哈希表只保证"能查"，不保证顺序；要按频次输出，得把 Entry 指针收进数组再排序——第 8 课的最后一步就是这个。

::: key 一句话记住
哈希表的 O(1) 是**平均**复杂度，前提是哈希函数分布均匀、负载因子受控。最坏情况下所有 key 挤进一个桶，查找退化成 O(n)。
:::

## 练习

::: exercise 练习 1：算桶下标与比较次数
桶数 `nbuckets = 8`。依次插入三个 key，它们的 `hash_str` 返回值分别是 42、17、9（value 都为 1），采用头插法。写出三个 key 的桶下标，以及查找 `hash = 17` 那个 key 时要比较几次？

::: answer
- 42 % 8 = 2 → 桶 2。
- 17 % 8 = 1 → 桶 1，此时桶 1 为空，成为链头。
- 9 % 8 = 1 → 桶 1，头插到 17 前面，链变成 `9 → 17`。

查找 17 要先比较链头的 9（不匹配），再比较 17（匹配），共 **2 次**。

判断标准：会算取模；知道头插会让后插入的排在链头，从而影响比较次数。
:::
:::

::: exercise 练习 2：什么时候扩容
`nbuckets = 16`、`size = 12`，负载因子是多少？再插入一个**全新的 key**，按 `(size + 1) * 4 > nbuckets * 3` 的规则会不会扩容？扩容后负载因子约是多少？

::: answer
- 当前 α = 12 / 16 = **0.75**。
- 插入前判断：`(12 + 1) * 4 = 52`，`16 * 3 = 48`，52 > 48 → **扩容**，桶数翻倍到 32。
- 插入后 α = 13 / 32 ≈ **0.41**。

注意如果只是更新已经存在的 key，`size` 不变，不会触发扩容。

判断标准：能区分"新插入"和"更新已有 key"，并会算扩容前后的 α。
:::
:::

::: exercise 练习 3：为什么不能 memcpy 桶数组
扩容时直接把旧桶数组 `memcpy` 到新数组的前半段，为什么不行？

::: answer
下标是 `hash(key) % nbuckets`，桶数从 16 变成 32 后，模数变了，同一个 key 可能从桶 3 变成桶 19。整块拷贝会让 key 留在旧下标上，按新下标查找时就找不到它。旧桶数组可以释放，但它指向的 Entry 必须逐个按新模数重新挂链。

正确做法是逐桶、逐节点重新算下标，用头插或尾插挂到新桶上。

判断标准：能说出"下标依赖桶数"，所以扩容必须重算而不是搬家。
:::
:::

::: selfcheck 自检
- [ ] 我能画出桶数组加链表，并说清查找的两步
- [ ] 我会写 djb2，并知道要做 `% nbuckets`
- [ ] 我能解释 0.75 的来历，以及 rehash 为什么必须重新算下标
- [ ] 我删除节点时会连 key 一起 free，且知道遍历顺序不可依赖
:::
