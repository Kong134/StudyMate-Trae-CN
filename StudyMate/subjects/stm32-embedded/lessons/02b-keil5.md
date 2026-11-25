---
node: s2b
title: Keil uVision5（MDK5）操作全流程
type: practice
duration: 120
---

## 这一课要解决的问题

::: goal
读完并动手做完，你能：看懂 Keil 界面的五个区域；从零建出一个 STM32F103C8T6 的标准库工程；把 `Options for Target` 里五个关键页配对，并知道每一项配错会看到什么现象；编译、下载、打断点、看变量；遇到 5 类最常见的报错能自己定位；会用补全、书签、条件断点、软件仿真、SWO 打印、多 Target 这些日常提效功能。
:::

::: note 和已有课件的关系
第 2 课走的是 **CubeIDE + HAL**，本课讲 **Keil MDK5 + 标准库**。原因很实际：你对照的江协科技视频、大部分学校教材和面试现场用的都是 Keil，你得会开这台"车"。

两者的**底层机制完全相同**（启动文件、时钟、GPIO 寄存器、SWD 下载），差别只在软件界面和函数名。所以本课不会重复第 2 课的原理，只讲"在 Keil 里怎么点"。课程主线仍然是 HAL，Keil 作为并行技能掌握即可。
:::

---

## 1. 先认路：Keil 界面就五个区域

打开 Keil，别急着点。先记住这五块地方分别干什么，后面所有操作都只是在这五块之间来回。

<svg class="diagram" viewBox="0 0 900 430" xmlns="http://www.w3.org/2000/svg">
  <rect class="box" x="10" y="10" width="880" height="44" rx="8"/>
  <text class="label" x="26" y="38" font-size="13">① 菜单栏 + 工具栏（File / Edit / View / Project / Flash / Debug，图标：编译、下载、魔术棒）</text>

  <rect class="box acc" x="10" y="64" width="220" height="270" rx="8"/>
  <text class="label" x="26" y="90" font-size="13">② Project 窗口</text>
  <text class="sub" x="26" y="114" font-size="11">Target 1</text>
  <text class="sub" x="38" y="136" font-size="11">├ Start（启动文件、内核）</text>
  <text class="sub" x="38" y="158" font-size="11">├ Library（标准库 .c）</text>
  <text class="sub" x="38" y="180" font-size="11">└ User（main.c、delay.c）</text>
  <text class="sub" x="26" y="212" font-size="11">双击文件名 → 在右侧打开</text>
  <text class="sub" x="26" y="234" font-size="11">右键 Group → 添加/删除文件</text>
  <text class="sub" x="26" y="256" font-size="11">文件名前有红叉 = 找不到文件</text>

  <rect class="box" x="240" y="64" width="650" height="200" rx="8"/>
  <text class="label" x="256" y="90" font-size="13">③ 编辑区（代码、语法高亮、行号、折叠）</text>
  <text class="sub" x="256" y="120" font-size="11">F12 跳到函数/变量定义；Ctrl+F 当前文件查找；Ctrl+Shift+F 全工程查找</text>
  <text class="sub" x="256" y="146" font-size="11">行号左侧灰色区域点一下 = 加断点（红色圆点）</text>
  <text class="sub" x="256" y="172" font-size="11">中文注释乱码？Edit → Configuration → Encoding 改成 UTF-8</text>

  <rect class="box" x="240" y="274" width="650" height="140" rx="8"/>
  <text class="label" x="256" y="300" font-size="13">④ Build Output 编译输出窗口</text>
  <text class="sub" x="256" y="326" font-size="11">Build started...</text>
  <text class="sub" x="256" y="348" font-size="11">compiling main.c...  linking...  Program Size: Code=... RO-data=... RW-data=... ZI-data=...</text>
  <text class="sub" x="256" y="370" font-size="11">0 Error(s), 0 Warning(s)  ← 只有这一行才是"通过了"</text>
  <text class="sub" x="256" y="392" font-size="11">双击报错那一行，光标自动跳到出错代码</text>

  <rect class="box" x="10" y="344" width="220" height="70" rx="8"/>
  <text class="label" x="26" y="370" font-size="13">⑤ 状态栏</text>
  <text class="sub" x="26" y="394" font-size="11">光标行列号 / 编译状态 / 芯片型号</text>

  <text class="sub" x="240" y="424" font-size="10.5">新手只需要盯住 ②④ 两块：文件加没加进工程、编译有没有 0 Error。</text>
</svg>

::: key 一句话记住
Keil 的工程 = **一组文件 + 一份配置文件（.uvprojx）**。界面上你做的所有事，本质只有两件：**把文件挂进工程组**，**在魔术棒里告诉编译器去哪找头文件、用什么芯片**。
:::

---

## 2. Keil 到底替你做了什么

只写一个 `main.c` 是烧不进芯片的，也不该这么烧。中间要过四道工序：

