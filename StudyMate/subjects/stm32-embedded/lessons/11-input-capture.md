---
node: s11
title: 输入捕获与编码器模式
type: practice
duration: 80
---

## 这一课要解决的问题

::: goal
读完你能：说清"输入捕获"就是把定时器的计数值在边沿到来的一瞬间存下来；用捕获值算出外部信号的频率和高电平宽度；自己判断一个信号该用测频法还是测周法；用编码器模式读旋钮的正反转。
:::

前两课定时器在"对外输出"：数到 CCR 就翻电平。这一课把方向反过来——**让外部信号来冻结定时器的计数值**，然后用这个数字反推时间。

---

## 1. 先想清楚：要测一个信号，到底缺什么

假设 PA0 上有一个方波，你要知道它的频率。手边只有板子和一根线，没有示波器。

人能想到的笨办法：拿秒表数 10 秒里跳了几次。这在单片机里就是**用定时器数一段时间内的边沿数**。

但更直接的问题是：**两个上升沿之间隔了多少个 1μs？** 如果能在"上升沿到来的那一刻"把定时器的 CNT 抄下来，两个抄下来的数一减，时间就出来了。

**输入捕获干的就是这个"抄 CNT"的动作**：

1. 定时器照常从 0 数到 ARR，循环。
2. 你指定一个通道（比如 TIM2_CH1 = PA0）盯着某个边沿。
3. 边沿一来，硬件瞬间把当前 CNT 的值复制进 CCR（捕获寄存器），并置一个标志位。
4. CPU 事后去读 CCR，就得到了"边沿发生时的时刻"。

::: note 为什么必须由硬件来抄
软件做不到。中断从"边沿到来"到"CPU 执行第一行代码"有十几个时钟周期的延迟，而且每次延迟还不一样（受当前指令影响）。1μs 的误差在测频率时就是几十 Hz 的偏差。

捕获是**纯硬件**动作，从边沿到锁存只有纳秒级、固定延迟，所以能测到微秒级。这就是"硬件自动化"的第二个例子（第一个是 s10 的 PWM）。
:::

---

## 2. 两种测法：测频法和测周法

同一个信号，有两种量法，差别只在"谁当尺子"。

| | 测频法 | 测周法 |
| --- | --- | --- |
| 尺子 | **固定闸门时间**（如 1 秒） | **固定计数时钟**（如 1μs） |
| 数什么 | 数闸门内来了几个边沿 | 数两个边沿之间过了多少个时钟 |
| 得到 | 直接是频率 | 先得周期，再取倒数 |
| 适合 | **高频**信号 | **低频**信号 |
| 误差来源 | 边沿数 ±1（低频时相对误差大） | 计数 ±1（高频时相对误差大） |

<svg class="diagram" viewBox="0 0 860 300" xmlns="http://www.w3.org/2000/svg">
  <text class="label" x="16" y="30" font-size="11.5">测频法：1 秒闸门内数边沿</text>
  <path d="M 60 90 L 60 60 L 110 60 L 110 90 L 160 90 L 160 60 L 210 60 L 210 90 L 260 90 L 260 60 L 310 60 L 310 90 L 360 90 L 360 60 L 410 60 L 410 90 L 460 90 L 460 60 L 510 60 L 510 90 L 560 90 L 560 60 L 610 60 L 610 90"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <line class="loop" x1="60" y1="110" x2="610" y2="110"/>
  <text class="sub" x="260" y="132" font-size="10">闸门 1s：数到 5 个上升沿 → 5Hz</text>

  <text class="label" x="16" y="190" font-size="11.5">测周法：两个上升沿之间数 1μs 的格子</text>
  <path d="M 60 250 L 60 220 L 110 220 L 110 250 L 210 250 L 210 220 L 310 220 L 310 250 L 410 250 L 410 220 L 510 220 L 510 250 L 610 250 L 610 220"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <line class="arrow" x1="110" y1="272" x2="210" y2="272"/>
  <polygon class="arrowhead" points="210,268 220,272 210,276"/>
  <text class="sub" x="120" y="292" font-size="10">捕获值差 = 100 个 1μs → 周期 100μs → 10kHz</text>
</svg>

::: key 一句话记住分工
**测频法**：低频时数得太少，误差大；**测周法**：高频时数得太多，还会溢出。

所以：**低频用测周，高频用测频**，中间范围两种都能用。实用分界线大约在几百 Hz ~ 几十 kHz，看你要求的精度。

本课的输入捕获天然是**测周法**（量两个边沿之间的时间），所以最适合测按键、红外、低频传感器这类慢信号。要测 MHz 级的信号，才切回测频法。
:::

::: warn 测周法有个必须解决的坑：溢出
CNT 是 16 位（TIM2~TIM5 是 16 位，TIM1 也是 16 位），最大 65535。PSC = 71 时一个格子 1μs，那么最多只能量 **65.5ms** 的周期——也就是最低约 15Hz。

低于 15Hz 的信号，CNT 会在两次捕获之间绕回来一圈，你读到的差值就错了。

