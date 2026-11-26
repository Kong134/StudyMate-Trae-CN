---
node: s6
title: SysTick 与延时：做一个不阻塞的定时框架
type: practice
duration: 60
---

## 这一课要解决的问题

::: goal
读完你能：说清 SysTick 的三个寄存器怎么工作；解释 `HAL_Delay` 的实现和两个致命缺陷；用"时间戳差值法"写出同时跑三个周期任务的非阻塞框架；知道 49 天溢出的坑怎么绕。
:::

前面的代码里，`HAL_Delay(500)` 已经用了三次，但它是**阻塞**的。这一课把这件事解决掉，顺便把"中断"的门推开一条缝。

---

## 1. SysTick 是什么

SysTick 是 **Cortex-M3 内核自带**的定时器，不属于任何厂商的外设。它只有三个寄存器：

| 寄存器 | 作用 |
| --- | --- |
| `LOAD` | 重装值。计数器从多少开始倒数 |
| `VAL` | 当前值。每来一个时钟减 1 |
| `CTRL` | 控制：使能、时钟源选择、中断使能 |

工作方式：`VAL` 从 `LOAD` 开始**递减**到 0 → 产生一次中断 → 自动重装 `LOAD` → 继续。

<svg class="diagram" viewBox="0 0 820 260" xmlns="http://www.w3.org/2000/svg">
  <rect class="box" x="20" y="20" width="200" height="60" rx="8"/>
  <text class="label" x="36" y="44" font-size="12">时钟源</text>
  <text class="sub" x="36" y="64" font-size="10.5">72MHz 或 8MHz</text>

  <rect class="box acc" x="250" y="20" width="200" height="60" rx="8"/>
  <text class="label" x="266" y="44" font-size="12">VAL 递减计数</text>
  <text class="sub" x="266" y="64" font-size="10.5">24 位，最大 16777215</text>

  <rect class="box" x="480" y="20" width="180" height="60" rx="8"/>
  <text class="label" x="496" y="44" font-size="12">减到 0</text>
  <text class="sub" x="496" y="64" font-size="10.5">产生中断 + 重装</text>

  <line class="arrow" x1="220" y1="50" x2="246" y2="50"/>
  <polygon class="arrowhead" points="246,46 256,50 246,54"/>
  <line class="arrow" x1="450" y1="50" x2="476" y2="50"/>
  <polygon class="arrowhead" points="476,46 486,50 476,54"/>

  <path class="loop" d="M 570 80 L 570 130 L 350 130 L 350 84"/>
  <text class="sub" x="400" y="148" font-size="10.5">从 LOAD 重新开始</text>

  <rect class="box" x="20" y="170" width="300" height="70" rx="8"/>
  <text class="label" x="36" y="194" font-size="11.5">HAL 的用法：1ms 一次</text>
  <text class="sub" x="36" y="214" font-size="10.5">LOAD = 72MHz/1000 − 1 = 71999</text>
  <text class="sub" x="36" y="232" font-size="10.5">中断里执行 uwTick++</text>

  <rect class="box" x="340" y="170" width="280" height="70" rx="8"/>
  <text class="label" x="356" y="194" font-size="11.5">uwTick</text>
  <text class="sub" x="356" y="214" font-size="10.5">uint32_t，全局变量</text>
  <text class="sub" x="356" y="232" font-size="10.5">开机以来经过的毫秒数</text>

  <rect class="box" x="640" y="170" width="160" height="70" rx="8"/>
  <text class="label" x="654" y="194" font-size="11.5">HAL_GetTick()</text>
  <text class="sub" x="654" y="214" font-size="10.5">只是 return uwTick</text>
  <text class="sub" x="654" y="232" font-size="10.5">读一个变量而已</text>

  <line class="arrow" x1="620" y1="205" x2="636" y2="205"/>
  <polygon class="arrowhead" points="636,201 646,205 636,209"/>
</svg>

::: note 为什么 LOAD 要减 1
因为计数器是**从 LOAD 数到 0**，包含两端共 `LOAD + 1` 个数。

要 1000 次计数（1ms），就填 999。填 1000 会变成 1001 次，慢 0.1%。

这个"+1"在定时器和 SysTick 里到处都是，是计算题最常见的失分点。记住：**计数值 = 目标值 + 1**。
:::

---

## 2. HAL 在 `HAL_Init()` 里做了什么