<svg class="diagram" viewBox="0 0 900 220" xmlns="http://www.w3.org/2000/svg">
  <rect class="box acc" x="10" y="50" width="160" height="90" rx="8"/>
  <text class="label" x="26" y="78" font-size="12">你写的源码</text>
  <text class="sub" x="26" y="102" font-size="11">main.c / delay.c</text>
  <text class="sub" x="26" y="122" font-size="11">.c → 编译</text>

  <line class="arrow" x1="172" y1="95" x2="212" y2="95"/>
  <text class="sub" x="172" y="86" font-size="10">cc</text>

  <rect class="box" x="214" y="50" width="150" height="90" rx="8"/>
  <text class="label" x="230" y="78" font-size="12">目标文件 .o</text>
  <text class="sub" x="230" y="102" font-size="11">机器码，还不能跑</text>
  <text class="sub" x="230" y="122" font-size="11">（地址没定）</text>

  <line class="arrow" x1="366" y1="95" x2="406" y2="95"/>
  <text class="sub" x="362" y="86" font-size="10">link</text>

  <rect class="box acc" x="408" y="40" width="190" height="110" rx="8"/>
  <text class="label" x="424" y="66" font-size="12">链接器打包</text>
  <text class="sub" x="424" y="90" font-size="11">+ startup_stm32f10x_md.s</text>
  <text class="sub" x="424" y="110" font-size="11">+ 标准库 .c 编译产物</text>
  <text class="sub" x="424" y="130" font-size="11">+ 分散加载（地址分配）</text>

  <line class="arrow" x1="600" y1="95" x2="640" y2="95"/>

  <rect class="box" x="642" y="50" width="120" height="90" rx="8"/>
  <text class="label" x="658" y="78" font-size="12">.hex / .axf</text>
  <text class="sub" x="658" y="102" font-size="11">最终固件</text>
  <text class="sub" x="658" y="122" font-size="11">可烧进 Flash</text>

  <line class="arrow" x1="764" y1="95" x2="800" y2="95"/>

  <rect class="box" x="802" y="50" width="88" height="90" rx="8"/>
  <text class="label" x="814" y="78" font-size="12">ST-Link</text>
  <text class="sub" x="814" y="102" font-size="11">SWD 写 Flash</text>
  <text class="sub" x="814" y="122" font-size="11">0x0800_0000</text>

  <text class="sub" x="10" y="190" font-size="11">启动文件负责：定义向量表、把栈顶设到 RAM 末尾、复位后调用 SystemInit 再跳 main。没有它，链接器不知道"第一条指令放哪"。</text>
  <text class="sub" x="10" y="212" font-size="11">标准库负责：把"写寄存器"包装成 GPIO_Init() 这种函数。你少加一个 .c，链接阶段就报 Undefined symbol。</text>
</svg>

::: warn 为什么第 3 节的"加文件"必须加全
编译只检查**语法**，链接才检查**有没有实现**。所以少加 `stm32f10x_gpio.c` 时，编译可能一个错都不报，一到链接就 `Undefined symbol GPIO_Init`。看到这类报错，先回 Project 窗口数文件，而不是去改代码。
:::

---

## 3. 从零建一个 F103 工程

### 3.1 准备文件：先建三个文件夹

在 `D:\mcu\stm32_keil_led\` 下手工建三个目录，把 ST 标准外设库（`STM32F10x_StdPeriph_Lib_V3.5.0`，江协资料包里也有）里的文件按下面这张表拷进去。

| 目录 | 放什么文件 | 从库里哪里拷 |
| --- | --- | --- |
| `Start/` | `startup_stm32f10x_md.s` | `Libraries\CMSIS\CM3\DeviceSupport\ST\STM32F10x\startup\arm\` |
| `Start/` | `stm32f10x.h`、`system_stm32f10x.c`、`system_stm32f10x.h` | `Libraries\CMSIS\CM3\DeviceSupport\ST\STM32F10x\` |
| `Start/` | `core_cm3.c`、`core_cm3.h` | `Libraries\CMSIS\CM3\CoreSupport\` |
| `Library/` | `stm32f10x_gpio.c/.h`、`stm32f10x_rcc.c/.h`、`misc.c/.h` | `Libraries\STM32F10x_StdPeriph_Driver\src\` 与 `inc\` |
| `User/` | `main.c`、`delay.c`、`delay.h` | 自己写（见 3.4） |

::: note 文件名里的 md 是什么意思
`startup_stm32f10x_**md**.s` 的 `md` = medium density（中容量），对应 Flash 64~128KB。F103C8T6 是 64KB，正属于中容量。

选错成 `hd`（大容量 256KB 以上）或 `ld`（小容量 16~32KB）的后果：内存映射和中断向量数量不对，常见现象是**能编译、能下载、程序跑飞或进 HardFault**。这个坑很隐蔽，因为编译不报错。
:::

### 3.2 新建工程

1. `Project → New uVision Project...`
2. 选到 `D:\mcu\stm32_keil_led\`，工程名填 `stm32_keil_led`，保存。生成 `stm32_keil_led.uvprojx`（这就是以后双击打开的文件）。
3. 弹窗选芯片：展开 `STMicroelectronics → STM32F1 Series → STM32F103 → STM32F103C8`，点 OK。
   - 如果列表里没有 STM32F1 系列，说明缺器件包：点弹窗里的 `Packs` 标签，安装 `Keil::STM32F1xx_DFP`。
4. 接着弹 `Manage Run-Time Environment`（RTE）：**什么都不勾，直接 OK**。我们要手动加标准库文件，不用它自动生成的 CMSIS 组件。

::: warn 路径里不要有中文和空格
`D:\我的工程\stm32 led\` 这种路径会让 Keil 的编译器和链接器读不到文件，报 `cannot open source input file`，而文件明明在那里。全英文、无空格最稳。
:::

### 3.3 建分组、挂文件

在 Project 窗口右键 `Target 1 → Manage Project Items...`（或点工具栏那个"三个方块"图标）：

- Groups 里新建三个：`Start`、`Library`、`User`；
- 选中 `Start` 组，点右侧 `Add Files`，把 `Start\` 下 6 个文件全加进去；
- 同理把 `Library\` 下 6 个文件加进 `Library` 组，`User\` 下 3 个加进 `User` 组；
- OK。

::: note 也可以在组上右键 Add Existing Files
效果一样。区别是 `Manage Project Items` 能一次性改分组结构，适合建工程时用；单个补文件时右键更快。
:::

### 3.4 三个源文件（完整代码）

**文件：`User\delay.h`**

```c
#ifndef __DELAY_H
#define __DELAY_H

#include "stm32f10x.h"

/* 粗略毫秒延时，参数是毫秒数 */
void Delay_ms(uint32_t ms);
void Delay_us(uint32_t us);

#endif
```

**文件：`User\delay.c`**

```c
#include "delay.h"

/*
 * 粗略延时：靠空循环消耗时间，不精确。
 * 72MHz 主频下实测约 7200 次循环 ≈ 1ms，
 * 换主频要重新标定。精确延时在 s6（SysTick）里做。
 */
void Delay_ms(uint32_t ms)
{
    uint32_t i;
    while (ms--)
    {
        for (i = 0; i < 7200; i++)
        {
            __NOP();          /* 空操作，防止编译器把空循环优化掉 */
        }
    }
}

void Delay_us(uint32_t us)
{
    uint32_t i;
    while (us--)
    {
        for (i = 0; i < 7; i++)
        {
            __NOP();
        }
    }
}
```

**文件：`User\main.c`**

```c
#include "stm32f10x.h"
#include "delay.h"

