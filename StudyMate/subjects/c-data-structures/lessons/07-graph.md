---
node: d7
title: 图与两种遍历
type: concept
duration: 60
---

## 先说结论

图就是"顶点 + 边"。它比树自由：没有根、可以有环、一个点能连很多个。存图可用邻接矩阵或邻接表；稀疏图（E 远小于 V²）用邻接表更省内存，也是本课用的方式。

遍历图只有两个动作：**BFS 用队列一层层扩散，DFS 用栈（或递归）一条路走到底**。两者时间复杂度都是 O(V+E)，区别在于"先看近的还是先钻深的"，这决定了它们适合完全不同的问题。

## 邻接表：每个顶点挂一条链

`Graph` 有一个 `AdjNode **heads`，`heads[i]` 是顶点 i 的邻居链。加边往链头插，O(1)。无向图一条边存两次，空间 O(V+E)。

<svg class="diagram" viewBox="0 0 760 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="有向图的邻接表表示">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="20">有向图的邻接表：每个顶点挂一条邻居链</text>
    <rect class="box acc" x="60" y="40" width="60" height="34" rx="5"/><text class="label" x="90" y="62" text-anchor="middle">v0</text>
    <rect class="box" x="60" y="88" width="60" height="34" rx="5"/><text class="label" x="90" y="110" text-anchor="middle">v1</text>
    <rect class="box" x="60" y="136" width="60" height="34" rx="5"/><text class="label" x="90" y="158" text-anchor="middle">v2</text>
    <rect class="box" x="60" y="184" width="60" height="34" rx="5"/><text class="label" x="90" y="206" text-anchor="middle">v3</text>
    <rect class="box" x="60" y="232" width="60" height="34" rx="5"/><text class="label" x="90" y="254" text-anchor="middle">v4</text>
    <rect class="box" x="190" y="40" width="80" height="34" rx="5"/><text class="label" x="230" y="62" text-anchor="middle" font-size="11">2</text>
    <rect class="box" x="300" y="40" width="80" height="34" rx="5"/><text class="label" x="340" y="62" text-anchor="middle" font-size="11">1</text>
    <rect class="box" x="190" y="88" width="80" height="34" rx="5"/><text class="label" x="230" y="110" text-anchor="middle" font-size="11">3</text>
    <rect class="box" x="190" y="136" width="80" height="34" rx="5"/><text class="label" x="230" y="158" text-anchor="middle" font-size="11">4</text>
    <rect class="box" x="300" y="136" width="80" height="34" rx="5"/><text class="label" x="340" y="158" text-anchor="middle" font-size="11">3</text>
    <rect class="box" x="190" y="184" width="80" height="34" rx="5"/><text class="label" x="230" y="206" text-anchor="middle" font-size="11">4</text>
    <g class="arrow"><path d="M120 57h70"/><path d="M270 57h30"/><path d="M120 105h70"/><path d="M120 153h70"/><path d="M270 153h30"/><path d="M120 201h70"/></g>
    <g class="arrowhead"><path d="M190 57l-7-4v8z"/><path d="M300 57l-7-4v8z"/><path d="M190 105l-7-4v8z"/><path d="M190 153l-7-4v8z"/><path d="M300 153l-7-4v8z"/><path d="M190 201l-7-4v8z"/></g>
    <text class="sub" x="392" y="62" font-size="11">NULL</text>
    <text class="sub" x="282" y="110" font-size="11">NULL</text>
    <text class="sub" x="392" y="158" font-size="11">NULL</text>
    <text class="sub" x="282" y="206" font-size="11">NULL</text>
    <text class="sub" x="130" y="254" font-size="11">空链：v4 没有出边</text>
    <text class="sub" x="8" y="286" font-size="11">每条边只存一个节点；链表的顺序取决于插入顺序（这里用头插，所以是反的）</text>
  </g>
</svg>

## BFS：队列一层层扩散

BFS 从起点开始，先把所有距离为 1 的邻居看完，再看距离为 2 的，依次向外。队列保证"先入队的先处理"，正好实现"近的先访问"。

把 `dist` 数组同时当访问标记用：`-1` 表示没到过，起点是 0，邻居是当前距离加一。这样 BFS 顺便就求出了无权图的最短步数。