```text
HAL_Init()                                          /* Core/Src/main.c 第一句，CubeMX 生成 */
  └─ HAL_InitTick(TICK_INT_PRIORITY)                /* Drivers/.../stm32f1xx_hal.c */
       ├─ HAL_SYSTICK_Config(SystemCoreClock / 1000)  /* stm32f1xx_hal_cortex.c，配 LOAD = 71999 */
       └─ HAL_NVIC_SetPriority(SysTick_IRQn, 15, 0)   /* 优先级设为最低 */
```

注意这不是能编译的 C 代码，只是一棵"谁调用谁"的树。真正的实现分散在三个地方：

| 你在哪看到 | 文件 | 作用 |
| --- | --- | --- |
| `HAL_Init()` | `Core/Src/main.c` | 你唯一要写的调用，开机第一句 |
| `HAL_InitTick()` / `HAL_SYSTICK_Config()` | `Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c`、`stm32f1xx_hal_cortex.c` | 库函数，配 LOAD 和中断优先级 |
| `SysTick_Handler()` | `Core/Src/stm32f1xx_it.c` | CubeMX 生成，函数体只有一句 `HAL_IncTick()` |

**为什么这几段都不用你写**：SysTick 的初始化在 `HAL_Init()` 里统一做了，中断入口由 CubeMX 写进 `stm32f1xx_it.c`。你手写一遍只会重复劳动，还可能和库里的定义冲突（同名函数重复定义，链接报错）。

**想改会怎样**：把 `HAL_Init()` 删掉，`HAL_GetTick()` 永远是 0、`HAL_Delay` 直接死等；把 `stm32f1xx_it.c` 里的 `SysTick_Handler` 删掉，`uwTick` 不再自增。要换 tick 频率不要改这里，调 `HAL_SYSTICK_Config()` 的入参（一般也不用动）。

然后 `SysTick_Handler()`（在 `stm32f1xx_it.c` 里）调用 `HAL_IncTick()`，也就是 `uwTick++`。

**注意优先级设为 15**——这是 Cortex-M3 里**最低**的优先级（数值越小优先级越高）。这个设计有深意：

::: key 为什么 SysTick 优先级最低
因为它只是个"计时打点"的后台任务，不该抢占任何真实的业务中断（串口收数据、按键、ADC 转换完成）。

如果 SysTick 优先级很高，它每秒打断 1000 次，高优先级的业务中断就会被推迟，串口可能丢字节。

**代价**是：如果某个中断的优先级比 SysTick 高，并且在这个中断里调用 `HAL_Delay`，`uwTick` 就不会涨，`HAL_Delay` 永远等不到——死机。
:::

---

## 3. `HAL_Delay` 的两个致命缺陷

**文件：`Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c`**（HAL 库源码，**不用你写、不要改**）

```c
/* 文件：Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c
 * 这是 HAL 库源码，你工程里的 HAL_Delay(500) 最终都进到这里。
 * 只读、不要改：CubeMX 重新生成会把 Drivers/ 目录覆盖掉。
 */
void HAL_Delay(uint32_t Delay)
{
  uint32_t tickstart = HAL_GetTick();     /* 记下起始时刻（ms） */
  uint32_t wait = Delay;                  /* 要等多少 ms */

  if (wait < HAL_MAX_DELAY)               /* HAL_MAX_DELAY = 0xFFFFFFFF */
  {
    wait += (uint32_t)(uwTickFreq);       /* uwTickFreq 默认 1，保证至少等 1 个 tick */
  }

  while ((HAL_GetTick() - tickstart) < wait)
  {
    /* 空转，什么都不干 */
  }
}
```

逐句看：

- `tickstart = HAL_GetTick()`：把"开始等"的时刻存下来，后面只比较差值，不关心绝对时间。
- `wait += uwTickFreq`：`uwTickFreq` 是 tick 的步长，默认 1。这句保证 `HAL_Delay(0)` 也至少等 1ms——否则传 0 会立刻返回，某些驱动会因此抢跑。把它去掉，`HAL_Delay(0)` 就变成"不等"，一般看不出问题，但库作者的防御就没了。
- `while ((HAL_GetTick() - tickstart) < wait)`：**忙等**。CPU 在这里反复读 `uwTick`，一直读到差值够为止。

**为什么不用 `for (i = 0; i < 100000; i++);` 这种软件延时**：一是编译器开着优化会直接把空循环删掉，时间变成 0；二是循环次数和主频、编译优化等级强绑定，换块板或改 `-O2` 就完全不准。

**为什么不用一个硬件定时器专门做延时**：那要额外占一个 TIM，还要写初始化、启动、等标志；SysTick 是内核自带的，不占外设，`HAL_Init()` 已经顺手配好了。

### 缺陷一：CPU 空转