int main(void)
{
    GPIO_InitTypeDef GPIO_InitStructure;              /* GPIO 配置结构体，先声明 */

    /* 第 1 步：开时钟。GPIOC 挂在 APB2 上，不先开时钟，后面写寄存器全部无效 */
    RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOC, ENABLE);

    /* 第 2 步：填配置。PC13 推挽输出 */
    GPIO_InitStructure.GPIO_Pin   = GPIO_Pin_13;      /* 要配的引脚 */
    GPIO_InitStructure.GPIO_Mode  = GPIO_Mode_Out_PP; /* 推挽输出（能输出高低电平） */
    GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz; /* 输出翻转速度 */
    GPIO_Init(GPIOC, &GPIO_InitStructure);            /* 把配置写进寄存器 */

    /* 第 3 步：先熄灭。蓝板 LED 是低电平点亮，所以先给高电平 */
    GPIO_SetBits(GPIOC, GPIO_Pin_13);

    while (1)
    {
        GPIO_ResetBits(GPIOC, GPIO_Pin_13);            /* 低电平 → 灯亮 */
        Delay_ms(500);
        GPIO_SetBits(GPIOC, GPIO_Pin_13);              /* 高电平 → 灯灭 */
        Delay_ms(500);
    }
}
```

::: note 为什么 PC13 是低电平点亮
蓝板上的 LED 一端接 3.3V，另一端接 PC13。PC13 输出 0V 时，两端有 3.3V 压差，电流流过 LED → 亮；输出 3.3V 时两端电压相等，没有电流 → 灭。这是硬件接法决定的，不是软件习惯。

另外 PC13/14/15 在 F103 手册里属于**低驱动引脚**（最大 3mA、2MHz），演示点灯用 50MHz 没问题，但正式产品里别用它驱动大电流负载。
:::

---

## 4. 魔术棒：Options for Target 五个关键页

点工具栏那个**魔术棒**图标（或 `Alt+F7`），或右键 `Target 1 → Options for Target`。这里有 10 个标签页，**新手只需要配对下面五个**，其余保持默认。

### 4.1 Target 页

| 设置项 | 设成什么 | 为什么 | 配错的现象 |
| --- | --- | --- | --- |
| Xtal (MHz) | `8.0` | 蓝板外部晶振是 8MHz。这个值 Keil 用来算调试时的时序、部分仿真宏 | 不影响实际运行（时钟由程序里的 RCC 配置决定），但仿真/时序显示会偏 |
| ARM Compiler | `Use default compiler version 5` | 标准库是 2011 年的代码，大量老语法在 AC6（Clang 内核）下会报错 | 选 AC6 后满屏 `error: non-ASM statement in naked function`、`expected identifier`，改代码也改不完 |
| Use MicroLIB | **勾选** | 精简 C 库，代码更小；以后 printf 重定向到串口时不会卡在半主机模式 | 不勾 MicroLIB 又用了 printf：程序下载后卡死不动（半主机等待调试器） |

::: warn 新版 Keil 默认没有 AC5
Keil MDK 5.37 以后安装包里不再自带 AC5。如果下拉框里只有 `version 6`，去 Keil 官网下载 `Arm Compiler 5.06 update 7` 装到 `Keil_v5\ARM\ARMCC\` 下，重启 Keil 才会出现 V5 选项。这一步很多人卡住，以为软件坏了。
:::

### 4.2 Output 页

| 设置项 | 设成什么 | 为什么 | 配错的现象 |
| --- | --- | --- | --- |
| Create HEX File | **勾选** | 生成 .hex，串口下载（FlyMcu）、给别人烧录、量产都要它 | 不勾：`Objects\` 里只有 .axf，想用 FlyMcu 串口下载时找不到文件 |
| Browse Information | **勾选** | 生成符号索引，F12「Go to Definition」才能跳转 | 不勾：F12 无反应，看库函数定义只能靠搜索 |
| Select Folder for Objects | `Objects\` | 编译中间文件单独放，工程目录不乱 | 默认堆在根目录，文件一多就分不清哪个能删 |

### 4.3 C/C++ 页（最容易出错的一页）

| 设置项 | 设成什么 | 为什么 | 配错的现象 |
| --- | --- | --- | --- |
| Define | `USE_STDPERIPH_DRIVER,STM32F10X_MD` | 前者让 `stm32f10x.h` 去包含外设头文件；后者告诉库"我是中容量芯片" | 不写 `USE_STDPERIPH_DRIVER`：`GPIO_InitTypeDef` 未定义；不写 `STM32F10X_MD`：直接 `#error "Please select first the target STM32F10x device..."` |
| Include Paths | `.\Start;.\Library;.\User` | 告诉编译器去哪找 `#include "xxx.h"` | 漏一个目录：`cannot open source input file "stm32f10x.h"` |
| Optimization | `Level 0 (-O0)` | 学习阶段关优化，单步调试时变量值和代码行一一对应 | 开 -O3 后断点乱跳、变量显示 `<optimized out>`，根本没法调试 |

::: note Define 里两个宏的分工，别记混
- `USE_STDPERIPH_DRIVER`：**开关**，决定 `stm32f10x.h` 尾部要不要 `#include "stm32f10x_conf.h"`，从而把 GPIO/RCC 这些外设声明拉进来。
- `STM32F10X_MD`：**档位**，决定 `stm32f10x.h` 里寄存器地址、中断号的数量按哪一档来。

一个管"用不用库"，一个管"芯片多大"，缺一个都编译不过。中间用**英文逗号**分隔，不能用中文逗号。
:::

### 4.4 Debug 页

| 设置项 | 设成什么 | 为什么 | 配错的现象 |
| --- | --- | --- | --- |
| Use | `ST-Link Debugger` | 你的下载器是 ST-Link | 选了 J-LINK/ULINK：点调试报 `No ULINK/JLINK found` |
| Settings → Port | `SW`（不是 JTAG） | 蓝板只引出了 SWD 两根线 | 选 JTAG：`No target connected` |
| Settings → Max Clock | 先 `1MHz`，稳了再 `4MHz` | 杜邦线长、克隆 ST-Link 时高速率容易丢包 | 时钟太高：`RDDI-DAP Error`、连上了但下载一半失败 |
| Settings → Reset | `Autodetect`（救砖时选 `Connect under reset`） | 常规自动复位；芯片被程序占了 SWD 脚时用复位期间强连 | 复位方式不对：连不上目标，或连上就断 |

