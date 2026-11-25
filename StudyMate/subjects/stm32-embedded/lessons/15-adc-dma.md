---
node: s15
title: ADC 采样与 DMA 搬运
type: lab
duration: 80
---

## 这一课要解决的问题

::: goal
读完你能：把一个 0~3.3V 的电压读成 0~4095 的数字并换算回电压；说清采样时间不够时为什么读数偏低；用 DMA 让 ADC 连续采多个通道、CPU 完全不参与；知道 1 个 LSB 是多少毫伏、12 位到底够不够用。
:::

前面所有外设处理的都是"0 和 1"。但真实世界是连续的：电池电压、光照、温度、电位器的位置。**ADC 就是单片机的"感官"**，把模拟电压翻译成数字。

---

## 1. 12 位是什么意思：一把 4096 格的尺子

STM32F103 的 ADC 是 **12 位**，参考电压通常接 3.3V。意思是：

- 把 0V ~ 3.3V 这段区间**平均切成 4096 格**（$2^{12}$）
- 输出 `0` 代表 0V，输出 `4095` 代表接近 3.3V

每一格叫 **1 个 LSB**：

$$1\text{ LSB} = \frac{3.3V}{4096} \approx 0.806mV$$

所以：

$$\text{电压} = \frac{\text{ADC值}}{4096} \times 3.3V$$

| ADC 值 | 电压 |
| --- | --- |
| 0 | 0.000 V |
| 1 | 0.0008 V |
| 1024 | 0.825 V |
| 2048 | 1.650 V |
| 4095 | 3.299 V |

::: note 为什么除以 4096 而不是 4095
严格说，`4095` 对应的电压是 $4095/4096 \times 3.3 = 3.2992V$，比 3.3V 差半个 LSB。理想 ADC 的传递函数是"**码值 = 输入电压 / LSB**，向下取整"，所以上限 3.3V 落在 4096 这一格，但码值最大只能到 4095。

工程上除以 4096 更符合 ADC 的实际行为。两者差 0.8mV，日常测量无所谓；做精密计量时才需要校准（用两点校准消掉增益和偏移误差）。
:::

::: warn 输入电压绝对不能超过 3.3V
ADC 引脚是**模拟输入**，内部没有保护到 5V。直接接 5V 传感器输出会：

1. 轻则读数**卡在 4095**（饱和），看起来"永远是满量程"；
2. 重则击穿引脚，整块芯片报废（而且是慢慢坏，可能今天能用明天就挂）。

**超过 3.3V 的信号必须分压**：两个电阻，比如 10kΩ + 20kΩ 把 0~5V 分到 0~3.33V。分压比要在代码里乘回去，这一层放在 `Hardware/Src/adc_bsp.c`：

**文件：`Hardware/Inc/adc_bsp.h`**
```c
#ifndef __ADC_BSP_H
#define __ADC_BSP_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define ADC_CH_COUNT    2U        /* 必须等于 CubeMX 里的 Number Of Conversion（本课 PA0/PA1 两路） */
#define ADC_VREF        3.3f      /* 参考电压 3.3V */
#define ADC_FULL_SCALE  4096.0f   /* 12 位：0~4095 共 4096 格 */
#define ADC_DIV_RATIO   1.0f      /* 分压还原系数：10k+20k 测 0~5V 时改 1.5f */

void     ADC_BSP_Start(void);                      /* 启动 ADC + 循环 DMA */
uint16_t ADC_BSP_GetRaw(uint8_t ch);               /* 取最近一次原始码值 */
float    ADC_BSP_GetVoltage(uint8_t ch);           /* 换算成电压（已乘分压比） */

#ifdef __cplusplus
}
#endif

#endif /* __ADC_BSP_H */
```

**文件：`Hardware/Src/adc_bsp.c`**
```c
#include "adc_bsp.h"
#include "adc.h"          /* hadc1 在这里 extern 声明 */

static volatile uint16_t s_adc_buf[ADC_CH_COUNT];   /* DMA 落点，下标 = Rank-1 */

void ADC_BSP_Start(void)
{
    /* 第三个参数是"转换次数"，不是字节数；Circular 模式下只调一次 */
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)s_adc_buf, ADC_CH_COUNT);
}

uint16_t ADC_BSP_GetRaw(uint8_t ch)
{
    return (ch < ADC_CH_COUNT) ? s_adc_buf[ch] : 0U;
}

float ADC_BSP_GetVoltage(uint8_t ch)
{
    uint16_t raw = ADC_BSP_GetRaw(ch);
    /* 电压 = 码值 / 4096 × 3.3V，再乘分压比还原被测点真实电压 */
    return ((float)raw / ADC_FULL_SCALE * ADC_VREF) * ADC_DIV_RATIO;
}
```
:::

---

## 2. ADC 内部怎么"量"：逐次逼近

STM32F103 用的是 **SAR（逐次逼近型）ADC**。它的工作原理和**用天平称重**一模一样。

假设要称一个 2.7kg 的东西，手上有 2kg、1kg、0.5kg、0.25kg… 的砝码（每个是前一个的一半）：

1. 先放 2kg：2 < 2.7，**保留**（这一位记 1）
2. 再加 1kg（共 3kg）：3 > 2.7，**拿掉**（这一位记 0）
3. 再加 0.5kg（共 2.5kg）：2.5 < 2.7，**保留**（记 1）
4. 再加 0.25kg（共 2.75kg）：超了，拿掉（记 0）
5. …直到最小砝码

最后剩下的砝码总和就是结果，每一位对应一个二进制位。

ADC 里"砝码"是一组按 1/2 递减的**参考电压**，由内部 DAC 产生，比较器负责判断"大了还是小了"。**12 位就要比较 12 次**，这就是为什么转换需要时间。

::: note SAR 的速度和精度是矛盾
每多一位就要多比较一次，所以位数越高越慢。12 位已经是很成熟的平衡点：0.8mV 分辨率，转换只要十几微秒。

想要更高精度（16 位、24 位）就得用**Σ-Δ 型 ADC**（靠过采样和数字滤波），速度慢但精度高，称重传感器、音频都用它。想要更高速度（几十 MHz）就得用**并行比较型（Flash ADC）**，功耗和面积爆炸，示波器前端用。

**没有一种 ADC 同时快、准、便宜**——这是面试常问的"ADC 类型对比"。
:::

---