`HAL_Delay(500)` 的这 500ms 里，CPU 在执行一个空的 `while` 循环，每秒几百万次，**什么正事都干不了**。

如果你的程序要同时：闪灯（500ms）、扫按键（10ms）、收串口（随时）、刷新显示（100ms），用 `HAL_Delay` 就会全部串行化——闪灯的时候按键完全没响应。

### 缺陷二：在中断里调用会死锁

前面说了，SysTick 优先级最低（15）。如果在优先级更高的中断里调用 `HAL_Delay`：

1. 中断抢占 CPU，SysTick 中断被挂起，`uwTick` 停止增长；
2. 中断里死等 `uwTick` 变化；
3. 但 SysTick 中断永远进不来，因为当前中断优先级更高；
4. **死锁**，看门狗会复位（如果开了的话）。

::: warn 这是面试必问题
"为什么不能在中断服务函数里调用 HAL_Delay？"

标准答案要包含两点：① SysTick 优先级最低，高优先级中断里它无法抢占，`uwTick` 不再递增；② `HAL_Delay` 是忙等，本质依赖中断推进，所以形成死锁。
:::

---

## 4. 解法：时间戳差值法

核心思路：**不问"过了多久"，只问"现在到点了吗"**。

**文件：`Core/Src/main.c`**（完整文件；只有 `last_led` 和 `while (1)` 里那三行是你加的）

```c
/* Core/Src/main.c —— 用时间戳差值做非阻塞闪灯 */
#include "main.h"
#include "gpio.h"

/* USER CODE BEGIN Includes */
/* USER CODE END Includes */

/* USER CODE BEGIN PV */
static uint32_t last_led = 0;           /* 上次翻转的时刻，单位 ms，初值 0 */
/* USER CODE END PV */

void SystemClock_Config(void);

int main(void)
{
  /* USER CODE BEGIN 1 */
  /* USER CODE END 1 */

  HAL_Init();                           /* 配 SysTick：1ms 中断，优先级 15 */
  SystemClock_Config();                 /* 72MHz */
  MX_GPIO_Init();                       /* PC13 推挽输出 */

  /* USER CODE BEGIN 2 */
  /* 不用额外初始化：SysTick 在 HAL_Init() 里已经跑起来了 */
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    if (HAL_GetTick() - last_led >= 500)     /* 到点了吗？没到就立刻返回 */
    {
      last_led = HAL_GetTick();              /* 记下本次执行的实际时刻 */
      HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);/* 翻转一次 = 500ms 亮、500ms 灭 */
    }
    /* USER CODE END 3 */
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState       = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.PLL.PLLState   = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL     = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                                   | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}
```

这样主循环每转一圈都检查一次，**没到点就立刻返回**，CPU 可以去做别的事。

为什么是这几句：

- `500`：想要的周期（ms）。写 1000 就是 1 秒闪一次；写 0 会变成"每圈都翻"，灯看起来是常亮半亮——不是代码错，是逻辑变成了高频翻转。
- `>= 500` 而不是 `== 500`：主循环一圈可能跨过正好等于 500 的那一刻，用 `==` 会漏过去，之后再也等不到，任务"卡死"。`>=` 越过一点也算到。
- `last_led` 初值 0：上电后 `HAL_GetTick()` 远大于 500，所以第一圈就立刻翻转一次，符合"上电即开始"的直觉。
- 用 `static` 修饰：变量要跨循环保留值，放函数外或加 `static` 都行；写成局部变量每次进函数就归零，永远等不到。
- 这里的 `while (1)` 由 CubeMX 生成，你只往 `USER CODE BEGIN 3` 里塞逻辑，重新生成代码不会被覆盖。

### 4.1 为什么写成减法

写成 `HAL_GetTick() > last_led + 500` 也有同样效果，但有两个隐患：

1. **溢出**：`uwTick` 是 32 位无符号数，约 49.7 天溢出归零。归零瞬间 `now` 变成 0，而 `last + 500` 可能仍是接近 $2^{32}$ 的大数；如果 `last` 离回绕超过 500ms，`now > last + 500` 会一直为假，最长要等将近 49.7 天才会再次成立。即使没这么极端，也会漏触发一次。
2. **编译器优化**：某些情况下 `last + 500` 的计算可能有问题。

而 `HAL_GetTick() - last >= 500` 是**无符号减法**，靠模运算自动正确：

举个 8 位数的例子（原理同 32 位）：

- `last = 250`，`now = 10`（已溢出绕回）
- `now - last = 10 - 250`，8 位无符号下等于 `-240 mod 256 = 16`
- 16 < 500？不，但按 8 位算 500 也不合理……