### 4.5 Utilities 页

| 设置项 | 设成什么 | 为什么 | 配错的现象 |
| --- | --- | --- | --- |
| Use Target Driver for Flash Programming | **勾选** | 让"下载"按钮真的通过 ST-Link 写 Flash，而不是只编译 | 不勾：按 F8 毫无反应，或者弹 `No Flash programmer selected` |
| Update Target before Debugging | **勾选** | 每次进调试前自动把最新程序烧进去，避免调试的是旧代码 | 不勾：改了代码点调试，跑的还是上一次的程序，白排查半天 |
| Flash Download → Programming Algorithm | 添加 `STM32F10x Med-density Flash 128K` | 告诉 Keil 这款芯片 Flash 的擦写算法 | 没加算法：`Error: Flash Download failed - Could not load file`、`Cannot Load Flash Programming Algorithm!` |
| Flash Download → Reset and Run | **勾选** | 下载完自动复位运行，不用手动按板子上的复位键 | 不勾：下载成功但灯不亮，必须手按复位才跑（这个"成功"是假成功） |

::: key 一张图记住五项
`Target` 管编译器版本，`Output` 管产物，`C/C++` 管头文件和宏，`Debug` 管连板子，`Utilities` 管写 Flash。

新手 90% 的"编译不过"在 C/C++ 页，90% 的"下载不了"在 Debug + Utilities 页。
:::

---

## 5. 编译：读懂 Build Output

按 `F7`（Build）或点工具栏三个箭头图标。只想全量重编时用 `Rebuild`（清理后重编，排除残留 .o 的干扰）。

成功的输出长这样：

```text
Build started: Project: stm32_keil_led
*** Using Compiler 'V5.06 update 6 (build 750)', folder: ...
Build target 'Target 1'
compiling main.c...
compiling delay.c...
compiling stm32f10x_gpio.c...
...
linking...
Program Size: Code=3124 RO-data=336 RW-data=12 ZI-data=1040
".\Objects\stm32_keil_led.axf" - 0 Error(s), 0 Warning(s).
Build Time Elapsed: 00:00:03
```

`Program Size` 四个数字要会读，因为 F103C8 的资源很紧（Flash 64KB、RAM 20KB）：

| 字段 | 含义 | 占哪里 |
| --- | --- | --- |
| Code | 机器指令 | Flash |
| RO-data | 常量、字符串、const 数组 | Flash |
| RW-data | 有初值的全局/静态变量 | **Flash 存初值 + RAM 运行时占用** |
| ZI-data | 初值为 0 的全局/静态变量、栈、堆 | RAM |

判断公式：**Flash 占用 ≈ Code + RO-data + RW-data**；**RAM 占用 ≈ RW-data + ZI-data**。

上例就是 Flash ≈ 3.5KB、RAM ≈ 1KB，离上限还很远。等以后加 FreeRTOS、大缓冲区时，这两个数字就是你的"油量表"。

::: warn 警告也要看
`0 Error(s), 0 Warning(s)` 才算干净。常见警告：
- `last line of file ends without a newline` —— 文件最后一行没换行，补个回车即可；
- `#1-D: last line of file ends without a newline` 之后紧跟的 `warning: #1295-D: Deprecated declaration` —— 库里的老写法，可以忽略；
- `declared implicitly` —— 函数没声明就用了，多半是头文件漏 include，别放着不管。
:::

---

## 6. 下载与在线调试

### 6.1 下载：F8

接线和引脚顺序见第 2 课第 1 节（3V3 / SWDIO / SWCLK / GND 四根，**GND 必须接**）。BOOT0 保持在 0 那一侧。

按 `F8`（或 `Flash → Download`），Build Output 出现：

```text
Load "D:\\mcu\\stm32_keil_led\\Objects\\stm32_keil_led.axf"
Erase Done.
Programming Done.
Verify OK.
Application running ...
```

四行都对上，才算真下载成功。

### 6.2 进入调试：Ctrl+F5

按 `Ctrl+F5`（`Debug → Start/Stop Debug Session`），界面会变：多出一排调试工具栏，左侧出现寄存器窗口。这时程序**暂停在 main 第一行**，还没开始跑。

| 操作 | 快捷键 | 用在哪 |
| --- | --- | --- |
| 全速运行 | `F5` | 跑到下一个断点 |
| 停止 | 调试工具栏红色 Stop | 回到编辑状态（**结束调试必须点它**） |
| 单步跳过 | `F10` | 一行一行走，不进函数内部 |
| 单步进入 | `F11` | 进到函数里面看 |
| 跳出函数 | `Ctrl+F11` | 看完想赶紧出来 |
| 运行到光标 | `Ctrl+F10` | 快速跳到某一行，不用加断点 |
| 加/删断点 | 行号左侧点一下 | 只想停在某处时 |

### 6.3 看变量：Watch 窗口

`View → Watch Windows → Watch 1`，在 `<Enter expression>` 里输入变量名，比如 `ms`、`GPIO_InitStructure.GPIO_Pin`。单步执行时数值实时刷新。

看不了变量？检查三件事：
1. 是不是在调试状态（没按 Ctrl+F5 就没有 Watch）；
2. Optimization 是不是 -O0（开了优化变量会被优化掉，显示 `<not in scope>` 或 `<optimized out>`）；
3. 变量是不是局部变量且当前不在它的作用域内。

::: note 为什么暂停时灯的状态和代码对不上
程序停在断点那一刻，**外设寄存器已经写过了**，所以灯是亮的；但你在编辑区看到的是"即将执行"的那一行。判断"这句有没有生效"，要单步执行完再去看板子，而不是看光标位置。
:::

### 6.4 看寄存器：Peripherals 菜单

调试状态下菜单栏多出 `Peripherals`，展开 `System Viewer → GPIO → GPIOC`，能看到 `CRH`、`ODR`、`IDR` 每一位的实时值。