## 3. 采样时间：为什么读数会偏低

ADC 不是"瞬间"测到电压的。它内部有一个**采样保持电容**（约 8pF），测量前要先通过引脚把电容充到外部电压，然后才进行比较。

充电需要时间，时间常数由**外部信号源内阻 + 内部采样电阻**决定：

$$t_{sample} \geq (R_{source} + R_{ADC}) \times C \times \ln(2^{13})$$

$\ln(2^{13}) \approx 9.01$ 是为了"充到 13 位精度"（比 12 位多留 1 位余量）。

代个数：$R_{source} = 10k\Omega$、$R_{ADC} \approx 1k\Omega$、$C = 8pF$：

$$t \geq 11000 \times 8 \times 10^{-12} \times 9.01 \approx 0.79\mu s$$

如果 ADC 时钟 12MHz（周期 83ns），这相当于至少 **9.5 个 ADC 周期**。所以采样时间要选 `13.5 cycles` 或更长。

::: warn 采样时间配太短的现象
**读数明显偏低，而且信号源内阻越大偏得越多。**

因为电容还没充到外部电压，比较就开始了，结果自然偏小。表现很隐蔽：

- 测电池电压（内阻小）看起来正常；
- 测光敏电阻分压（内阻几十 kΩ）读数只有实际值的 80%；
- 用手碰一下引脚，读数立刻跳上去（人体相当于一个低阻源）。

遇到"读数偏低、加个运放跟随器就正常了"，基本就是这个原因。**要么加长采样时间，要么加电压跟随器（降低源内阻）。**
:::

### 3.1 总转换时间

$$\text{总时间} = (\text{采样周期数} + 12.5) \times T_{ADCCLK}$$

其中 12.5 是 12 位 SAR 的比较时间。ADCCLK 最高 **14MHz**，一般用 12MHz。

采样 13.5 周期时：

$$(13.5 + 12.5) \times \frac{1}{12MHz} = 26 \times 83.3ns \approx 2.17\mu s$$

即单通道最高约 **460k 次/秒**。多通道轮流采，每个通道的速度再除以通道数。

---

## 4. DMA：让数据自己搬

### 4.1 没有 DMA 的痛点

ADC 每转换完一次就置一个标志。如果不用 DMA，你有两个选择：

- **轮询**：主循环一直问"好了没"，CPU 空转。
- **中断**：每 2μs 进一次中断。以 100kHz 采样率算，CPU 每秒被打断 10 万次，什么正事都干不了。

### 4.2 DMA 是什么

DMA（Direct Memory Access）是一个**独立的小搬运工**：你告诉它"从 ADC 数据寄存器搬到内存这个数组，搬 N 次，循环"，它就自己干，**完全不经过 CPU**。

CPU 只在"搬完一轮"时收一个通知（或者连通知都不要）。

<svg class="diagram" viewBox="0 0 860 220" xmlns="http://www.w3.org/2000/svg">
  <rect x="40" y="60" width="150" height="70" rx="6" fill="none" stroke="#2c6fbb" stroke-width="2"/>
  <text class="sub" x="76" y="102" font-size="11">ADC 数据寄存器</text>

  <rect x="350" y="60" width="160" height="70" rx="6" fill="none" stroke="#c0392b" stroke-width="2"/>
  <text class="sub" x="420" y="102" font-size="11">DMA 控制器</text>

  <rect x="670" y="60" width="150" height="70" rx="6" fill="none" stroke="#2c6fbb" stroke-width="2"/>
  <text class="sub" x="714" y="102" font-size="11">内存数组</text>

  <line class="arrow" x1="190" y1="95" x2="345" y2="95"/>
  <polygon class="arrowhead" points="345,91 355,95 345,99"/>
  <line class="arrow" x1="510" y1="95" x2="665" y2="95"/>
  <polygon class="arrowhead" points="665,91 675,95 665,99"/>

  <text class="sub" x="40" y="175" font-size="10.5">CPU 只需：配置一次 → 启动 → 去干别的；数组填满后收一次通知。</text>
</svg>

### 4.3 循环模式是关键

DMA 有两种模式：

| 模式 | 行为 | 适用 |
| --- | --- | --- |
| Normal | 搬完 N 次就停 | 单次采集 |
| **Circular** | 搬完回到开头，永远不停 | **连续采样（本课用这个）** |

配成 Circular 后，ADC 一直采、DMA 一直填，数组就像一个"永远在更新的窗口"。主循环随时读数组，拿到的就是最近 N 次采样。

::: warn 不配 Circular 的现象
现象：上电后数组里有一次数据，之后**再也不更新**，读出来永远是同一批值。

因为 DMA 搬完一轮就停了，ADC 还在采但没人搬。新手常误以为是 ADC 坏了。

同理，如果 DMA 的中断里没有重新启动，Normal 模式也只能用一次。
:::

---

## 5. CubeMX 配置（两路 ADC + DMA）

以 PA0(ADC1_IN0) 和 PA1(ADC1_IN1) 为例。

### 5.1 ADC1

| 配置项 | 值 | 理由 |
| --- | --- | --- |
| Clock Prescaler | **PCLK2/6** | 72/6 = 12MHz，低于 14MHz 上限 |
| Resolution | 12 bits | 0.8mV |
| Scan Conversion Mode | **Enable** | 多通道要扫描 |
| Continuous Conversion Mode | **Enable** | 一直采 |
| Discontinuous Conversion Mode | Disable | — |
| DMA Continuous Requests | **Enable** | 配合循环 DMA |
| Number Of Conversion | **2** | 两个通道 |
| Rank 1 | Channel 0，采样 **13.5 Cycles** | 低速信号 |
| Rank 2 | Channel 1，采样 **13.5 Cycles** | — |

`Analog` 页里把 PA0、PA1 都设为 ADC 输入。

### 5.2 DMA

`DMA Settings → Add`：

| 配置项 | 值 |
| --- | --- |
| DMA Request | ADC1 |
| Direction | Peripheral To Memory |
| Mode | **Circular** |
| Data Width (P→M) | Half Word / Half Word（16 位） |
| Increment Address (Memory) | **Enable**（数组要往后走） |
| Increment Address (Peripheral) | Disable（ADC 寄存器地址不变） |

::: note 为什么外设地址不递增、内存地址递增
DMA 每次搬运的两个地址：

