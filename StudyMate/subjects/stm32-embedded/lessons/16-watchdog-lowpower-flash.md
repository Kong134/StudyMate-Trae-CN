---
node: s16
title: 看门狗、低功耗与 Flash 参数存储
type: concept
duration: 60
---

## 这一课要解决的问题

::: goal
读完你能：用独立看门狗让程序"跑飞了能自己回来"；由 LSI 频率和分频算出超时时间；说清睡眠/停机/待机三种低功耗模式的差别和唤醒源；把一组配置参数写进 Flash，断电不丢，并知道擦写 Flash 时最容易踩的坑。
:::

一个能演示的工程和一个能交付的产品之间，差的是三件事：**死机了怎么办、电池能用多久、设置怎么记住**。这一课一次讲完。

---

## 1. 看门狗：一个只会倒计时的闹钟

嵌入式设备常常无人值守：装在电表里、挂在墙上、埋在车里。程序一旦因为干扰、指针跑飞、某个 while 卡死，就永远不会自己好。

看门狗（Watchdog）的思路极其朴素：**一个独立的倒计时器，时间到了就复位整个芯片**。程序正常运行时，必须在它到点前"喂"它一次（重置计数）；程序卡死了，自然喂不了，芯片就被强制重启。

关键是：这个倒计时器**不依赖主程序**，用的是独立的时钟源（LSI，内部约 40kHz RC 振荡器），即使系统时钟挂了它还在跑。

### 1.1 独立看门狗 IWDG 的时间怎么算

$$\text{超时时间} = \frac{\text{预分频} \times \text{重装值}}{f_{LSI}}$$

- $f_{LSI} \approx 40kHz$（注意：RC 振荡器，**误差约 -25%/+50%**，实际可能 30~60kHz）
- 预分频可选 4 / 8 / 16 / 32 / 64 / 128 / 256
- 重装值是 12 位，0~4095

例：要 1 秒超时。

$$1s = \frac{\text{预分频} \times \text{重装值}}{40000}$$

取预分频 64：$40000 / 64 = 625Hz$，重装值 = **625** → 正好 1 秒。

::: warn LSI 误差 -25%/+50%，所以别把超时卡太紧
因为 LSI 是 RC 振荡器，标称 40kHz 实际可能是 30kHz 或 60kHz。你算出来 1 秒，实际可能是 0.67 秒或 1.33 秒。

如果你按"1 秒超时、每 900ms 喂一次"设计，遇到 LSI 偏快的芯片（60kHz → 实际 0.67s 超时），**正常程序也会被反复复位**。现象是：板子每隔不到 1 秒重启一次，串口反复打印启动信息，但代码逻辑明明没问题。

**经验：喂狗周期不超过理论超时的 1/2**。要 1 秒超时，就配 2 秒，然后每 500ms 喂一次。
:::

### 1.2 喂狗喂在哪：这是设计问题，不是代码问题

真实工程里，`main.c` 只做初始化、排任务顺序，**喂狗的"条件判断"放在 Hardware 层的一个小模块里**。这样 App 层想知道"系统还算健康吗"只需要调一个接口，不用关心 IWDG 句柄和标志位。

**文件：`Hardware/Inc/bsp_iwdg.h`**

```c
#ifndef __BSP_IWDG_H
#define __BSP_IWDG_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

/* 三个必须"完整跑完"的关键任务，用位表示；新增受监控任务就加一个枚举 */
typedef enum {
    BSP_IWDG_TASK_KEY = 0,
    BSP_IWDG_TASK_DISPLAY,
    BSP_IWDG_TASK_SENSOR,
    BSP_IWDG_TASK_NUM
} BSP_IwdgTask_t;

void BSP_IwdgStart(void);                     /* 进主循环前调用一次 */
void BSP_IwdgMarkDone(BSP_IwdgTask_t task);   /* 某个任务正常跑完一圈 */
void BSP_IwdgPoll(void);                      /* 全绿才喂狗，并清标志 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_IWDG_H */
```

**文件：`Hardware/Src/bsp_iwdg.c`**

```c
#include "bsp_iwdg.h"
#include "iwdg.h"      /* hiwdg 与 MX_IWDG_Init() 的声明在 Core/Inc/iwdg.h */

/* 3 个任务 → 0b111；用枚举数算，加任务时这里不用改 */
#define BSP_IWDG_ALL_DONE   ((uint8_t)((1U << BSP_IWDG_TASK_NUM) - 1U))

/* 只在主循环和它调用的任务里访问，不需要原子操作；volatile 防止编译器优化掉轮询 */
static volatile uint8_t s_done_mask;

void BSP_IwdgStart(void)
{
    s_done_mask = 0;

    /* 调试器暂停内核时冻结 IWDG 计数：DBGMCU_CR 的 IWDG_STOP 位 */
    __HAL_DBGMCU_FREEZE_IWDG();

    /* 进循环前先喂一次，从完整超时（约 2 秒）重新倒计时 */
    HAL_IWDG_Refresh(&hiwdg);
}

void BSP_IwdgMarkDone(BSP_IwdgTask_t task)
{
    if ((uint32_t)task < (uint32_t)BSP_IWDG_TASK_NUM) {
        s_done_mask |= (uint8_t)(1U << (uint32_t)task);
    }
}

void BSP_IwdgPoll(void)
{
    if (s_done_mask == BSP_IWDG_ALL_DONE) {
        HAL_IWDG_Refresh(&hiwdg);   /* 三个任务都跑完，才算系统活着 */
        s_done_mask = 0;            /* 清标志，下一圈重新计 */
    }
}
```

IWDG 的句柄和初始化是 CubeMX 生成的，单独放在 `Core/Src/iwdg.c`，**不要手写寄存器**：

**文件：`Core/Inc/iwdg.h`**

```c
#ifndef __IWDG_H__
#define __IWDG_H__

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

extern IWDG_HandleTypeDef hiwdg;

void MX_IWDG_Init(void);

#ifdef __cplusplus
}
#endif

#endif /* __IWDG_H__ */
```

**文件：`Core/Src/iwdg.c`**

```c
/* CubeMX 生成：System Core → IWDG 勾选后自动产生，参数改这里或改 .ioc 重新生成 */
#include "iwdg.h"

IWDG_HandleTypeDef hiwdg;

void MX_IWDG_Init(void)
{
  hiwdg.Instance = IWDG;
  hiwdg.Init.Prescaler = IWDG_PRESCALER_64;   /* 64 分频：40000/64 = 625Hz */
  hiwdg.Init.Reload = 1250;                   /* 625Hz 下计 1250 次 = 2 秒 */
  if (HAL_IWDG_Init(&hiwdg) != HAL_OK)
  {
    Error_Handler();
  }
}
```

`main.c` 里只剩"初始化 + 按顺序跑任务 + 报进度"：