这是理解"库函数到底改了什么"的最快方式：执行完 `GPIO_Init()` 后看 CRH 里 PC13 对应的 4 位从 `0x4`（浮空输入）变成 `0x2`（推挽输出 2MHz）；执行 `GPIO_ResetBits()` 后 ODR 的 bit13 变 0。第 3 课讲推挽/开漏时，用这个窗口验证一遍，比看十遍文字都清楚。

### 6.5 退出调试

点调试工具栏的 **Stop**（红色方块），或再按一次 `Ctrl+F5`。**不点 Stop 直接关软件，ST-Link 可能被占用**，下次连不上，拔插 USB 才能恢复。

---

## 7. 五类常见报错对照表

| 报错/现象 | 真正原因 | 处理顺序 |
| --- | --- | --- |
| `No ST-LINK detected` | USB 没插好 / 驱动没装 / 克隆器固件问题 | 换 USB 口 → 设备管理器看有没有 STLink → 重装驱动 |
| `No target connected` | 线序错（克隆器丝印反）/ 没接 GND / SWD 脚被程序占用 / BOOT 异常 | 先对调 SWDIO 与 SWCLK 试 → 检查 GND → Debug 里 Reset 选 `Connect under reset` |
| `Error: Flash Download failed - Could not load file` | Utilities 里没勾 `Use Target Driver...`，或 Flash Download 里没加编程算法 | Utilities 页两项都检查 |
| `Cannot Load Flash Programming Algorithm!` | 编程算法没选，或选成了别的容量档 | Flash Download 里加 `STM32F10x Med-density Flash 128K` |
| `cannot open source input file "xxx.h"` | C/C++ 页 Include Paths 缺目录，或路径含中文/空格 | 补齐三个路径 → 确认路径全英文 |
| `Undefined symbol GPIO_Init` | 对应的 `.c` 没加进工程组，或加进了但没编译 | Project 窗口数文件 → Rebuild |
| `#error "Please select first the target STM32F10x device..."` | C/C++ 的 Define 少了 `STM32F10X_MD` | 补宏，注意英文逗号 |
| `RDDI-DAP Error` / 连上就断 | SWD 速率太高、杜邦线太长、电源不稳 | Max Clock 降到 1MHz → 换短线 → 单独供电 |
| 下载成功但灯不亮 | BOOT0 在 1 / 没勾 Reset and Run / 程序卡死 | 看 BOOT0 → 勾 Reset and Run → 进调试看停在哪 |
| 编译通过但进不了 main | 启动文件选错容量档 / 中断向量表不对 | 换成 `startup_stm32f10x_md.s` |
| 中文注释乱码 | 文件编码不是 UTF-8 | Edit → Configuration → Encoding → UTF-8 |

::: key 排查顺序（背下来）
**先看编译（0 Error 吗）→ 再看连接（能识别 ST-Link 吗）→ 再看下载（Erase/Program/Verify 三行都有吗）→ 最后看运行（进调试停在 main 吗）。**

按这四层往下走，任何问题都能定位到某一层，不会到处乱试。
:::

---

## 8. 如果代码是 HAL / CubeMX 生成的

现在很多教程（包括本课程）用 CubeMX 生成工程。它同样支持 Keil：

1. CubeMX 里 `Project Manager → Toolchain / IDE` 选 **MDK-ARM**（版本选 V5），生成代码；
2. 生成目录下会有 `MDK-ARM\xxx.uvprojx`，双击用 Keil 打开；
3. CubeMX **已经帮你配好了**魔术棒里的关键项：Define 是 `USE_HAL_DRIVER,STM32F103xB`，Include Paths 指向 `Drivers/...`，Debug 是 ST-Link。你不需要再手配第 4 节那些项；
4. 按 F7 编译、F8 下载，操作和第 5、6 节完全一样。

::: note 宏名为什么不一样
标准库用 `STM32F10X_MD`（全大写 X），HAL 用 `STM32F103xB`（具体型号档位）。两套库的命名风格不同，别互相抄。

另外 HAL 工程在 Keil 里编译较慢（文件多），第一次全编可能要十几秒；之后增量编译就快了。
:::

### 和 CubeIDE 的对照

| 你要做的事 | CubeIDE | Keil |
| --- | --- | --- |
| 选芯片 | New STM32 Project → MCU Selector | New uVision Project → 器件列表 |
| 配引脚/时钟 | 图形化 CubeMX 界面 | **没有**，只能写代码（或用 CubeMX 生成） |
| 加头文件路径 | 自动（由 CubeMX 生成 Makefile） | 魔术棒 → C/C++ → Include Paths 手动加 |
| 编译 | 锤子图标 / Ctrl+B | F7 |
| 下载 | 绿色播放键 | F8 |
| 调试 | 虫子图标 | Ctrl+F5 |
| 看变量 | Expressions 窗口 | Watch 窗口 |
| 看寄存器 | SFR 视图 | Peripherals → System Viewer |

**结论：Keil 更像"手动挡"**——所有配置都要你自己说清楚，好处是你能看见每一步；CubeIDE 是"自动挡"，少配但黑盒多。会了 Keil，CubeIDE 只是换了按钮位置。

---

## 9. 工作里真正高频的功能

前 8 节保证你"能把程序跑起来"，这一节保证你"跑得快"。按你干活时遇到的场景往下查，不用从头看。

### 9.1 写代码：补全、语法检查、模板、书签

Keil 的补全**默认是关着的**，所以很多人以为它没有补全。打开方式：`Edit → Configuration → Text Completion` 页。

| 选项 | 建议 | 作用 | 不配的后果 |
| --- | --- | --- | --- |
| Symbols after N Characters | 勾选，N=3 | 输入 3 个字符后自动弹出工程里的符号 | 全程手打，`GPIO_InitStructure` 这种长名字打到崩溃 |
| Function Parameters | 勾选 | 输入函数名和左括号时显示参数表 | 忘了参数顺序，只能回去翻头文件 |
| Struct/Class Members | 勾选 | 输入 `.` 或 `->` 后弹出成员列表 | 结构体字段靠背 |
| Dynamic Syntax Checking | 先不开，工程大了会卡 | 边写边做语法检查，错误处标红波浪线 | 开着写大文件，打字有明显延迟 |