**两种解法**：
1. 加大 PSC（比如 720 分频，一个格子 10μs，量程到 655ms）。
2. 在捕获中断里数"溢出了几次"，用 `溢出次数 × 65536 + 差值`。

第 2 种更通用，但代码复杂。课程实验用第 1 种就够了。
:::

---

## 3. CubeMX 里怎么配（以 PA0 测一路方波为例）

### 3.1 定时器基础参数

`Timers → TIM2`：

| 配置项 | 值 | 理由 |
| --- | --- | --- |
| Clock Source | Internal Clock | 72MHz |
| Prescaler | **71** | 72 分频 → 计数频率 1MHz，一格 1μs |
| Counter Mode | Up | 向上数 |
| Counter Period (ARR) | **65535** | 尽量拉满量程，别让它频繁溢出 |

### 3.2 通道配置

`TIM2 → Channel1` 选 **Input Capture direct mode**，然后：

| 配置项 | 值 | 理由 |
| --- | --- | --- |
| IC Polarity | **Rising Edge** | 先抓上升沿 |
| IC Selection | Direct | 信号直接进通道 |
| IC Prescaler | No division | 每个边沿都抓 |
| **IC Filter** | **0xF（最大）** | 滤掉毛刺，见下面的 warn |

引脚自动变成 **PA0**。

### 3.3 中断

NVIC 里勾上 **TIM2 global interrupt**。捕获事件要靠中断通知 CPU 去读 CCR，不开中断就只能轮询标志位。

::: warn IC Filter 配错的两种现象
`IC Filter` 是数字滤波器，值越大，要求信号稳定越久才算一个有效边沿（以 fDTS 为单位）。

- **配成 0（不滤波）**：按键、长导线、电机旁边的信号会读到一串乱七八糟的捕获值，算出来的频率忽大忽小。示波器看信号很干净，单片机却读不准。
- **配得太大**：窄脉冲直接被滤掉，完全捕获不到。现象是"中断一次都不进"。

经验：机械按键、长线用 0x8~0xF；干净的信号源（信号发生器、另一个单片机输出的方波）用 0~0x3 就行。
:::

---

## 4. HAL 代码：量一个周期

文件分工：启动捕获和打印在 `main.c`，捕获回调与"取一组新数据"的接口属于测量逻辑，放 `App/Src/capture.c`。CubeMX 生成的 `MX_TIM2_Init()` 已在内部把 PSC、ARR、通道、滤波都配好（见 3.1/3.2 的表），所以这里只写"启动 + 回调 + 用数据"。

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `capture.h` | `App/Inc/` | 启动、取周期的接口与 extern |
| `capture.c` | `App/Src/` | `HAL_TIM_IC_CaptureCallback`、无符号回绕相减 |
| `main.c` | `Core/Src/` | 初始化、启动捕获、主循环打印 |
| `main.h`、`tim.c`、`gpio.c`、`stm32f1xx_it.c`、`stm32f1xx_hal_msp.c` | `Core/` | CubeMX 生成（PSC/ARR/CH1/滤波、NVIC、`TIM2_IRQHandler`），**不手写** |

**文件：`App/Inc/capture.h`**
```c
#ifndef __CAPTURE_H
#define __CAPTURE_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void    Capture_Start(void);                    /* 开捕获 + 开 CC1 中断 */
uint8_t Capture_TakePeriod(uint32_t *period_us);/* 1 = 取到一组新周期，单位 μs */

extern volatile uint32_t g_capture_period;      /* 最近一次周期，调试器里看 */

#ifdef __cplusplus
}
#endif

#endif /* __CAPTURE_H */
```

**文件：`App/Src/capture.c`**
```c
#include "capture.h"
#include "tim.h"        /* htim2 的 extern 声明 */

static volatile uint32_t s_last  = 0;   /* 上一次捕获到的 CNT */
static volatile uint8_t  s_ready = 0;   /* 有一组新数据 */

volatile uint32_t g_capture_period = 0; /* PSC=71 时单位就是 μs */

void Capture_Start(void)
{
  HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_1);   /* 只写 Start 不会进中断 */
}

/* 捕获中断最终调到这里；不要写进 stm32f1xx_it.c */
void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance == TIM2 && htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1) {
    uint32_t now = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);  /* 抄走 CCR1 */
    g_capture_period = (now - s_last) & 0xFFFFU;  /* 取低 16 位，绕一圈也能算对 */
    s_last  = now;
    s_ready = 1;
  }
}

uint8_t Capture_TakePeriod(uint32_t *period_us)
{
  if (!s_ready) return 0;
  s_ready = 0;
  *period_us = g_capture_period;         /* 先取副本，免得算到一半被中断改掉 */
  return 1;
}
```