- **源地址 = ADC->DR**（数据寄存器），永远同一个位置，每次搬完 ADC 会把新值放进去 → **不递增**。
- **目的地址 = 数组**，第一次搬 `buf[0]`，第二次 `buf[1]`…… → **递增**。

如果两边都递增，第二次就会去读 ADC 寄存器后面的地址，读到的是配置寄存器，数据全乱。如果内存不递增，数组里只有一个元素被反复覆盖——现象是"两路数据看起来一样"。
:::

---

## 6. HAL 代码

**文件：`Core/Src/main.c`**
```c
#include "main.h"
#include "adc.h"
#include "dma.h"
#include "gpio.h"
#include "usart.h"
#include "adc_bsp.h"
#include <stdio.h>

static void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_DMA_Init();            /* 必须先于 MX_ADC1_Init：ADC 要先挂到 DMA 通道 */
  MX_ADC1_Init();           /* 12 位、扫描、连续转换、DMA 连续请求、13.5 周期 */
  MX_USART1_UART_Init();    /* 115200-8-N-1，打印电压 */

  /* USER CODE BEGIN 2 */
  ADC_BSP_Start();          /* 启动后永不停，Circular 自己回卷 */
  /* USER CODE END 2 */

  while (1)
  {
    /* 读到的永远是"最近一轮"的采样值，读的过程中 DMA 可能正在写下一轮 */
    uint32_t mv0 = (uint32_t)(ADC_BSP_GetVoltage(0) * 1000.0f + 0.5f);
    uint32_t mv1 = (uint32_t)(ADC_BSP_GetVoltage(1) * 1000.0f + 0.5f);
    printf("CH0=%lu mV  CH1=%lu mV\r\n", (unsigned long)mv0, (unsigned long)mv1);
    HAL_Delay(500);
  }
}

static void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  /* HSE 8MHz × 9 = 72MHz；PCLK2 = 72MHz，ADC 预分频 6 → 12MHz ≤ 14MHz */
  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState = RCC_HSE_ON;
  osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  osc.PLL.PLLState = RCC_PLL_ON;
  osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();

  clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                  RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) Error_Handler();
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

::: note 为什么是这几句
- 第三个参数是 **转换次数，不是字节数**：`ADC_CH_COUNT = 2` 表示"搬 2 个半字"，不等于 2 字节。写成 `sizeof(s_adc_buf)`（= 4 字节），DMA 会多搬两次，数组后面的内存被改写，现象是**相邻变量莫名其妙变化**。
- 强制转 `(uint32_t *)` 只是骗过函数原型（HAL 统一用 32 位指针），真正决定搬多宽的是 CubeMX 里设的 **Half Word**。设成 Byte 时，12 位结果会被劈成两个字节，读出来是 `0xXX00` 之类的怪值。
- ADC 时钟配 **PCLK2/6 = 12MHz**、采样 **13.5 周期**：13.5 × 83ns ≈ 1.1μs，大于第 3 节算出的 0.79μs 充电需求；改成 1.5 周期（0.125μs）后，光敏电阻这类高内阻信号**读数只有真实值的八成**。
- `HAL_ADC_Start_DMA` 只调一次：DMA 是 Circular，搬完一轮自动回开头，不需要在回调里重新启动。若在 `HAL_ADC_ConvCpltCallback` 里再调一次，HAL 会返回 `HAL_BUSY`，重配反而把正在跑的传输打断。
:::

::: note 为什么不用轮询或中断
- **轮询**：主循环里等 EOC 标志，采样率完全取决于你多久问一次，其它任务一忙就漏采。ADC 是连续转换的，轮询只会读到"碰巧那一刻"的值。
- **中断**：每 2.17μs 一次中断。100kHz 采样就要每秒 10 万次进出中断，CPU 全耗在压栈出栈上，`printf` 根本没机会跑。
- **DMA**：ADC 每转换完自己去"敲门"，DMA 搬走，CPU 零参与。代价是**数据不是实时的**——主循环通过 `ADC_BSP_GetRaw()` 读缓冲时，DMA 可能正写到一半，所以同一轮的两个通道最好一次读完，别边读边判断。
:::

::: note 哪些代码"故意没写"
`HAL_ADC_MspInit()`（在 `Core/Src/adc.c`）负责开 ADC1 时钟、把 PA0/PA1 配成模拟输入、把 `hdma_adc1` 绑到 `hadc1.DMA_Handle`；`MX_DMA_Init()` 开 DMA1 时钟和 NVIC。这些都由 CubeMX 生成——手写的典型翻车是**忘了配模拟输入**（配成浮空输入时读数在 0~4095 乱跳），或者 DMA 通道选错（F103 的 ADC1 只能用 DMA1 通道 1）。

另外 F103 的 ADC 上电后可以调一次 `HAL_ADCEx_Calibration_Start()` 做自校准，课堂实验不调也能用；如果发现所有通道都偏几十个 LSB，再把它加到 `MX_ADC1_Init()` 之后。
:::

### 6.1 软件滤波：读数还是会跳怎么办

ADC 天生有 ±1~2 个 LSB 的噪声，直接显示会"跳数字"。工程上至少做一层滤波：

滤波单独放 `Hardware`，输入是"新样本"，输出是"平均值"，与 ADC 驱动解耦：

**文件：`Hardware/Inc/adc_filter.h`**
```c
#ifndef __ADC_FILTER_H
#define __ADC_FILTER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define ADC_FILTER_N   8U    /* 滑动窗口长度：8 次平均 */

/* 传入本通道最新原始值，返回 8 次滑动平均；ch 取值 0~ADC_CH_COUNT-1 */
uint16_t ADC_Filter(uint8_t ch, uint16_t raw);

#ifdef __cplusplus
}
#endif

#endif /* __ADC_FILTER_H */
```

**文件：`Hardware/Src/adc_filter.c`**
```c
#include "adc_filter.h"
#include "adc_bsp.h"     /* 用 ADC_CH_COUNT 决定每个通道各存多少历史 */