**文件：`Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "adc.h"
#include "usart.h"
#include "iwdg.h"
#include "bsp_iwdg.h"
#include "app_main.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_ADC1_Init();
  MX_USART1_UART_Init();
  MX_IWDG_Init();          /* 预分频 64、重装值 1250 → 约 2 秒 */

  BSP_IwdgStart();         /* 冻结调试计数 + 首次喂狗 */
  App_Init();              /* 参数读取、串口/ADC 初始化，实现在 App/Src/app_main.c */

  while (1)
  {
    App_TaskKey();     BSP_IwdgMarkDone(BSP_IWDG_TASK_KEY);
    App_TaskDisplay(); BSP_IwdgMarkDone(BSP_IWDG_TASK_DISPLAY);
    App_TaskSensor();  BSP_IwdgMarkDone(BSP_IWDG_TASK_SENSOR);

    BSP_IwdgPoll();          /* 三件事都做完才喂狗 */
    HAL_Delay(10);           /* 一圈约几十 ms，远小于 2 秒超时 */
  }
}

/* CubeMX 生成的 72MHz 时钟配置：HSE 8MHz × 9 = 72MHz，APB1 二分频 36MHz */
void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState       = RCC_HSE_ON;
  osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  osc.HSIState       = RCC_HSI_ON;
  osc.PLL.PLLState   = RCC_PLL_ON;
  osc.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL     = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) { Error_Handler(); }

  clk.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                       RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;   /* 36MHz，USART2/3 用 */
  clk.APB2CLKDivider = RCC_HCLK_DIV1;   /* 72MHz，USART1/SPI1 用 */
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) { Error_Handler(); }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

**为什么这样拆**：`main.c` 变成一张"流程表"，喂狗的判据在 `bsp_iwdg.c` 里，谁都能复用；`iwdg.c` 是 CubeMX 的地盘，改超时只改它的两个参数，不会碰到业务代码。

**为什么这样写**：`HAL_IWDG_Refresh()` 本质是往 IWDG 的键寄存器写 `0xAAAA`，把 12 位计数器重新装回 1250；这行必须每圈都真的执行到，狗才有意义。先跑任务、后判标志，是因为"喂狗"要代表"所有关键任务都正常结束"——只喂不管任务，等于养了狗却不给它看门。

**为什么不用别的写法**：别在 SysTick/TIM 中断里喂（见下面的警告）；也别靠 `HAL_Delay` 的时长"顺便"喂，任务一旦把自己卡住，循环根本回不来。除 IWDG 就只有 WWDG（1.3 节），它由 PCLK1 驱动，防不了时钟故障，还要卡"喂早了也复位"的窗口，新手先用 IWDG。

**哪些没写**：LSI 使能、预分频与重装值的寄存器操作、`HAL_IWDG_MspInit()` 都由 CubeMX 生成（`Core/Src/stm32f1xx_hal_msp.c`）；`MX_IWDG_Init()` 在 `Core/Src/iwdg.c` 里，不用碰 `IWDG->KR`、`IWDG->PR`。要改超时就改 CubeMX 那两个参数，别去改喂狗代码。

::: warn 把喂狗放进定时器中断里，是典型的"假看门狗"
很多人图省事，在 1ms 的 SysTick 中断里喂狗。这样做的后果：

- 主循环里某个 `while` 卡死了，**中断照样在跑、狗照样被喂**，芯片永远不会复位。看门狗形同虚设。

看门狗要监控的是"**整个系统还活着**"，所以喂狗动作必须放在**主循环**里，且要确认所有关键任务都执行过了。

更严谨的做法：每个任务执行完置一个标志位，主循环检查"所有标志都置位"才喂狗、并清标志（就是上面的 `BSP_IwdgMarkDone()` + `BSP_IwdgPoll()`）。这样任何一个任务卡住，都会导致不喂狗。
:::

::: warn 调试时被狗咬
用 ST-Link 单步调试时，程序停在断点上，看门狗还在跑。一会儿芯片就复位了，调试根本没法进行。

解决办法已经写进 `Hardware/Src/bsp_iwdg.c` 的 `BSP_IwdgStart()` 第一行：`__HAL_DBGMCU_FREEZE_IWDG();`。

它置 `DBGMCU_CR` 的 `IWDG_STOP` 位：内核被调试器停住时，IWDG 计数也停。它不占 RAM、不改超时，只是告诉调试单元"我暂停时别让狗接着跑"。这是 HAL 的宏，`main.h` 里已经包含 `stm32f1xx_hal.h`，不用额外 `#include`；`DBGMCU` 也不用手动开时钟（调试单元常供电）。

不写它的代价：单步时每停 2 秒芯片复位一次，你会以为自己代码跑飞了。**为什么不用别的**：靠调试器配置里勾 freeze，换台电脑或新建工程就忘了；调试时干脆不初始化 IWDG，则是把狗关了做实验，问题会留到现场。

**不加这一句，你会以为是自己代码有 bug。**
:::

### 1.3 窗口看门狗 WWDG 一句话

WWDG 多一个"窗口"限制：**喂早了也会复位**。

- 它由 PCLK1 驱动（不是独立时钟），所以主时钟挂了它也不跑，不能防时钟故障。
- 用途是监控"**程序跑得太快**"——比如某个循环本该 10ms 跑一圈，结果 1ms 就转完了（跳过了某些步骤），提前喂狗会被 WWDG 抓住。

**新手先用 IWDG。** WWDG 是给"时序正确性"做保险的，面窄。

---

## 2. 低功耗：三种"睡着"的程度

STM32F103 有三种低功耗模式，区别在于**关掉了多少东西**。

| 模式 | 关掉什么 | 典型电流 | 唤醒源 | 唤醒后 |
| --- | --- | --- | --- | --- |
| **睡眠 Sleep** | 只停 CPU 时钟 | 几 mA | **任意中断** | 继续执行 |
| **停机 Stop** | 所有时钟（含 HSE/PLL） | ~20μA | **EXTI 线** | 继续执行（时钟恢复） |
| **待机 Standby** | 1.8V 域也断电，SRAM 丢失 | ~2μA | **WKUP 引脚 / RTC / IWDG** | **相当于复位**，从头跑 |

<svg class="diagram" viewBox="0 0 860 220" xmlns="http://www.w3.org/2000/svg">
  <rect x="40" y="60" width="220" height="90" rx="8" fill="none" stroke="#2c6fbb" stroke-width="2"/>
  <text class="sub" x="96" y="96" font-size="12">Sleep</text>
  <text class="sub" x="68" y="120" font-size="10">CPU 停，外设都在</text>

  <rect x="310" y="60" width="220" height="90" rx="8" fill="none" stroke="#2c6fbb" stroke-width="2"/>
  <text class="sub" x="374" y="96" font-size="12">Stop</text>
  <text class="sub" x="330" y="120" font-size="10">时钟全停，SRAM 保留</text>

  <rect x="580" y="60" width="220" height="90" rx="8" fill="none" stroke="#c0392b" stroke-width="2"/>
  <text class="sub" x="646" y="96" font-size="12">Standby</text>
  <text class="sub" x="600" y="120" font-size="10">几乎全断，醒来像复位</text>

  <text class="sub" x="40" y="190" font-size="10">越往右越省电，也越"难叫醒"、醒来越"健忘"。</text>
</svg>

### 2.1 进 Sleep 只要一行

低功耗的"进/出"封装统一放 `Hardware/bsp_power.c`，`App` 层只决定"什么时候可以睡"。

**文件：`Hardware/Inc/bsp_power.h`**