手动唤起提示按 `Ctrl+Space`。

::: note 补全不弹的三个常见原因
1. 没勾 `Symbols after N Characters`；
2. 光标在字符串或注释里（补全不工作）；
3. 工程还没成功编译过一次，符号表是空的——先按 F7 编一遍。
:::

**代码模板**：Project 窗口的 `Templates` 标签页里有现成模板（比如中断服务函数骨架），右键可以新建自己的 `.uvt` 文件。把常用的 `main` 骨架、GPIO 初始化骨架存成模板，比每次复制粘贴快。

**书签**：读别人代码或自己写长文件时用，比滚轮靠谱。

| 操作 | 快捷键 |
| --- | --- |
| 加/删书签 | `Ctrl+F2` |
| 跳到下一个书签 | `F2` |
| 跳到上一个书签 | `Shift+F2` |
| 清空所有书签 | `Ctrl+Shift+F2` |

**批量注释**：`Edit → Advanced → Comment Selection / Uncomment Selection`。调一段代码时先注释掉，比删了再加回来安全。

**折叠**：`Edit → Outlining → Collapse All / Expand All`，看整体结构时一屏装下整个文件。

### 9.2 找东西：F12、全工程搜索、跳行

| 想干什么 | 操作 | 前提/坑 |
| --- | --- | --- |
| 看函数/变量的定义 | `F12`（Go to Definition） | 必须勾 Output 页的 Browse Information，否则毫无反应 |
| 全工程搜字符串 | `Ctrl+Shift+F`（Find in Files） | 可以限定目录、勾正则；比 `Ctrl+F` 只搜当前文件强得多 |
| 跳到第 N 行 | `Ctrl+G` | 看编译报错的行号时最快 |
| 看当前文件有哪些函数 | Project 窗口 `Functions` 标签 | 文件超过 500 行时必备 |
| 看某个符号被谁引用 | `View → Source Browser` | 同样依赖 Browse Information |

::: warn 改了头文件后 F12 跳错位置
Browse Information 是编译时生成的索引。只改 `.h` 不重编，索引还是旧的，F12 会跳到旧行号。改完头文件按 F7 重编一次即可。
:::

### 9.3 断点不止"停一下"

`Ctrl+B` 打开 Breakpoints 窗口，能看到所有断点并逐个编辑。断点有三种高级玩法：

| 类型 | 怎么设 | 用在什么场景 |
| --- | --- | --- |
| 条件断点 | Expression 填条件，如 `i == 500` | 循环第 500 次才出错，不想按 499 次 F5 |
| 计数断点 | Count 填 N，命中第 N 次才停 | PWM 第 10 个周期波形不对 |
| 数据访问断点 | Expression 填变量名或地址，设 Read/Write | "这个变量被谁偷偷改了"——排查内存越界的神器 |

注意两点：

- **条件要用 `==` 不能用 `=`**。写成 `i = 500` 是赋值，条件永远成立，断点第一圈就停，看起来像"条件没生效"。
- **断点数量受硬件限制**。Cortex-M3 的 FPB 只有 6 个指令比较器，ST-Link 一般也就支持 6 个；超了会报 `Too many breakpoints`。解决办法是把零散断点合并成条件断点。

::: note 数据访问断点为什么经常"设了没反应"
它依赖调试器的硬件 watchpoint，部分克隆 ST-Link 或旧固件不支持；而且只能监视有限个地址。设了不停，先用"暂停后手动看变量"的方式替代。
:::

### 9.4 没有板子也能跑：软件仿真（Simulator）

忘带板子、或者想验证一段纯算法逻辑时，用仿真模式：

1. 魔术棒 `Debug` 页，`Use` 从 `ST-Link Debugger` 改成 **`Simulator`**；
2. `Ctrl+F5` 进调试，之后操作和真机完全一样；
3. 能看变量、寄存器（`Peripherals → System Viewer`）、内存（`View → Memory Windows`）。

**逻辑分析仪**（只能在仿真模式下用）：

1. `View → Analysis Windows → Logic Analyzer`；
2. 点 `Setup`，新建一条信号，输入要观察的引脚；
3. 常见写法：`GPIOC.13`、`GPIOC_IDR.13`，或直接写变量名。报 `Unknown Signal` 就换一种写法试；
4. 全速运行，波形会画出来，量一下高电平宽度就能验证 PWM 占空比。

::: warn 仿真有三个必须知道的局限
1. **时序不真实**：仿真器按指令条数估算时间，不反映真实主频、中断延迟、总线等待。拿它测"延时准不准"会得到错误结论。
2. **外设模型不全**：串口、I2C 从机、外部传感器在仿真里没有模型，读回来全是 0。
3. **必须记得改回来**：调试完把 `Use` 改回 `ST-Link Debugger`，否则 F8 下载会提示找不到 Flash 算法——因为仿真器不写 Flash。
:::

### 9.5 不占串口的打印：SWO / ITM printf

Cortex-M3 里有个 **ITM**（Instrumentation Trace Macrocell），它能借调试器的 SWO 脚往电脑发字符，**不占用 USART**。

配置四步：

1. 魔术棒 `Debug → Settings → Trace` 页，勾 `Trace Enable`；
2. `Core Clock` 填 **72MHz**（填错了时间戳不对，但不影响字符输出）；
3. 勾上 `ITM Stimulus Port 0`；
4. 代码里重定向：

**文件：`User\retarget.c`**

```c
#include "stm32f10x.h"
#include <stdio.h>

/* 把 printf 的底层输出改到 ITM，不占用串口 */
int fputc(int ch, FILE *f)
{
    ITM_SendChar((uint32_t)ch);   /* core_cm3.h 里的内联函数 */
    return ch;
}
```

然后在 `View → Serial Windows → Debug (printf) Viewer` 里看输出。

::: warn 蓝板用户先别急着用这个
SWO 信号走的是 **PB3** 引脚，而蓝板那 4 针 SWD 排针只有 3V3 / SWDIO / SWCLK / GND，**没有引出 PB3**。要用就得飞线，而且不少克隆 ST-Link 的 SWO 通道不稳定。

