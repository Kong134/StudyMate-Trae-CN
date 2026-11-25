---
node: s4
title: GPIO 输入：上下拉、浮空与按键消抖
type: practice
duration: 70
---

## 这一课要解决的问题

::: goal
读完你能：说清浮空输入为什么会乱跳；根据外部电路正确选择上拉或下拉；写出一个 20ms 消抖的按键程序；区分"按住"和"按了一下"。
:::

上一课是把电平送出去，这一课是读电平进来。听起来更简单，但坑更多——因为**输入端的电平不是你能控制的**。

---

## 1. 浮空输入为什么会乱跳

把 PA0 配成输入、不接任何东西，然后在调试器里盯 `GPIOA->IDR` 的第 0 位，你会看到它以几 kHz 的频率随机翻转。

不是芯片坏了。原因很物理：

- 输入脚内部是一个 MOS 栅极，**输入阻抗极高**（几百 MΩ 到 GΩ）。
- 悬空的引脚相当于一根**天线**，把周围的电磁干扰（50Hz 工频、开关电源、你手靠近时的静电）都耦合进来。
- 因为阻抗太高，一点点电荷就能让电压跨过逻辑阈值，于是 0 和 1 乱跳。

::: key
**浮空输入 = 电平不确定**。它不是在读"0"或"1"，而是在读"当前环境噪声是多少"。

所以：**输入脚必须有明确的默认电平**。要么靠外部电路给，要么靠芯片内部的上下拉电阻给。
:::

::: note 内部上下拉是什么
STM32 每个 IO 内部都有两个可选接通的电阻：

- **上拉**（Pull-up）：把引脚通过约 40kΩ 接到 3.3V。没东西驱动时读到 **1**。
- **下拉**（Pull-down）：把引脚通过约 40kΩ 接到 GND。没东西驱动时读到 **0**。

40kΩ 这个值决定了它的"力气"很小：你用一个 1kΩ 的开关接地，分压后引脚是 $3.3 \times \frac{1}{41} \approx 0.08\text{V}$，稳稳是低电平。但如果外部有强干扰，40kΩ 拉不住，还是会抖。

所以内部上下拉适合**短距离、干净环境**；长线、工业环境要用外部 4.7k~10kΩ。
:::

---

## 2. 按键电路：为什么几乎总是"上拉 + 接地"

最常见的按键接法只有两种：

<svg class="diagram" viewBox="0 0 820 300" xmlns="http://www.w3.org/2000/svg">
  <rect class="box" x="16" y="18" width="380" height="264" rx="12"/>
  <text class="label" x="36" y="44" font-size="12.5">接法 A：按键接地 + 上拉</text>

  <text class="sub" x="48" y="76" font-size="11">3.3V ──[ 内部/外部上拉 ]──┬── PA0</text>
  <text class="sub" x="48" y="100" font-size="11">　　　　　　　　　　　　│</text>
  <text class="sub" x="48" y="124" font-size="11">　　　　　　　　　　　 [按键]</text>
  <text class="sub" x="48" y="148" font-size="11">　　　　　　　　　　　　│</text>
  <text class="sub" x="48" y="172" font-size="11">　　　　　　　　　　　 GND</text>

  <text class="sub" x="48" y="212" font-size="11">松开：读到 <tspan font-size="12">1</tspan></text>
  <text class="sub" x="48" y="234" font-size="11">按下：读到 <tspan font-size="12">0</tspan></text>
  <text class="sub" x="48" y="262" font-size="10.5">→ 常用，因为"低电平有效"抗干扰更好</text>

  <rect class="box" x="424" y="18" width="380" height="264" rx="12"/>
  <text class="label" x="444" y="44" font-size="12.5">接法 B：按键接 3.3V + 下拉</text>

  <text class="sub" x="456" y="76" font-size="11">3.3V ──[按键]──┬── PA0</text>
  <text class="sub" x="456" y="100" font-size="11">　　　　　　　 │</text>
  <text class="sub" x="456" y="124" font-size="11">　　　　　 [ 下拉电阻 ]</text>
  <text class="sub" x="456" y="148" font-size="11">　　　　　　　 │</text>
  <text class="sub" x="456" y="172" font-size="11">　　　　　　　GND</text>

  <text class="sub" x="456" y="212" font-size="11">松开：读到 <tspan font-size="12">0</tspan></text>
  <text class="sub" x="456" y="234" font-size="11">按下：读到 <tspan font-size="12">1</tspan></text>
  <text class="sub" x="456" y="262" font-size="10.5">→ 也可用，但长线上"串入干扰"更容易误触发</text>