```c
#ifndef __BSP_POWER_H
#define __BSP_POWER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void BSP_PowerSleepOnce(void);       /* 睡到下一个中断，醒来从下一句继续 */
void BSP_PowerEnterStopOnce(void);   /* 睡到 EXTI 唤醒，醒来自动重配 72MHz */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_POWER_H */
```

**文件：`Hardware/Src/bsp_power.c`**

```c
#include "bsp_power.h"
#include "bsp_iwdg.h"

/* SystemClock_Config() 定义在 Core/Src/main.c（CubeMX 生成），这里只声明 */
void SystemClock_Config(void);

/* Sleep：只关 CPU 时钟，外设、时钟树、SRAM 全不动，任何中断都能唤醒 */
void BSP_PowerSleepOnce(void)
{
    __WFI();   /* CMSIS intrinsic，编译成一条 WFI 指令 */
}

/* Stop：关 HSE/PLL，SRAM 保留，只能由 EXTI 线唤醒 */
void BSP_PowerEnterStopOnce(void)
{
    BSP_IwdgStart();                       /* 0. 睡前喂狗并清任务标志（IWDG 在 Stop 里仍在跑） */

    HAL_SuspendTick();                     /* 1. 关 SysTick 中断，否则 1ms 就被叫醒 */

    HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON,   /* 2. 低压稳压器供电，SRAM 保住 */
                          PWR_STOPENTRY_WFI);         /*    WFI 睡下，等 EXTI */

    /* 3. 硬件已把系统时钟切回 HSI 8MHz，HSE/PLL 是停的 */
    SystemClock_Config();                  /* 4. 重跑 HSE→PLL→72MHz */
    HAL_ResumeTick();                      /* 5. 恢复 1ms 时基，HAL_Delay 才能计时 */
}
```

**为什么 Sleep 就一行**：Sleep 只关 CPU 时钟，外设、时钟树、SRAM 全不动，所以没有任何寄存器要配；`__WFI()` 是 CMSIS intrinsic，编译出来就是一条 `WFI` 指令。醒来从下一句继续跑，局部变量都还在。

**为什么不用别的**：它只把几 mA 降到 1~2mA，适合"等几十毫秒"的场合；要到 μA 级必须用 2.2 的 Stop，代价是多一堆收尾。

**哪些没写**：进入/退出 Sleep 不需要 `HAL_PWR_xxx`，也不用重配时钟，这是它比 Stop 省心的地方。但"什么时候允许睡"要你自己判断，比如主循环里 `if (!key_pending && !uart_busy) BSP_PowerSleepOnce();`，库不会替你做调度。

### 2.2 进 Stop 要配 EXTI

2.1 的 `BSP_PowerEnterStopOnce()` 就是完整的 Stop 流程：先喂一次狗，再按五步走，顺序不能换：

1. **`HAL_SuspendTick()`**：SysTick 是内核异常，睡下后它照样每 1ms 到期把 CPU 叫醒，现象是"电流几乎没降"。
2. **`HAL_PWR_EnterSTOPMode()`**：`PWR_LOWPOWERREGULATOR_ON` 让 1.8V 域继续供电，SRAM 内容保住；`PWR_STOPENTRY_WFI` 用等待中断的方式进入。
3. **醒来**：硬件自动把系统时钟切回 HSI 8MHz，HSE/PLL 已经停了。
4. **`SystemClock_Config()`**：重跑 72MHz。不重配，串口波特率按 8MHz 算会差 9 倍，看到的就是满屏乱码。
5. **`HAL_ResumeTick()`**：恢复 HAL 时基，`HAL_Delay` 才有正确的毫秒计数。

**为什么是这个顺序**：先停 Tick 才能真的睡下去，先恢复时钟才能让后面所有依赖 72MHz 的外设正常工作。把 `SystemClock_Config()` 放在 `HAL_ResumeTick()` 之后也常见，但**必须**在第一次用串口/定时器之前。

**为什么不用别的**：`PWR_STOPENTRY_WFE` 用"事件"唤醒，任何外设事件都行、不用 EXTI，但你分不清是谁叫醒的；课程统一 WFI + EXTI，唤醒源明确。想再省一个数量级就上 Standby（2.3），代价是醒来等于复位。

**哪些没写**：`__HAL_RCC_PWR_CLK_ENABLE()` 在 CubeMX 的 `HAL_PWR_MspInit()` 里，EXTI 的引脚映射和 NVIC 使能在 `MX_GPIO_Init()` 里（`Core/Src/gpio.c`），`SystemClock_Config()` 也是 CubeMX 生成——这三处都不该手写。

::: warn Stop 模式最常见的三个坑
1. **没停 SysTick**：`HAL_Delay` 依赖 SysTick，它每 1ms 中断一次，刚进 Stop 就被叫醒。现象是"电流没降下来，停在 20mA 而不是 20μA"。
2. **唤醒后没重配时钟**：Stop 唤醒后系统默认跑 HSI 8MHz，串口波特率全错、定时全慢 9 倍。现象是"唤醒后串口全是乱码"。
3. **用普通 GPIO 中断唤醒**：Stop 模式只有 **EXTI 线**能唤醒，且引脚要提前配成 EXTI。光配成普通输入中断不会唤醒。
:::

::: note 看门狗在 Stop 模式里还在跑
这条很容易被忽略：STM32F1 的 IWDG 挂在 VDD 域，**进入 Stop 后它照样计数**（Standby 才停）。

所以"2 秒看门狗 + 进 Stop 等按键"会互相打架：用户 3 秒不按键，芯片就被狗复位。工程上有两种正解（外加一个调试手段）：

1. **限制睡眠时长**：按 RTC 或定时唤醒，每段睡眠 < 超时的 1/2，醒来立刻喂狗再睡（最正规）。
2. **调试时冻结**：置 `DBGMCU_CR` 的 `IWDG_STOP` 位，调试器暂停内核时看门狗也停。它只在调试暂停时有效，Stop 模式不生效，不能当低功耗方案。
3. **接受复位**：本课项目把参数存在 Flash，复位不丢配置，醒来重新初始化即可（演示够用，产品不建议）。

面试里能主动说出这一条，说明你真的跑过低功耗 + 看门狗。
:::

### 2.3 Standby 适合"长期待机、偶尔工作"

传感器节点可以这样设计：采集 100ms → 进 Standby → RTC 闹钟 10 分钟后唤醒（实际是复位重跑）→ 再采集。

代价：**醒来等于复位**，所有 RAM 变量清零，必须把状态存进 Flash 或 BKP 备份寄存器才能延续。

::: note 三种模式怎么选：看"多久醒一次"
- 醒来频繁（几十 ms 一次，比如键盘扫描）：**Sleep**。省得不多，但恢复快，代码不用改。
- 醒来较慢（几百 ms ~ 几秒，比如无线收发间隙）：**Stop**。省 100 倍电流，代价是重配时钟。
- 醒来很慢（分钟级以上，比如水表上报）：**Standby**。省到极致，代价是状态要持久化。

**别为了省几微安把系统搞得极复杂**——先算清楚电池容量和平均电流，再决定值不值得。
:::

---

## 3. Flash 参数存储：掉电不丢的小本子