**文件：`Core/Src/main.c`**
```c
#include <stdio.h>          /* printf */
#include "main.h"
#include "gpio.h"
#include "tim.h"            /* htim2 / MX_TIM2_Init 原型 */
#include "capture.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();     /* 72MHz，见 s9 */
  MX_GPIO_Init();
  MX_TIM2_Init();           /* PSC=71、ARR=65535、CH1 上升沿、IC Filter=0xF */

  Capture_Start();

  while (1)
  {
    uint32_t per;

    if (Capture_TakePeriod(&per)) {          /* 有新的捕获结果 */
      if (per != 0U) {
        printf("period=%luus  f=%luHz\r\n", per, 1000000U / per);
      }
    }
  }
}

/* 以下两个函数是 CubeMX 生成的固定内容，不用你手写 */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  osc.OscillatorType  = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState        = RCC_HSE_ON;
  osc.HSEPredivValue  = RCC_HSE_PREDIV_DIV1;
  osc.PLL.PLLState    = RCC_PLL_ON;
  osc.PLL.PLLSource   = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL      = RCC_PLL_MUL9;          /* 8MHz × 9 = 72MHz */
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) { Error_Handler(); }

  clk.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                     | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;          /* TIM2 时钟 72MHz */
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) { Error_Handler(); }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

::: note 为什么是这几句（配错会看到什么）
- `#include "tim.h"`：`htim2` 定义在 `tim.c`、声明在 `tim.h`。自己在 main.c 再写一遍 `TIM_HandleTypeDef htim2;` 是**重复定义**，链接直接报错。
- 用 `Start_IT` 而不是 `Start`：`HAL_TIM_IC_Start` 只开捕获不开中断，CCR1 里的数一直在更新却没人去抄，现象是**串口一个字都不打印**。
- `volatile`：`g_capture_period`/`s_ready` 在中断里写、主循环里读，不加这个关键字，编译器可能把 `if (s_ready)` 优化成永远读寄存器里的旧值，现象是**中断进了、串口没输出**。
- `per != 0`：第一次中断时 `s_last` 还是 0，会算出一个离谱的大数；更要紧的是 `1000000 / 0` 会触发硬件异常，程序直接卡死。
- `printf` 在 CubeIDE 里不会自己出门，要靠 s12 的 `_write` 重定向；没有重定向时不是"没捕获到"，而是"打印被丢进了黑洞"。
:::

::: note 为什么没用"数溢出"的写法
PSC=71 时量程只有 65.5ms（约 15Hz 以上），本课实验信号都在这个范围之上，所以最省事的写法就是**不数溢出**。真要测 5Hz，按练习 2 把 PSC 改成 287（一格 4μs）就够；非要保留 1μs 分辨率，才需要在 `HAL_TIM_PeriodElapsedCallback` 里加 `ovf++`，代价是多开一个中断、多维护一个变量。
:::

::: note 哪些代码"故意没写"
`MX_TIM2_Init()`、`HAL_TIM_IC_MspInit()`、`SystemClock_Config()` 都是 CubeMX 生成的：前者写 PSC/ARR/CCMR，`MspInit` 负责开 TIM2 时钟、把 PA0 配成复用功能、连 NVIC，后者配 72MHz。**手写它们没有好处，最容易漏的是开时钟**——漏了的现象是 `Start_IT` 返回 `HAL_ERROR`、中断永远不进。要改的是参数（PSC/ARR/Filter），不是这些函数本身。
:::

::: note 为什么 `(now - s_last) & 0xFFFF` 能处理溢出
CNT/CCR 只有 16 位，但 `HAL_TIM_ReadCapturedValue()` 返回的是 `uint32_t`。假设 `s_last = 65500`，`now` 绕回后是 `300`：

```
(300 - 65500) & 0xFFFF
= 4294902096 & 0xFFFF
= 336
```

直接相减会得到 4294902096；`& 0xFFFFU` 取低 16 位，才是真实经过的计数。只要两次捕获之间**最多绕一圈**，结果就是对的——这也是为什么 ARR 要设成 65535、并且要保证信号频率不低于量程下限。

这个技巧叫"无符号回绕减法 + 掩码"，定时器、DMA 计数器里到处都是，面试也常问。
:::

---

## 5. 同时量高电平宽度：PWMI 模式

只抓上升沿，你只知道周期。想知道**占空比**，还得知道高电平持续多久——那就需要"上升沿和下降沿都抓"。

最省事的做法是 **PWMI 模式**（PWM Input）：

- **CH1** 抓上升沿，捕获值存进 CCR1 → 得到周期
- **CH2** 抓下降沿（同一根引脚，内部连过去），捕获值存进 CCR2 → 得到高电平时间
- 从模式配成 **Reset Mode**：每次上升沿把 CNT 清零

这样每次上升沿，CNT 归零重新开始数；下降沿时 CCR2 记下的就是高电平宽度；下一个上升沿时 CCR1 记下的就是整个周期。