</svg>

为什么接法 A 更常见？三个理由：

1. **抗干扰**：干扰大多通过分布电容耦合，更容易把高电平"拉下来"，而不容易把低电平"抬上去"。所以低电平有效的信号更稳。
2. **历史原因**：TTL 时代的输入默认就是低阻抗接地，这个习惯延续下来。
3. **和芯片复位脚一致**：NRST 就是低电平复位，全行业都是"低有效"。

::: warn 别同时开内部上拉和外部上拉
有人既在 CubeMX 里选了 `Pull-up`，又在外部焊了 10kΩ 上拉到 3.3V。这不会烧，但两个电阻并联后等效约 8kΩ，按下按键时电流从 3.3V 经 8kΩ 到 GND 是 0.4mA——白耗电。低功耗设备上这一条很致命。

**规则：外部有上拉，CubeMX 就选 `No pull`**。
:::

---

## 3. 按键抖动：机械开关不会"干净地"闭合

按键内部是两片金属弹片。按下时它们会**弹跳**几毫秒，才稳定接触。示波器上看是这样：

<svg class="diagram" viewBox="0 0 820 220" xmlns="http://www.w3.org/2000/svg">
  <line class="loop" x1="60" y1="170" x2="780" y2="170"/>
  <line class="loop" x1="60" y1="60" x2="780" y2="60"/>
  <text class="sub" x="16" y="64" font-size="10.5">高</text>
  <text class="sub" x="16" y="174" font-size="10.5">低</text>

  <path d="M 60 60 L 240 60 L 240 170 L 258 170 L 258 60 L 272 60 L 272 170 L 292 170 L 292 60 L 306 60 L 306 170 L 322 170 L 322 60 L 338 60 L 338 170 L 360 170 L 360 60 L 376 60 L 376 170 L 400 170 L 400 60 L 418 60 L 418 170 L 440 170 L 440 60 L 462 60 L 462 170 L 490 170 L 490 60 L 512 60 L 512 170"
        stroke="#c0392b" stroke-width="2" fill="none" stroke-linejoin="round"/>
  <path d="M 512 170 L 780 170" stroke="#c0392b" stroke-width="2" fill="none"/>

  <line class="arrow" x1="240" y1="200" x2="512" y2="200"/>
  <polygon class="arrowhead" points="512,196 522,200 512,204"/>
  <text class="sub" x="330" y="216" font-size="10.5">抖动区：5~20ms，CPU 会读到几十次跳变</text>

  <text class="sub" x="80" y="200" font-size="10.5">松开稳定</text>
  <text class="sub" x="560" y="200" font-size="10.5">按下稳定</text>
</svg>

如果主循环里写 `if (ReadPin() == 0) 计数++`，按一下可能加七八次。这就是为什么按键必须**消抖**。

两种消抖思路：

| 方法 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **延时消抖** | 检测到变化 → 等 20ms → 再读一次确认 | 简单，够用 | 阻塞 20ms |
| **状态机 + 周期采样** | 每 10ms 采样一次，连续两次相同才认 | 非阻塞，能识别长按/双击 | 代码稍复杂 |

本课先用第二种（更工程化），它和第 6 课的非阻塞定时正好接上。

---

## 4. HAL 怎么写输入

### 4.1 CubeMX 配置

PA0 接按键（一端接 PA0，一端接 GND），配置成：

| 配置项 | 值 | 理由 |
| --- | --- | --- |
| GPIO mode | **Input mode** | 只读电平 |
| GPIO Pull-up/Pull-down | **Pull-up** | 按键另一端接地，必须上拉才能有确定的高电平 |
| User Label | `KEY` | 生成 `KEY_Pin` 宏，代码可读性更好 |