s14 讲过外部 SPI Flash。这一节讲**芯片内部的 Flash**——不用外接器件，直接用自己的程序区旁边那块空间存参数。

F103C8T6 有 **64KB Flash**，组织方式：

| 项目 | 值 |
| --- | --- |
| 起始地址 | **0x08000000** |
| 容量 | 64KB（0x08000000 ~ 0x0800FFFF） |
| 页大小 | **1KB** |
| 页数 | 64 页 |
| 擦除单位 | **页（1KB）** |
| 写入单位 | **半字（16 位 / 2 字节）** |
| 擦除后 | 全 **0xFF** |

和外部 Flash 的规律一样：**只能 1→0，擦除才能变回 1**。

### 3.1 选哪一页存参数

程序从 0x08000000 开始放，编译出来可能占 10~20KB。**参数要放在最后一页**，避开程序：

```
参数页地址 = 0x08000000 + 64KB - 1KB = 0x0800FC00
```

::: warn 擦错页 = 程序自毁
Flash 的擦除是**整页 1KB**。如果你把参数页地址算成了程序所在的页，一擦就把代码擦掉了。

现象：擦除后程序立刻跑飞、HardFault，或者复位后**完全没反应**（连启动信息都不打），只能重新烧录。

**保险做法**：在链接脚本/编译输出里确认程序实际占多大（`.map` 文件或 CubeIDE 的 Build Analyzer），参数页至少留出 1KB 余量。改代码后体积会变，重新确认一次。
:::

### 3.2 HAL 擦写流程

参数读写的全部实现放在 `Hardware/bsp_flash.c`，对外只暴露"加载 / 保存 / 恢复默认"三个接口。

**文件：`Hardware/Inc/bsp_flash.h`**

```c
#ifndef __BSP_FLASH_H
#define __BSP_FLASH_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

/* 最后一页：0x08000000 + 64KB - 1KB。改容量/改页大小必须同步改这里 */
#define PARAM_ADDR    0x0800FC00U
#define PARAM_MAGIC   0xA5A55A5AU
#define PARAM_DEFAULT_SAMPLE_MS   1000U
#define PARAM_DEFAULT_ALARM_MV    2500U

typedef struct {
    uint32_t magic;        /* 写过参数页的标记 */
    uint32_t sample_ms;    /* 采样间隔 */
    uint16_t alarm_mv;     /* 报警阈值 */
    uint16_t crc;          /* 覆盖前面所有字段，防写一半断电 */
} Param_t;

void        Param_Load(Param_t *p);          /* 读，magic/CRC 不对就填默认值 */
void        Param_Save(const Param_t *p);    /* 解锁→擦页→半字写→上锁 */
void        Param_Reset(Param_t *p);         /* 恢复默认值（只改 RAM，不写 Flash） */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_FLASH_H */
```

**文件：`Hardware/Src/bsp_flash.c`**

```c
#include "bsp_flash.h"
#include <string.h>
#include <stddef.h>

/* 编译期护栏：结构体一旦涨过一页，编译直接失败，而不是运行时擦掉程序 */
typedef char param_size_guard[(sizeof(Param_t) <= 1024U) ? 1 : -1];

/* CRC16-CCITT：多项式 0x1021，初值 0xFFFF，覆盖 magic + 数据字段 */
static uint16_t Crc16(const uint8_t *p, uint32_t len)
{
    uint16_t crc = 0xFFFFU;
    while (len--) {
        crc ^= (uint16_t)(*p++) << 8;
        for (uint8_t i = 0; i < 8U; i++) {
            crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
                                  : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

void Param_Reset(Param_t *p)
{
    p->magic     = PARAM_MAGIC;
    p->sample_ms = PARAM_DEFAULT_SAMPLE_MS;
    p->alarm_mv  = PARAM_DEFAULT_ALARM_MV;
    p->crc       = Crc16((const uint8_t *)p, offsetof(Param_t, crc));
}

/* 读：内部 Flash 可以直接当内存读 */
void Param_Load(Param_t *p)
{
    memcpy(p, (const void *)PARAM_ADDR, sizeof(Param_t));

    if (p->magic != PARAM_MAGIC) {          /* 从没写过，或者被擦除了 */
        Param_Reset(p);
        return;
    }
    if (p->crc != Crc16((const uint8_t *)p, offsetof(Param_t, crc))) {
        Param_Reset(p);                     /* 写一半断电：退回默认值 */
    }
}

/* 写：解锁 → 擦页 → 按半字写 → 上锁 */
void Param_Save(const Param_t *p)
{
    FLASH_EraseInitTypeDef er = {0};
    uint32_t page_err = 0;
    Param_t tmp = *p;
    uint16_t *src = (uint16_t *)&tmp;

    /* CRC 覆盖 magic + 数据，先算好再落盘 */
    tmp.crc = Crc16((const uint8_t *)&tmp, offsetof(Param_t, crc));

    HAL_FLASH_Unlock();                     /* 往 FLASH->KEYR 写 0x45670123、0xCDEF89AB */

    er.TypeErase   = FLASH_TYPEERASE_PAGES;
    er.PageAddress = PARAM_ADDR;            /* F1 填页首地址，没有 Sector 编号 */
    er.NbPages     = 1;
    if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
        HAL_FLASH_Lock();
        return;
    }

    /* F1 只有半字（16 位）编程；长度按半字向上取整 */
    for (uint32_t i = 0; i < (sizeof(Param_t) + 1U) / 2U; i++) {
        if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD,
                              PARAM_ADDR + i * 2U, src[i]) != HAL_OK) {
            HAL_FLASH_Lock();
            return;
        }
    }

    HAL_FLASH_Lock();                       /* 重新上锁，防跑飞的指针改程序区 */
}
```

**为什么是这四步**：`HAL_FLASH_Unlock()` 不写的话，后面的擦/写都会被硬件拒绝、返回 `HAL_ERROR`。擦除只能按页，`PageAddress` 填页首、`NbPages = 1`；F1 的页没有编号字段，不像 F4 要填 `Banks`、`Sector`。写入必须半字，所以把结构体当 `uint16_t*` 遍历；`(sizeof+1)/2` 是向上取整，防止奇数长度漏写最后半个字。末尾 `HAL_FLASH_Lock()` 重新上锁。

**为什么加 CRC 和编译期护栏**：magic 只能证明"这页看起来写过"，不能证明"写完过"——擦除后先写 magic 再写数据的中途断电，magic 对、数据烂。CRC 覆盖 magic + 数据字段，能抓住这种半成品。`param_size_guard` 用负长度数组在编译期报错（`sizeof` 超过 1KB 时数组长度变 -1），比运行时擦掉程序安全。

**为什么不用别的**：不能"改一个字节"（整页擦）；也不能用 `memcpy(p, ...)` 往 Flash 地址写——那只是 RAM 语义的写，不会触发编程，读回来仍是 `0xFF`。F1 的 FPEC 只支持**半字（16 位）编程**，HAL 也没有字编程模式；半字写入还要求地址 2 字节对齐，所以把结构体当 `uint16_t*` 遍历最稳。

