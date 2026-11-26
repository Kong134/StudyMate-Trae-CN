---
node: e3
title: 逻辑门与电平特性
type: concept
duration: 60
---

## 先说结论

逻辑表达式是纸上的东西，门电路才是能通电工作的实现。同样一个反相器，用 CMOS 做是"一只 P 管上拉、一只 N 管下拉"，用 TTL 做是"电流从输入端流出、三极管推挽输出"。两者的逻辑功能一样，但电平、功耗、扇出、速度完全不同。

学门电路不要背内部结构图，先抓住四件事：**高低电平怎么定义、输出能带几个输入、信号从输入到输出延迟多久、静态和动态功耗各是多少**。这四件事决定了你的电路能不能稳定工作。

::: goal 本课目标
能画出 CMOS 反相器并说明上拉/下拉的互补过程，会算高低电平噪声容限与扇出，能说出 TTL 与 CMOS 的差别和互连注意事项。
:::

## CMOS 反相器：一只上拉，一只下拉

CMOS 反相器的结构只有两只管子：PMOS 的源极接 VDD，NMOS 的源极接 GND，两只管子的栅极连在一起作为输入 A，漏极连在一起作为输出 Y。

PMOS 在栅极低于源极时导通，所以输入 A=0 时它导通，把 Y 拉到 VDD，输出高电平；此时 NMOS 的栅极是 0，不导通。输入 A=1 时反过来：PMOS 截止，NMOS 导通，把 Y 拉到 GND，输出低电平。任一时刻只有一只管子导通，VDD 到 GND 之间没有直通路径，这就是"互补"的含义。

<svg class="diagram" viewBox="0 0 760 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CMOS 反相器：PMOS 上拉、NMOS 下拉，栅极并联为输入，漏极并联为输出">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="22">CMOS 反相器：上拉与下拉互补，同一时刻只有一只管子导通</text>
    <path class="arrow" d="M300 50H500"/>
    <text class="label" x="508" y="55">VDD（+5V）</text>
    <rect class="box" x="330" y="76" width="110" height="54" rx="6"/>
    <text class="label" x="385" y="100" text-anchor="middle">PMOS 上拉</text>
    <text class="sub" x="385" y="119" font-size="10.5" text-anchor="middle">栅极低电平导通</text>
    <path class="arrow" d="M385 50V76"/>
    <path class="arrow" d="M385 130V200"/>
    <rect class="box" x="330" y="200" width="110" height="54" rx="6"/>
    <text class="label" x="385" y="224" text-anchor="middle">NMOS 下拉</text>
    <text class="sub" x="385" y="243" font-size="10.5" text-anchor="middle">栅极高电平导通</text>
    <path class="arrow" d="M385 254V300"/>
    <path class="arrow" d="M300 300H500"/>
    <text class="label" x="508" y="305">GND（0V）</text>
    <path class="arrow" d="M190 165H260"/>
    <path class="arrow" d="M260 103V227"/>
    <path class="arrow" d="M260 103H330"/>
    <path class="arrow" d="M260 227H330"/>
    <path class="arrowhead" d="M330 103l-7-4v8z"/>
    <path class="arrowhead" d="M330 227l-7-4v8z"/>
    <text class="label" x="170" y="170">A</text>
    <path class="arrow" d="M385 165H620"/>
    <circle class="arrowhead" cx="385" cy="165" r="4"/>
    <path class="arrowhead" d="M620 165l-7-4v8z"/>
    <text class="label" x="628" y="170">Y</text>
    <text class="label" x="500" y="100">A=0：PMOS 通、NMOS 断</text>
    <text class="label" x="500" y="122">Y 被上拉到 VDD → 1</text>
    <text class="label" x="500" y="220">A=1：PMOS 断、NMOS 通</text>
    <text class="label" x="500" y="242">Y 被下拉到 GND → 0</text>
    <text class="sub" x="8" y="342" font-size="11.5">互补的收益：VDD 到 GND 没有直通路径，静态电流只有漏电流（纳安级）</text>
    <text class="sub" x="8" y="364" font-size="11.5">真值表：A=0 → Y=1；A=1 → Y=0。输出永远是被某只管子"主动"拉到某个电平</text>
  </g>
</svg>

注意最后一句：**输出永远被主动拉高或拉低**，不会悬空。这带来一个副作用——两个 CMOS 输出不能直接接在一起，一个要拉高、一个要拉低时会形成直通大电流，甚至烧管子。需要共享一条线时，用三态门或开漏输出。

::: warn 不用的 CMOS 输入必须接固定电平
CMOS 栅极输入阻抗极高，悬空的输入会被电荷慢慢充到一个不确定的中间电平，可能让 PMOS 和 NMOS 同时半开，静态电流骤增、电路乱跳。多余输入一律接 VDD 或 GND，不能"放着不管"。
:::

## 从反相器到与非门

把反相器的管子换成一串一并联，就得到其他门：

- **与非门**：两只 PMOS 并联做上拉，两只 NMOS 串联做下拉。只有 A、B 都为 1 时，两只 NMOS 都导通，输出才被拉到 0；其余情况至少一只 PMOS 导通，输出为 1。
- **或非门**：两只 PMOS 串联做上拉，两只 NMOS 并联做下拉。只有 A、B 都为 0 时输出才为 1。
- 串联对应"与"，并联对应"或"；上拉网络和下拉网络正好互补，这是 CMOS 门设计的固定套路。

因为与非门、或非门结构简单、速度快，标准单元库里用得最多。需要与门时，通常用"与非门 + 反相器"，而不是专门造一个与门——多一级反相器换来更规整的版图。

## TTL：另一种思路