用 32 位实际数据：

- `last = 0xFFFFFF00`，`now = 0x00000100`（绕回了）
- `now - last = 0x00000100 - 0xFFFFFF00 = 0x00000200 = 512`
- 512 ≥ 500 → **正确判定已到点**

真实经过的毫秒数就是 512（从 0xFFFFFF00 到绕回再到 0x100），减法算出来分毫不差。

::: key 无符号减法的魔力
`a - b` 在无符号数里等于"从 b 走到 a 经过了多少步"，**不管中间有没有绕回**。

所以时间比较只写一种形式：`现在 - 上次 >= 间隔`。永远不要写 `现在 > 上次 + 间隔`。
:::

### 4.2 `last = now` 还是 `last += 500`

| 写法 | 效果 |
| --- | --- |
| `last = HAL_GetTick();` | 以"实际执行时刻"为基准，长期会累积抖动（因为每次循环有微小延迟） |
| `last += 500;` | 以"理论时刻"为基准，长期平均周期精确，但若某次任务超时会连续补触发 |

- **要长期精确**（做时钟、秒表）→ `last += interval`
- **要避免补偿爆发**（做闪灯、采样）→ `last = now`

另一种更稳的写法是 `last += interval;` 之后检查 `if (now - last >= interval) last = now;`（防止任务卡太久后疯狂补跑）。初期先不用，知道这个取舍就够了。

---

## 5. 三任务并行：把框架搭起来

框架属于业务调度，放 `App/`：`app_sched` 负责"什么时候跑"，`app_tasks` 负责"跑什么"，`main.c` 只调用一次 `App_Sched_Run()`。

**文件：`App/Inc/app_sched.h`**（调度器接口，自己写）

```c
/* App/Inc/app_sched.h —— 极简协作式调度器 */
#ifndef __APP_SCHED_H
#define __APP_SCHED_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define APP_SCHED_MAX  8U        /* 最多 8 个任务；表满时 Add 返回 0 */

typedef struct
{
  uint32_t period;               /* 周期，ms */
  uint32_t last;                 /* 上次执行时刻 */
  void   (*task)(void);          /* 任务函数地址 */
} app_task_t;

void    App_Sched_Init(void);                              /* 清空任务表 */
uint8_t App_Sched_Add(uint32_t period_ms, void (*task)(void)); /* 1=成功 0=失败 */
void    App_Sched_Run(void);                               /* 主循环反复调用 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_SCHED_H */
```

**文件：`App/Src/app_sched.c`**（调度器实现）

```c
/* App/Src/app_sched.c */
#include "app_sched.h"

static app_task_t s_tasks[APP_SCHED_MAX];
static uint8_t    s_count = 0;      /* 已登记的任务数 */

void App_Sched_Init(void)
{
  uint8_t i;

  for (i = 0; i < APP_SCHED_MAX; i++)
  {
    s_tasks[i].period = 0;
    s_tasks[i].last   = 0;
    s_tasks[i].task   = 0;
  }
  s_count = 0;
}

uint8_t App_Sched_Add(uint32_t period_ms, void (*task)(void))
{
  if (s_count >= APP_SCHED_MAX || task == 0 || period_ms == 0U)
  {
    return 0;                        /* 表满或参数非法，调用方自己决定怎么处理 */
  }

  s_tasks[s_count].period = period_ms;
  s_tasks[s_count].last   = HAL_GetTick();   /* 从登记这一刻开始计时 */
  s_tasks[s_count].task   = task;
  s_count++;
  return 1;
}

void App_Sched_Run(void)
{
  uint8_t i;

  for (i = 0; i < s_count; i++)
  {
    if (HAL_GetTick() - s_tasks[i].last >= s_tasks[i].period)
    {
      s_tasks[i].last = HAL_GetTick();   /* 先记时间，再干活 */
      s_tasks[i].task();                 /* 通过函数指针调用 */
    }
  }
}
```

**文件：`App/Inc/app_tasks.h`**（本课三个演示任务）

```c
/* App/Inc/app_tasks.h */
#ifndef __APP_TASKS_H
#define __APP_TASKS_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_Tasks_Init(void);   /* 把三个任务登记进调度器 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_TASKS_H */
```

**文件：`App/Src/app_tasks.c`**（任务函数本身）