```c
#include <stdio.h>
#include <stdlib.h>

typedef struct AdjNode {
    int to;
    struct AdjNode *next;
} AdjNode;

typedef struct {
    AdjNode **heads;
    int n;
} Graph;

void bfs_dist(const Graph *g, int start) {
    int *dist = malloc((size_t)g->n * sizeof *dist);
    int *queue = malloc((size_t)g->n * sizeof *queue);
    if (!dist || !queue) { free(dist); free(queue); return; }

    for (int i = 0; i < g->n; i++) dist[i] = -1;
    int head = 0, tail = 0;
    dist[start] = 0;
    queue[tail++] = start;

    while (head < tail) {
        int u = queue[head++];
        for (const AdjNode *e = g->heads[u]; e; e = e->next) {
            if (dist[e->to] == -1) {         /* 第一次到达，就是最短距离 */
                dist[e->to] = dist[u] + 1;
                queue[tail++] = e->to;        /* 入队时就已经标记 */
            }
        }
    }

    for (int i = 0; i < g->n; i++) printf("%d:%d ", i, dist[i]);
    printf("\n");
    free(dist);
    free(queue);
}
```

队列最多放 n 个顶点，因为每个顶点只会入队一次——前提是你**在入队时就把 `dist` 改掉**，而不是等出队才标记。

## DFS：递归或显式栈

DFS 换一个方向：遇到第一个没去过的邻居就立刻钻进去，直到走不动再回头。递归写法几乎就是"树的遍历 + 访问标记"：

```c
static void dfs_visit(const Graph *g, int u, int *visited) {
    visited[u] = 1;
    printf("%d ", u);
    for (const AdjNode *e = g->heads[u]; e; e = e->next)
        if (!visited[e->to]) dfs_visit(g, e->to, visited);
}

void dfs(const Graph *g, int start) {
    int *visited = calloc((size_t)g->n, sizeof *visited);
    if (!visited) return;
    dfs_visit(g, start, visited);
    free(visited);
}
```

显式栈版本把"递归调用"换成"压栈"，标记放在压栈时，保证每个顶点只进栈一次：

```c
void dfs_iter(const Graph *g, int start) {
    int *visited = calloc((size_t)g->n, sizeof *visited);
    int *stack = malloc((size_t)g->n * sizeof *stack);
    if (!visited || !stack) { free(visited); free(stack); return; }

    int top = 0;
    visited[start] = 1;
    stack[top++] = start;

    while (top > 0) {
        int u = stack[--top];
        printf("%d ", u);
        for (const AdjNode *e = g->heads[u]; e; e = e->next) {
            if (!visited[e->to]) {
                visited[e->to] = 1;
                stack[top++] = e->to;
            }
        }
    }
    free(visited);
    free(stack);
}
```

显式栈的顺序通常和递归不同：递归按链表顺序走，栈把邻居全压进去再反着弹。两者都是合法 DFS 序，别拿输出对答案。

## 两种遍历，各管一类问题

<svg class="diagram" viewBox="0 0 760 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="BFS 按距离分层扩散">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="60" y="20">BFS 从 v0 出发，按距离分层</text>
    <text class="sub" x="62" y="44" font-size="11">d = 0</text>
    <text class="sub" x="302" y="44" font-size="11">d = 1</text>
    <text class="sub" x="542" y="44" font-size="11">d = 2</text>
    <rect class="box acc" x="60" y="96" width="80" height="40" rx="6"/><text class="label" x="100" y="121" text-anchor="middle">v0</text>
    <rect class="box" x="300" y="52" width="80" height="40" rx="6"/><text class="label" x="340" y="77" text-anchor="middle">v1</text>
    <rect class="box" x="300" y="140" width="80" height="40" rx="6"/><text class="label" x="340" y="165" text-anchor="middle">v2</text>
    <rect class="box" x="540" y="52" width="80" height="40" rx="6"/><text class="label" x="580" y="77" text-anchor="middle">v3</text>
    <rect class="box" x="540" y="140" width="80" height="40" rx="6"/><text class="label" x="580" y="165" text-anchor="middle">v4</text>
    <g class="arrow"><path d="M140 105L300 74"/><path d="M140 127L300 158"/><path d="M380 72L540 72"/><path d="M380 160L540 160"/><path d="M380 152L540 84"/></g>
    <g class="arrowhead"><path d="M300 74l-9 1 4 7z"/><path d="M300 158l-9-1 4-7z"/><path d="M540 72l-8-4v8z"/><path d="M540 160l-8-4v8z"/><path d="M540 84l-8 2 5 6z"/></g>
    <text class="sub" x="60" y="200" font-size="11">队列保证 v1、v2 先于 v3、v4 出队，所以距离小的先被确定</text>
  </g>