**哪些没写**：Flash 的等待周期（`FLASH->ACR` 的 LATENCY）由 `SystemClock_Config()` 按 72MHz 配好；没开擦写中断，因为轮询足够（一次页擦几十 ms，这时也没别的事可干）。参数页没在链接脚本里 `KEEP`，所以 3.1 节"确认程序不越界"必须自己保证。

::: warn 四个最常见的 Flash 写入错误
1. **没解锁**：`HAL_FLASH_Program` 一直返回 `HAL_ERROR`。现象是"保存了但读出来还是旧值"。
2. **没擦除就写**：Flash 只能 1→0，旧数据和新数据按位与，读出来是乱码。现象是"参数越存越怪"。
3. **写入地址不是 2 字节对齐**：半字写入要求地址是偶数，奇数地址直接报错或写坏相邻字节。
4. **写一半断电**：结构体只写了一部分，`magic` 对了但数据是旧的/坏的。所以要有 **CRC 或双备份**：写之前先写 `magic = 0`，写完再写回真 magic；读的时候 magic/CRC 不对就用默认值。
:::

::: note 为什么不用 EEPROM 的思路"只改一个字节"
内部 Flash 最小擦除单位是 1KB。要改一个参数，必须：**读出整页 → 在 RAM 里改 → 擦整页 → 整页写回**。

这意味着：
- 擦写次数有限（约 1 万次），频繁保存会磨损（虽然对实验来说完全够）。
- 擦除时如果断电，整页数据全丢。所以**要么双页轮换（A 页写坏了用 B 页），要么接受"参数丢失回默认值"**。

真要频繁、可靠地存参数，用外部 EEPROM（如 AT24C02）或 FRAM。内部 Flash 适合"**偶尔写一次**"的配置。
:::

---

## 4. 算一算

::: exercise 练习 1：配一个 2 秒的看门狗
LSI 按 40kHz 算。要让 IWDG 超时约 2 秒，预分频和重装值怎么取？你实际应该多久喂一次？

::: answer
$$2s = \frac{\text{预分频} \times \text{重装值}}{40000}$$

取预分频 64 → $40000/64 = 625Hz$，重装值 = $625 \times 2 = 1250$（12 位最大 4095，合法）。

验证：$64 \times 1250 / 40000 = 2.0s$ ✓。

但 LSI 有 -25%/+50% 误差，实际超时可能是 **1.33s ~ 2.67s**。按最坏情况（1.33s），喂狗周期必须小于它的一半：

$$\text{喂狗周期} \leq 1.33 / 2 \approx 0.66s$$

所以主循环**每 500ms 喂一次**是安全的。如果主循环一圈要 800ms，就说明任务太重，该拆分或换更大的超时。

**结论：理论超时 × 0.5 是喂狗上限，再叠加 LSI 误差的余量。**
:::
:::

::: exercise 练习 2：参数页地址
F103C8T6 的 Flash 是 64KB，页大小 1KB。程序编译后占 18KB。参数页放在最后一页，地址是多少？为什么不能放在 0x08001000？

::: answer
Flash 范围：`0x08000000 ~ 0x0800FFFF`（64KB = 0x10000 字节）。

最后一页的起始：

$$0x08000000 + 64KB - 1KB = 0x08000000 + 0x10000 - 0x400 = 0x0800FC00$$

**不能放 0x08001000**，因为：

1. 0x08001000 是第 5 页（偏移 4KB），程序占 18KB 已经覆盖到 0x08004800 附近，**这一页是代码**。一擦就把程序擦掉。
2. 即使现在程序还没用到那一页，以后加功能就会撞上——这是个**定时炸弹**。

正确做法：参数页永远放在**最后**（0x0800FC00），并在代码里加编译期断言，保证结构体不会涨过一页。这条断言就是 `Hardware/Src/bsp_flash.c` 顶部的 `typedef char param_size_guard[(sizeof(Param_t) <= 1024U) ? 1 : -1];`（上一节的完整文件里已经包含）。

`sizeof(Param_t)` 超过 1024 时数组长度变成 -1，编译直接失败，而不是运行时踩坏别的页。

**为什么用负长度数组**：老标准 C 没有可用的 `static_assert` 时，这是唯一能"编译期报错"的手法。**为什么不用别的**：`assert` 是运行时的，等跑到才发现，那时可能已经擦错页；`#if` 只能判宏，判不了 `sizeof`。**哪些没写**：真正拦住"链接器把常量塞进参数页"要靠链接脚本独立 section + `KEEP`，这行只是自查提醒。

更严谨的工程会用链接脚本保留这一页（`KEEP` + 独立的 section），防止编译器把常量放进去。
:::
:::

---

## 5. 动手项目

::: project
**带看门狗和参数记忆的电压记录仪**

在 s15 的 ADC 基础上加三件事：

1. **IWDG**：2 秒超时，主循环每 500ms 喂一次。
2. **参数存储**：把"采样间隔"和"报警阈值"存进 `0x0800FC00`，上电读取，串口命令可修改并保存。
3. **低功耗**：空闲 5 秒（没有串口命令）后进入 **Stop 模式**，用 EXTI（按键）唤醒。

**验收标准**：

1. 在代码里故意加一个 `while(1);`，板子应在 2 秒内**自动复位**并重新打印启动信息（证明看门狗真的在工作）。
2. 断电再上电，串口打印的采样间隔和阈值是上次保存的值（证明 Flash 写入成功）。
3. 擦除参数页后上电，参数恢复默认值（证明 magic 判断生效）。
4. 进 Stop 模式后用万用表测电流，应从几十 mA 降到 **几十 μA** 量级。
5. 按键能把系统从 Stop 唤醒，且唤醒后串口输出**不乱码**（证明时钟重配了）。

**加分**：给参数加 CRC16，模拟"写到一半断电"（在写入中途手动复位），验证读取时能检测出损坏并回退默认值。

### 5.1 文件放置表

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `main.c` | `Core/Src` | 初始化 + 主循环排任务 + 喂狗节奏 |
| `main.h` | `Core/Inc` | 引脚宏、`SystemClock_Config`/`Error_Handler` 声明 |
| `iwdg.c` / `iwdg.h` | `Core/Src`、`Core/Inc` | CubeMX 生成的 IWDG 句柄与初始化 |
| `bsp_iwdg.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 三任务标志位 + 条件喂狗 |
| `bsp_flash.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 参数结构体、CRC16、读/写/恢复默认 |
| `bsp_power.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | Sleep / Stop 进出封装 |
| `bsp_adc.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | ADC1_IN0 采样与 mV 换算 |
| `bsp_uart.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 中断收字节、行缓冲、格式化打印 |
| `app_main.c` / `.h` | `App/Src`、`App/Inc` | 参数加载、串口命令、采样/上报/低功耗调度 |

CubeMX 已经生成、**不需要手写**的：`gpio.c`（含 KEY1 的 EXTI 配置）、`adc.c`、`usart.c`、`stm32f1xx_it.c`（含 `EXTI0_IRQHandler`）、`stm32f1xx_hal_msp.c`、`system_stm32f1xx.c`、启动文件、链接脚本、`Drivers/` 整棵树。

下面按"头文件 → 驱动 `.c` → App `.c` → `main.c`"给全部文件的完整代码。

### 5.2 头文件

**文件：`Core/Inc/main.h`**

```c
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