::: note 为什么不选 `GPIO_ANALOG`
模拟模式会**关闭数字输入通路**（施密特触发器断开），是 ADC 用的低功耗模式。选了它，`HAL_GPIO_ReadPin` 永远读到 0，你会怀疑人生。

F1 系列里，输入模式下选 `Analog` 还有额外好处：引脚漏电最小，做低功耗时未使用的引脚都建议配成模拟输入。
:::

### 4.2 读电平

先看最小的一步：读一个脚。它出现在 `Core/Src/main.c` 主循环的 `USER CODE BEGIN 3` 段（完整工程见 4.3）：

**文件：`Core/Src/main.c`**（`while(1)` 里的读脚演示）

```c
/* Core/Src/main.c —— main() 的 while (1) 内部 */
while (1)
{
  /* USER CODE BEGIN 3 */
  GPIO_PinState s = HAL_GPIO_ReadPin(GPIOA, GPIO_PIN_0);  // 松开=1，按下=0
  if (s == GPIO_PIN_RESET)
  {
    /* 读到低电平 → 按键被按下（下一节换成带消抖的版本） */
  }
  /* USER CODE END 3 */
}
```

`GPIO_PIN_RESET` 就是 0，`GPIO_PIN_SET` 就是 1。别急着把 `s` 当 `0/1` 用：它是枚举 `GPIO_PinState`，编译器能帮你挡住"传了个 2 进去"这类错。用 `uint8_t` 也能跑，只是丢了这层保护。

为什么不直接读 `GPIOA->IDR & GPIO_PIN_0`：一句就能拿到位，还更快。但 `IDR` 是整个 16 位端口的值，你得自己 `&`、自己判断、自己记住"第 0 位对应 PA0"；掩码一旦写错（写成 `GPIO_PIN_1`），读到的就是隔壁脚，现象是"按下去没反应，手一靠近反而触发"。HAL 包了这一层，代价是一次函数调用。

哪些没写：上拉配置不在这一段，它在 `MX_GPIO_Init()` 里（`GPIO_InitStruct.Pull = GPIO_PULLUP`），由 4.1 的 CubeMX 表生成。也就是说"松开读到 1"不是 `ReadPin` 的功劳，是内部 40kΩ 上拉在撑着——`ReadPin` 只负责把引脚当前电平搬进变量。

### 4.3 非阻塞消抖

按键扫描属于外设驱动，按工程规范放 `Hardware/`；`main.c` 只负责"拿到事件就办事"。下面三个文件都是完整内容，可以直接照抄。

**文件：`Hardware/Inc/key.h`**（自己写的驱动头文件）

```c
/* Hardware/Inc/key.h —— 按键驱动：10ms 周期采样 + 连续 2 次确认 */
#ifndef __KEY_H
#define __KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"                /* KEY_Pin、KEY_GPIO_Port 来自 main.h */

#define KEY_SCAN_MS      10U     /* 采样周期 10ms；连续 2 次 = 20ms 确认 */
#define KEY_CONFIRM_CNT  2U      /* 连续读到几次"不同"才认可 */

typedef enum
{
  KEY_NONE = 0,                  /* 本周期没有事件 */
  KEY_DOWN                       /* 刚被按下（下降沿），已消抖 */
} KeyEvent;

KeyEvent Key_Scan(void);         /* 每 10ms 推进一次；没到点直接返回 KEY_NONE */

#ifdef __cplusplus
}
#endif

#endif /* __KEY_H */
```

**文件：`Hardware/Src/key.c`**（非阻塞消抖的实现）