<svg class="diagram" viewBox="0 0 860 240" xmlns="http://www.w3.org/2000/svg">
  <text class="label" x="16" y="28" font-size="11.5">PWMI：一个引脚，两个通道，各抓一个边沿</text>
  <path d="M 60 110 L 60 70 L 180 70 L 180 110 L 340 110 L 340 70 L 460 70 L 460 110 L 620 110 L 620 70 L 740 70 L 740 110"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <line class="loop" x1="60" y1="130" x2="800" y2="130"/>

  <line class="arrow" x1="60" y1="168" x2="340" y2="168"/>
  <polygon class="arrowhead" points="340,164 350,168 340,172"/>
  <text class="sub" x="130" y="186" font-size="10">CCR1（上升沿）= 周期</text>

  <line class="arrow" x1="60" y1="212" x2="180" y2="212"/>
  <polygon class="arrowhead" points="180,208 190,212 180,216"/>
  <text class="sub" x="198" y="216" font-size="10">CCR2（下降沿）= 高电平宽度 → 占空比 = CCR2 / CCR1</text>
</svg>

CubeMX 里配法：

1. Channel1 → **PWM Input on CH1**（CubeMX 会自动把 CH2 也配成间接捕获）。
2. 从模式 `Slave Mode` → **Reset Mode**，触发源 `Trigger Source` → **TI1FP1**。
3. 中断照旧开 TIM2。

::: warn PWMI 最容易配错的两处
1. **忘了配从模式 Reset**：CNT 不清零，CCR2 记的是"从开机到现在的高电平结束时刻"，不是宽度。现象：占空比算出来永远大于 100%。
2. **触发源选成了 TI1FP2 或 TI2FP1**：清零和捕获对不上，周期值乱跳。必须让"清零"和"抓周期"用**同一个边沿源**（TI1FP1）。
:::

---

## 6. 编码器模式：读旋钮的方向和速度

旋转编码器（EC11）输出 **A、B 两路方波**，两路相位差 90°。正转时 A 领先 B，反转时 B 领先 A。

<svg class="diagram" viewBox="0 0 860 260" xmlns="http://www.w3.org/2000/svg">
  <text class="label" x="16" y="26" font-size="11.5">正转：A 上升沿时 B 还是低</text>
  <path d="M 60 80 L 60 56 L 120 56 L 120 80 L 180 80 L 180 56 L 240 56 L 240 80 L 300 80 L 300 56 L 360 56 L 360 80"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <text class="sub" x="14" y="72" font-size="10">A</text>
  <path d="M 60 130 L 60 106 L 150 106 L 150 130 L 210 130 L 210 106 L 300 106 L 300 130 L 360 130 L 360 106"
        stroke="#2c6fbb" stroke-width="2" fill="none"/>
  <text class="sub" x="14" y="122" font-size="10">B</text>

  <text class="label" x="16" y="180" font-size="11.5">反转：A 上升沿时 B 已经是高</text>
  <path d="M 60 230 L 60 206 L 120 206 L 120 230 L 180 230 L 180 206 L 240 206 L 240 230 L 300 230 L 300 206 L 360 206 L 360 230"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <text class="sub" x="420" y="214" font-size="10">A</text>
  <path d="M 60 250 L 60 226 L 90 226 L 90 250 L 150 250 L 150 226 L 210 226 L 210 250 L 270 250 L 270 226 L 330 226 L 330 250"
        stroke="#2c6fbb" stroke-width="2" fill="none"/>
  <text class="sub" x="420" y="244" font-size="10">B</text>
</svg>

定时器的**编码器模式**就是把 CNT 交给这两路信号驱动：

- 每一个有效边沿，硬件自动判断方向，然后 **CNT 加 1 或减 1**。
- 你完全不用写中断，CPU 只负责过一段时间读一次 CNT。

这又是一个"硬件自动化"：如果软件做，每个边沿都要进中断，旋钮一转快就丢步。

### 6.1 配置

`TIM3 → Combined Channels` 选 **Encoder Mode**：

| 配置项 | 值 | 理由 |
| --- | --- | --- |
| Encoder Mode | **TI1 and TI2** | 两路都用，4 倍频 |
| IC1 Polarity | Rising | 默认 |
| IC2 Polarity | Rising | 默认 |
| IC1/IC2 Filter | 0xF | 机械编码器必须滤波 |
| Counter Period | **65535** | 满量程 |

引脚：**PA6 = TIM3_CH1，PA7 = TIM3_CH2**。

### 6.2 读数和换算

编码器的读数属于驱动职责，放 `Hardware/`；`main.c` 只负责定时打印。编码器不占中断，`while` 里读就行。

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `encoder.h` | `Hardware/Inc/` | 启动、读增量、增量转 rpm |
| `encoder.c` | `Hardware/Src/` | 读 CNT、清零、`int16_t` 截断、rpm 换算 |
| `main.c` | `Core/Src/` | 初始化、每 10ms 打印一次 |
| `main.h`、`tim.c`、`gpio.c`、`stm32f1xx_hal_msp.c` | `Core/` | CubeMX 生成（Encoder Mode、PA6/PA7 复用），**不手写** |

