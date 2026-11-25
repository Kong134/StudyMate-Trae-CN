---
node: e8
title: 存储器与可编程逻辑
type: concept
duration: 70
---

## 先说结论

存储器就是"按地址取数据的表格"：给一个地址，它把对应那一行的若干位数据送到输出。**ROM** 的内容固定，断电不丢；**RAM** 可读可写，断电丢失。两者内部都是一个存储阵列，外加地址译码器——译码器负责"选中哪一行"，阵列负责"这一行存了什么"。

可编程逻辑器件（PLD）把"连线"变成可编程的开关：CPLD 用乘积项阵列，FPGA 用查找表（LUT）加触发器。它们让"一片芯片替代一板子 74 芯片"成为现实，也是现代数字设计的主流实现方式。

::: goal 本课目标
能区分 ROM 与 RAM 的主要类型，会根据容量算地址线和数据线，能看懂 ROM 的地址译码矩阵，能说出 LUT、CPLD、FPGA 的关系。
:::

## ROM 与 RAM 的分类

ROM 是只读存储器，断电后内容保留。按写入方式分几代：

- **掩膜 ROM**：出厂时把数据刻进芯片，便宜但改不了，适合大批量固定程序。
- **PROM**：用户可烧一次，靠熔断熔丝写 1，写完不能改。
- **EPROM**：用紫外线照射擦除，整片擦，擦写次数有限。
- **EEPROM**：电可擦，可以按字节改，方便但速度慢、寿命有限。
- **Flash**：电可擦、按块擦除，容量大、成本低，U 盘和固态盘都是它。

RAM 是随机读写存储器，断电丢失。它分两类：

- **SRAM**：一个存储单元用 6 个晶体管组成双稳态锁存器，速度快、不需要刷新，但面积大、成本高，常用在 CPU 缓存。
- **DRAM**：一个晶体管加一个电容，靠电容存电荷，密度高、便宜，但电荷会漏，需要周期性**刷新**，常用在主内存。SDRAM、DDR 都是 DRAM 的进化版。

| 类型 | 易失性 | 写入方式 | 典型用途 |
| --- | --- | --- | --- |
| Mask ROM | 非易失 | 出厂掩膜 | 固定程序、字库 |
| Flash | 非易失 | 电擦除，按块 | 固件、U 盘、SSD |
| SRAM | 易失 | 电写，随时 | 缓存、小容量高速缓冲 |
| DRAM | 易失 | 电写，需刷新 | 主内存 |

::: note "只读"是历史叫法
很多 ROM 其实是可写的（EPROM、Flash），只是写入比读取慢得多、次数有限。"ROM"更多表示"正常工作时以读为主"，不要理解成物理上绝对不能写。
:::

## 容量、地址线与地址译码

存储器的容量写成"字数 × 位数"，例如 8K×8 表示 8192 个字，每个字 8 位。总比特数是两者相乘：$8192 \times 8 = 65536$ 位。

地址线数量由字数决定：$2^n$ 个字需要 n 根地址线。8K = $2^{13}$，所以要 13 根地址线；数据线数量就是每个字的位数，8K×8 需要 8 根数据线。反过来，给 11 根地址线、8 根数据线，容量就是 $2^{11} \times 8 = 2K \times 8 = 16K$ 位。

地址译码器把 n 位地址翻译成 $2^n$ 根字线，一次只让一根有效。下图的 8×4 ROM 用 3-8 译码器：地址 000 选中第 0 行，地址 111 选中第 7 行；被选中那一行的 4 个存储单元把数据送到 D3–D0。