```c
/* Hardware/Src/key.c —— 状态机：每 10ms 采样，连续 2 次不同才认 */
#include "key.h"

static uint32_t last_scan  = 0;   /* 上次采样的时刻（HAL_GetTick 的毫秒值） */
static uint8_t  stable_cnt = 0;   /* "读到与当前状态不同"连续出现的次数 */
static uint8_t  key_state  = 1;   /* 消抖后的稳定状态：1=松开，0=按下 */

KeyEvent Key_Scan(void)
{
  uint8_t raw;

  if (HAL_GetTick() - last_scan < KEY_SCAN_MS)
  {
    return KEY_NONE;              /* 还没到 10ms，什么都不做 */
  }
  last_scan = HAL_GetTick();

  /* KEY_Pin / KEY_GPIO_Port 是 CubeMX 按 User Label 生成在 main.h 里的宏 */
  raw = (HAL_GPIO_ReadPin(KEY_GPIO_Port, KEY_Pin) == GPIO_PIN_SET) ? 1 : 0;

  if (raw != key_state)
  {
    if (++stable_cnt >= KEY_CONFIRM_CNT)   /* 连续两次（20ms）都不同，才认 */
    {
      key_state = raw;
      stable_cnt = 0;

      if (key_state == 0)                  /* 1→0 的下降沿 = 按下事件 */
      {
        return KEY_DOWN;
      }
    }
  }
  else
  {
    stable_cnt = 0;                        /* 中途回到原状态，计数清零 */
  }

  return KEY_NONE;
}
```

**文件：`Core/Src/main.c`**（只轮询，不含消抖细节）

```c
/* Core/Src/main.c —— 入口：初始化 + 轮询按键 */
#include "main.h"
#include "gpio.h"
#include "key.h"          /* Hardware/Inc 要加进头文件搜索路径（方法见课 2 的 note） */

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
  MX_GPIO_Init();        /* PA0 = 输入上拉（KEY），PC13 = 推挽输出 */

  /* USER CODE BEGIN 2 */
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    if (Key_Scan() == KEY_DOWN)
    {
      HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);   /* 按一次翻转一次 */
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

逐行说关键处：

- `HAL_GetTick() - last_scan >= KEY_SCAN_MS`：**不要写成 `HAL_GetTick() > last_scan + 10`**。前者是无符号减法，溢出（约 49 天）时结果依然正确；后者在溢出那一刻会突然失效，现象是"板子连跑 49 天后按键失灵"。这是嵌入式里必知的写法。
- `KEY_CONFIRM_CNT`（=2）配合 `KEY_SCAN_MS`（=10ms）= **20ms 确认**，正好覆盖最长抖动时间。
- 只有 `key_state` 从 1 变 0 才算一次"按下事件"。如果按键一直按着，`raw` 一直是 0，`raw != key_state` 不成立，就不会重复触发。这就是"按住不连发"。
- `KEY_SCAN_MS 10` 里的 10 不是随便取的：抖动最长约 20ms，采两次刚好盖住；采样太快（1ms）会把抖动也当成真实变化，太慢（100ms）快速点按可能一次都采不到。
- `key_state` 用 `uint8_t` 而不是 `bool`：F1 的 HAL 不依赖 `stdbool.h`，省得为一个变量多引头文件；值只有 0/1，语义一样。
- 三个 `static` 变量放在 `key.c` 里、函数外：它们是按键的私有状态，跨调用要保留值，又不能让别的文件改。放 `main.c` 里也能跑，但那样"按键"这个模块就没封装起来。

为什么不把消抖逻辑留在 `main.c`：主循环会变成"读脚 + 计时 + 计数 + 判断 + 业务"五件事混在一起；抽到 `Hardware/key.c` 后，主循环只剩一行 `Key_Scan()`，以后加双击、加第二个按键都只改驱动文件。

为什么不直接用 `HAL_Delay(20)` 延时消抖：见下面 note，一句话——阻塞 20ms，别的任务全停。

为什么不用外部中断（EXTI）来消抖：中断响应快，但机械抖动会触发一串中断，你还是得在中断里消抖，而中断里又不能调 `HAL_Delay`。EXTI 适合"低功耗待机、按键唤醒"，普通主循环轮询用这套状态机更省心。第 8 课会把两者放一起对比。

::: note 为什么不用 HAL_Delay(20) 消抖
`if (读到低) { HAL_Delay(20); if (还低) 触发; }`

这段代码能工作，但在这 20ms 里 CPU 什么都不能干。如果同时还要刷新显示、收串口数据，就会卡顿、丢数据。

更糟的情况：如果这个按键处理被放进了中断（第 8 课会讲），`HAL_Delay` 依赖 SysTick 中断，而中断里不能嵌套等中断——直接死机。

**记住：阻塞延时只适合"这块板只干这一件事"的场景。**
:::

---

## 5. 区分短按、长按

真实产品里，一个按键往往要干两件事：短按切模式，长按进入设置。这一节把消抖和短按/长按合成一个函数 `Key_Scan()`，主循环只负责"拿到事件就办事"。下面三份文件都是完整内容，直接替换 4.3 那三份即可。

**文件：`Hardware/Inc/key.h`**（事件从 2 种扩到 3 种）

```c
/* Hardware/Inc/key.h —— 按键驱动：消抖 + 短按/长按识别 */
#ifndef __KEY_H
#define __KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define KEY_SCAN_MS      10U     /* 采样周期 10ms */
#define KEY_CONFIRM_CNT  2U      /* 连续 2 次 = 20ms 确认 */
#define KEY_LONG_MS      1000U   /* 按住 ≥1000ms 算长按（产品手感参数，可调） */