**文件：`Hardware/Inc/encoder.h`**
```c
#ifndef __ENCODER_H
#define __ENCODER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define ENCODER_COUNTS_PER_REV   80U   /* 20 格/圈 × 4 倍频 */

void    Encoder_Start(void);                            /* 启动 TIM3 编码器模式 */
int16_t Encoder_ReadDelta(void);                        /* 读"净增量"并清零 CNT */
float   Encoder_DeltaToRpm(int16_t delta, uint32_t interval_ms);  /* 增量 → rpm */

#ifdef __cplusplus
}
#endif

#endif /* __ENCODER_H */
```

**文件：`Hardware/Src/encoder.c`**
```c
#include "encoder.h"
#include "tim.h"        /* htim3 */

void Encoder_Start(void)
{
  HAL_TIM_Encoder_Start(&htim3, TIM_CHANNEL_ALL);   /* 两路都要开，只开 CH1 会丢一半 */
}

int16_t Encoder_ReadDelta(void)
{
  /* CNT 是 16 位无符号的，反转时从 0 减到 65535；
   * 先截断到 16 位再转有符号，65535 就变成 -1 */
  int16_t cnt = (int16_t)__HAL_TIM_GET_COUNTER(&htim3);
  __HAL_TIM_SET_COUNTER(&htim3, 0);
  return cnt;
}

float Encoder_DeltaToRpm(int16_t delta, uint32_t interval_ms)
{
  /* delta/80 = 圈数；÷(interval_ms/1000) 秒 = 圈/秒；×60 = 圈/分 */
  return (float)delta / (float)ENCODER_COUNTS_PER_REV
         * (60000.0f / (float)interval_ms);
}
```