/* 与 CubeMX 的 .ioc 保持一致；改引脚必须两边一起改 */
#define KEY1_Pin        GPIO_PIN_0
#define KEY1_GPIO_Port  GPIOB
#define LED_Pin         GPIO_PIN_13
#define LED_GPIO_Port   GPIOC

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
```

注意：`SystemClock_Config()` 不用 `static`——`Hardware/Src/bsp_power.c` 从 Stop 唤醒后要调它重配 72MHz，所以它在 `main.c` 里定义、在 `bsp_power.c` 顶部 extern 声明。

**文件：`Core/Inc/iwdg.h`**

```c
#ifndef __IWDG_H__
#define __IWDG_H__

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

extern IWDG_HandleTypeDef hiwdg;

void MX_IWDG_Init(void);

#ifdef __cplusplus
}
#endif

#endif /* __IWDG_H__ */
```

**文件：`Hardware/Inc/bsp_iwdg.h`**

```c
#ifndef __BSP_IWDG_H
#define __BSP_IWDG_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

typedef enum {
    BSP_IWDG_TASK_KEY = 0,
    BSP_IWDG_TASK_DISPLAY,
    BSP_IWDG_TASK_SENSOR,
    BSP_IWDG_TASK_NUM
} BSP_IwdgTask_t;

void BSP_IwdgStart(void);
void BSP_IwdgMarkDone(BSP_IwdgTask_t task);
void BSP_IwdgPoll(void);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_IWDG_H */
```

**文件：`Hardware/Inc/bsp_flash.h`**

```c
#ifndef __BSP_FLASH_H
#define __BSP_FLASH_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define PARAM_ADDR               0x0800FC00U
#define PARAM_MAGIC              0xA5A55A5AU
#define PARAM_DEFAULT_SAMPLE_MS  1000U
#define PARAM_DEFAULT_ALARM_MV   2500U

typedef struct {
    uint32_t magic;
    uint32_t sample_ms;
    uint16_t alarm_mv;
    uint16_t crc;
} Param_t;

void Param_Load(Param_t *p);
void Param_Save(const Param_t *p);
void Param_Reset(Param_t *p);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_FLASH_H */
```

**文件：`Hardware/Inc/bsp_power.h`**

```c
#ifndef __BSP_POWER_H
#define __BSP_POWER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void BSP_PowerSleepOnce(void);
void BSP_PowerEnterStopOnce(void);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_POWER_H */
```

**文件：`Hardware/Inc/bsp_adc.h`**

```c
#ifndef __BSP_ADC_H
#define __BSP_ADC_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void     BSP_AdcInit(void);
uint16_t BSP_AdcReadMv(void);   /* 8 次平均后的毫伏值，3.3V 参考 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_ADC_H */
```

**文件：`Hardware/Inc/bsp_uart.h`**

```c
#ifndef __BSP_UART_H
#define __BSP_UART_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void    BSP_UartInit(void);
uint8_t BSP_UartReadLine(char *out, uint16_t out_size);   /* 收到一整行返回 1 */
void    BSP_UartPrintf(const char *fmt, ...);             /* 阻塞发送，一行几十字节 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_UART_H */
```

### 5.3 驱动源文件

**文件：`Core/Src/iwdg.c`**

```c
#include "iwdg.h"

IWDG_HandleTypeDef hiwdg;

void MX_IWDG_Init(void)
{
  hiwdg.Instance = IWDG;
  hiwdg.Init.Prescaler = IWDG_PRESCALER_64;   /* 40000Hz / 64 = 625Hz */
  hiwdg.Init.Reload = 1250;                   /* 625 × 2 = 1250 → 2 秒 */
  if (HAL_IWDG_Init(&hiwdg) != HAL_OK)
  {
    Error_Handler();
  }
}
```

**文件：`Hardware/Src/bsp_iwdg.c`**

```c
#include "bsp_iwdg.h"
#include "iwdg.h"

#define BSP_IWDG_ALL_DONE   ((uint8_t)((1U << BSP_IWDG_TASK_NUM) - 1U))

static volatile uint8_t s_done_mask;

void BSP_IwdgStart(void)
{
    s_done_mask = 0;
    __HAL_DBGMCU_FREEZE_IWDG();
    HAL_IWDG_Refresh(&hiwdg);
}

void BSP_IwdgMarkDone(BSP_IwdgTask_t task)
{
    if ((uint32_t)task < (uint32_t)BSP_IWDG_TASK_NUM) {
        s_done_mask |= (uint8_t)(1U << (uint32_t)task);
    }
}

void BSP_IwdgPoll(void)
{
    if (s_done_mask == BSP_IWDG_ALL_DONE) {
        HAL_IWDG_Refresh(&hiwdg);
        s_done_mask = 0;
    }
}
```

**文件：`Hardware/Src/bsp_flash.c`**

```c
#include "bsp_flash.h"
#include <string.h>
#include <stddef.h>

typedef char param_size_guard[(sizeof(Param_t) <= 1024U) ? 1 : -1];

static uint16_t Crc16(const uint8_t *p, uint32_t len)
{
    uint16_t crc = 0xFFFFU;
    while (len--) {
        crc ^= (uint16_t)(*p++) << 8;
        for (uint8_t i = 0; i < 8U; i++) {
            crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
                                  : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

void Param_Reset(Param_t *p)
{
    p->magic     = PARAM_MAGIC;
    p->sample_ms = PARAM_DEFAULT_SAMPLE_MS;
    p->alarm_mv  = PARAM_DEFAULT_ALARM_MV;
    p->crc       = Crc16((const uint8_t *)p, offsetof(Param_t, crc));
}

void Param_Load(Param_t *p)
{
    memcpy(p, (const void *)PARAM_ADDR, sizeof(Param_t));

    if (p->magic != PARAM_MAGIC ||
        p->crc != Crc16((const uint8_t *)p, offsetof(Param_t, crc))) {
        Param_Reset(p);
    }
}

void Param_Save(const Param_t *p)
{
    FLASH_EraseInitTypeDef er = {0};
    uint32_t page_err = 0;
    Param_t tmp = *p;
    uint16_t *src = (uint16_t *)&tmp;

    tmp.crc = Crc16((const uint8_t *)&tmp, offsetof(Param_t, crc));

    HAL_FLASH_Unlock();

    er.TypeErase   = FLASH_TYPEERASE_PAGES;
    er.PageAddress = PARAM_ADDR;
    er.NbPages     = 1;
    if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
        HAL_FLASH_Lock();
        return;
    }

    for (uint32_t i = 0; i < (sizeof(Param_t) + 1U) / 2U; i++) {
        if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD,
                              PARAM_ADDR + i * 2U, src[i]) != HAL_OK) {
            HAL_FLASH_Lock();
            return;
        }
    }

    HAL_FLASH_Lock();
}
```

**文件：`Hardware/Src/bsp_power.c`**

```c
#include "bsp_power.h"
#include "bsp_iwdg.h"

/* SystemClock_Config() 定义在 Core/Src/main.c（CubeMX 生成），这里只声明 */
void SystemClock_Config(void);

