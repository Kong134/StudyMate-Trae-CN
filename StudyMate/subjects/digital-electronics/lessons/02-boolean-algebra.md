---
node: e2
title: 逻辑代数基础
type: concept
duration: 70
---

## 先说结论：布尔代数只干一件事

布尔代数只研究取值为 0 或 1 的变量，运算只有与、或、非。它的用途不是解方程，而是**把逻辑表达式压成门数最少的形状**：`AB+AB'+A'B` 要三个与门加一个或门，化成 `A+B` 只要一个或门，功能完全一样。化简有两条路：公式法靠恒等式一步步推，适合项数少；卡诺图靠"相邻项只差一位"直接圈，适合 3 到 5 个变量。两条路得到的式子可能长得不同，但真值表必须逐行一致——真值表是最终裁判。

## 三种基本运算与复合门

与：全 1 才出 1，写作 `AB`；或：有 1 就出 1，写作 `A+B`；非：取反，写作 `A'`。三者组合出常用复合门：与非 `(AB)'`、或非 `(A+B)'`、异或 `A⊕B=A'B+AB'`，相异为 1。

| A | B | AB | A+B | (AB)' | (A+B)' | A⊕B |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| 0 | 1 | 0 | 1 | 1 | 0 | 1 |
| 1 | 0 | 0 | 1 | 1 | 0 | 1 |
| 1 | 1 | 1 | 1 | 0 | 0 | 0 |

与非门是**万能门**：把输入并起来 `(AA)'=A'` 得非；与非后再取反 `((AB)')'=AB` 得与；两个反相信号再与非 `(A'B')'=A+B` 得或。或非门同理。所以"只用与非门实现"不是刁难，而是因为实际芯片里最便宜、最常见的就是与非门。

## 公式表：先认脸，再谈化简

| 名称 | 公式 |
| --- | --- |
| 同一律 | $A+A=A$，$A\cdot A=A$ |
| 0-1 律 | $A+0=A$，$A\cdot1=A$，$A+1=1$，$A\cdot0=0$ |
| 互补律 | $A+A'=1$，$A\cdot A'=0$ |
| 吸收律 | $A+AB=A$，$A(A+B)=A$ |
| 消去律 | $A+A'B=A+B$，$A(A'+B)=AB$ |
| 冗余律 | $AB+A'C+BC=AB+A'C$ |
| 德摩根 | $(AB)'=A'+B'$，$(A+B)'=A'B'$ |

最常用的是吸收律、消去律和德摩根。`A+AB=A` 是说 A 成立时 B 怎样都无所谓；`A+A'B=A+B` 是说 A 不成立时只能靠 B；`AB+A'C+BC=AB+A'C` 是说 BC 已被前两项完全覆盖。德摩根是拆长横线的唯一工具：横线断开，与变或、或变与，每个变量单独取反。拆 `(AB+C)'` 要先得 `(AB)'·C'`，再得 `(A'+B')C'`，不能一步写成 `A'B'+C'`。

## 公式化简：三个例子，每步写依据

例一，合并只差一个变量的项：