```c
/* App/Src/app_tasks.c —— 三个周期不同的任务 */
#include "app_tasks.h"
#include "app_sched.h"

static uint32_t s_beat = 0;        /* 100ms 计数器，调试器里看它涨得快不快 */

static void Task_Led(void)         /* 500ms：翻转 PC13 */
{
  HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
}

static void Task_Key(void)         /* 10ms：课 4 的消抖采样 */
{
  /* 这里放 Key_Scan()；本课只演示框架，先空着 */
}

static void Task_Beat(void)        /* 100ms：计数 */
{
  s_beat++;
}

void App_Tasks_Init(void)
{
  App_Sched_Init();
  App_Sched_Add(500, Task_Led);
  App_Sched_Add(10,  Task_Key);
  App_Sched_Add(100, Task_Beat);
}
```

**文件：`Core/Src/main.c`**（完整文件）

```c
/* Core/Src/main.c —— 入口：只启动调度器 */
#include "main.h"
#include "gpio.h"
#include "app_sched.h"
#include "app_tasks.h"

/* USER CODE BEGIN Includes */
/* USER CODE END Includes */

/* USER CODE BEGIN PV */
/* USER CODE END PV */

void SystemClock_Config(void);

int main(void)
{
  /* USER CODE BEGIN 1 */
  /* USER CODE END 1 */

  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();

  /* USER CODE BEGIN 2 */
  App_Tasks_Init();      /* 内部会调 App_Sched_Add() 登记三个任务 */
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    App_Sched_Run();     /* 谁到点跑谁，没到点的立刻跳过 */
    /* USER CODE END 3 */
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState       = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.PLL.PLLState   = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL     = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                                   | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}
```

几个"为什么这么写"：

- **`last` 在 `App_Sched_Add()` 里设成 `HAL_GetTick()`**：从登记那一刻开始计时，所以三个任务都要等满一个周期才第一次跑（按键 10ms、计数 100ms、闪灯 500ms）。想要"上电立刻跑一次"，把 `last` 设成 `HAL_GetTick() - period_ms`（无符号回绕），这属于进阶用法，先不引入。
- **循环变量 `i` 用 `uint8_t`**：`s_count` 最多到 `APP_SCHED_MAX`（8），`uint8_t` 足够；时间戳才用 `uint32_t`，两者别混。
- **`s_tasks[i].last = HAL_GetTick()` 放调用之前**：如果任务函数耗时较长，先记时间可以避免下一圈把这段时间也算进周期；放后面则会把执行时间累加进去，周期变长。
- **表大小用宏 `APP_SCHED_MAX`**：只有一处定义，加任务只改 `App_Sched_Add()` 的次数；写死数字的后果是加任务时越界不报错。
- **为什么用函数指针表，而不是 `switch (i)` 或一长串 `if`**：函数指针把"要干什么"和"什么时候干"分开，加任务只多一次 `App_Sched_Add()`；`switch` 写法每加一个任务要改两处，容易漏。代价是多一次间接跳转（几个周期），在这个量级可以忽略。
- **哪些没写**：`HAL_Init()`、`SystemClock_Config()`、`MX_GPIO_Init()` 和 `while (1)` 骨架都由 CubeMX 生成；调度器、任务函数全部在 `App/` 的 `.c` 里，`main.c` 只有一句 `App_Sched_Run()`，重新生成代码也不会丢。

这个结构的三个优点：

1. **零阻塞**：每个任务只占几十个周期，转一圈不到 10μs。
2. **可扩展**：加任务只要多一次 `App_Sched_Add()`。
3. **周期独立**：10ms 的按键不会被 500ms 的闪灯拖慢。

::: note 这就是"协作式调度"的雏形
你刚写的这个东西，本质是一个极简的任务调度器。FreeRTOS 做的是同一件事，只不过它用**抢占**（高优先级任务随时打断低优先级）而不是轮询，并且有栈隔离、队列、信号量。

理解了这个数组，s17 学 RTOS 时你会觉得"只是换了个更强的方式"。
:::

::: warn 这个框架的局限
它**不能处理"必须立刻响应"的事件**。

比如串口突然来了一帧数据，你要等主循环转到这个任务才能处理，最坏情况延迟 = 一圈循环时间。如果循环里有耗时操作（比如刷 OLED 要 20ms），串口就会丢数据。

解决方式就是**中断**——这正是 s7 要讲的内容。轮询 + 中断组合使用，才是完整方案。
:::

---

## 6. 动手项目

::: project
**三节奏系统**

用同一块板同时跑三件事，互不干扰：

1. **PC13 每 500ms 翻转一次**（1Hz 闪灯）
2. **每 10ms 采样一次按键 PA0**（带课 4 的 20ms 消抖）
3. **每 100ms 让一个变量 `beat++`**，短按按键时把 `beat` 清零