</svg>

| 问题 | 用 BFS | 用 DFS |
| --- | --- | --- |
| 无权图最少走几步 | 是，`dist` 直接给出 | 不保证最短 |
| 判断两点是否连通 | 可以 | 可以 |
| 求连通分量 | 可以，逐层染色 | 可以，一条路染到底 |
| 检测有向图的环 | 一般不用 | 可以，靠三色标记或递归栈 |
| 拓扑排序 | 可以（Kahn 算法，队列） | 可以（后序逆序） |
| 枚举所有路径 | 不适合，队列会爆 | 适合，天然回溯 |
| 空间开销 | O(V) 队列 | O(h) 递归栈 |

BFS 的强项是"最短"和"按层"：迷宫最少步数、社交网络几度好友、二叉树的层序。DFS 的强项是"走到底再回头"：找环、拓扑排序、枚举路径、连通块染色。选错了不会错，但会多花时间或爆内存。

## 四个容易翻车的地方

第一，**无向图要加两条边**。`graph_add_edge` 只加 `u → v`，还得再调一次反向，否则从 v 出发找不到 u。

第二，**visited 的时机**。BFS 在入队时标记，否则同一顶点会被重复入队；DFS 递归版进入时标记，显式栈版压栈时标记。

第三，**非连通图只从起点遍历会漏点**。BFS/DFS 只能覆盖起点所在的连通分量；要遍历全图，外层还得套一个循环：

```c
for (int i = 0; i < g->n; i++)
    if (!visited[i]) dfs_visit(g, i, visited);
```

第四，**递归深度**。链状图（0→1→2→…）的 DFS 递归深度等于 V，十万个顶点会爆栈；这种输入要改显式栈。

::: key 一句话记住
BFS = 队列 + 按距离扩散，天然求最短路；DFS = 栈/递归 + 一条路走到底，天然做回溯和环检测。两者都是 O(V+E)，差别只在访问顺序。
:::

## 练习

::: exercise 练习 1：邻接表占多少
无向图有 6 个顶点、8 条边，用邻接表存。需要多少个 `AdjNode`？如果换成邻接矩阵，要存多少个格子？为什么说邻接表是 O(V+E)？

::: answer
- 无向图每条边在两个端点各存一次，`AdjNode` 数量 = 2 × 8 = **16** 个。
- 邻接矩阵是 6 × 6 = **36** 个格子（实际可只存一半，但仍 O(V²)）。
- 邻接表的空间 = V 个链头 + 2E 个节点 = O(V+E)；稀疏图 E 远小于 V² 时优势明显。

判断标准：能说出"无向图存两次"，并把 V 和 E 分开算。
:::
:::

::: exercise 练习 2：BFS 的距离
一张有向图有这些边：0→1、0→2、1→3、2→3、2→4。从 0 出发做 BFS，写出每个顶点的 `dist`。

::: answer
`dist[0] = 0`；`dist[1] = 1`、`dist[2] = 1`；`dist[3] = 2`（从 1 或 2 到达）；`dist[4] = 2`。

判断标准：3 不能写成 1（0 不直接连 3），也不能因为 1→3 就先定成某个固定值；BFS 按层扩展，第一次到达即最短。
:::
:::

::: exercise 练习 3：为什么入队就标记
BFS 里如果改成"出队时才把 `dist` 置为有效值"，会发生什么？用一个具体图说明。

::: answer
同一个顶点可能被多个已访问的邻居重复入队。例如 0 连 1 和 2，1、2 都连 3：处理 1 时把 3 入队，处理 2 时 3 还没出队、仍未标记，于是又入队一次。队列里出现重复元素，最坏超过 V 个，`queue` 按 n 分配就会越界；即使不溢出，3 也会被处理两次。

判断标准：能说出"标记要在入队时做"，并解释重复入队与队列容量两个后果。
:::
:::

::: selfcheck 自检
- [ ] 我能写出邻接表结构，并说清无向图为什么要加两次边
- [ ] 我能默写 BFS，且知道 `dist` 同时充当 visited
- [ ] 我能写递归 DFS，并知道显式栈版的顺序可能不同
- [ ] 我能按"最短/按层"和"环/路径/拓扑"选 BFS 或 DFS
:::