**文件：`Core/Src/main.c`**
```c
#include <stdio.h>          /* printf */
#include "main.h"
#include "gpio.h"
#include "tim.h"            /* htim3 */
#include "encoder.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_TIM3_Init();          /* Combined Channels = Encoder Mode，PA6/PA7 */

  Encoder_Start();

  while (1)
  {
    int16_t delta = Encoder_ReadDelta();                 /* 10ms 的净增量 */
    printf("cnt=%d rpm=%.1f\r\n",
           delta, Encoder_DeltaToRpm(delta, 10U));       /* 换算按 10ms 算 */
    HAL_Delay(10);
  }
}

/* 以下两个函数是 CubeMX 生成的固定内容，不用你手写 */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  osc.OscillatorType  = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState        = RCC_HSE_ON;
  osc.HSEPredivValue  = RCC_HSE_PREDIV_DIV1;
  osc.PLL.PLLState    = RCC_PLL_ON;
  osc.PLL.PLLSource   = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL      = RCC_PLL_MUL9;          /* 8MHz × 9 = 72MHz */
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) { Error_Handler(); }

  clk.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                     | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;          /* TIM3 时钟 72MHz */
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) { Error_Handler(); }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

::: note 这套写法省掉了什么、改错会怎样
- **一行中断都没写**：加减法由定时器硬件完成，CPU 只在 `HAL_Delay(10)` 醒来时读一次。若改成"每个边沿进外部中断、软件判 A/B"，手一转快就是丢步——这是 s11 反复强调的"能用硬件就别用软件"。
- `TIM_CHANNEL_ALL`：两路都要开。只传 `TIM_CHANNEL_1` 时 B 相不参与，现象是**转速只有一半、正反转也分不出来**。
- 常数 `60000/10 = 6000`：`Encoder_DeltaToRpm(delta, 10)` 内部就是按 10ms 换算。把 `HAL_Delay(10)` 改成 20，就必须传 `20U`，否则 rpm 整体差一倍——这是最常见的"转速不准"原因。
- `__HAL_TIM_GET_COUNTER` / `SET_COUNTER` 都是直接读写 CNT 寄存器的宏，不经过 HAL 状态机，所以慢速轮询完全安全；不用它俩、改成"记住上次值再相减"也行，只是多一个变量要维护。
- `MX_TIM3_Init()`、`HAL_TIM_Encoder_MspInit()`（开 TIM3 时钟、把 PA6/PA7 配成复用）都由 CubeMX 生成，没写在这里；手写只会漏时钟，现象是 `HAL_TIM_Encoder_Start` 返回 `HAL_ERROR`、CNT 一动不动。
:::

::: note 为什么计数要强转成 int16_t
CNT 寄存器是 16 位无符号的，反转时它会从 0 减到 65535。直接当 uint16_t 读，反转就成了"正向 65535 格"。

强转成 `int16_t` 后，65535 就是 -1，65530 就是 -6——正好是反转的格数。这也是"无符号看到的是环，有符号看到的是正负"的典型应用。

注意 `__HAL_TIM_GET_COUNTER` 返回的是 `uint32_t`，一定要先截断到 16 位再转有符号，否则高 16 位是 0，转出来还是正数。
:::

::: warn 编码器模式配错的三种现象
1. **方向反了**：正转读数变小。轿厢升降、电机测速这类场景会直接判错方向。改法：交换 A/B 两根线，或把其中一个通道的极性改成 Falling。
2. **不转也在跳数**：滤波没开（IC Filter = 0），触点抖动被当成边沿。现象是静止时 CNT 乱变，转速算出来是噪声。
3. **转得快就丢步**：用了"软件轮询 A 相 + 判 B 相"的写法。硬件编码器模式不会丢，软件会。**能用硬件就别用软件**。
:::

---

## 7. 算一算：这些数字必须能自己推

::: exercise 练习 1：从捕获值反推信号
PSC = 71，ARR = 65535，连续两次上升沿捕获到 `s_last = 10000`、`now = 22345`。

1. 信号周期是多少？
2. 频率是多少？
3. 这个信号用测周法合适吗？

::: answer
一个计数 = 72MHz / 72 = 1MHz → **1μs**。

1. 周期 = (22345 − 10000) × 1μs = **12345μs ≈ 12.35ms**
2. 频率 = 1 / 12.345ms ≈ **81Hz**
3. **合适**。81Hz 属于低频，测周法正好；而且 12.35ms 远小于 65.5ms 的量程上限，不会溢出。

如果改用测频法（1 秒闸门），1 秒里只有 81 个边沿，±1 的计数误差就是 ±1.2%——精度明显不如测周法的 1/12345 ≈ 0.008%。
:::
:::

::: exercise 练习 2：量程不够怎么办
要测一个 **5Hz** 的方波（周期 200ms），PSC = 71 时 CNT 只有 16 位。你怎么改配置？

::: answer
5Hz 的周期是 200ms = 200000μs，而 16 位最大只能数 65535μs ≈ 65.5ms，**必然溢出**。

方案一：**加大 PSC**。要让 200ms 落在 65535 个计数内：

$$200000\mu s / 65535 \approx 3.05\mu s/\text{格}$$

取 PSC = 215（216 分频，一格 3μs）→ 200ms 对应 66667 格，还是超了一点。取 PSC = 287（288 分频，一格 4μs）→ 50000 格 ✓。

代价：分辨率从 1μs 变成 4μs，测 200ms 的相对误差 4/200000 = 0.002%，完全够用。

方案二：**捕获中断里数溢出**。ARR 保持 65535，在 `HAL_TIM_PeriodElapsedCallback` 里 `ovf++`，周期 = `ovf × 65536 + (now - last)`。通用但要记得在两次捕获之间把 `ovf` 清零。

**先问自己"要多准"**，再决定值不值得写方案二。多数场景方案一就够了。
:::
:::

---

## 8. 动手项目

::: project
**旋钮调光 + 串口读数**

硬件：EC11 编码器接 PA6/PA7，LED 接 PA0（PWM，s10 已会）。

要实现：

1. 编码器每转一格，LED 占空比变化 5%（范围 0~100%）。
2. 每 200ms 通过串口打印一次 `cnt / 占空比`（串口在 s12 才正式讲，这里先用 `printf` + 重定向，或先只做前两步）。
3. 长按编码器自带的按键（接 PB0）：复位到 50%。

**验收标准**：

1. 慢慢转、快速转，占空比都**跟手**，不丢步（证明用了硬件编码器模式）。
2. 手不碰旋钮时，占空比**不漂移**（证明滤波生效）。
3. 正转变亮、反转变暗，方向符合直觉（不符合就交换 A/B）。

**加分**：用输入捕获测一个信号发生器输出的方波，和示波器读数对比，误差应小于 1%。

### 8.1 CubeMX 配置

| 外设/引脚 | 配置 | 说明 |
| --- | --- | --- |
| TIM2 | PSC=71、ARR=999、PWM Generation CH1、PWM1、Polarity=Low、OC Preload=Enable | PA0 输出 1kHz PWM |
| TIM3 | Combined Channels = Encoder Mode、Encoder Mode = TI1 and TI2、IC1/IC2 Filter=0xF、ARR=65535 | PA6/PA7 接 A/B |
| PA0 | TIM2_CH1 | 外接共阳极 LED |
| PB0 | GPIO_Input，Pull-up，User Label=`ENC_SW` | 编码器按键，按下为低 |
| NVIC | 不需要勾任何定时器中断 | 编码器和 PWM 都靠硬件 |

### 8.2 文件放置表

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `encoder.h` | `Hardware/Inc/` | 编码器/按键驱动 API |
| `encoder.c` | `Hardware/Src/` | 读 CNT 增量、4 计数=1 格、长按检测 |
| `dimmer.h` | `App/Inc/` | 调光业务 API、步进宏 |
| `dimmer.c` | `App/Src/` | 5%/格、限幅 0~100%、200ms 打印 |
| `main.c` | `Core/Src/` | 初始化、启动 PWM/编码器、主循环 |
| `main.h`、`tim.c`、`gpio.c`、`stm32f1xx_hal_msp.c` | `Core/` | CubeMX 生成（TIM2 PWM、TIM3 编码器、PA6/PA7 复用），**不手写** |

五个手写文件都是完整内容，按"头文件 → 驱动 → 业务 → main"排列。

**文件：`Hardware/Inc/encoder.h`**
```c
#ifndef __ENCODER_H
#define __ENCODER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define ENCODER_COUNTS_PER_DETENT   4      /* 4 倍频下，一格 = 4 个计数 */
#define ENCODER_LONG_MS             1000U  /* 按住 1 秒算长按 */