<svg class="diagram" viewBox="0 0 760 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="8×4 ROM 的地址译码矩阵：3-8 译码器选中一行，行内四位送到数据线">
  <g font-family="-apple-system, 'Microsoft YaHei', sans-serif" font-size="13">
    <text class="label" x="8" y="22">8×4 ROM：3 位地址经译码器选中一根字线，字线上的 4 位就是该地址的数据</text>
    <text class="label" x="26" y="116">A2</text>
    <text class="label" x="26" y="156">A1</text>
    <text class="label" x="26" y="196">A0</text>
    <path class="arrow" d="M56 112H150"/>
    <path class="arrow" d="M56 152H150"/>
    <path class="arrow" d="M56 192H150"/>
    <path class="arrowhead" d="M150 112l-7-4v8z"/>
    <path class="arrowhead" d="M150 152l-7-4v8z"/>
    <path class="arrowhead" d="M150 192l-7-4v8z"/>
    <rect class="box acc" x="150" y="90" width="110" height="130" rx="6"/>
    <text class="label" x="205" y="146" text-anchor="middle">3-8 译码器</text>
    <text class="sub" x="205" y="168" font-size="10.5" text-anchor="middle">每根字线对应一行</text>
    <path class="arrow" d="M260 100H340"/>
    <path class="arrow" d="M260 120H340"/>
    <path class="arrow" d="M260 140H340"/>
    <path class="arrow" d="M260 160H340"/>
    <path class="arrow" d="M260 180H340"/>
    <path class="arrow" d="M260 200H340"/>
    <path class="arrow" d="M260 220H340"/>
    <path class="arrow" d="M260 240H340"/>
    <path class="arrowhead" d="M340 100l-7-4v8z"/>
    <path class="arrowhead" d="M340 120l-7-4v8z"/>
    <path class="arrowhead" d="M340 140l-7-4v8z"/>
    <path class="arrowhead" d="M340 160l-7-4v8z"/>
    <path class="arrowhead" d="M340 180l-7-4v8z"/>
    <path class="arrowhead" d="M340 200l-7-4v8z"/>
    <path class="arrowhead" d="M340 220l-7-4v8z"/>
    <path class="arrowhead" d="M340 240l-7-4v8z"/>
    <rect class="box" x="340" y="90" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="104" font-size="10">0</text>
    <text class="label" x="372" y="104" text-anchor="middle">1</text><text class="label" x="437" y="104" text-anchor="middle">0</text><text class="label" x="502" y="104" text-anchor="middle">1</text><text class="label" x="567" y="104" text-anchor="middle">0</text>
    <rect class="box" x="340" y="110" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="124" font-size="10">1</text>
    <text class="label" x="372" y="124" text-anchor="middle">0</text><text class="label" x="437" y="124" text-anchor="middle">1</text><text class="label" x="502" y="124" text-anchor="middle">1</text><text class="label" x="567" y="124" text-anchor="middle">0</text>
    <rect class="box" x="340" y="130" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="144" font-size="10">2</text>
    <text class="label" x="372" y="144" text-anchor="middle">1</text><text class="label" x="437" y="144" text-anchor="middle">1</text><text class="label" x="502" y="144" text-anchor="middle">0</text><text class="label" x="567" y="144" text-anchor="middle">0</text>
    <rect class="box" x="340" y="150" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="164" font-size="10">3</text>
    <text class="label" x="372" y="164" text-anchor="middle">0</text><text class="label" x="437" y="164" text-anchor="middle">0</text><text class="label" x="502" y="164" text-anchor="middle">1</text><text class="label" x="567" y="164" text-anchor="middle">1</text>
    <rect class="box" x="340" y="170" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="184" font-size="10">4</text>
    <text class="label" x="372" y="184" text-anchor="middle">1</text><text class="label" x="437" y="184" text-anchor="middle">0</text><text class="label" x="502" y="184" text-anchor="middle">0</text><text class="label" x="567" y="184" text-anchor="middle">1</text>
    <rect class="box" x="340" y="190" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="204" font-size="10">5</text>
    <text class="label" x="372" y="204" text-anchor="middle">0</text><text class="label" x="437" y="204" text-anchor="middle">1</text><text class="label" x="502" y="204" text-anchor="middle">0</text><text class="label" x="567" y="204" text-anchor="middle">1</text>
    <rect class="box" x="340" y="210" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="224" font-size="10">6</text>
    <text class="label" x="372" y="224" text-anchor="middle">1</text><text class="label" x="437" y="224" text-anchor="middle">1</text><text class="label" x="502" y="224" text-anchor="middle">1</text><text class="label" x="567" y="224" text-anchor="middle">0</text>
    <rect class="box" x="340" y="230" width="260" height="20" rx="2"/>
    <text class="sub" x="350" y="244" font-size="10">7</text>
    <text class="label" x="372" y="244" text-anchor="middle">0</text><text class="label" x="437" y="244" text-anchor="middle">0</text><text class="label" x="502" y="244" text-anchor="middle">0</text><text class="label" x="567" y="244" text-anchor="middle">1</text>
    <text class="sub" x="350" y="272" font-size="10">地址</text>
    <text class="label" x="372" y="272" text-anchor="middle">D3</text>
    <text class="label" x="437" y="272" text-anchor="middle">D2</text>
    <text class="label" x="502" y="272" text-anchor="middle">D1</text>
    <text class="label" x="567" y="272" text-anchor="middle">D0</text>
    <path class="arrow" d="M372 250V320"/>
    <path class="arrow" d="M437 250V320"/>
    <path class="arrow" d="M502 250V320"/>
    <path class="arrow" d="M567 250V320"/>
    <path class="arrowhead" d="M372 320l-4-7h8z"/>
    <path class="arrowhead" d="M437 320l-4-7h8z"/>
    <path class="arrowhead" d="M502 320l-4-7h8z"/>
    <path class="arrowhead" d="M567 320l-4-7h8z"/>
    <text class="label" x="372" y="342" text-anchor="middle">D3</text>
    <text class="label" x="437" y="342" text-anchor="middle">D2</text>
    <text class="label" x="502" y="342" text-anchor="middle">D1</text>
    <text class="label" x="567" y="342" text-anchor="middle">D0</text>
    <text class="sub" x="8" y="370" font-size="11.5">行号 0–7 就是地址 000–111；被选中的行把 4 位送到 D3–D0，未被选中的行不驱动数据线</text>
    <text class="sub" x="8" y="388" font-size="11.5">ROM 的真值是"烧录"进去的：改内容要重烧，改地址译码只需换接法</text>
  </g>