现阶段更省事的路是 **USART1 + 串口助手**（s12 会讲完整实现）。SWO 留给以后用官方 Nucleo 板或带 SWO 排针的调试器时再用。

另外，没勾 `Use MicroLIB` 时 printf 会走半主机模式，程序一调用就停在等调试器——第 4 节说的那个坑，在这里再确认一次。
:::

### 9.6 一份代码管多个配置：多 Target 与多工程

**多 Target**（同一工程、不同编译配置）：`Project → Manage → Project Items → Targets` 标签，点 `New` 复制一个 Target。每个 Target 有自己独立的魔术棒设置。

典型用法：

- `Debug` Target：`-O0`、勾调试信息，用来单步；
- `Release` Target：`-O2`、不生成调试信息，用来出正式固件；
- 一块板一个 Target：只改 Define 里的芯片宏，源码共用。

**多工程 Workspace**：`Project → Manage → Multi-Project Workspace`，把多个 `.uvprojx` 放进一个工作区，按顺序编译。典型的 Bootloader + App 双工程（s20 会用到），一次 Build 就能生成两个固件。

::: warn 切了 Target 却没改魔术棒
最常见的事故：切到 Release Target 发现编译报错，因为宏和优化等级还是另一套；或者切了 Target 以为在调试新配置，实际下载的是旧 Target 的产物。**切 Target 后先扫一眼魔术棒标题栏**——它会显示当前 Target 名。
:::

### 9.7 换芯片、加组件：Pack Installer 与 RTE

- **Pack Installer**（工具栏图标，或 `Project → Manage → Pack Installer`）：装器件支持包（DFP）、CMSIS 包、中间件。装完新芯片才会出现在器件列表里。
- **RTE**（`Project → Manage → Run-Time Environment`）：勾选式添加 CMSIS-Core、Device Startup、FreeRTOS 等组件，Keil 自动把源文件挂进工程。

::: warn RTE 和手动加文件不要混用
RTE 勾了 `Device Startup` 之后又手动拷一份 `startup_stm32f10x_md.s` 进工程，链接时会报 `multiply defined`（重复定义）。二选一，别两边都来。
:::

### 9.8 把 Keil 工程放进 Git（配合你的 GitHub 仓库）

Keil 会往工程目录里扔几十个中间文件，全提交上去仓库很快就臃肿。规则很简单：**源码和工程描述文件提交，编译产物和本机布局忽略**。

| 文件 | 提交? | 原因 |
| --- | --- | --- |
| `*.c` / `*.h` | 提交 | 源码本体 |
| `*.uvprojx` | **必须提交** | 工程结构、芯片型号、魔术棒配置都在里面，别人靠它打开工程 |
| `*.uvoptx` | 建议忽略 | 断点、调试器选择等个人设置，换人打开就变 |
| `Objects/`、`Listings/` | 忽略 | 编译产物，可随时重建 |
| `*.uvguix.*` | 忽略 | 窗口布局，带用户名，每人不同 |
| `*.hex`、`*.axf` | 忽略（发版可另存） | 产物，不该进版本库 |

在工程根目录放一个 `.gitignore`：

```gitignore
# Keil 编译产物
Objects/
Listings/
*.hex
*.axf
*.map
*.lst
*.dep
*.crf
*.o
*.d

# µVision 本机布局与备份
*.uvguix.*
*.uvgui.*
*.bak

# 个人调试设置（团队要共享断点时可去掉这一行）
*.uvoptx
```

::: note 换电脑打不开工程的两个原因
1. **Include Paths 写成了绝对路径**（`D:\mcu\...`）。在魔术棒 C/C++ 里改成 `.\\Start;.\\Library;.\\User` 这种相对路径，工程才能跟着文件夹走。
2. **只提交了 .uvprojx，没提交库文件**。别人 clone 下来缺 `stm32f10x_gpio.c`，一编译全是 `Undefined symbol`。库文件要么一起提交，要么在 README 里写清从哪下载哪个版本。
:::

### 9.9 把常用工具塞进菜单

`Tools → Customize Tools Menu` 可以添加外部程序。常用组合：

| 名称 | Command | 用途 |
| --- | --- | --- |
| Git Bash | `C:\Program Files\Git\bin\bash.exe` | 不离开 Keil 就能提交代码 |
| 串口助手 | 你自己的串口工具 exe | 看 printf 输出 |
| CubeProgrammer | `STM32CubeProgrammer.exe` | 芯片被锁时全片擦除 |

Command 路径里有空格要加英文引号。

### 9.10 快捷键总表（打印出来贴显示器边上）

| 快捷键 | 功能 | 快捷键 | 功能 |
| --- | --- | --- | --- |
| `F7` | 编译 | `F8` | 下载 |
| `Ctrl+F5` | 进入/退出调试 | `F5` | 全速运行 |
| `F9` | 加/删断点 | `Ctrl+B` | 断点管理窗口 |
| `F10` | 单步跳过 | `F11` | 单步进入 |
| `Ctrl+F11` | 跳出函数 | `Ctrl+F10` | 运行到光标 |
| `F12` | 跳到定义 | `Ctrl+G` | 跳到指定行 |
| `Ctrl+F` | 当前文件查找 | `Ctrl+Shift+F` | 全工程查找 |
| `Ctrl+H` | 替换 | `Ctrl+Space` | 唤起补全 |
| `Ctrl+F2` | 加/删书签 | `F2` / `Shift+F2` | 下/上一个书签 |
| `Alt+F7` | 工程选项（魔术棒） | `Ctrl+F7` | 只编译当前文件 |
| `Ctrl+S` | 保存 | `Ctrl+Z` | 撤销 |

::: key 这一节的取舍
不是每个都要会。**先掌握 9.1 的补全、9.2 的 F12 和 9.3 的条件断点**——这三个每天都会用到；仿真、SWO、多 Target 是遇到具体场景再回来查的工具，不用背。
:::

---

## 10. 练习

::: exercise 练习 1（配置题）
某同学的工程编译报错：
```text
..\User\main.c(5): error: #20: identifier "GPIO_InitTypeDef" is undefined
```
他确认 `stm32f10x_gpio.h` 已经在工程里。最可能是魔术棒哪一页的哪一项没配？为什么？
:::