uint16_t ADC_Filter(uint8_t ch, uint16_t raw)
{
    static uint16_t hist[ADC_CH_COUNT][ADC_FILTER_N];   /* 每通道各自的历史 */
    static uint8_t  idx[ADC_CH_COUNT];                  /* 每通道各自的写位置 */
    uint32_t sum = 0;

    if (ch >= ADC_CH_COUNT) return raw;

    hist[ch][idx[ch]] = raw;                            /* 塞入最新一次 */
    for (uint8_t i = 0; i < ADC_FILTER_N; i++) sum += hist[ch][i];

    if (++idx[ch] >= ADC_FILTER_N) idx[ch] = 0U;        /* 环形推进 */
    return (uint16_t)(sum / ADC_FILTER_N);
}
```

::: note 为什么 `idx` 必须按通道分开存
上面这版是**改过的**。常见写法只用一个 `static uint8_t idx`，两路交替调用时，CH0 写第 3 格、CH1 也去写第 3 格，历史数组互相覆盖，现象是**两路读数一起跳、滤波后反而更抖**。

另外两个细节：
- `sum` 用 `uint32_t`：8 × 4095 = 32760，已经接近 `uint16_t` 上限，再多一路或改成 16 次平均就溢出了。
- 前 8 次读数偏低：`hist` 上电是全 0，平均时把 0 也算进去了，所以刚开机那几次数值会偏小。要避免就先连续调用 8 次预热，或者用一个"已填充个数"做除数。代价是代码变复杂，多数场景等 8 个采样周期（几十微秒）就行。
:::

::: note 平均滤波的代价和替代方案
- **滑动平均**：简单，但会**延迟响应**（8 次平均相当于滞后 4 个采样周期）。测温度没问题，测按键/过零检测就不行。
- **中值滤波**：取 3~5 次的中位数，专治"偶发尖峰"（比如电机干扰导致的一个异常值）。
- **中值 + 平均**：先中值去掉尖峰，再平均压噪声，工业上最常用。
- **一阶低通（RC 数字滤波）**：`y += (x - y) * α`，α 越小越平滑、越迟钝，内存只要一个变量。

**选哪种取决于你要"稳"还是要"快"**，没有万能的。
:::

---

## 7. 算一算

::: exercise 练习 1：读数换算
ADC 读到 `2048`，参考电压 3.3V。实际电压是多少？如果这个通道接的是 10kΩ + 20kΩ 分压后的 5V 电池，电池真实电压是多少？

::: answer
通道电压：

$$2048 / 4096 \times 3.3V = 1.65V$$

分压比：$R_{下} / (R_{上} + R_{下}) = 20 / 30 = 2/3$，所以：

$$V_{电池} = 1.65 / (2/3) = 2.475V$$

验证：$2.475 \times 2/3 = 1.65$ ✓。

但这里有个设计问题：如果电池满电是 5V，分压后是 $5 \times 2/3 = 3.33V$，对应码值 $3.33/3.3 \times 4096 \approx 4136$ —— **超过 4095，饱和了**。满电附近的变化完全看不出来。

正确做法是按**最高输入电压**、并留 10% 余量来选电阻。5V 输入想让分压后不超过 3.0V：

$$\frac{R_{下}}{R_{上}+R_{下}} \leq \frac{3.0}{5} = 0.6$$

取 **10kΩ + 10kΩ**（分压比 0.5），5V → 2.5V，码值 3103，还能测到 6.6V 才饱和，余量充足。

**分压电阻一定要按"最高电压"算，不能按典型值算。**
:::
:::

::: exercise 练习 2：采样率够不够
ADC 时钟 12MHz，采样时间 13.5 周期，两个通道轮流采。每路每秒能采多少次？

::: answer
单次转换时间：

$$(13.5 + 12.5) / 12MHz = 26 / 12\mu s \approx 2.17\mu s$$

两通道轮流，一轮 2 次：

$$2 \times 2.17 = 4.33\mu s$$

每路采样率：

$$1 / 4.33\mu s \approx 231\text{ kSPS}$$

两路合计约 462k 次/秒，正好是 ADC 的极限。

如果信号是 50Hz 工频，231kSPS 远远够（奈奎斯特只要 100Hz）；如果要测 20kHz 音频，231kSPS 也够（>40kHz）。**真正受限的是"要不要多通道 + 要多高精度"**，不是 ADC 本身。
:::
:::

---

## 8. 动手项目

::: project
**电位器电压表 + OLED 显示**

1. 电位器两端接 3.3V 和 GND，中间抽头接 PA0。
2. ADC + DMA 连续采样（单通道即可），做 8 次滑动平均。
3. 把电压显示在 OLED 上，保留 2 位小数，同时画一个**长度随电压变化的进度条**。
4. 串口每 200ms 打印一次原始值和滤波后的值，方便对比。

**验收标准**：

1. 拧电位器，OLED 上的电压在 **0.00V ~ 3.30V** 之间连续变化，不跳变。
2. 拧到两端时读数分别是 0 和 4095 附近（不是卡在中间）。
3. 手不碰时，显示的最后一位偶尔跳 ±0.01V 属正常；滤波后应基本稳定。
4. 用万用表量 PA0 电压，和 OLED 显示对比，误差 **< 0.02V**。

**加分**：把 s13 的 I2C 扫描和本课的 ADC 合到一个工程里，OLED 上同时显示 I2C 地址和电压。

**文件放置表**

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `adc_bsp.h` | `Hardware/Inc/` | 通道数、VREF、分压比、采样/换算接口 |
| `adc_filter.h` | `Hardware/Inc/` | 滑动平均接口 |
| `app_adc.h` | `App/Inc/` | 电压表界面接口 |
| `ssd1306.h`、`ssd1306_text.h` | `Hardware/Inc/` | OLED 基础绘图与字符显示接口 |
| `adc_bsp.c` | `Hardware/Src/` | 启动 ADC+DMA、取码值、换算电压 |
| `adc_filter.c` | `Hardware/Src/` | 8 次滑动平均 |
| `ssd1306.c`、`ssd1306_text.c` | `Hardware/Src/` | OLED 初始化、定位、清屏、画点、字模与字符显示 |
| `retarget.c` | `Hardware/Src/` | `printf` 重定向 |
| `app_adc.c` | `App/Src/` | 读电压 → 显示数字 + 进度条 → 串口打印 |
| `main.h` | `Core/Inc/` | `Error_Handler` 声明 |
| `main.c` | `Core/Src/` | 初始化调用、主循环 |
| `adc.c/h`、`dma.c/h`、`i2c.c/h`、`usart.c/h`、`gpio.c/h` | `Core/Src`、`Core/Inc` | CubeMX 生成，不手写 |

::: note 为什么这里把 OLED 驱动再贴一遍
这个项目要求"复制进工程就能编译"，所以即使 s13 已经给过一份 `ssd1306`，这里仍然把**本工程用到的四个文件完整写出**。你可以直接从 s13 复制，但不要假设"读者手里已经有"——课件本身要能独立落地。
:::

**文件：`Hardware/Inc/ssd1306.h`**
```c
#ifndef __SSD1306_H
#define __SSD1306_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