**验收标准**：
1. 按键响应**明显快于**闪灯周期——按下去立刻有反应，不用等灯闪完。
2. 三个周期互不漂移（用调试器看 `beat`，10 秒应该增加约 100）。
3. 把 `HAL_Delay(500)` 替换成框架后，用 Live Expressions 看循环次数，每秒几十万次，说明没有阻塞。

**加分**：给 `app_task_t` 加一个 `enabled` 标志，做成"可运行时启停"，体会一下这离真正的调度器有多近。

**文件放置表**：

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `main.h` | `Core/Inc/` | CubeMX 生成，含 `KEY_Pin` / `KEY_GPIO_Port` |
| `gpio.h` / `gpio.c` | `Core/Inc/` / `Core/Src/` | PA0 输入上拉、PC13 推挽输出（CubeMX 生成） |
| `key.h` / `key.c` | `Hardware/Inc/` / `Hardware/Src/` | 按键驱动：10ms 采样、20ms 消抖 |
| `app_sched.h` / `app_sched.c` | `App/Inc/` / `App/Src/` | 调度器：时间戳差值 + 函数指针表 |
| `app_tasks.h` / `app_tasks.c` | `App/Inc/` / `App/Src/` | 三个任务的实现与登记 |
| `main.c` | `Core/Src/` | 只调 `App_Tasks_Init()` 和 `App_Sched_Run()` |

一、头文件

**文件：`Core/Inc/main.h`**

```c
/* Core/Inc/main.h —— CubeMX 生成；KEY 是 PA0 的 User Label */
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

void Error_Handler(void);

#define KEY_Pin GPIO_PIN_0
#define KEY_GPIO_Port GPIOA

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
```

**文件：`Core/Inc/gpio.h`**

```c
/* Core/Inc/gpio.h —— CubeMX 生成 */
#ifndef __GPIO_H
#define __GPIO_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void MX_GPIO_Init(void);

#ifdef __cplusplus
}
#endif

#endif /* __GPIO_H */
```

**文件：`Hardware/Inc/key.h`**

```c
/* Hardware/Inc/key.h —— 按键驱动（20ms 消抖） */
#ifndef __KEY_H
#define __KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define KEY_SCAN_MS      10U     /* 采样周期 10ms */
#define KEY_CONFIRM_CNT  2U      /* 连续 2 次 = 20ms 确认 */

typedef enum
{
  KEY_NONE = 0,                  /* 本周期无事件 */
  KEY_DOWN                       /* 刚按下（下降沿，已消抖） */
} KeyEvent;

KeyEvent Key_Scan(void);

#ifdef __cplusplus
}
#endif

#endif /* __KEY_H */
```

**文件：`App/Inc/app_sched.h`**

```c
/* App/Inc/app_sched.h —— 极简协作式调度器 */
#ifndef __APP_SCHED_H
#define __APP_SCHED_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define APP_SCHED_MAX  8U

typedef struct
{
  uint32_t period;               /* 周期，ms */
  uint32_t last;                 /* 上次执行时刻 */
  void   (*task)(void);          /* 任务函数地址 */
} app_task_t;

void    App_Sched_Init(void);
uint8_t App_Sched_Add(uint32_t period_ms, void (*task)(void));
void    App_Sched_Run(void);

#ifdef __cplusplus
}
#endif

#endif /* __APP_SCHED_H */
```

**文件：`App/Inc/app_tasks.h`**

```c
/* App/Inc/app_tasks.h —— 三节奏系统的任务接口 */
#ifndef __APP_TASKS_H
#define __APP_TASKS_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

extern volatile uint32_t g_beat;   /* 100ms 计数，调试器里观察用 */

void App_Tasks_Init(void);

#ifdef __cplusplus
}
#endif

#endif /* __APP_TASKS_H */
```

二、驱动 / 调度 .c

**文件：`Core/Src/gpio.c`**（CubeMX 生成）

```c
/* Core/Src/gpio.c */
#include "gpio.h"

void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOC_CLK_ENABLE();

  /* PC13：推挽输出，初始高电平（灭） */
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET);
  GPIO_InitStruct.Pin   = GPIO_PIN_13;
  GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull  = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOC, &GPIO_InitStruct);

  /* PA0：输入 + 上拉 */
  GPIO_InitStruct.Pin  = KEY_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(KEY_GPIO_Port, &GPIO_InitStruct);
}
```

**文件：`Hardware/Src/key.c`**