void BSP_PowerSleepOnce(void)
{
    __WFI();
}

void BSP_PowerEnterStopOnce(void)
{
    BSP_IwdgStart();                     /* 睡前把看门狗重新计时（见 2.2 的 note） */

    HAL_SuspendTick();
    HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON, PWR_STOPENTRY_WFI);

    SystemClock_Config();                /* HSI 8MHz → HSE/PLL 72MHz */
    HAL_ResumeTick();
}
```

**文件：`Hardware/Src/bsp_adc.c`**

```c
#include "bsp_adc.h"
#include "adc.h"

#define ADC_SAMPLES   8U

void BSP_AdcInit(void)
{
    /* 校准必须在 ADC 使能之后、第一次转换之前；CubeMX 已在 MX_ADC1_Init 里使能 */
    HAL_ADCEx_Calibration_Start(&hadc1);
}

uint16_t BSP_AdcReadMv(void)
{
    uint32_t sum = 0;
    uint8_t  n   = 0;

    for (uint8_t i = 0; i < ADC_SAMPLES; i++) {
        HAL_ADC_Start(&hadc1);
        if (HAL_ADC_PollForConversion(&hadc1, 10U) == HAL_OK) {
            sum += HAL_ADC_GetValue(&hadc1);
            n++;
        }
        HAL_ADC_Stop(&hadc1);
    }

    if (n == 0U) {
        return 0;
    }
    /* 12 位、3.3V 参考：mv = code × 3300 / 4096 */
    return (uint16_t)((sum * 3300U) / ((uint32_t)n * 4096U));
}
```

**文件：`Hardware/Src/bsp_uart.c`**

```c
#include "bsp_uart.h"
#include "usart.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define RX_RING_SIZE   128U
#define LINE_MAX       64U

static uint8_t  s_ring[RX_RING_SIZE];
static volatile uint16_t s_head;
static volatile uint16_t s_tail;
static char     s_line[LINE_MAX];
static uint16_t s_line_len;
static uint8_t  s_rx_byte;

void BSP_UartInit(void)
{
    s_head = s_tail = 0;
    s_line_len = 0;
    HAL_UART_Receive_IT(&huart1, &s_rx_byte, 1);   /* 每次收 1 字节，中断里再挂下一次 */
}

/* 覆盖 HAL 的弱回调；SysTick 之外的 USART1 中断入口在 Core/Src/stm32f1xx_it.c */
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart->Instance == USART1) {
        uint16_t next = (uint16_t)((s_head + 1U) % RX_RING_SIZE);
        if (next != s_tail) {          /* 满则丢新字节，不覆盖旧数据 */
            s_ring[s_head] = s_rx_byte;
            s_head = next;
        }
        HAL_UART_Receive_IT(&huart1, &s_rx_byte, 1);
    }
}

uint8_t BSP_UartReadLine(char *out, uint16_t out_size)
{
    while (s_tail != s_head) {
        char c = (char)s_ring[s_tail];
        s_tail = (uint16_t)((s_tail + 1U) % RX_RING_SIZE);

        if (c == '\r' || c == '\n') {
            if (s_line_len == 0U) {
                continue;              /* 连续换行忽略 */
            }
            uint16_t n = (s_line_len < (uint16_t)(out_size - 1U))
                       ? s_line_len : (uint16_t)(out_size - 1U);
            memcpy(out, s_line, n);
            out[n] = '\0';
            s_line_len = 0;
            return 1;
        }

        if (s_line_len < (LINE_MAX - 1U)) {
            s_line[s_line_len++] = c;
        } else {
            s_line_len = 0;            /* 超长行直接丢弃，防止溢出 */
        }
    }
    return 0;
}

void BSP_UartPrintf(const char *fmt, ...)
{
    char buf[96];
    va_list ap;
    int n;

    va_start(ap, fmt);
    n = vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);

    if (n <= 0) {
        return;
    }
    if (n > (int)sizeof(buf) - 1) {
        n = (int)sizeof(buf) - 1;
    }
    HAL_UART_Transmit(&huart1, (uint8_t *)buf, (uint16_t)n, 100U);
}
```

### 5.4 App 层

**文件：`App/Inc/app_main.h`**

```c
#ifndef __APP_MAIN_H
#define __APP_MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_Init(void);
void App_TaskKey(void);       /* 解析串口命令行 */
void App_TaskDisplay(void);   /* 每秒打印一次状态 */
void App_TaskSensor(void);    /* 按 sample_ms 采样 */
void App_TaskPower(void);     /* 空闲 5 秒进 Stop */

#ifdef __cplusplus
}
#endif

#endif /* __APP_MAIN_H */
```

**文件：`App/Src/app_main.c`**

```c
#include "app_main.h"
#include "bsp_adc.h"
#include "bsp_flash.h"
#include "bsp_uart.h"
#include "bsp_power.h"
#include "bsp_iwdg.h"
#include <stdio.h>
#include <string.h>

Param_t  g_param;                 /* 全局唯一一份，App 内部读写 */

static uint16_t s_last_mv;
static uint32_t s_last_sample_ms;
static uint32_t s_last_print_ms;
static uint32_t s_last_cmd_ms;

void App_Init(void)
{
    BSP_AdcInit();
    BSP_UartInit();
    Param_Load(&g_param);         /* magic/CRC 不对自动回默认值 */

    s_last_sample_ms = HAL_GetTick();
    s_last_print_ms  = s_last_sample_ms;
    s_last_cmd_ms    = s_last_sample_ms;

    BSP_UartPrintf("\r\n[recorder] sample=%lums alarm=%umV\r\n",
                   (unsigned long)g_param.sample_ms, (unsigned)g_param.alarm_mv);
    BSP_UartPrintf("cmd: get | save | reset | set int <ms> | set th <mv>\r\n");
}

void App_TaskKey(void)
{
    char line[64];
    unsigned long v;

    if (BSP_UartReadLine(line, sizeof(line)) == 0U) {
        return;
    }
    s_last_cmd_ms = HAL_GetTick();

    if (strcmp(line, "get") == 0) {
        BSP_UartPrintf("sample=%lums alarm=%umV\r\n",
                       (unsigned long)g_param.sample_ms, (unsigned)g_param.alarm_mv);
    } else if (strcmp(line, "save") == 0) {
        Param_Save(&g_param);
        BSP_UartPrintf("saved to 0x%08lX\r\n", (unsigned long)PARAM_ADDR);
    } else if (strcmp(line, "reset") == 0) {
        Param_Reset(&g_param);
        BSP_UartPrintf("default restored (RAM only, send save to persist)\r\n");
    } else if (sscanf(line, "set int %lu", &v) == 1 && v >= 100UL && v <= 60000UL) {
        g_param.sample_ms = (uint32_t)v;
        BSP_UartPrintf("sample=%lums (send save)\r\n", v);
    } else if (sscanf(line, "set th %lu", &v) == 1 && v <= 3300UL) {
        g_param.alarm_mv = (uint16_t)v;
        BSP_UartPrintf("alarm=%lumV (send save)\r\n", v);
    } else {
        BSP_UartPrintf("bad cmd\r\n");
    }
}