/* SSD1306 数据手册的 7 位地址是 0x3C；有的模块焊成 0x3D */
#define SSD1306_ADDR7       0x3CU
/* HAL 的 DevAddress 要"已左移一位"的 8 位值：写 0x78、读 0x79 */
#define SSD1306_ADDR8       (SSD1306_ADDR7 << 1)

#define SSD1306_CMD         0x00U   /* 控制字节：0x00 后面是命令 */
#define SSD1306_DATA        0x40U   /* 控制字节：0x40 后面是显存数据 */

#define SSD1306_PAGES       8U      /* 128×64：8 页 */
#define SSD1306_WIDTH       128U    /* 每页 128 列 */
#define SSD1306_I2C_TIMEOUT 100U    /* 100kHz 下 2 字节约 0.2ms，100ms 足够 */

void OLED_Init(void);
void OLED_Clear(void);
void OLED_SetPos(uint8_t page, uint8_t col);
void OLED_WriteCmd(uint8_t cmd);
void OLED_WriteData(const uint8_t *data, uint16_t len);
void OLED_Dot(uint8_t page, uint8_t col, uint8_t on);

#ifdef __cplusplus
}
#endif

#endif /* __SSD1306_H */
```

**文件：`Hardware/Inc/ssd1306_text.h`**
```c
#ifndef __SSD1306_TEXT_H
#define __SSD1306_TEXT_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define OLED_FONT_W    5U   /* 字模宽 5 像素 */
#define OLED_FONT_H    7U   /* 字模高 7 像素（放在 8 像素高的页里） */
#define OLED_CHAR_W    6U   /* 每个字符占 6 列：5 列字模 + 1 列间隔 */

void OLED_ShowChar(uint8_t page, uint8_t col, char ch);
void OLED_ShowString(uint8_t page, uint8_t col, const char *str);
void OLED_ShowNum(uint8_t page, uint8_t col, uint32_t num, uint8_t len);

#ifdef __cplusplus
}
#endif

#endif /* __SSD1306_TEXT_H */
```

**文件：`Hardware/Src/ssd1306.c`**
```c
#include "ssd1306.h"
#include "i2c.h"          /* hi2c1 在这里 extern 声明 */
#include <string.h>

/* 上电初始化序列，全部来自 SSD1306 数据手册（Application Note 表格） */
static const uint8_t s_init_cmds[] = {
    0xAE,        /* 关显示 */
    0xD5, 0x80,  /* 时钟分频 = 1，振荡频率档位 8 */
    0xA8, 0x3F,  /* 复用率 = 64 行（0x3F） */
    0xD3, 0x00,  /* 显示偏移 = 0 */
    0x40,        /* 显存起始行 = 0 */
    0x8D, 0x14,  /* 开电荷泵（必须，否则屏不亮） */
    0x20, 0x00,  /* 水平寻址模式 */
    0xA1,        /* 段重映射：列 127 → SEG0（左右不镜像） */
    0xC8,        /* COM 反向扫描：上下不镜像 */
    0xDA, 0x12,  /* COM 引脚配置：128×64 用 0x12 */
    0x81, 0xCF,  /* 对比度 0xCF */
    0xD9, 0xF1,  /* 预充电周期 */
    0xDB, 0x40,  /* VCOMH 电压 */
    0xA4,        /* 显示跟随显存 */
    0xA6,        /* 正常显示（非反白） */
    0x2E,        /* 关滚动 */
    0xAF         /* 开显示 */
};

/* 发一条命令：0x00 是 SSD1306 的控制字节，声明后面是命令流 */
void OLED_WriteCmd(uint8_t cmd)
{
    uint8_t buf[2] = {SSD1306_CMD, cmd};
    HAL_I2C_Master_Transmit(&hi2c1, SSD1306_ADDR8, buf, 2, SSD1306_I2C_TIMEOUT);
}

/* 连续写显存数据：一个事务最多 32 字节，避免栈上开大数组 */
void OLED_WriteData(const uint8_t *data, uint16_t len)
{
    uint8_t buf[33];                    /* 1 个控制字节 + 最多 32 字节数据 */
    while (len > 0U) {
        uint16_t n = (len > 32U) ? 32U : len;
        buf[0] = SSD1306_DATA;
        memcpy(&buf[1], data, n);
        HAL_I2C_Master_Transmit(&hi2c1, SSD1306_ADDR8, buf, (uint16_t)(n + 1U),
                                SSD1306_I2C_TIMEOUT);
        data += n;
        len  -= n;
    }
}

/* 定位到第 page 页（0~7）的第 col 列（0~127） */
void OLED_SetPos(uint8_t page, uint8_t col)
{
    uint8_t cmd[4];
    cmd[0] = SSD1306_CMD;
    cmd[1] = (uint8_t)(0xB0U | (page & 0x07U));   /* 页地址命令 0xB0~0xB7 */
    cmd[2] = (uint8_t)(col & 0x0FU);              /* 列地址低 4 位 */
    cmd[3] = (uint8_t)(0x10U | (col >> 4));       /* 列地址高 4 位 */
    HAL_I2C_Master_Transmit(&hi2c1, SSD1306_ADDR8, cmd, 4, SSD1306_I2C_TIMEOUT);
}

/* 清屏：8 页 × 128 列全部写 0 */
void OLED_Clear(void)
{
    static const uint8_t zeros[SSD1306_WIDTH] = {0};
    for (uint8_t p = 0; p < SSD1306_PAGES; p++) {
        OLED_SetPos(p, 0);
        OLED_WriteData(zeros, SSD1306_WIDTH);
    }
}

/* 点亮/熄灭某页某列最上面的像素（bit0 在上） */
void OLED_Dot(uint8_t page, uint8_t col, uint8_t on)
{
    uint8_t v = on ? 0x01U : 0x00U;
    OLED_SetPos(page, col);
    OLED_WriteData(&v, 1);
}