```c
/* Hardware/Src/key.c —— 10ms 采样 + 连续 2 次确认 */
#include "key.h"

static uint32_t last_scan  = 0;
static uint8_t  stable_cnt = 0;
static uint8_t  key_state  = 1;    /* 1=松开，0=按下 */

KeyEvent Key_Scan(void)
{
  uint8_t raw;

  if (HAL_GetTick() - last_scan < KEY_SCAN_MS)
  {
    return KEY_NONE;
  }
  last_scan = HAL_GetTick();

  raw = (HAL_GPIO_ReadPin(KEY_GPIO_Port, KEY_Pin) == GPIO_PIN_SET) ? 1 : 0;

  if (raw != key_state)
  {
    if (++stable_cnt >= KEY_CONFIRM_CNT)
    {
      key_state = raw;
      stable_cnt = 0;

      if (key_state == 0)             /* 1→0：按下 */
      {
        return KEY_DOWN;
      }
    }
  }
  else
  {
    stable_cnt = 0;
  }

  return KEY_NONE;
}
```

**文件：`App/Src/app_sched.c`**

```c
/* App/Src/app_sched.c */
#include "app_sched.h"

static app_task_t s_tasks[APP_SCHED_MAX];
static uint8_t    s_count = 0;

void App_Sched_Init(void)
{
  uint8_t i;

  for (i = 0; i < APP_SCHED_MAX; i++)
  {
    s_tasks[i].period = 0;
    s_tasks[i].last   = 0;
    s_tasks[i].task   = 0;
  }
  s_count = 0;
}

uint8_t App_Sched_Add(uint32_t period_ms, void (*task)(void))
{
  if (s_count >= APP_SCHED_MAX || task == 0 || period_ms == 0U)
  {
    return 0;
  }

  s_tasks[s_count].period = period_ms;
  s_tasks[s_count].last   = HAL_GetTick();
  s_tasks[s_count].task   = task;
  s_count++;
  return 1;
}

void App_Sched_Run(void)
{
  uint8_t i;

  for (i = 0; i < s_count; i++)
  {
    if (HAL_GetTick() - s_tasks[i].last >= s_tasks[i].period)
    {
      s_tasks[i].last = HAL_GetTick();
      s_tasks[i].task();
    }
  }
}
```

**文件：`App/Src/app_tasks.c`**（三个任务：500ms 闪灯、10ms 读键、100ms 计数）

```c
/* App/Src/app_tasks.c */
#include "app_tasks.h"
#include "app_sched.h"
#include "key.h"

volatile uint32_t g_beat = 0;

static void Task_Led(void)          /* 500ms */
{
  HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
}

static void Task_Key(void)          /* 10ms */
{
  if (Key_Scan() == KEY_DOWN)       /* 短按一次就把计数清零 */
  {
    g_beat = 0;
  }
}

static void Task_Beat(void)         /* 100ms */
{
  g_beat++;
}

void App_Tasks_Init(void)
{
  App_Sched_Init();

  App_Sched_Add(500, Task_Led);
  App_Sched_Add(10,  Task_Key);
  App_Sched_Add(100, Task_Beat);
}
```

三、`main.c`

**文件：`Core/Src/main.c`**

```c
/* Core/Src/main.c —— 入口 */
#include "main.h"
#include "gpio.h"
#include "app_sched.h"
#include "app_tasks.h"

/* USER CODE BEGIN Includes */
/* USER CODE END Includes */

/* USER CODE BEGIN PV */
/* USER CODE END PV */

void SystemClock_Config(void);

int main(void)
{
  /* USER CODE BEGIN 1 */
  /* USER CODE END 1 */

  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();

  /* USER CODE BEGIN 2 */
  App_Tasks_Init();      /* 登记三个任务 */
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    App_Sched_Run();     /* 每圈只做"到点了吗"的判断，几乎不耗时 */
    /* USER CODE END 3 */
  }
}

void SystemClock_Config(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  RCC_OscInitStruct.HSEState       = RCC_HSE_ON;
  RCC_OscInitStruct.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  RCC_OscInitStruct.PLL.PLLState   = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource  = RCC_PLLSOURCE_HSE;
  RCC_OscInitStruct.PLL.PLLMUL     = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  RCC_ClkInitStruct.ClockType      = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK
                                   | RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource   = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider  = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

void Error_Handler(void)
{
  __disable_irq();
  while (1)
  {
  }
}
```

**为什么按键任务要 10ms、计数要 100ms、闪灯要 500ms**：三个周期各自独立登记，调度器只比较"现在 - 上次 ≥ 周期"，谁到点跑谁。按键必须比人手的抖动窗口（20ms）细，才能凑满两次确认；`beat` 的 100ms 正好让 10 秒约等于 100 次，方便验收；闪灯 500ms 是需求。