</svg>

地址译码有两种常见结构：**线性译码**用一级译码器直接产生全部字线，适合小容量；**二维译码**把地址分成行、列两组，先选行再选列，减少译码器数量，DRAM 里普遍这么做。片选（CS）则是把多片存储器拼成更大容量：高位地址接译码器，译码器输出接各片的 CS，低位地址接片内地址线。

::: example 例子：拼出 32K×8
用 8 片 4K×8 的 RAM，每片需要 12 根地址线（$2^{12}=4096$）。把低 12 位地址并联到所有片，高 3 位送 3-8 译码器，译码器的 8 个输出分别接 8 片的片选。这样任意时刻只选中一片，总容量 8×4K×8=32K×8。
:::

## 用 ROM 实现组合逻辑

ROM 的地址译码器本质上是一个**与阵列**：每个地址对应一个最小项。存储阵列是一个**或阵列**：每根数据线把该列上为 1 的单元或起来。所以 ROM 天生就是"与-或"结构，可以直接实现任意组合逻辑。

做法：把输入变量接地址线，把真值表中输出为 1 的那些行写入 1，其余行写 0。例如 $F(A,B,C)=\sum m(1,3,5,7)$，就在地址 1、3、5、7 的行写 1，其余写 0。读地址时，F 就出现在数据线上。因为 1、3、5、7 都满足 C=1，这个函数其实就是 C——但 ROM 不关心你化不化简，它只忠实查表。

::: key ROM 与 LUT 的共同点
ROM 是"用地址查表"，LUT 是"用输入查表"，本质是同一件事。FPGA 里的 LUT4 就是一张 16 项的 1 位 ROM：4 个输入当地址，16 个存储单元存真值表，输出就是函数值。
:::

## FPGA 与 CPLD：把连线变成程序

**CPLD**（复杂可编程逻辑器件）内部是若干宏单元，每个宏单元包含一个乘积项阵列（与阵列）和一个触发器。它基于 EEPROM 工艺，掉电不丢配置，时序可预测，适合做地址译码、状态机、接口胶合逻辑，容量一般较小。