void OLED_Init(void)
{
    for (uint16_t i = 0; i < sizeof(s_init_cmds); i++) {
        OLED_WriteCmd(s_init_cmds[i]);
    }
    OLED_Clear();
}
```

**文件：`Hardware/Src/ssd1306_text.c`**
```c
#include "ssd1306_text.h"
#include "ssd1306.h"
#include "i2c.h"          /* hi2c1 在这里 extern 声明 */
#include <string.h>

/* 5×7 点阵，ASCII 0x20~0x5A；每字符 5 字节，纵向取模、低位在上 */
static const uint8_t s_font5x7[][OLED_FONT_W] = {
    /* 0x20 */ {0x00,0x00,0x00,0x00,0x00}, /* 0x21 */ {0x00,0x00,0x5F,0x00,0x00},
    /* 0x22 */ {0x00,0x07,0x00,0x07,0x00}, /* 0x23 */ {0x14,0x7F,0x14,0x7F,0x14},
    /* 0x24 */ {0x24,0x2A,0x7F,0x2A,0x12}, /* 0x25 */ {0x23,0x13,0x08,0x64,0x62},
    /* 0x26 */ {0x36,0x49,0x55,0x22,0x50}, /* 0x27 */ {0x00,0x05,0x03,0x00,0x00},
    /* 0x28 */ {0x00,0x1C,0x22,0x41,0x00}, /* 0x29 */ {0x00,0x41,0x22,0x1C,0x00},
    /* 0x2A */ {0x14,0x08,0x3E,0x08,0x14}, /* 0x2B */ {0x08,0x08,0x3E,0x08,0x08},
    /* 0x2C */ {0x00,0x50,0x30,0x00,0x00}, /* 0x2D */ {0x08,0x08,0x08,0x08,0x08},
    /* 0x2E */ {0x00,0x60,0x60,0x00,0x00}, /* 0x2F */ {0x20,0x10,0x08,0x04,0x02},
    /* 0x30 */ {0x3E,0x51,0x49,0x45,0x3E}, /* 0x31 */ {0x00,0x42,0x7F,0x40,0x00},
    /* 0x32 */ {0x42,0x61,0x51,0x49,0x46}, /* 0x33 */ {0x21,0x41,0x45,0x4B,0x31},
    /* 0x34 */ {0x18,0x14,0x12,0x7F,0x10}, /* 0x35 */ {0x27,0x45,0x45,0x45,0x39},
    /* 0x36 */ {0x3C,0x4A,0x49,0x49,0x30}, /* 0x37 */ {0x01,0x71,0x09,0x05,0x03},
    /* 0x38 */ {0x36,0x49,0x49,0x49,0x36}, /* 0x39 */ {0x06,0x49,0x49,0x29,0x1E},
    /* 0x3A */ {0x00,0x36,0x36,0x00,0x00}, /* 0x3B */ {0x00,0x56,0x36,0x00,0x00},
    /* 0x3C */ {0x00,0x08,0x14,0x22,0x41}, /* 0x3D */ {0x14,0x14,0x14,0x14,0x14},
    /* 0x3E */ {0x41,0x22,0x14,0x08,0x00}, /* 0x3F */ {0x02,0x01,0x51,0x09,0x06},
    /* 0x40 */ {0x32,0x49,0x79,0x41,0x3E}, /* 0x41 */ {0x7E,0x11,0x11,0x11,0x7E},
    /* 0x42 */ {0x7F,0x49,0x49,0x49,0x36}, /* 0x43 */ {0x3E,0x41,0x41,0x41,0x22},
    /* 0x44 */ {0x7F,0x41,0x41,0x22,0x1C}, /* 0x45 */ {0x7F,0x49,0x49,0x49,0x41},
    /* 0x46 */ {0x7F,0x09,0x09,0x01,0x01}, /* 0x47 */ {0x3E,0x41,0x41,0x51,0x32},
    /* 0x48 */ {0x7F,0x08,0x08,0x08,0x7F}, /* 0x49 */ {0x00,0x41,0x7F,0x41,0x00},
    /* 0x4A */ {0x20,0x40,0x41,0x3F,0x01}, /* 0x4B */ {0x7F,0x08,0x14,0x22,0x41},
    /* 0x4C */ {0x7F,0x40,0x40,0x40,0x40}, /* 0x4D */ {0x7F,0x02,0x04,0x02,0x7F},
    /* 0x4E */ {0x7F,0x04,0x08,0x10,0x7F}, /* 0x4F */ {0x3E,0x41,0x41,0x41,0x3E},
    /* 0x50 */ {0x7F,0x09,0x09,0x09,0x06}, /* 0x51 */ {0x3E,0x41,0x51,0x21,0x5E},
    /* 0x52 */ {0x7F,0x09,0x19,0x29,0x46}, /* 0x53 */ {0x46,0x49,0x49,0x49,0x31},
    /* 0x54 */ {0x01,0x01,0x7F,0x01,0x01}, /* 0x55 */ {0x3F,0x40,0x40,0x40,0x3F},
    /* 0x56 */ {0x1F,0x20,0x40,0x20,0x1F}, /* 0x57 */ {0x7F,0x20,0x18,0x20,0x7F},
    /* 0x58 */ {0x63,0x14,0x08,0x14,0x63}, /* 0x59 */ {0x03,0x04,0x78,0x04,0x03},
    /* 0x5A */ {0x61,0x51,0x49,0x45,0x43}
};

/* 在 (page, col) 处画一个字符：一次 I2C 事务写 6 列 */
void OLED_ShowChar(uint8_t page, uint8_t col, char ch)
{
    uint8_t buf[OLED_CHAR_W + 1];   /* 1 个控制字节 + 5 列字模 + 1 列空隙 */
    uint8_t idx;

    if (ch >= 'a' && ch <= 'z') ch = (char)(ch - 32);   /* 只做了一套大写 */
    if (ch < ' ' || ch > 'Z') ch = '?';
    idx = (uint8_t)(ch - ' ');

    buf[0] = SSD1306_DATA;
    memcpy(&buf[1], s_font5x7[idx], OLED_FONT_W);
    buf[OLED_CHAR_W] = 0x00;        /* 字符之间留 1 列空白 */
    OLED_SetPos(page, col);
    HAL_I2C_Master_Transmit(&hi2c1, SSD1306_ADDR8, buf, sizeof(buf), SSD1306_I2C_TIMEOUT);
}