$$F=AB+AB'+A'B=A(B+B')+A'B=A+A'B=A+B$$

第一步用分配律提出 A，第二步用互补律 $B+B'=1$，第三步用同一律去掉乘 1，最后用消去律。

例二，删掉冗余项：

$$F=AB+A'C+BC=AB+A'C+BC(A+A')=AB+A'C+ABC+A'BC=AB+A'C$$

先把 BC 乘 $(A+A')$ 补成两项，再用吸收律分别并入 AB 和 A'C。结论：两头各含一个互补变量、第三项由剩下的变量组成时，第三项一定冗余。

例三，先拆横线再合并：

$$F=(A'B+AB')'=(A'B)'\cdot(AB')'=(A+B')(A'+B)=AB+A'B'$$

前两步用德摩根，第三步用分配律展开，其中 $AA'$ 和 $BB'$ 为 0，最后得同或。

::: warn 拆横线要一层一层来
$(AB+C)'$ 不是 $A'B'+C'$。最外层是或，先把或拆成"与"：$(AB)'\cdot C'$，再拆里面的与。漏一层，真值表就对不上。
:::

## 卡诺图：把"相邻"画成看得见

卡诺图每格是一个最小项，行、列都按格雷序 `00、01、11、10` 排，保证图上相邻（包括首尾绕回）的两格只差一个变量。3 变量是 2×4 共 8 格，行写 A=0/1，列写 BC 的四种组合；4 变量是 4×4 共 16 格，行写 AB、列写 CD，同样按格雷序。

圈 1 的规则：只圈 1（无关项 X 可当 1）；圈内格数只能是 1、2、4、8；圈必须是矩形，可跨上下、左右边界；圈越大越好、圈数越少越好；同一格可被多个圈共用；每个 1 至少进一个圈。读项时只看圈内不变的变量，值为 0 的写成反变量。

<svg class="diagram" viewBox="0 0 760 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="四变量卡诺图，左上四格圈成 A 反 C 反，右下四格圈成 AC">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="24">四变量卡诺图：F = Σm(0,1,4,5,10,11,14,15)</text>
    <text class="sub" x="520" y="52" text-anchor="middle" font-size="11">CD（列，格雷序）</text>
    <text class="sub" x="208" y="78" font-size="11">AB</text>
    <text class="sub" x="289" y="82" text-anchor="middle" font-size="11">00</text>
    <text class="sub" x="367" y="82" text-anchor="middle" font-size="11">01</text>
    <text class="sub" x="445" y="82" text-anchor="middle" font-size="11">11</text>
    <text class="sub" x="523" y="82" text-anchor="middle" font-size="11">10</text>
    <text class="sub" x="232" y="127" text-anchor="middle" font-size="11">00</text>
    <text class="sub" x="232" y="179" text-anchor="middle" font-size="11">01</text>
    <text class="sub" x="232" y="231" text-anchor="middle" font-size="11">11</text>
    <text class="sub" x="232" y="283" text-anchor="middle" font-size="11">10</text>
    <rect class="box acc" x="250" y="96" width="78" height="52" rx="4"/><text class="label" x="289" y="128" text-anchor="middle">1</text>
    <rect class="box acc" x="328" y="96" width="78" height="52" rx="4"/><text class="label" x="367" y="128" text-anchor="middle">1</text>
    <rect class="box" x="406" y="96" width="78" height="52" rx="4"/><text class="label" x="445" y="128" text-anchor="middle">0</text>
    <rect class="box" x="484" y="96" width="78" height="52" rx="4"/><text class="label" x="523" y="128" text-anchor="middle">0</text>
    <rect class="box acc" x="250" y="148" width="78" height="52" rx="4"/><text class="label" x="289" y="180" text-anchor="middle">1</text>
    <rect class="box acc" x="328" y="148" width="78" height="52" rx="4"/><text class="label" x="367" y="180" text-anchor="middle">1</text>
    <rect class="box" x="406" y="148" width="78" height="52" rx="4"/><text class="label" x="445" y="180" text-anchor="middle">0</text>
    <rect class="box" x="484" y="148" width="78" height="52" rx="4"/><text class="label" x="523" y="180" text-anchor="middle">0</text>
    <rect class="box" x="250" y="200" width="78" height="52" rx="4"/><text class="label" x="289" y="232" text-anchor="middle">0</text>
    <rect class="box" x="328" y="200" width="78" height="52" rx="4"/><text class="label" x="367" y="232" text-anchor="middle">0</text>
    <rect class="box acc" x="406" y="200" width="78" height="52" rx="4"/><text class="label" x="445" y="232" text-anchor="middle">1</text>
    <rect class="box acc" x="484" y="200" width="78" height="52" rx="4"/><text class="label" x="523" y="232" text-anchor="middle">1</text>
    <rect class="box" x="250" y="252" width="78" height="52" rx="4"/><text class="label" x="289" y="284" text-anchor="middle">0</text>
    <rect class="box" x="328" y="252" width="78" height="52" rx="4"/><text class="label" x="367" y="284" text-anchor="middle">0</text>
    <rect class="box acc" x="406" y="252" width="78" height="52" rx="4"/><text class="label" x="445" y="284" text-anchor="middle">1</text>
    <rect class="box acc" x="484" y="252" width="78" height="52" rx="4"/><text class="label" x="523" y="284" text-anchor="middle">1</text>
    <rect class="loop" x="246" y="92" width="164" height="112" rx="8"/>
    <rect class="loop" x="402" y="196" width="164" height="112" rx="8"/>
    <text class="label" x="585" y="134">A′C′：左上 4 格</text>
    <text class="label" x="585" y="262">AC：右下 4 格</text>
    <text class="sub" x="8" y="362" font-size="11.5">圈内不变的变量留下，变了的丢掉；0 写反变量。两个圈已盖住全部 1，且都是 4 格，不能再大。</text>
    <text class="sub" x="8" y="384" font-size="11.5">结果 F = A′C′ + AC，也就是 A 与 C 的同或。</text>
  </g>
</svg>

例：$F(A,B,C,D)=\sum m(0,1,4,5,10,11,14,15)$。左上四格（0、1、4、5）里 A=0、C=0，得 $A'C'$；右下四格（10、11、14、15）里 A=1、C=1，得 $AC$。所有 1 都被盖住，且两个圈都是 4 格，所以最简与或式就是 $F=A'C'+AC$。

无关项 X 表示这些输入组合在实际系统里永远不会出现。X 可以当 1 用来把圈扩大，也可以当 0 不管；但它不能单独成圈，也不能被当成输出。例：$F(A,B,C)=\sum m(0,2,4)+d(6)$，不用 X 只能得 $A'C'+B'C'$；把 6 当 1 后，0、2、4、6 四格 C 恒为 0，直接得 $C'$，省掉一个门。变量超过 5 个就别手画了，交给工具或 Q-M 算法。

::: note 冒险，只说一句
A 与 A' 的路径延迟不同，切换瞬间可能冒出一个窄脉冲；卡诺图上多圈一个冗余的相邻圈，等于在电路里加冗余项，把这个空档盖住。
:::

## 练习

::: exercise 练习 1：用公式化简
把 $F=A'BC+AB'C+ABC'$ 化成最简形式，每一步写出所用公式，并用真值表核对。
::: answer
$$F=C(A'B+AB')+ABC'=C(A\oplus B)+C'\cdot AB$$

前两步用分配律把含 C 的两项提出 C，第三项保留；括号内正是异或的定义。若要求与或式，原式三项都是孤立最小项（m3、m5、m6），卡诺图上无法合并，**原式已是最简与或式**。

核对：它描述"恰好两个输入为 1"。注意它**不是** $A\oplus B\oplus C$：代 A=0、B=0、C=1，本题为 0，而异或为 1。
:::
:::

::: exercise 练习 2：三变量卡诺图
用卡诺图化简 $F(A,B,C)=\sum m(0,1,2,3,6,7)$。
::: answer
按格雷序填图：0、1、2、3 在 A=0 的上半区，6、7 在 A=1、B=1 的两格。

- 0、1、2、3 四格：A 恒为 0，得 $A'$。
- 2、3、6、7 四格：B 恒为 1，得 $B$。

两个圈盖住全部 1，所以 $F=A'+B$。验证：A=0 时 $A'=1$ 恒输出 1；A=1 时只剩 B=1 的 6、7 输出 1。
:::
:::

::: exercise 练习 3：只用与非门实现三输入或非
用德摩根写出 $Y=(A+B+C)'$，并给出只用与非门的实现方案与门数。
::: answer
德摩根：$(A+B+C)'=A'B'C'$。用与非门：每个输入各用一个与非门接成反相器（`(AA)'=A'`）得到 A'、B'、C'；再用一个三输入与非门得到 $(A'B'C')'=A+B+C$；最后再用一个与非门接成反相器，输出 A'B'C'。共 **5 个与非门**（3 个反相 + 1 个三输入与非 + 1 个反相）。
:::
:::

::: selfcheck 自检
- [ ] 我能默写与、或、非、与非、或非、异或的真值
- [ ] 我能用与非门分别做出非、与、或，并解释万能性
- [ ] 我能用吸收律、消去律、德摩根一步步化简并标出依据
- [ ] 我能画三变量与四变量卡诺图，按"1、2、4、8 格"规则圈组
- [ ] 我知道无关项可以当 1 扩大圈，但不能单独成圈或当输出
:::