::: answer
**C/C++ 页的 `Define` 里没写 `USE_STDPERIPH_DRIVER`**。

`GPIO_InitTypeDef` 这个类型定义在 `stm32f10x_gpio.h` 里，而 `stm32f10x_gpio.h` 是被 `stm32f10x.h` 通过 `#include "stm32f10x_conf.h"` 间接包含进来的。这个"间接包含"只有在定义了 `USE_STDPERIPH_DRIVER` 时才会发生。文件加进工程 ≠ 声明可见。

（如果 Define 写对了还报这个错，第二嫌疑是 Include Paths 没加 `.\Library`。）
:::

::: exercise 练习 2（现象判断）
现象：F8 下载后 Build Output 显示 `Programming Done.`，但板子上的灯一动不动，必须手按复位才开始闪。哪一项配置漏了？
:::

::: answer
**Utilities → Flash Download 里的 `Reset and Run` 没勾**。

勾上后 Keil 写完 Flash 会发一个复位命令让芯片从头执行，省掉手动按复位。另一种可能是 BOOT0 在 1 那一侧（芯片从系统存储器启动，根本不跑你的程序），但"按复位就能闪"这个细节基本排除了 BOOT 问题——BOOT0 错了按复位也不会跑。
:::

::: exercise 练习 3（动手）
按第 3、4 节从零建工程，编译下载让 PC13 闪起来。然后把编译输出的 `Program Size` 抄下来，算出：

1. Flash 占用了多少 KB？
2. RAM 占用了多少 KB？
3. 距 F103C8 的 64KB / 20KB 上限还剩多少？
:::

::: answer
以上面第 5 节的示例 `Code=3124 RO-data=336 RW-data=12 ZI-data=1040` 为例：

1. Flash = 3124 + 336 + 12 = 3472 B ≈ **3.4KB**（占 64KB 的 5.3%）
2. RAM = 12 + 1040 = 1052 B ≈ **1.0KB**（占 20KB 的 5.1%）
3. 剩余 Flash ≈ 60.6KB，剩余 RAM ≈ 19KB。

你自己的数字会略有差异（编译器版本、优化等级不同），但量级应该一致。如果 RAM 一上来就显示十几 KB，八成是启动文件选错容量档，把栈设得过大。
:::

::: exercise 练习 4（排错）
现象：`Ctrl+F5` 进调试，弹窗 `No target connected`，但 F8 下载刚才还是好的。可能的三个原因是什么？按什么顺序查？
:::

::: answer
1. **SWD 被程序占用**：如果代码里把 PA13/PA14 配成了普通 GPIO，下载后程序一跑 SWD 就断。查：Debug → Settings → Reset 改 `Connect under reset`，重新进调试。
2. **ST-Link 被占用/掉线**：上一次调试没点 Stop 就关了软件。查：拔插 USB，重新打开工程。
3. **供电或接线松动**：杜邦线接触不良、板子只靠 ST-Link 供电导致电流不足。查：换线、单独给板子 USB 供电（注意不要两边同时供）。

顺序：先拔插 USB（最省事）→ 再试 `Connect under reset`（覆盖最多情况）→ 最后查线。
:::

::: exercise 练习 5（条件断点）
下面这段代码在第 500 次循环时，`sum` 突然变成一个离谱的大数：

```c
for (i = 0; i < 1000; i++)
{
    sum += buf[i];
}
```

你不想按 499 次 F5。用条件断点怎么设？如果断点第一圈就停，最可能是什么原因？
:::

::: answer
`Ctrl+B` 打开 Breakpoints 窗口，在 Expression 里填 **`i == 500`**（或 `sum > 某个合理上限`），关闭窗口后按 F5，程序会自动跑到第 500 圈停下。

第一圈就停的原因，几乎都是把 `==` 写成了 `=`：`i = 500` 是赋值，把 i 改成 500 后条件恒为真，于是立刻命中。

补充：如果想"第 500 圈停下来看，但之后还继续"，在断点窗口里配 `Count`；想抓"谁改了 sum"，用数据访问断点而不是条件断点。
:::

::: exercise 练习 6（Git）
你把 Keil 工程提交到 GitHub，队友 clone 下来后打开 `.uvprojx`，一编译报 `cannot open source input file "stm32f10x.h"`。工程里文件都在。最可能是哪两件事之一？

如果是你自己这边发现仓库里多了几百个 `Objects\*.o`，该改哪个文件？
:::

::: answer
**两个可能**：

1. 队友的 Include Paths 指向的是你电脑上的绝对路径（`D:\mcu\...`），他那边没有这个目录。改成 `.\Start;.\Library;.\User` 相对路径再提交。
2. 库文件根本没提交（`.gitignore` 误伤了 `Library/`，或者当初是复制粘贴没加进仓库），队友本地缺 `.c/.h`。把库文件补进仓库，或在 README 写清依赖。

**忽略编译产物**：工程根目录的 `.gitignore` 里加 `Objects/`、`Listings/`、`*.uvguix.*`。已经误提交的产物要先 `git rm -r --cached Objects` 从索引里移除，再提交一次 `.gitignore`——光加 `.gitignore` 不会让已跟踪的文件自动消失。
:::

::: selfcheck 自检
- [ ] 我能说出 Keil 界面五个区域各自的作用
- [ ] 我能不看笔记说出魔术棒五个必配页和它们各管什么
- [ ] 我知道 `USE_STDPERIPH_DRIVER` 和 `STM32F10X_MD` 分别管什么
- [ ] 我能从 `Program Size` 四个数字算出 Flash 和 RAM 占用
- [ ] 报 `No target connected` 时我知道按什么顺序排查
- [ ] 我完成了一次"建工程 → 编译 → 下载 → 断点 → 看变量"的完整闭环
- [ ] 我打开了代码补全，能用 `Ctrl+Space` 和 `Ctrl+F2` 书签
- [ ] 我会用 `Ctrl+B` 设一个条件断点，并知道 `=` 和 `==` 的坑
- [ ] 我知道哪些 Keil 文件该提交、哪些该写进 `.gitignore`
:::