void OLED_ShowString(uint8_t page, uint8_t col, const char *str)
{
    while (*str != '\0' && (uint16_t)(col + OLED_CHAR_W) <= SSD1306_WIDTH) {
        OLED_ShowChar(page, col, *str++);
        col = (uint8_t)(col + OLED_CHAR_W);
    }
}

/* 定长显示十进制数，例如 len=5 显示 "00042" */
void OLED_ShowNum(uint8_t page, uint8_t col, uint32_t num, uint8_t len)
{
    char tmp[11];
    if (len > 10U) len = 10U;
    for (uint8_t i = 0; i < len; i++) {
        tmp[len - 1U - i] = (char)('0' + num % 10U);   /* 从最低位往前填 */
        num /= 10U;
    }
    tmp[len] = '\0';
    OLED_ShowString(page, col, tmp);
}
```

**文件：`Hardware/Inc/adc_bsp.h`**
```c
#ifndef __ADC_BSP_H
#define __ADC_BSP_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define ADC_CH_COUNT    2U        /* 必须等于 CubeMX 的 Number Of Conversion（PA0/PA1） */
#define ADC_VREF        3.3f      /* 参考电压 3.3V */
#define ADC_FULL_SCALE  4096.0f   /* 12 位：0~4095 共 4096 格 */
#define ADC_DIV_RATIO   1.0f      /* 电位器直接接 3.3V，不用分压；测 5V 时改 1.5f */

void     ADC_BSP_Start(void);
uint16_t ADC_BSP_GetRaw(uint8_t ch);
float    ADC_BSP_GetVoltage(uint8_t ch);

#ifdef __cplusplus
}
#endif

#endif /* __ADC_BSP_H */
```

**文件：`Hardware/Inc/adc_filter.h`**
```c
#ifndef __ADC_FILTER_H
#define __ADC_FILTER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define ADC_FILTER_N   8U    /* 滑动窗口长度：8 次平均 */

uint16_t ADC_Filter(uint8_t ch, uint16_t raw);

#ifdef __cplusplus
}
#endif

#endif /* __ADC_FILTER_H */
```

**文件：`App/Inc/app_adc.h`**
```c
#ifndef __APP_ADC_H
#define __APP_ADC_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_AdcInit(void);   /* OLED 初始化 + 画静态标签 */
void App_AdcLoop(void);   /* 每 200ms 刷新一次电压、进度条和串口输出 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_ADC_H */
```
**文件：`Hardware/Src/adc_bsp.c`**
```c
#include "adc_bsp.h"
#include "adc.h"          /* hadc1 在这里 extern 声明 */

static volatile uint16_t s_adc_buf[ADC_CH_COUNT];   /* DMA 落点，下标 = Rank-1 */

void ADC_BSP_Start(void)
{
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)s_adc_buf, ADC_CH_COUNT);
}

uint16_t ADC_BSP_GetRaw(uint8_t ch)
{
    return (ch < ADC_CH_COUNT) ? s_adc_buf[ch] : 0U;
}

float ADC_BSP_GetVoltage(uint8_t ch)
{
    uint16_t raw = ADC_BSP_GetRaw(ch);
    return ((float)raw / ADC_FULL_SCALE * ADC_VREF) * ADC_DIV_RATIO;
}
```

**文件：`Hardware/Src/adc_filter.c`**
```c
#include "adc_filter.h"
#include "adc_bsp.h"

uint16_t ADC_Filter(uint8_t ch, uint16_t raw)
{
    static uint16_t hist[ADC_CH_COUNT][ADC_FILTER_N];
    static uint8_t  idx[ADC_CH_COUNT];
    uint32_t sum = 0;

    if (ch >= ADC_CH_COUNT) return raw;

    hist[ch][idx[ch]] = raw;
    for (uint8_t i = 0; i < ADC_FILTER_N; i++) sum += hist[ch][i];

    if (++idx[ch] >= ADC_FILTER_N) idx[ch] = 0U;
    return (uint16_t)(sum / ADC_FILTER_N);
}
```

**文件：`Hardware/Src/retarget.c`**（GCC / CubeIDE）
```c
#include "usart.h"
#include <stdio.h>

int _write(int file, char *ptr, int len)
{
    (void)file;
    HAL_UART_Transmit(&huart1, (uint8_t *)ptr, (uint16_t)len, HAL_MAX_DELAY);
    return len;
}
```
**文件：`App/Src/app_adc.c`**
```c
#include "app_adc.h"
#include "adc_bsp.h"
#include "adc_filter.h"
#include "ssd1306.h"
#include "ssd1306_text.h"
#include <stdio.h>

#define BAR_COL_START  10U    /* 进度条从第 10 列开始 */
#define BAR_COL_LEN    100U   /* 3.3V 对应 100 列 */

void App_AdcInit(void)
{
    OLED_Init();
    OLED_ShowString(0, 0, "VOLT");     /* 第 0 页：标签 */
    OLED_ShowString(4, 0, "RAW");      /* 第 4 页：滤波后的原始值 */
}

void App_AdcLoop(void)
{
    static uint32_t last = 0;
    uint16_t raw, flt;
    uint32_t mv;
    char s[8];
    uint8_t bar;

    if (HAL_GetTick() - last < 200U) return;
    last = HAL_GetTick();

    raw = ADC_BSP_GetRaw(0);
    flt = ADC_Filter(0, raw);
    mv  = (uint32_t)(ADC_BSP_GetVoltage(0) * 1000.0f + 0.5f);   /* 四舍五入到 mV */

    /* 第 1 页显示 "x.xxV" */
    s[0] = (char)('0' + (mv / 1000U) % 10U);
    s[1] = '.';
    s[2] = (char)('0' + (mv / 100U) % 10U);
    s[3] = (char)('0' + (mv / 10U) % 10U);
    s[4] = 'V';
    s[5] = '\0';
    OLED_ShowString(1, 0, s);

    /* 第 4 页显示滤波后的原始值，第 6 页画进度条 */
    OLED_ShowNum(4, 42, flt, 4);

    bar = (uint8_t)((mv * BAR_COL_LEN) / 3300U);   /* 0~3300mV → 0~100 列 */
    if (bar > BAR_COL_LEN) bar = BAR_COL_LEN;
    for (uint8_t i = 0; i < BAR_COL_LEN; i++) {
        OLED_Dot(6, (uint8_t)(BAR_COL_START + i), (i < bar) ? 1U : 0U);
    }

    printf("raw=%u flt=%u mv=%lu\r\n", raw, flt, (unsigned long)mv);
}
```

**文件：`Core/Inc/main.h`**
```c
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
```

**文件：`Core/Src/main.c`**
```c
#include "main.h"
#include "adc.h"
#include "dma.h"
#include "gpio.h"
#include "i2c.h"
#include "usart.h"
#include "adc_bsp.h"
#include "app_adc.h"