typedef enum
{
  KEY_NONE = 0,                  /* 本周期没有事件 */
  KEY_SHORT,                     /* 短按：按下后在 1 秒内松开 */
  KEY_LONG                       /* 长按：按住满 1 秒，只报一次 */
} KeyEvent;

KeyEvent Key_Scan(void);         /* 每 10ms 推进一次 */

#ifdef __cplusplus
}
#endif

#endif /* __KEY_H */
```

**文件：`Hardware/Src/key.c`**（完整实现）

```c
/* Hardware/Src/key.c —— 消抖 + 短按/长按 */
#include "key.h"

static uint32_t last_scan   = 0;   /* 上次采样时刻 */
static uint8_t  stable_cnt  = 0;   /* 连续"与当前状态不同"的次数 */
static uint8_t  key_state   = 1;   /* 稳定状态：1=松开，0=按下 */
static uint32_t press_start = 0;   /* 本次按下的开始时刻 */
static uint8_t  long_fired  = 0;   /* 长按已上报，防止重复触发 */

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
    if (++stable_cnt >= KEY_CONFIRM_CNT)      /* 20ms 确认 */
    {
      key_state = raw;
      stable_cnt = 0;

      if (key_state == 0)                     /* 1→0：刚按下 */
      {
        press_start = HAL_GetTick();
        long_fired  = 0;                      /* 新一轮按下，长按标志复位 */
      }
      else if (!long_fired)                   /* 0→1：松开且没报过长按 → 短按 */
      {
        return KEY_SHORT;
      }
    }
  }
  else
  {
    stable_cnt = 0;
  }

  /* 还按着、没报过长按、且按够 1 秒 → 报长按 */
  if (key_state == 0 && !long_fired &&
      HAL_GetTick() - press_start >= KEY_LONG_MS)
  {
    long_fired = 1;
    return KEY_LONG;
  }

  return KEY_NONE;
}
```

**文件：`Core/Src/main.c`**（调用点只多了两个 `case`）

```c
/* Core/Src/main.c —— 入口：初始化 + 处理按键事件 */
#include "main.h"
#include "gpio.h"
#include "key.h"

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
  MX_GPIO_Init();        /* PA0 = 输入上拉（KEY），PC13 = 推挽输出 */

  /* USER CODE BEGIN 2 */
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    switch (Key_Scan())
    {
      case KEY_SHORT:                                  /* 短按：翻转一次 */
        HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
        break;

      case KEY_LONG:                                   /* 长按：这里先做"点亮"示例 */
        HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_RESET);
        break;

      default:
        break;
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

`long_fired` 这个标志位很关键：没有它，长按期间每个 10ms 都满足"按够 1 秒"，一秒能触发 100 次。**"事件只在状态跳变时产生一次"，这是状态机设计的核心思想。**

为什么把逻辑收进 `Key_Scan()` 而不摊在主循环里：主循环只剩一个 `switch`，以后加"双击"只改函数、不动调用点。那几个 `static` 是按键的私有状态，外界碰不到，这也让它将来能被挪进定时器中断（第 6 课）。

为什么用枚举返回值、不用全局 `flag`：全局标志要"置位—检查—清零"三步，漏了清零就重复触发；返回值只在本次调用有效，想漏都漏不掉。代价只是一次函数调用、几十个周期，对 10ms 的节奏毫无影响。