**FPGA**（现场可编程门阵列）内部是大量可编程逻辑块，每块的核心是 **LUT** 加触发器，块与块之间有可编程互连。LUT4 有 4 个输入、16 个存储位，能实现任意 4 输入布尔函数——因为 16 位正好存下 4 输入真值表的 16 个输出值。更大函数靠多级 LUT 拼。

| 项目 | CPLD | FPGA |
| --- | --- | --- |
| 基本单元 | 宏单元（乘积项） | LUT + 触发器 |
| 配置存储 | EEPROM，非易失 | SRAM，易失（需外部 Flash 加载） |
| 容量 | 小到中 | 中到大 |
| 时序 | 固定、可预测 | 依赖布局布线，需时序约束 |
| 典型用途 | 胶合逻辑、译码 | 信号处理、协议、SoC 原型 |

FPGA 的开发流程是：写 HDL（Verilog/VHDL）→ 综合成 LUT 和触发器 → 布局布线 → 生成比特流 → 下载到芯片。综合工具会把你的 `assign y = a & b | c;` 翻译成若干 LUT 的连接，你不需要手工画门电路。

::: warn FPGA 的配置不是"程序" 
FPGA 的 SRAM 配置掉电即失，所以大多数开发板配一片配置 Flash，上电时先把它搬进 FPGA。调试时下载的比特流只存在于 SRAM，断电就没了。别把"下载成功"当成"已经固化"。
:::

## 练习

::: exercise 练习 1：算容量和地址线
一片 2K×8 的存储器，总比特数是多少？需要多少根地址线、多少根数据线？
::: answer
总比特数：$2048 \times 8 = 16384$ 位 = 16K 位。

地址线：$2^{11}=2048$，所以需要 **11 根**地址线。数据线：每个字 8 位，需要 **8 根**。

注意"2K×8"里的 2K 是字数，不是总比特数；总比特数要再乘 8。
:::
:::

::: exercise 练习 2：ROM 查表
用 8×1 的 ROM 实现 $F(A,B,C)=\sum m(1,3,5,7)$，地址 A2A1A0=ABC。哪些行写 1？输出功能是什么？
::: answer
地址 1、3、5、7 这四行写 1，其余（0、2、4、6）写 0。

这四个地址的二进制分别是 001、011、101、111，C 位都为 1，所以 $F=C$。ROM 照样能实现，只是用了 8 个存储位来做一根线的工作——这就是"先化简再选器件"的意义。
:::
:::

::: exercise 练习 3：LUT4 能装多少种函数
一个 4 输入 LUT 有多少个存储位？能实现多少种不同的 4 输入逻辑函数？
::: answer
4 个输入有 $2^4=16$ 种组合，所以 LUT 有 **16 个存储位**，每位对应一个输入组合的输出值。

16 位可以组成 $2^{16}=65536$ 种不同的真值表，因此 LUT4 能实现 **65536 种** 4 输入逻辑函数（包括常 0 和常 1）。任何 4 输入以内的函数都能装进去，这也是 FPGA 通用性的来源。
:::
:::

::: exercise 练习 4：SRAM 与 DRAM
SRAM 和 DRAM 各用什么存 1 位？为什么 DRAM 需要刷新？
::: answer
SRAM 用 6 个晶体管组成双稳态锁存器，靠正反馈锁住 0/1，不需要刷新。

DRAM 用 1 个晶体管加 1 个电容，靠电容上的电荷存 1 位；电容会通过漏电流慢慢放电，所以必须周期性刷新（读出再写回）。代价是控制复杂，收益是密度高、成本低，所以主内存用 DRAM，缓存用 SRAM。
:::
:::

::: selfcheck 自检
- [ ] 我能说出 ROM 的四种写入方式和 RAM 的两大类
- [ ] 我能由"字数×位数"算总比特数、地址线和数据线
- [ ] 我能看懂 8×4 ROM 的译码矩阵，指出某地址对应哪一行
- [ ] 我能用 ROM 的"与阵列+或阵列"解释它为什么能实现组合逻辑
- [ ] 我能说出 LUT4 的 16 个存储位和 CPLD/FPGA 的配置差别
:::