void    Encoder_Start(void);                  /* 启动 TIM3 编码器模式 */
int8_t  Encoder_ReadDetents(void);            /* 返回"转过几格"，正转正、反转负 */
uint8_t Encoder_ButtonLongPressed(void);      /* 长按返回一次 1，随后保持 0 */

#ifdef __cplusplus
}
#endif

#endif /* __ENCODER_H */
```

**文件：`App/Inc/dimmer.h`**
```c
#ifndef __DIMMER_H
#define __DIMMER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define DIMMER_STEP_PERCENT   5U     /* 每格 5% */
#define DIMMER_DEFAULT_PERCENT 50U   /* 上电/复位默认 50% */

void Dimmer_Init(void);              /* 占空比设为默认值 */
void Dimmer_Task(void);              /* 主循环调用：读旋钮、更新 PWM、定时打印 */

extern volatile uint8_t g_duty_percent;   /* 当前占空比 0~100 */

#ifdef __cplusplus
}
#endif

#endif /* __DIMMER_H */
```

**文件：`Hardware/Src/encoder.c`**
```c
#include "encoder.h"
#include "tim.h"        /* htim3 */

static int32_t s_remain = 0;   /* 不足一格的零头计数，跨调用累计 */

void Encoder_Start(void)
{
  HAL_TIM_Encoder_Start(&htim3, TIM_CHANNEL_ALL);   /* 两路都开 */
}

int8_t Encoder_ReadDetents(void)
{
  int16_t cnt = (int16_t)__HAL_TIM_GET_COUNTER(&htim3);  /* 先截断到 16 位 */
  __HAL_TIM_SET_COUNTER(&htim3, 0);                      /* 读后清零，下次只算增量 */

  s_remain += cnt;                                   /* 累计零头 */
  int8_t detents = (int8_t)(s_remain / ENCODER_COUNTS_PER_DETENT);
  s_remain -= (int32_t)detents * ENCODER_COUNTS_PER_DETENT;
  return detents;                                    /* 1 格 = 1，反转 = -1 */
}

uint8_t Encoder_ButtonLongPressed(void)
{
  static uint8_t  s_down     = 0;
  static uint8_t  s_reported = 0;
  static uint32_t s_tick     = 0;

  uint8_t pressed = (HAL_GPIO_ReadPin(ENC_SW_GPIO_Port, ENC_SW_Pin) == GPIO_PIN_RESET);

  if (!pressed) {                    /* 松开：清状态，允许下次再报 */
    s_down     = 0;
    s_reported = 0;
    return 0;
  }

  if (!s_down) {                     /* 刚按下：记时刻 */
    s_down = 1;
    s_tick = HAL_GetTick();
  }

  if (!s_reported && (HAL_GetTick() - s_tick >= ENCODER_LONG_MS)) {
    s_reported = 1;                  /* 本次按住只报一次 */
    return 1;
  }
  return 0;
}
```

**文件：`App/Src/dimmer.c`**
```c
#include <stdio.h>
#include "dimmer.h"
#include "encoder.h"
#include "tim.h"        /* htim2 */

volatile uint8_t g_duty_percent = DIMMER_DEFAULT_PERCENT;

static uint32_t s_last_print = 0;

/* 把 0~100 的百分比写到 TIM2_CH1；ARR=999，分母是 1000，所以 ×10 */
static void Dimmer_Apply(void)
{
  __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1,
                        (uint16_t)(g_duty_percent * 10U));
}

void Dimmer_Init(void)
{
  g_duty_percent = DIMMER_DEFAULT_PERCENT;
  Dimmer_Apply();
}

void Dimmer_Task(void)
{
  int8_t detents = Encoder_ReadDetents();   /* 转过几格 */

  if (detents != 0) {
    int16_t p = (int16_t)g_duty_percent + (int16_t)detents * (int16_t)DIMMER_STEP_PERCENT;
    if (p < 0)   p = 0;                     /* 限幅，避免 8 位整数回绕 */
    if (p > 100) p = 100;
    g_duty_percent = (uint8_t)p;
    Dimmer_Apply();
  }

  if (Encoder_ButtonLongPressed()) {        /* 长按复位到 50% */
    g_duty_percent = DIMMER_DEFAULT_PERCENT;
    Dimmer_Apply();
  }

  if (HAL_GetTick() - s_last_print >= 200U) {   /* 每 200ms 打印一次 */
    s_last_print = HAL_GetTick();
    printf("duty=%u%%\r\n", g_duty_percent);
  }
}
```

**文件：`Core/Src/main.c`**
```c
#include "main.h"
#include "gpio.h"
#include "tim.h"          /* htim2 / htim3 */
#include "encoder.h"
#include "dimmer.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();                                /* PA0 复用由 MspPostInit 处理，PB0 上拉输入 */
  MX_TIM2_Init();                                /* PSC=71、ARR=999、CH1 PWM1、极性 Low */
  MX_TIM3_Init();                                /* Encoder Mode TI1+TI2，PA6/PA7 */

  HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1);      /* 硬件 PWM 输出 */
  Encoder_Start();                               /* 硬件编码器计数 */

  Dimmer_Init();                                 /* 默认 50% */

  while (1)
  {
    Dimmer_Task();                               /* 读旋钮、改占空比、打印 */
  }
}