哪些没写：`KEY_LONG_MS 1000`、`KEY_SCAN_MS 10` 是"产品手感"参数，不是芯片要求，改小更灵敏、改大更迟钝；PA0 上拉和 PC13 推挽输出仍由 `MX_GPIO_Init()` 生成，这里不重复写。

---

## 6. 动手项目

::: project
**单键控制 LED：短按切换，长按慢闪**

用 PA0 上的按键控制 PC13 的 LED：

- **短按**（<1 秒）：切换 LED 常亮 / 常灭
- **长按**（≥1 秒）：LED 进入 200ms 慢闪模式
- 慢闪模式下再短按一次：退出慢闪，回到常亮

**验收标准**：
1. 快速连按 10 次，LED 状态翻转 10 次，不多不少（消抖有效）。
2. 按住 1.5 秒松开，只进入慢闪一次，不会重复触发。
3. 用调试器看 `key_state`，按住期间稳定为 0，抖动时不会反复跳变。

**提示**：加一个 `enum { MODE_OFF, MODE_ON, MODE_BLINK }` 状态变量，比一堆 `if` 清楚得多。

**文件放置表**：

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `main.h` | `Core/Inc/` | CubeMX 生成，含 `KEY_Pin` / `KEY_GPIO_Port` 宏 |
| `gpio.h` / `gpio.c` | `Core/Inc/` / `Core/Src/` | PA0 输入上拉、PC13 推挽输出（CubeMX 生成） |
| `key.h` / `key.c` | `Hardware/Inc/` / `Hardware/Src/` | 按键驱动：消抖 + 短按/长按事件 |
| `app_key.h` / `app_key.c` | `App/Inc/` / `App/Src/` | 业务：三种模式切换 + 非阻塞慢闪 |
| `main.c` | `Core/Src/` | 只做初始化 + 调用 `App_Key_Task()` |

一、头文件

**文件：`Core/Inc/main.h`**

```c
/* Core/Inc/main.h —— CubeMX 生成；KEY 是给 PA0 起的 User Label */
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

void Error_Handler(void);

/* 下面两行由 CubeMX 按 User Label "KEY" 自动生成，改标签名这里会跟着变 */
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
/* Hardware/Inc/key.h —— 按键驱动 */
#ifndef __KEY_H
#define __KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define KEY_SCAN_MS      10U     /* 采样周期 10ms */
#define KEY_CONFIRM_CNT  2U      /* 连续 2 次 = 20ms 确认 */
#define KEY_LONG_MS      1000U   /* 按住 ≥1000ms 算长按 */

typedef enum
{
  KEY_NONE = 0,
  KEY_SHORT,
  KEY_LONG
} KeyEvent;

KeyEvent Key_Scan(void);

#ifdef __cplusplus
}
#endif

#endif /* __KEY_H */
```

**文件：`App/Inc/app_key.h`**

```c
/* App/Inc/app_key.h —— 单键控制 LED 的业务接口 */
#ifndef __APP_KEY_H
#define __APP_KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define APP_BLINK_MS  200U   /* 慢闪半周期：亮 200ms、灭 200ms（需求指定 200ms） */

void App_Key_Init(void);   /* 初始模式 = 常灭，并确保灯灭 */
void App_Key_Task(void);   /* 主循环反复调用：处理事件 + 推进慢闪 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_KEY_H */
```

二、驱动 / 业务 .c

**文件：`Core/Src/gpio.c`**（CubeMX 生成；PA0 上拉、PC13 推挽）

```c
/* Core/Src/gpio.c */
#include "gpio.h"

void MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};

  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOC_CLK_ENABLE();

  /* PC13：推挽输出，先置高（共阳极 = 灭） */
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET);
  GPIO_InitStruct.Pin   = GPIO_PIN_13;
  GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull  = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
  HAL_GPIO_Init(GPIOC, &GPIO_InitStruct);

  /* PA0：输入 + 内部上拉（按键另一端接 GND，松开读到 1） */
  GPIO_InitStruct.Pin  = KEY_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(KEY_GPIO_Port, &GPIO_InitStruct);
}
```

**文件：`Hardware/Src/key.c`**（与第 5 节相同，完整一份）