**为什么 `g_beat` 用 `volatile`**：它在 `app_tasks.c` 的定时逻辑里改、在调试器/Live Expressions 里读，编译器不能把它优化进寄存器，否则你看到的永远是旧值。

**为什么短按清零放在 `Task_Key` 里**：`Key_Scan()` 只报告"发生了按下"，"按下要干什么"是业务，属于 `app_tasks.c`。以后加"长按重置所有状态"，只改这一个函数。

**哪些没写**：`SysTick_Handler()` 在 `Core/Src/stm32f1xx_it.c`（内容只有 `HAL_IncTick()`），`HAL_Init()` 里的 1ms 配置也都由 CubeMX 生成；`APP_SCHED_MAX` 之外的动态增删、优先级、栈隔离都没有——那是 FreeRTOS 的活。

**验收对照**：Live Expressions 里同时放 `g_beat`、`uwTick`、`GPIOA->IDR` 的第 0 位；按住按键时第 0 位变 0，松手瞬间 `g_beat` 归零，而闪灯节奏完全不受影响。
:::

::: exercise 练习 1：算 LOAD
系统 72MHz，想让 SysTick 每 1ms 中断一次，`LOAD` 应该填多少？如果想让它是 10μs 一次呢？
::: answer
**1ms**：
$$\text{LOAD} = \frac{72\,000\,000}{1000} - 1 = 72000 - 1 = 71999$$

**10μs**：
10μs 对应频率 100kHz，所以
$$\text{LOAD} = \frac{72\,000\,000}{100\,000} - 1 = 720 - 1 = 719$$

注意第二个：**计数次数 = 720，填 719**。填 720 会得到 721 次，周期多 0.14%。

另外提醒：10μs 一次中断意味着每秒 10 万次中断，CPU 会有一大半时间在进中断，不划算。要高精度定时应该用硬件定时器（s9），SysTick 只适合做时基。
:::
:::

::: exercise 练习 2：溢出判断
`uwTick` 是 32 位无符号数，72MHz 下每 1ms 加 1。它多久溢出一次？如果有个任务设置 `last = 0xFFFFFFFF`，然后 `uwTick` 绕回 0 再走到 100，此时 `uwTick - last` 等于多少？
::: answer
**溢出时间**：
$$2^{32} \text{ ms} = 4\,294\,967\,296 \text{ ms} \approx 4\,294\,967 \text{ s} \approx 49.7 \text{ 天}$$

**绕回后的减法**：
`last = 0xFFFFFFFF`，`now = 0x00000064`（100）

$$0x00000064 - 0xFFFFFFFF$$
无符号运算下等于 $+0x00000065 = 101$。

含义：从 `0xFFFFFFFF` 到 `0x00000000` 是 1 步，再到 100 是 100 步，共 101。**结果完全正确**。

所以 `if (now - last >= interval)` 在溢出边界上依然准确，不需要任何特殊处理。这正是这种写法必须成为习惯的原因。
:::
:::

---

## 7. 本课小结

- SysTick 是内核自带的 24 位**递减**计数器，三个寄存器：`LOAD`/`VAL`/`CTRL`。
- 计数值 = 目标值 + 1，`LOAD` 要减 1。
- HAL 把它配成 1ms 中断，中断里 `uwTick++`，优先级是最低的 15。
- `HAL_Delay` 是忙等，**阻塞 CPU**；在高于 SysTick 优先级的中断里调用会**死锁**。
- 非阻塞：`if (HAL_GetTick() - last >= period)`，无符号减法自动处理溢出。
- `last = now` 避免补偿爆发，`last += period` 保证长期精度。
- 任务数组 + 函数指针 = 极简协作式调度器，是理解 FreeRTOS 的台阶。
- 轮询框架无法保证事件响应的实时性，需要中断补充。

::: selfcheck 自检
- [ ] 我能说出 SysTick 的 LOAD/VAL/CTRL 各干什么
- [ ] 我能算出任意周期的 LOAD 值
- [ ] 我能解释 HAL_Delay 在中断里为什么死锁
- [ ] 我能写出正确的时间比较，并说明为什么这么写
- [ ] 我知道 `last = now` 和 `last += period` 的取舍
- [ ] 我能用任务数组同时跑三个不同周期的任务
:::

---

**下一课预告**：`s7 中断与 NVIC：CPU 被打断时发生了什么`。这一课把"中断"这个黑盒打开：CPU 被打断时那 12 个寄存器压到哪去了、向量表怎么找到处理函数、抢占优先级和子优先级有什么区别、以及中断服务函数里绝对不能做的三件事。