static void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_DMA_Init();            /* 必须先于 MX_ADC1_Init */
  MX_ADC1_Init();           /* PA0=Rank1(CH0)、PA1=Rank2(CH1)，13.5 周期 */
  MX_I2C1_Init();           /* 100kHz，PB6/PB7，给 OLED 用 */
  MX_USART1_UART_Init();    /* 115200-8-N-1 */

  /* USER CODE BEGIN 2 */
  ADC_BSP_Start();          /* Circular DMA，启动一次即可 */
  App_AdcInit();            /* OLED 初始化 + 静态标签 */
  /* USER CODE END 2 */

  while (1)
  {
    App_AdcLoop();          /* 内部限速 200ms */
    HAL_Delay(10);
  }
}

static void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  /* HSE 8MHz × 9 = 72MHz；PCLK2 = 72MHz，ADC 预分频 6 → 12MHz */
  osc.OscillatorType = RCC_OSCILLATORTYPE_HSE;
  osc.HSEState = RCC_HSE_ON;
  osc.HSEPredivValue = RCC_HSE_PREDIV_DIV1;
  osc.PLL.PLLState = RCC_PLL_ON;
  osc.PLL.PLLSource = RCC_PLLSOURCE_HSE;
  osc.PLL.PLLMUL = RCC_PLL_MUL9;
  if (HAL_RCC_OscConfig(&osc) != HAL_OK) Error_Handler();

  clk.ClockType = RCC_CLOCKTYPE_HCLK | RCC_CLOCKTYPE_SYSCLK |
                  RCC_CLOCKTYPE_PCLK1 | RCC_CLOCKTYPE_PCLK2;
  clk.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  clk.AHBCLKDivider = RCC_SYSCLK_DIV1;
  clk.APB1CLKDivider = RCC_HCLK_DIV2;
  clk.APB2CLKDivider = RCC_HCLK_DIV1;
  if (HAL_RCC_ClockConfig(&clk, FLASH_LATENCY_2) != HAL_OK) Error_Handler();
}

void Error_Handler(void)
{
  __disable_irq();
  while (1) { }
}
```

::: note 这个项目里哪些代码是 CubeMX 生成的
- `MX_ADC1_Init()`（在 `adc.c`）：Clock Prescaler = **PCLK2/6 → 12MHz**（上限 14MHz）、12 位、Scan Enable、Continuous Enable、DMA Continuous Requests Enable、Number Of Conversion = 2、Rank1 = CH0 / Rank2 = CH1、采样时间 **13.5 Cycles**。
- `HAL_ADC_MspInit()`（在 `adc.c`）：开 ADC1 时钟、PA0/PA1 配**模拟输入**、`hdma_adc1` 绑到 `hadc1.DMA_Handle`。
- `MX_DMA_Init()`（在 `dma.c`）：开 DMA1 时钟、NVIC。F103 的 ADC1 只能用 **DMA1 通道 1**。
- `MX_I2C1_Init()`：100kHz、7 位地址，PB6/PB7 复用开漏，给 OLED。
- 只显示 CH0（电位器接 PA0）；CH1 悬空也不影响 Rank1 的采样。想省一路就把 Number Of Conversion 改成 1、`ADC_CH_COUNT` 改成 1。
:::

::: note 为什么这样拆文件
- `adc_bsp.c` 只负责"把模拟量变成可读的数字和电压"，`adc_filter.c` 只负责"把抖动的数字变稳"，`app_adc.c` 只负责"怎么显示"。三层各自可以单独测：串口打印验证前两层，OLED 验证第三层。
- 滤波用"传入新样本"而不是"自己去读 DMA 数组"：这样滤波模块不认识 ADC 句柄，换 8 路或换内部温度传感器都不用改。
- 进度条每 200ms 重画 100 个点，每个点 2 次 I2C 事务（定位 + 数据），100kHz 下约 54ms —— 占 27% 总线。想更快就把整行 100 列拼成一次 `OLED_WriteData`，这也是真实 OLED 库刷新的做法。
:::
:::

---

## 9. 本课小结

- 12 位 ADC = 把 0~3.3V 切成 4096 格，**1 LSB ≈ 0.806mV**；电压 = `adc / 4096 × 3.3`。
- 输入**绝不能超过 3.3V**，超了先分压，分压比按最高电压算。
- SAR ADC 像"天平称重"，12 位要比较 12 次；**位数、速度、成本三者不可兼得**。
- 采样时间由**源内阻 × 采样电容**决定；太短会**读数偏低**，内阻大时尤其明显。
- 总转换时间 = `(采样周期 + 12.5) / ADCCLK`；ADCCLK 最高 14MHz。
- **DMA 是独立搬运工**，配 Circular 模式后 ADC 连续采、数组自动更新，CPU 零负担。
- DMA 配置要点：**外设地址不递增、内存地址递增、Circular、半字**。
- 读数跳动用滑动平均/中值滤波，但要注意**滤波会带来延迟**。

::: selfcheck 自检
- [ ] 我能由 ADC 值算出电压，也知道 1 LSB 是多少
- [ ] 我能说清为什么除 4096 而不是 4095
- [ ] 我能用"天平砝码"解释 SAR ADC
- [ ] 我能解释采样时间太短为什么读数偏低
- [ ] 我能算出总转换时间和最大采样率
- [ ] 我能说出 DMA 的 Circular 模式和两个地址递增规则
- [ ] 我知道为什么会"只采一次就不更新了"
- [ ] 我能根据"要稳还是要快"选滤波方式
:::

---

## 10. 下一课预告

到这里，**采集、通信、显示**的主干都通了：能测电压、能发串口、能驱动屏幕、能存 Flash。

但一个真正能交付的产品还缺三件事：**死机了怎么办、怎么省电、参数存哪**。

下一课 `s16 看门狗、低功耗与 Flash 参数存储`：这三件事看着不相关，其实都是"**让设备在无人值守时还能活下去**"。