```c
/* Hardware/Src/key.c —— 消抖 + 短按/长按 */
#include "key.h"

static uint32_t last_scan   = 0;
static uint8_t  stable_cnt  = 0;
static uint8_t  key_state   = 1;   /* 1=松开，0=按下 */
static uint32_t press_start = 0;
static uint8_t  long_fired  = 0;

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

      if (key_state == 0)
      {
        press_start = HAL_GetTick();
        long_fired  = 0;
      }
      else if (!long_fired)
      {
        return KEY_SHORT;
      }
    }
  }
  else
  {
    stable_cnt = 0;
  }

  if (key_state == 0 && !long_fired &&
      HAL_GetTick() - press_start >= KEY_LONG_MS)
  {
    long_fired = 1;
    return KEY_LONG;
  }

  return KEY_NONE;
}
```

**文件：`App/Src/app_key.c`**（三种模式 + 非阻塞慢闪）

```c
/* App/Src/app_key.c —— 短按切换 ON/OFF，长按进慢闪，慢闪中短按回常亮 */
#include "app_key.h"
#include "key.h"

typedef enum
{
  MODE_OFF = 0,   /* 常灭 */
  MODE_ON,        /* 常亮 */
  MODE_BLINK      /* 200ms 慢闪 */
} LedMode;

static LedMode  s_mode       = MODE_OFF;
static uint32_t s_blink_last = 0;   /* 上次翻转时刻，用于非阻塞慢闪 */

/* 蓝板 LED 低电平点亮 */
static void Led_On(void)
{
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_RESET);
}

static void Led_Off(void)
{
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, GPIO_PIN_SET);
}

void App_Key_Init(void)
{
  s_mode = MODE_OFF;
  Led_Off();
}

void App_Key_Task(void)
{
  KeyEvent ev = Key_Scan();

  if (ev == KEY_SHORT)
  {
    if (s_mode == MODE_BLINK)        /* 慢闪中短按 → 退出慢闪，回到常亮 */
    {
      s_mode = MODE_ON;
      Led_On();
    }
    else if (s_mode == MODE_OFF)     /* 常灭 → 常亮 */
    {
      s_mode = MODE_ON;
      Led_On();
    }
    else                             /* 常亮 → 常灭 */
    {
      s_mode = MODE_OFF;
      Led_Off();
    }
  }
  else if (ev == KEY_LONG)           /* 长按：进入慢闪 */
  {
    s_mode = MODE_BLINK;
    s_blink_last = HAL_GetTick();
  }

  /* 慢闪用"时间戳差值"，不阻塞：到点才翻转一次 */
  if (s_mode == MODE_BLINK &&
      HAL_GetTick() - s_blink_last >= APP_BLINK_MS)
  {
    s_blink_last = HAL_GetTick();
    HAL_GPIO_TogglePin(GPIOC, GPIO_PIN_13);
  }
}
```

三、`main.c`

**文件：`Core/Src/main.c`**