TTL 用双极型三极管，74 系列是代表。74LS 系列输入级是一个多发射极三极管（本质是与门输入），输入端为低电平时会**向外流出电流**（约 0.4 mA），为高电平时几乎不吸电流；输出级是推挽（图腾柱），高电平约 3.4 V，低电平约 0.2 V。

TTL 的速度和驱动能力不错，但静态功耗大：每个门几毫瓦到几十毫瓦，因为三极管一直有电流。CMOS 静态功耗近乎为零，但每次翻转都要给栅极电容充放电，动态功耗 $P=CV^2f$ 随频率线性上升。

| 项目 | 74LS（TTL） | 74HC（CMOS） |
| --- | --- | --- |
| 电源 | 5 V | 2–6 V |
| 高电平 VOH | 约 3.4 V | 约 VDD−0.1 V |
| 低电平 VOL | 约 0.2 V | 约 0.1 V |
| 输入阈值 VIH / VIL | 约 2.0 V / 0.8 V | 74HC：约 3.5 V / 1.5 V（5 V）；74HCT：2.0 V / 0.8 V |
| 静态电流 | 每门数毫安 | 纳安级 |
| 输入悬空 | 等效为高电平 | 禁止，必须接固定电平 |
| 输出并联 | 禁止 | 禁止（三态/开漏除外） |

::: note TTL 与 CMOS 互连
5 V TTL 输出高电平约 3.4 V，只有输入端标了 5 V 兼容（5V-tolerant）的 3.3 V CMOS 器件才允许这样直接接；普通 3.3 V 器件会超出它的电源轨，必须电平转换。反方向，3.3 V CMOS 输出高电平约 3.2 V，5 V TTL 的 VIH 通常只要 2.0 V，能识别。真正麻烦的是 5 V CMOS 输入：它的 VIH 可能是 3.5 V，TTL 的 3.4 V 就卡在边缘，需要电平转换。看数据手册，不要凭"都是 5 V"想当然。
:::

## 五个必须记住的参数

1. **VOH / VOL**：输出高/低电平的保证值。
2. **VIH / VIL**：输入能识别为高/低的最小/最大电平。
3. **噪声容限**：高电平容限 $V_{OH}-V_{IH}$，低电平容限 $V_{IL}-V_{OL}$。它告诉你信号上叠加多少噪声还能正常工作。
4. **扇出**：输出能带多少个同类输入。分别用高电平电流和低电平电流算，取小的那个：$\min(I_{OH}/I_{IH},\ I_{OL}/I_{IL})$。
5. **传输延迟 tpd**：输入跳变到输出跳变的时间，决定最高工作频率。多级门级联时延迟会累加，这也是后面异步计数器不可靠的根源。

::: example 例子：算噪声容限
以 5 V CMOS（74HCT 系列，输入阈值按 TTL 兼容）为例：$V_{OH}=4.4$ V、$V_{IH}=2.0$ V，则高电平噪声容限是 2.4 V；$V_{OL}=0.1$ V、$V_{IL}=0.8$ V，低电平噪声容限是 0.7 V。低电平容限更小，说明这条链路对"往高抬"的干扰更敏感。
:::

## 练习

::: exercise 练习 1：反相器的工作状态
CMOS 反相器输入 A=1 时，哪只管子导通？输出 Y 是什么电平？如果两只管子同时导通，会发生什么？
::: answer
A=1 时 PMOS 栅源电压不够，截止；NMOS 栅极为高，导通，把 Y 拉到 GND，输出 0。

若两只同时导通，VDD 到 GND 之间形成低阻直通路径，电流会很大，轻则功耗暴涨、输出电平不确定，重则烧毁管子。互补结构的设计目的就是避免这种状态。
:::
:::

::: exercise 练习 2：噪声容限
某 5 V CMOS（74HCT，TTL 电平阈值）门 $V_{OH}=4.4$ V、$V_{IH}=2.0$ V、$V_{OL}=0.1$ V、$V_{IL}=0.8$ V，求高、低电平噪声容限。
::: answer
高电平：$4.4-2.0=2.4$ V。

低电平：$0.8-0.1=0.7$ V。

两个数取小的是 0.7 V；只要地线或串扰把低电平抬高不超过 0.7 V，下一级仍能认出 0。
:::
:::

::: exercise 练习 3：扇出
某门 $I_{OH}=0.4$ mA、$I_{OL}=8$ mA，负载门 $I_{IH}=20$ μA、$I_{IL}=0.4$ mA。扇出是多少？
::: answer
高电平：$0.4\text{ mA}/20\text{ μA}=400/20=20$。

低电平：$8\text{ mA}/0.4\text{ mA}=20$。

两边都等于 20，扇出取小值仍是 **20**。实际设计要留余量，通常不超过 10。
:::
:::

::: exercise 练习 4：CMOS 功耗
为什么 CMOS 静态功耗很低，频率升高后功耗却明显变大？
::: answer
静态时只有一只管子导通，VDD 到 GND 没有直通路径，电流只有漏电流，所以功耗极低。

翻转时栅极电容要反复充放电，功耗 $P=CV^2f$，与频率成正比；频率越高，每秒充放电次数越多，动态功耗越大。另外，输入处于中间电平时可能出现两管同时半开，也会带来额外功耗。
:::
:::

::: selfcheck 自检
- [ ] 我能画出 CMOS 反相器并说清 A=0、A=1 时哪只管子导通
- [ ] 我知道 CMOS 输出不能直接并联，多余输入不能悬空
- [ ] 我能用 VOH/VIH、VIL/VOL 算两个噪声容限
- [ ] 我能用 IOH/IIH、IOL/IIL 算扇出并取小值
- [ ] 我能说出 TTL 与 CMOS 在电平、功耗、输入处理上的三点差别
:::