/* 以下两个函数是 CubeMX 生成的固定内容，不用你手写 */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  osc.OscillatorType  = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState        = RCC_HSE_ON;
  osc.HSEPredivValue  = RCC_HSE_PREDIV_DIV1;
  osc.PLL.PLLState    = RCC_PLL_ON;
  osc.PLL.PLLSource   = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL      = RCC_PLL_MUL9;          /* 8MHz × 9 = 72MHz */
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) { Error_Handler(); }

  clk.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                     | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;          /* TIM2/TIM3 时钟 72MHz */
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) { Error_Handler(); }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

**为什么要做"零头累计"**：一圈 20 格 × 4 倍频 = 80 个计数，但旋钮是连续转的，两次 `Dimmer_Task()` 之间可能只来了 3 个计数。如果直接 `cnt/4`，这 3 个计数会被丢掉，慢慢转时就会出现"转了好几格才动一下"。`s_remain` 把零头留到下一次，才能做到"每格必响应"。

**为什么用 `int8_t` 返回格数**：一格只可能是 -1/0/+1 这类小整数，`int8_t` 足够；转得再快，主循环也会很快再读一次。真正需要防溢出的是 `s_remain`，所以用 `int32_t`。

**为什么长按检测放驱动**：它读的是编码器按键的引脚，属于 `Hardware` 的职责；`Dimmer_Task` 只需要"有没有长按"这个结果，不用关心消抖状态机。

**为什么打印放 `App` 而不是 `main.c`**：打印的内容是"当前占空比"，属于业务状态；`main.c` 不应该知道 `g_duty_percent` 怎么算。

**哪些没写**：`MX_TIM2_Init()`、`MX_TIM3_Init()`、`HAL_TIM_PWM_MspInit()`、`HAL_TIM_Encoder_MspInit()`、`HAL_TIM_MspPostInit()`（PA0 复用）、`MX_GPIO_Init()` 全部由 CubeMX 生成。`htim2`/`htim3` 定义在 `tim.c`、声明在 `tim.h`，各文件只 include 头文件，不要重复定义。
:::

---

## 9. 本课小结

- 输入捕获 = 边沿到来时**硬件把 CNT 抄进 CCR**，精度远高于软件中断。
- **测频法**适合高频，**测周法**适合低频；捕获天然是测周法。
- 16 位 CNT 的量程 = 65536 个计数；PSC = 71 时只有 65.5ms，低频必须加 PSC 或数溢出。
- 无符号减法 `now - last` 自动处理一次回绕，这是定时器代码的通用技巧。
- **PWMI 模式**：CH1 抓周期、CH2 抓高电平，占空比 = CCR2/CCR1；从模式必须配 Reset。
- **编码器模式**：A/B 两路驱动 CNT 加减，4 倍频，不用中断；读数要强转 `int16_t`。
- 机械编码器/按键**必须开 IC Filter**，否则静止也在跳数。
- 配错的典型现象：滤波为 0 → 乱跳；方向反 → 交换 A/B；忘配 Reset → 占空比 > 100%。
- 工程结构：捕获/编码器读数放 `Hardware/` 或 `App/`，`main.c` 只做初始化和调任务。

::: selfcheck 自检
- [ ] 我能说出输入捕获和软件中断测时间的精度差别在哪
- [ ] 我能判断一个信号该用测频法还是测周法
- [ ] 我能由捕获值算出周期和频率
- [ ] 我知道 16 位 CNT 的量程怎么算、不够时怎么办
- [ ] 我能解释 `now - last` 为什么不怕溢出
- [ ] 我能说出 PWMI 模式两个通道各抓什么、从模式为什么必须 Reset
- [ ] 我知道编码器读数为什么强转 int16_t
- [ ] 我能说出滤波配错会看到什么现象
- [ ] 我能把捕获回调、编码器读数从 main.c 拆到独立文件
:::

---

## 10. 下一课预告

到这里，"定时器"这个外设的四种用法你都会了：

| 用法 | 方向 | 典型场景 |
| --- | --- | --- |
| 定时中断（s9） | 内部 | 周期任务 |
| PWM 输出（s10） | 输出 | 调光、舵机、电机 |
| 输入捕获（s11） | 输入 | 测频率、测脉宽 |
| 编码器（s11） | 输入 | 旋钮、测速 |

下一课 `s12 串口 UART`：这是**第一个真正的通信协议**。你会看到"一根线怎么把 0 和 1 排成队传过去"，以及为什么 115200 这个数字既不能随便改、又能容忍一点误差。