void App_TaskSensor(void)
{
    if ((HAL_GetTick() - s_last_sample_ms) < g_param.sample_ms) {
        return;
    }
    s_last_sample_ms = HAL_GetTick();
    s_last_mv = BSP_AdcReadMv();
}

void App_TaskDisplay(void)
{
    if ((HAL_GetTick() - s_last_print_ms) < 1000U) {
        return;
    }
    s_last_print_ms = HAL_GetTick();
    BSP_UartPrintf("mv=%u th=%u %s\r\n", (unsigned)s_last_mv, (unsigned)g_param.alarm_mv,
                   (s_last_mv >= g_param.alarm_mv) ? "ALARM" : "ok");
}

void App_TaskPower(void)
{
    uint32_t now = HAL_GetTick();

    /* 采样是内部节奏，不算"活动"；只要 5 秒没有串口命令就进 Stop */
    if ((now - s_last_cmd_ms) < 5000U) {
        return;
    }

    BSP_UartPrintf("enter STOP, press KEY1 to wake\r\n");
    HAL_Delay(20);                    /* 等最后一行发完再关时钟 */
    BSP_PowerEnterStopOnce();         /* 内部会先喂狗；LSI 的狗在 Stop 里仍在跑 */

    s_last_cmd_ms = s_last_sample_ms = s_last_print_ms = HAL_GetTick();
    BSP_UartPrintf("wake up, sysclk=72MHz\r\n");
}
```

### 5.5 main.c

**文件：`Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "adc.h"
#include "usart.h"
#include "iwdg.h"
#include "bsp_iwdg.h"
#include "app_main.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();              /* 含 KEY1=PB0 的 EXTI0，CubeMX 生成 */
  MX_ADC1_Init();
  MX_USART1_UART_Init();
  MX_IWDG_Init();

  BSP_IwdgStart();
  App_Init();

  while (1)
  {
    App_TaskKey();     BSP_IwdgMarkDone(BSP_IWDG_TASK_KEY);
    App_TaskDisplay(); BSP_IwdgMarkDone(BSP_IWDG_TASK_DISPLAY);
    App_TaskSensor();  BSP_IwdgMarkDone(BSP_IWDG_TASK_SENSOR);

    BSP_IwdgPoll();
    App_TaskPower();          /* 不算关键任务，不参与喂狗判据 */

    HAL_Delay(10);
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState       = RCC_HSE_ON;
  osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  osc.HSIState       = RCC_HSI_ON;
  osc.PLL.PLLState   = RCC_PLL_ON;
  osc.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL     = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) { Error_Handler(); }

  clk.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                       RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) { Error_Handler(); }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

### 5.6 为什么这么组织

**为什么 main.c 这么薄**：它只负责"上电顺序"——时钟 → 引脚 → 外设 → 看门狗 → App → 循环。业务（命令、参数、采样节奏）全在 `App/app_main.c`，硬件细节全在 `Hardware/`。想换一块板，只改 `Hardware/` 和引脚宏，`main.c` 不动。

**为什么 Stop 的判断放在 App 而不是 `bsp_power.c`**：`bsp_power` 只回答"怎么睡、怎么醒"，"现在能不能睡"是业务策略（有没有命令、有没有采样），只能 App 知道。混在一起，换一个产品就要改驱动。

**为什么看门狗用"三任务标志"而不是简单刷新**：`App_TaskKey`/`Display`/`Sensor` 任意一个卡住（比如串口阻塞、ADC 死等），标志就凑不齐，狗不喂、2 秒后复位。这比"主循环随便喂一下"多一层保护。

**为什么不用别的方案**：不用 WWDG（由 PCLK1 驱动，Stop 后时钟停，且要算窗口）；不用 `HAL_Delay` 里顺手喂（阻塞任务就永远喂不到）；不在 `HAL_UART_RxCpltCallback` 里喂（中断还活着不代表主循环活着）。

**哪些没写、默认值是多少**：`gpio.c`/`adc.c`/`usart.c` 全是 CubeMX 生成——KEY1 配成 `GPIO_MODE_IT_FALLING`、上拉，NVIC 优先级默认 4；ADC1_IN0 独立模式、12 位、采样时间 55.5 周期；USART1 115200-8-N-1、开启 RXNE 中断。这些默认值直接影响行为：EXTI 忘了配就无法从 Stop 唤醒；USART1 没开中断就收不到命令。启动文件、链接脚本、`Drivers/` 也不用手写。

**做验收 4/5 之前**：IWDG 在 Stop 里仍在计数，2 秒内不按键就会被复位。要么把唤醒周期压到 1 秒以内、醒来立刻喂狗；要么把 IWDG 预分频改成 128、重装值改成 2500（约 8 秒）留出按键时间。F103 没有 `IWDG_STOP` 选项字节，Stop 模式下不能靠它冻结看门狗。
:::

---

## 6. 本课小结

- 看门狗 = **独立倒计时器**，到点复位；IWDG 用 LSI 40kHz，**误差约 -25%/+50%**。
- 超时 = `预分频 × 重装值 / 40000`；喂狗周期不超过理论值的 **1/2**。
- **喂狗必须在主循环**，放在中断里等于没开看门狗；调试时要 `__HAL_DBGMCU_FREEZE_IWDG()`。
- 三种低功耗：**Sleep**（任意中断唤醒）、**Stop**（EXTI 唤醒，要停 SysTick、醒后重配时钟）、**Standby**（醒来等于复位）。
- **IWDG 在 Stop 里还在计数**，长时间 Stop 要么分段唤醒喂狗（调试时可用 `DBGMCU_CR` 的 `IWDG_STOP` 仅冻结调试暂停），要么接受复位。
- 内部 Flash：`0x08000000` 起，**64KB / 1KB 一页 / 半字写入 / 擦除变 0xFF**。
- 参数页放**最后一页 0x0800FC00**，擦错页会毁掉程序。
- 写入四步：**解锁 → 擦页 → 按半字写 → 上锁**；未擦除直接写会得到按位与的乱码。
- 写一半断电要用 **magic + CRC / 双备份**兜底。

::: selfcheck 自检
- [ ] 我能由 LSI 和分频算出 IWDG 超时，并说明为什么要留一倍余量
- [ ] 我能解释"喂狗放中断里"为什么是假看门狗
- [ ] 我能说出三种低功耗模式的电流量级和唤醒源
- [ ] 我知道 Stop 模式必须停 SysTick、唤醒后要重配时钟
- [ ] 我知道 IWDG 在 Stop 里仍在跑，以及三种应对办法
- [ ] 我能算出参数页地址并说明为什么不能放程序区
- [ ] 我能默写 Flash 擦写的四步流程
- [ ] 我能说出"没解锁 / 没擦除 / 不对齐 / 写一半断电"各自的现象
:::

---

## 7. 下一课预告

到这里，**裸机（不带操作系统）的能力已经完整了**：GPIO、中断、定时器、通信、采集、存储、可靠性。

但裸机有个天花板：任务一多，"谁先跑、跑多久"全靠你自己排，一个慢任务会拖死所有任务。

下一课 `s17 FreeRTOS 入门`：引入操作系统，让多个任务"看起来同时在跑"，用队列传数据、用信号量同步。这是嵌入式岗位的分水岭。