```c
/* Core/Src/main.c —— 入口：初始化 + 调度 */
#include "main.h"
#include "gpio.h"
#include "app_key.h"

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
  App_Key_Init();        /* 业务层自己的初始状态自己负责 */
  /* USER CODE END 2 */

  while (1)
  {
    /* USER CODE BEGIN 3 */
    App_Key_Task();      /* 读键、切换模式、慢闪全在 App/ 里 */
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

**为什么把模式变量放 `App/` 而不是 `key.c`**：`key.c` 只回答"按键发生了什么"（按下/松开/长按），不关心"灯要怎么表现"。把模式放业务层，以后换成一个 OLED 菜单，`key.c` 一行都不用改。

**为什么慢闪不用 `HAL_Delay(200)`**：一旦阻塞 200ms，按键响应会变慢、后续任务全被拖住。这里沿用第 4 节的"时间戳差值"，主循环转得飞快，只有到点才翻转一次。

**为什么 `KEY_SHORT` 在慢闪中要单独判断**：需求要求"慢闪中短按回到常亮"，而不是"关灯"。如果直接走 `MODE_BLINK → MODE_OFF`，行为就不对了——这就是状态机里每个分支都要写清楚的原因。

**哪些没写**：`KEY_Pin`/`KEY_GPIO_Port` 宏、PA0 的上拉配置、PC13 的推挽配置都由 CubeMX 生成（见 4.1 表）；`SysTick_Handler()` 在 `Core/Src/stm32f1xx_it.c`，内容只有 `HAL_IncTick()`。

**验收对照**：第 2 条"按住 1.5 秒只进一次慢闪"，靠 `long_fired` 保证——长按只报一次，松开时因为 `long_fired == 1` 也不会再报短按。
:::

::: exercise 练习 1：为什么读不到按下
有人把按键一端接 PA1、另一端接 **3.3V**，CubeMX 里配了 `Pull-up`。他写 `if (读 == 0) 按下`，结果永远读不到按下。为什么？怎么改？
::: answer
两个错误叠在一起：

1. **上拉 + 接 3.3V = 永远高电平**。松开时上拉到 3.3V（1），按下时直接接 3.3V（还是 1）。引脚电压从头到尾没变化，当然读不到。
2. **判断逻辑也反了**。接 3.3V 的按键按下时读到的是 **1**，不是 0。

改法（二选一）：
- 保持按键接 3.3V → CubeMX 改 `Pull-down`，判断 `读 == 1` 为按下。
- 保持 `Pull-up` → 把按键另一端改接 **GND**，判断 `读 == 0` 为按下。（推荐）

**通用规则**：上拉配"另一端接地"，下拉配"另一端接电源"。配对错了，电平永远不变。
:::
:::

::: exercise 练习 2：抖动到底多久
某按键数据手册写"bounce time ≤ 5ms"。如果用 10ms 采样、连续 2 次确认（20ms）消抖，最小能可靠识别多长的按键？如果人快速点按，最短间隔 50ms 会不会漏掉？
::: answer
**能识别的最短按下时间**：需要至少 2 次采样都读到低。第一次可能在按下后 0~10ms 内采到，第二次在 10~20ms 后。所以按下时间必须**大于 20ms** 才能被确认。

**50ms 快速点按**：50ms 内会有 5 次采样，足够凑满 2 次连续低电平，**不会漏**。

但注意松开也要 20ms 确认。如果两次按下的间隔只有 30ms，可能出现"按下已确认、松开还没确认就又被按下"的情况，逻辑上会当成**一直按着**，漏掉第二次按下。

极端快速连点（间隔 < 40ms）本来也不是人手的正常操作，工程上可以不管。要更灵敏就把采样周期降到 5ms。
:::
:::

---

## 附：PPT 原图对照

![PPT · 浮空/上拉/下拉输入](/assets/stm32/022.png)

*PPT 第 22 页：三种输入模式。看图中的两个开关和上下拉电阻，对照正文第 1 节"浮空为什么会乱跳"会更直观。*

![PPT · 按键简介](/assets/stm32/029.png)

*PPT 第 29 页：按键与抖动。正文第 3 节的抖动波形就是这页内容的展开。*

## 7. 本课小结

- 浮空输入 = 电平不确定，必须靠上拉/下拉给出默认值。
- **上拉配接地按键，下拉配接电源按键**，这是最基础的配对规则。
- 外部已有上拉时，CubeMX 选 `No pull`，避免并联耗电。
- 机械按键抖动 5~20ms，必须消抖；20ms 是通用值。
- 消抖用"周期采样 + 连续确认"，不要用 `HAL_Delay` 阻塞。
- 时间比较写 `HAL_GetTick() - last >= N`，能自动处理溢出。
- "事件只在状态跳变时产生一次"——状态机的核心。

::: selfcheck 自检
- [ ] 我能解释浮空输入为什么会读随机值
- [ ] 我能根据按键接法说出该配上拉还是下拉，以及按下时读到什么
- [ ] 我知道 20ms 这个数字是怎么来的
- [ ] 我能写出一个不阻塞的消抖状态机
- [ ] 我知道为什么时间比较要用无符号减法
- [ ] 我能说出短按/长按为什么要一个 `long_fired` 标志
:::

---

**下一课预告**：`s5 时钟系统：8MHz 怎么变成 72MHz`。前面两课你一直在用 72MHz，但从没问过它怎么来的。下一课把时钟树拆开：四个振荡源、PLL 倍频、三条总线分频，以及一个面试必答点——为什么 APB1 只有 36MHz，定时器却还能按 72MHz 算。
