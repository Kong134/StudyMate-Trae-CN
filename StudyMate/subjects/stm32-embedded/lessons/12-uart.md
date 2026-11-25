---
node: s12
title: 串口 UART：帧格式、波特率与 printf 重定向
type: practice
duration: 90
---
## 这一课要解决的问题

::: goal
读完你能：说清一帧串口数据由哪几位组成；由波特率算出每一位的时间、判断误差是否可接受；用中断 + 环形缓冲区收不定长数据；把 `printf` 重定向到串口，让板子能"说话"；知道为什么接收不能只用 `HAL_UART_Receive_IT`。
:::

前 11 课，板子的输出只有 LED 和波形。这一课给它一张嘴和一对耳朵——**串口**。它是最古老、最简单、也最不可能被淘汰的通信方式：调试要靠它，模块（GPS、蓝牙、WiFi、指纹）大半也靠它。

---

## 1. 一根线怎么传 0 和 1：先看帧

串口是**异步**通信：没有时钟线，收发双方各自按约定好的节奏采样。所以每一帧都必须自带"开始"和"结束"的标记。

一帧 8 位数据、无校验、1 位停止（常写成 **115200-8-N-1**）长这样：

<svg class="diagram" viewBox="0 0 860 220" xmlns="http://www.w3.org/2000/svg">
  <text class="label" x="16" y="28" font-size="11.5">一帧 = 起始位 + 8 位数据（低位在前）+ 停止位，共 10 位</text>
  <path d="M 60 130 L 60 90 L 110 90 L 110 130 L 160 130 L 160 90 L 210 90 L 210 130 L 260 130 L 260 90 L 310 90 L 310 130 L 360 130 L 360 90 L 410 90 L 410 130 L 460 130 L 460 90 L 510 90 L 510 130 L 560 130 L 560 90 L 610 90 L 610 130 L 660 130 L 660 90 L 710 90 L 710 130"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <line class="loop" x1="60" y1="160" x2="810" y2="160"/>
  <text class="sub" x="66" y="180" font-size="9.5">起始 0</text>
  <text class="sub" x="160" y="180" font-size="9.5">D0</text>
  <text class="sub" x="210" y="180" font-size="9.5">D1</text>
  <text class="sub" x="310" y="180" font-size="9.5">D2</text>
  <text class="sub" x="460" y="180" font-size="9.5">D3</text>
  <text class="sub" x="660" y="180" font-size="9.5">D4…</text>
  <text class="sub" x="710" y="180" font-size="9.5">停止 1</text>
  <text class="sub" x="60" y="204" font-size="10">空闲时线上是高电平；一个下降沿 = 一帧开始。</text>
</svg>

要点：

1. **空闲是高电平**。所以"线断了"和"没数据"看起来一样，都是高。
2. **起始位是低电平**。接收方靠这个下降沿对齐自己的采样时钟——这是异步通信唯一同步的机会。
3. **数据低位在前**。发 `0x41`（'A'，二进制 0100 0001），线上先出现的是最低位 1，最后才是最高位 0。
4. **停止位是高电平**，至少 1 位，给接收方一点喘息时间。

::: note 为什么串口能容忍"时钟不准"
接收方并不是在每一位中间采样一次，而是在**每一位的中点**采样（16 倍过采样时取第 8、9、10 个时钟投票）。

一帧 10 位，只要双方累计误差在停止位之前不超过**半个位宽**，采样点就还在正确的位上。算下来，波特率误差容忍大约 **±2%~3%**（10 位帧、无校验时约 ±5%）。

这就是为什么"波特率差一点点也能通，差多了全是乱码"——不是玄学，是误差累积到半个位宽了。
:::

---

## 2. 波特率：一个必须会算的数字

波特率 = **每秒传多少位**（含起始、停止位）。115200 就是每秒 115200 个位。

STM32 的 USART 内部把 PCLK 做 16 倍过采样，所以分频系数是：

$$\text{USARTDIV} = \frac{f_{PCLK}}{16 \times \text{baud}}$$

USART2 挂在 APB1 上（36MHz），USART1 挂在 APB2 上（72MHz）。**注意这两个不一样**，配错时钟源波特率就错一倍。

以 USART1、72MHz、115200 为例：

$$\text{USARTDIV} = \frac{72\,000\,000}{16 \times 115200} = 39.0625$$

BRR 寄存器把整数和小数分开存：整数部分 39 放高 12 位，小数 0.0625 × 16 = 1 放低 4 位。

$$BRR = (39 \ll 4) \,|\, 1 = 0x271$$

反算实际波特率：$72M / (16 \times 39.0625) = 115200$，**误差 0**。

再看一个不整除的：9600 时 $\text{USARTDIV} = 468.75$，整数 468、小数 0.75×16 = 12，`BRR = 0x1D4C`，实际仍是精确的 9600。

::: key 计算流程（背下来）
1. 确认这个 USART 挂在哪条总线：**USART1 → 72MHz，USART2/3 → 36MHz**。
2. 算 `USARTDIV = fPCLK / (16 × baud)`。
3. 整数部分进 BRR[15:4]，`小数 × 16` 取整进 BRR[3:0]。
4. 反算实际波特率，算误差：`|实际 − 目标| / 目标`，**要小于 2%**。

CubeMX 会自动算好 BRR，但面试会让你手算，而且"为什么我的串口是乱码"十有八九是这里配错。
:::

::: warn 波特率配错的典型现象
| 现象 | 原因 |
| --- | --- |
| 全是乱码/方块，但偶尔能认出几个字符 | 波特率差 2%~10%（比如配了 115200，实际跑 9600 的 8 倍偏差） |
| 一个字符都收不到 | 波特率差太多，或者 TX/RX 接反 |
| 收到自己的发送内容（回环） | TX 和 RX 短接了，或引脚复用配错 |
| 电脑端一会儿通一会儿断 | 没共地，或 USB-TTL 供电不足 |
| 发送正常、接收全是 0x00 | RX 引脚没配成复用/上拉，或没开接收中断 |

**排查顺序**：先确认两边波特率一致 → 再确认 TX 接对方 RX（交叉）→ 再确认共地 → 最后才怀疑代码。
:::

---

## 3. 三种收发方式，怎么选

| 方式 | CPU 占用 | 适合 | HAL 函数 |
| --- | --- | --- | --- |
| **轮询** | 全程阻塞 | 初始化打印、简单调试 | `HAL_UART_Transmit` / `Receive` |
| **中断** | 每字节一次 | 低频、不定长 | `HAL_UART_Transmit_IT` / `Receive_IT` |
| **DMA** | 几乎为 0 | 大批量、高波特率 | `HAL_UART_Transmit_DMA` / `Receive_DMA` |

发数据用轮询问题不大（发完就走）。**收数据绝对不能用轮询**：你不知道对方什么时候发，轮询要么一直卡着，要么漏掉。

但中断接收也有个坑，下一节讲。

---

## 4. HAL 库接收的坑：定长 vs 不定长

`HAL_UART_Receive_IT(&huart1, buf, 10)` 的意思是"**收满 10 个字节**才进一次回调"。可现实中的数据是**不定长**的：发 `"OK\r\n"` 是 4 个字节，发 `"ERROR\r\n"` 是 7 个字节。

如果你写死 10，短包永远等不到回调，长包会被截断。

### 4.1 正确姿势：空闲中断 + DMA

思路：让 DMA 把收到的每个字节自动搬进缓冲区，**总线空闲（IDLE）时**说明一包发完了，再去处理。

这段拆成四个文件：`Hardware/Inc/bsp_uart.h`（接口）、`Hardware/Src/bsp_uart.c`（IDLE + DMA + 环形缓冲）、`Core/Src/stm32f1xx_it.c`（中断入口，CubeMX 生成）、`Core/Src/main.c`（初始化 + 主循环）。

**文件：`Hardware/Inc/bsp_uart.h`**
```c
#ifndef __BSP_UART_H
#define __BSP_UART_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define UART_RX_BUF_SIZE   128U   /* DMA 落点：一包最多 128 字节 */
#define UART_RING_SIZE     256U   /* 环形缓冲，必须是 2 的幂 */
#define UART_LINE_SIZE     64U    /* 一条命令最长 63 字符 + 结尾 '\0' */

void     BSP_UART_Init(UART_HandleTypeDef *huart);       /* 打开 IDLE + 启动 DMA 接收 */
void     BSP_UART_IdleHandler(UART_HandleTypeDef *huart);/* 在 USARTx_IRQHandler 里调用 */
int      BSP_UART_GetByte(void);                          /* 取一个字节，空返回 -1 */
uint16_t BSP_UART_GetLine(char *line, uint16_t max_len);  /* 取一整行，无完整行返回 0 */
uint16_t BSP_UART_RxLen(void);                            /* 上一包字节数，调试用 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_UART_H */
```

**文件：`Hardware/Src/bsp_uart.c`**
```c
#include "bsp_uart.h"

static uint8_t  s_rx_buf[UART_RX_BUF_SIZE];         /* DMA 直接写入的落点 */
static uint8_t  s_ring[UART_RING_SIZE];             /* 环形缓冲：中断→主循环 */
static volatile uint16_t s_head = 0;                /* 写指针，只由中断改 */
static volatile uint16_t s_tail = 0;                /* 读指针，只由主循环改 */
static volatile uint16_t s_last_len = 0;            /* 上一包字节数 */

void BSP_UART_Init(UART_HandleTypeDef *huart)
{
    s_head = 0;
    s_tail = 0;
    __HAL_UART_ENABLE_IT(huart, UART_IT_IDLE);                 /* 额外打开空闲中断 */
    HAL_UART_Receive_DMA(huart, s_rx_buf, UART_RX_BUF_SIZE);   /* 交给 DMA 一直收 */
}

/* 中断里调用：把 len 个字节逐个塞进环形缓冲 */
static void BSP_UART_Push(const uint8_t *data, uint16_t len)
{
    for (uint16_t i = 0; i < len; i++) {
        uint16_t next = (uint16_t)((s_head + 1U) & (UART_RING_SIZE - 1U));
        if (next != s_tail) {           /* 留一格空位判满，满了丢新字节 */
            s_ring[s_head] = data[i];
            s_head = next;
        }
    }
}

/* 中断服务函数里调用：IDLE → 算长度 → 搬走 → 重新挂 DMA */
void BSP_UART_IdleHandler(UART_HandleTypeDef *huart)
{
    if (__HAL_UART_GET_FLAG(huart, UART_FLAG_IDLE) == RESET) return;

    __HAL_UART_CLEAR_IDLEFLAG(huart);              /* F1 要读 SR 再读 DR 才清得掉 */
    HAL_UART_DMAStop(huart);                       /* 先停 DMA，计数器才冻结 */
    s_last_len = (uint16_t)(UART_RX_BUF_SIZE - __HAL_DMA_GET_COUNTER(huart->hdmarx));
    BSP_UART_Push(s_rx_buf, s_last_len);           /* 中断里只搬数据，不解析 */
    HAL_UART_Receive_DMA(huart, s_rx_buf, UART_RX_BUF_SIZE);  /* 重新武装等下一包 */
}

/* 主循环里调用：取一个字节，没有数据返回 -1 */
int BSP_UART_GetByte(void)
{
    if (s_head == s_tail) return -1;               /* 空 */
    uint8_t b = s_ring[s_tail];
    s_tail = (uint16_t)((s_tail + 1U) & (UART_RING_SIZE - 1U));
    return (int)b;
}

/* 主循环里调用：攒够一整行（以 '\r' 或 '\n' 结尾）才返回长度，否则返回 0 */
uint16_t BSP_UART_GetLine(char *line, uint16_t max_len)
{
    static uint16_t n = 0;                         /* 当前行已写字符数 */
    int b;

    if (line == 0 || max_len < 2U) return 0;

    while ((b = BSP_UART_GetByte()) >= 0) {
        if (b == '\r' || b == '\n') {
            if (n == 0U) continue;                 /* 空行、连续换行都跳过 */
            uint16_t len = n;
            line[n] = '\0';
            n = 0;
            return len;
        }
        if (n < (uint16_t)(max_len - 1U)) {
            line[n++] = (char)b;                   /* 存不下就丢弃，绝不越界 */
        }
    }
    return 0;
}

uint16_t BSP_UART_RxLen(void) { return s_last_len; }
```

**文件：`Core/Src/stm32f1xx_it.c`**（CubeMX 已生成骨架，只把 USER CODE 段填进去）
```c
#include "main.h"
#include "usart.h"
#include "bsp_uart.h"

void USART1_IRQHandler(void)
{
  /* USER CODE BEGIN USART1_IRQn 0 */
  BSP_UART_IdleHandler(&huart1);      /* IDLE 判定、读长度、重挂 DMA 都在驱动里 */
  /* USER CODE END USART1_IRQn 0 */

  HAL_UART_IRQHandler(&huart1);       /* CubeMX 原有的一行，不能删 */

  /* USER CODE BEGIN USART1_IRQn 1 */
  /* USER CODE END USART1_IRQn 1 */
}
```

**文件：`Core/Src/main.c`**（最小骨架，可直接编译）
```c
#include "main.h"
#include "dma.h"
#include "gpio.h"
#include "usart.h"
#include "bsp_uart.h"
#include <stdio.h>

static void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_DMA_Init();            /* 必须在 MX_USART1_UART_Init 之前 */
  MX_USART1_UART_Init();    /* 115200-8-N-1，BRR = 39<<4|1 = 0x271 */

  /* USER CODE BEGIN 2 */
  BSP_UART_Init(&huart1);   /* 打开 IDLE 中断 + 启动 DMA 接收 */
  printf("STM32 ready\r\n");
  /* USER CODE END 2 */

  while (1)
  {
    char line[UART_LINE_SIZE];
    if (BSP_UART_GetLine(line, sizeof(line)) > 0) {
      printf("RX: %s\r\n", line);   /* 先回显；命令解析见第 7 节 */
    }
    HAL_Delay(1);
  }
}

static void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  /* HSE 8MHz × 9 = 72MHz；APB1 二分频 36MHz，APB2 不分频 72MHz */
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
- `UART_RX_BUF_SIZE - __HAL_DMA_GET_COUNTER(...)`：DMA 每搬一个字节计数器减 1，所以**剩余量**才是 `COUNTER`，`总数 − 剩余` 就是收到的字节数。写反了会得到一个 100 多的假长度，现象是打印一堆乱码或数组越界。
- 先 `HAL_UART_DMAStop` 再读计数：DMA 还在跑时计数随时变，读出来的长度可能差一两个字节。停掉后计数冻结，长度才准；读完立刻重新 `Receive_DMA`，否则下一包没人收。
- 必须 `__HAL_UART_CLEAR_IDLEFLAG`：F1 的清标志动作是"读 SR 再读 DR"，不清的话 IDLE 一直挂着，中断会连续触发，主循环饿死。
- 保留 `HAL_UART_IRQHandler(&huart1)`：它负责处理溢出/噪声等错误标志并更新 HAL 状态。删掉它，出错后 HAL 认为串口还在忙，之后 `Receive_DMA` 全部返回 `HAL_BUSY`。
:::

::: note 为什么不用 `HAL_UART_Receive_IT`
`HAL_UART_Receive_IT(&huart1, buf, 10)` 是**定长**的：收满 10 字节才回调一次。对 `"OK\r\n"`（4 字节）永远等不到；对 200 字节的长包又只给你前 10 个。想用中断做不定长，只能"每次收 1 字节、在回调里再挂一次"，115200 下每秒 11520 次中断，CPU 一半时间在进进出出。**IDLE + DMA 是同一件事的省力版本：搬运不花 CPU，只在包尾打断一次。**
:::

::: note 哪些代码"故意没写"
`MX_USART1_UART_Init()` 负责 BRR/字长/停止位；`HAL_UART_MspInit()`（在 `Core/Src/usart.c`）负责开 USART1 和 DMA 时钟、把 PA9/PA10 配成复用推挽、把 `hdma_usart1_rx` 绑到 `huart1.hdmarx`；`MX_DMA_Init()` 开 DMA1 时钟和 NVIC。**这些手写只会漏**：漏了 `MX_DMA_Init` 的典型现象是 `HAL_UART_Receive_DMA` 返回 `HAL_ERROR`、一个字节也收不到。

`SystemClock_Config()` 决定 PCLK2 = 72MHz，BRR 就是按这个频率算出来的。手动把主频改低、却没让 CubeMX 重新生成 BRR，现象就是第 2 节说的"全乱码"——**时钟和波特率是一对，改一个必须改另一个**。
:::

::: note 为什么"空闲中断"能判断一包结束
UART 协议里，一帧结束后线上是高电平。如果连续 **1 个字节的时间**都是高电平，硬件就判定"总线空闲"，置 IDLE 标志。

对手发的数据包，字节之间是连续的（间隔远小于 1 个字节时间），包与包之间才有明显间隔。所以 IDLE 几乎就是"一包结束"的信号。

代价：如果对方发得极慢（字节间隔超过 1 个字符时间），一包会被拆成好几段。多数上位机不会这样。
:::

### 4.2 环形缓冲区：中断里只搬数据，主循环慢慢处理

即使有了 IDLE，中断里也不该做解析（printf、字符串处理都太慢）。标准做法是**中断只往环形缓冲区塞字节，主循环从里面取**。这套逻辑已经完整写在上面 `Hardware/Src/bsp_uart.c` 里：中断走 `BSP_UART_Push`，主循环走 `BSP_UART_GetByte` / `BSP_UART_GetLine`。这里把指针语义钉死：

| 动作 | 谁做 | 指针怎么动 | 判据 |
| --- | --- | --- | --- |
| 塞一个字节 | 中断 | `head` 前进一格 | 满：`head+1 == tail`，丢弃新字节 |
| 取一个字节 | 主循环 | `tail` 前进一格 | 空：`head == tail`，返回 -1 |
| 前进一格 | — | `(p + 1) & (SIZE - 1)` | SIZE 必须是 2 的幂 |

`BSP_UART_Push` 和 `BSP_UART_GetByte` 从头到尾只做这一件事，所以中断里执行时间是常数（几个周期），不会因为数据多而变慢。

::: note 为什么用 `& (UART_RING_SIZE-1)`，不用 `%`
`UART_RING_SIZE = 256` 时 `x & 255` 和 `x % 256` 结果完全一样，但取模要除法（几十个周期），与运算只要 1 个周期。中断里每秒可能进上千次，这个差别值得较真。

前提是 `UART_RING_SIZE` 必须是 **2 的幂**；写成 200 就取不出正确的回绕位置，现象是**下标跑到 200 以后数组被写坏，程序随机死机**。改不了 2 的幂，就老老实实写 `% UART_RING_SIZE`。

没有关中断：这是"单生产者/单消费者"，中断只动 head、主循环只动 tail，`uint16_t` 写是一条指令、原子完成，所以不需要 `__disable_irq()`；一旦有两个中断都往里塞，就必须加临界区。
:::

::: warn 环形缓冲区的三个常见错误
1. **`head`/`tail` 不加 `volatile`**：编译器优化后主循环永远读到旧值，表现为"数据进来了但取不出来"。
2. **在中断里调用 `printf`**：`printf` 内部有锁、耗时长，会把中断拖到几十微秒，高波特率下直接丢字节。**中断里只做搬运**。
3. **在中断里也改 `tail`（或在主循环里也改 `head`）**：这就成了多生产者/多消费者，必须加临界区。本写法只允许"中断只动 head、主循环只动 tail"，两个 16 位写是原子的，所以**不用关中断**。
:::

---

## 5. printf 重定向：让板子会说话

`printf` 最终会调用底层的"写一个字符"函数。GCC（CubeIDE 用的编译器）里是 `_write`，Keil 里是 `fputc`。把它改成往串口发就行。

CubeIDE（GCC）版本，单独放一个文件，别塞进 main.c：

**文件：`Hardware/Src/retarget.c`**
```c
#include "usart.h"           /* huart1 在这里 extern 声明 */
#include <stdio.h>           /* printf/_write 的声明 */

/* GCC/newlib 的底层"写"接口：printf 组好一串字符后调它 */
int _write(int file, char *ptr, int len)
{
    (void)file;          /* 只有一个串口，用不到这个参数 */
    HAL_UART_Transmit(&huart1, (uint8_t *)ptr, (uint16_t)len, HAL_MAX_DELAY);
    return len;          /* 必须返回 len，返回 0/负数 printf 会认为写失败 */
}
```

::: note 为什么这里用阻塞发送，而不是 IT 或 DMA
`_write` 可能在主循环任意位置被调用，甚至一次 `printf` 里被调用多次。用 `HAL_UART_Transmit_IT` 时，前一次还没发完就又来一次，HAL 直接返回 `HAL_BUSY`，现象是**输出缺行、少几个字**；用 DMA 同样会冲突。而 `HAL_MAX_DELAY` 是"等到发完"，代价是这句卡住 CPU：115200 下打印 50 个字符约 4.3ms。调试输出这点延迟可以接受，**但绝对不能在中断里 printf**（那 4.3ms 会变成丢字节）。

另外 `printf("%f")` 默认不链接浮点格式化（省 Flash），现象是打印出空白或乱码；要么在链接选项加 `-u _printf_float`，要么自己拆整数和小数打印。
:::

Keil（ARMCC）版本——路径还是 `Hardware/Src/retarget.c`，但**只在 Keil 工程里用这一份**（把上面 GCC 版的内容整体换掉）：

**文件：`Hardware/Src/retarget.c`（Keil 工程专用，二选一）**
```c
#include "usart.h"
#include <stdio.h>

int fputc(int ch, FILE *f)
{
    (void)f;
    HAL_UART_Transmit(&huart1, (uint8_t *)&ch, 1, HAL_MAX_DELAY);
    return ch;
}
```

::: note 两个版本为什么只挑一个
GCC（CubeIDE）的 `printf` 最终走 `_write`；Keil 的 C 库走 `fputc`。在 CubeIDE 里写 `fputc` 永远不会被调用（现象：重定向了但串口没输出），在 Keil 里不勾 **Use MicroLIB** 时 `fputc` 也可能不生效。**按编译器二选一**，别两个都写——都写也能编译，但将来换工具链时容易搞不清哪个在起作用。
:::

然后 `printf("temp=%d\r\n", t);` 就能在串口助手里看到。

::: note 为什么要加 `\r\n` 而不是只加 `\n`
串口助手（以及很多终端）里，`\n` 只是"换行"，光标会回到**当前行的下一行**但不停在最左；`\r` 才是"回车"，把光标移到行首。

只发 `\n` 的现象是输出呈阶梯状往右偏。**养成 `\r\n` 的习惯**。

另外 `printf` 里的浮点数默认可能不链接浮点格式化库，输出 `%f` 会显示空白或乱码。要么在链接选项里加 `-u _printf_float`，要么自己把浮点拆成整数和小数打印——后者更省 Flash，工程里更常见。
:::

---

## 6. 算一算

::: exercise 练习 1：一位有多宽
115200-8-N-1，传一个字符要多久？每秒最多传多少字节？

::: answer
**一帧 10 位**：1 起始 + 8 数据 + 0 校验 + 1 停止。

一位时间：

$$1 / 115200 \approx 8.68\mu s$$

一帧时间：

$$10 \times 8.68\mu s = 86.8\mu s$$

每秒字符数：

$$115200 / 10 = 11520 \text{ 字节/秒} \approx 11.25\text{ KB/s}$$

所以发一句 50 个字符的调试信息，占用总线约 4.3ms。如果每 10ms 打印一次，总线占用率 43%——这就该考虑降频打印或改二进制协议了。
:::
:::

::: exercise 练习 2：波特率误差
某模块要求 9600，但你的板子 USART2 实际跑在 36MHz，你却按 72MHz 算了 BRR。会发生什么？

::: answer
按 72MHz 算出的 `USARTDIV = 468.75`，但实际时钟只有 36MHz：

$$\text{实际波特率} = \frac{36\,000\,000}{16 \times 468.75} = 4800$$

**实际跑成了 4800，只有目标的一半**，误差 50%，远超 2% 的容忍度。

现象：收到的**每一个字节都是错的**，串口助手显示一堆乱码或方块，偶尔因为位模式碰巧对上能认出一两个字符。

**排查方法**：拿示波器/逻辑分析仪量 TX 上一位的宽度。9600 应该是 104μs，如果量到 208μs，就是时钟或分频算错了一倍。**先用"一位多宽"验证，比盯着乱码猜快得多。**
:::
:::

---

## 7. 动手项目

::: project
**串口命令行小工具**

在 PA9(TX)/PA10(RX) 接 USB-TTL（注意 **TX 接模块 RX、RX 接模块 TX、GND 共地**），实现：

1. `printf` 重定向，上电打印 `"STM32 ready\r\n"`。
2. 用 IDLE + DMA 收不定长命令，支持：
   - `led on` / `led off` → 控制 PC13
   - `pwm 50` → 把 PA0 的占空比设为 50%
   - `status` → 回 `"led=1 pwm=50\r\n"`
3. 收到无法识别的命令回 `"ERR\r\n"`。

**验收标准**：

1. 用串口助手发 `led on`，板载 LED 亮；发 `led off`，灭。
2. 连续快速发 10 条命令，**不丢包、不粘包**（说明环形缓冲和 IDLE 处理正确）。
3. 发一条 200 字节的长命令，缓冲区不溢出、程序不死机。
4. 关掉串口助手再重开，板子仍能正常响应（说明没有卡在阻塞接收里）。

**加分**：加一个 `reboot` 命令，用 `NVIC_SystemReset()` 软复位。

**文件放置表**

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `bsp_uart.h` | `Hardware/Inc/` | 串口驱动接口：缓冲区尺寸、函数声明 |
| `main.h` | `Core/Inc/` | LED/PWM 引脚宏、`Error_Handler` 声明 |
| `app_cmd.h` | `App/Inc/` | 命令解析接口 |
| `bsp_uart.c` | `Hardware/Src/` | IDLE + DMA 接收、环形缓冲、取行 |
| `retarget.c` | `Hardware/Src/` | `printf` 重定向（`_write`） |
| `app_cmd.c` | `App/Src/` | 解析 `led/pwm/status/reboot` 并执行 |
| `main.c` | `Core/Src/` | 初始化调用、主循环 |
| `stm32f1xx_it.c` | `Core/Src/` | 只在 `USART1_IRQHandler` 里插一行（CubeMX 生成） |
| `usart.c/h`、`dma.c/h`、`tim.c/h`、`gpio.c/h` | `Core/Src`、`Core/Inc` | CubeMX 生成，不手写 |

下面全部文件按 头文件 → 驱动 .c → App .c → main.c 的顺序给出完整内容。

**文件：`Hardware/Inc/bsp_uart.h`**
```c
#ifndef __BSP_UART_H
#define __BSP_UART_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define UART_RX_BUF_SIZE   128U   /* DMA 落点：一包最多 128 字节 */
#define UART_RING_SIZE     256U   /* 环形缓冲，必须是 2 的幂 */
#define UART_LINE_SIZE     64U    /* 一条命令最长 63 字符 + 结尾 '\0' */

void     BSP_UART_Init(UART_HandleTypeDef *huart);
void     BSP_UART_IdleHandler(UART_HandleTypeDef *huart);
int      BSP_UART_GetByte(void);
uint16_t BSP_UART_GetLine(char *line, uint16_t max_len);
uint16_t BSP_UART_RxLen(void);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_UART_H */
```

**文件：`Core/Inc/main.h`**
```c
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

/* 板载 LED：PC13，低电平点亮 */
#define LED_PIN          GPIO_PIN_13
#define LED_GPIO_PORT    GPIOC

/* PWM 输出：PA0 = TIM2_CH1 */
#define PWM_PIN          GPIO_PIN_0
#define PWM_GPIO_PORT    GPIOA
#define PWM_PERIOD_CNT   1000U      /* ARR = 999，1 个计数 = 0.1% 占空比 */

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
```

**文件：`App/Inc/app_cmd.h`**
```c
#ifndef __APP_CMD_H
#define __APP_CMD_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_CmdInit(void);   /* 上电初始化：LED 灭、PWM 0%、启动 PWM 输出 */
void App_CmdPoll(void);   /* 主循环调用：取一行命令并执行 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_CMD_H */
```
**文件：`Hardware/Src/bsp_uart.c`**
```c
#include "bsp_uart.h"

static uint8_t  s_rx_buf[UART_RX_BUF_SIZE];         /* DMA 直接写入的落点 */
static uint8_t  s_ring[UART_RING_SIZE];             /* 环形缓冲：中断→主循环 */
static volatile uint16_t s_head = 0;                /* 写指针，只由中断改 */
static volatile uint16_t s_tail = 0;                /* 读指针，只由主循环改 */
static volatile uint16_t s_last_len = 0;            /* 上一包字节数 */

void BSP_UART_Init(UART_HandleTypeDef *huart)
{
    s_head = 0;
    s_tail = 0;
    __HAL_UART_ENABLE_IT(huart, UART_IT_IDLE);                 /* 打开空闲中断 */
    HAL_UART_Receive_DMA(huart, s_rx_buf, UART_RX_BUF_SIZE);   /* 交给 DMA 一直收 */
}

/* 中断里调用：把 len 个字节逐个塞进环形缓冲 */
static void BSP_UART_Push(const uint8_t *data, uint16_t len)
{
    for (uint16_t i = 0; i < len; i++) {
        uint16_t next = (uint16_t)((s_head + 1U) & (UART_RING_SIZE - 1U));
        if (next != s_tail) {           /* 留一格空位判满，满了丢新字节 */
            s_ring[s_head] = data[i];
            s_head = next;
        }
    }
}

/* 中断服务函数里调用：IDLE → 算长度 → 搬走 → 重新挂 DMA */
void BSP_UART_IdleHandler(UART_HandleTypeDef *huart)
{
    if (__HAL_UART_GET_FLAG(huart, UART_FLAG_IDLE) == RESET) return;

    __HAL_UART_CLEAR_IDLEFLAG(huart);              /* F1 要读 SR 再读 DR 才清得掉 */
    HAL_UART_DMAStop(huart);                       /* 先停 DMA，计数器才冻结 */
    s_last_len = (uint16_t)(UART_RX_BUF_SIZE - __HAL_DMA_GET_COUNTER(huart->hdmarx));
    BSP_UART_Push(s_rx_buf, s_last_len);           /* 中断里只搬数据，不解析 */
    HAL_UART_Receive_DMA(huart, s_rx_buf, UART_RX_BUF_SIZE);  /* 重新武装等下一包 */
}

/* 主循环里调用：取一个字节，没有数据返回 -1 */
int BSP_UART_GetByte(void)
{
    if (s_head == s_tail) return -1;               /* 空 */
    uint8_t b = s_ring[s_tail];
    s_tail = (uint16_t)((s_tail + 1U) & (UART_RING_SIZE - 1U));
    return (int)b;
}

/* 主循环里调用：攒够一整行（以 '\r' 或 '\n' 结尾）才返回长度，否则返回 0 */
uint16_t BSP_UART_GetLine(char *line, uint16_t max_len)
{
    static uint16_t n = 0;                         /* 当前行已写字符数 */
    int b;

    if (line == 0 || max_len < 2U) return 0;

    while ((b = BSP_UART_GetByte()) >= 0) {
        if (b == '\r' || b == '\n') {
            if (n == 0U) continue;                 /* 空行、连续换行都跳过 */
            uint16_t len = n;
            line[n] = '\0';
            n = 0;
            return len;
        }
        if (n < (uint16_t)(max_len - 1U)) {
            line[n++] = (char)b;                   /* 存不下就丢弃，绝不越界 */
        }
    }
    return 0;
}

uint16_t BSP_UART_RxLen(void) { return s_last_len; }
```

**文件：`Hardware/Src/retarget.c`**（GCC / CubeIDE；Keil 工程换成 `fputc` 版本）
```c
#include "usart.h"           /* huart1 在这里 extern 声明 */
#include <stdio.h>

int _write(int file, char *ptr, int len)
{
    (void)file;
    HAL_UART_Transmit(&huart1, (uint8_t *)ptr, (uint16_t)len, HAL_MAX_DELAY);
    return len;              /* 必须返回 len，否则 printf 认为写失败 */
}
```
**文件：`App/Src/app_cmd.c`**
```c
#include "app_cmd.h"
#include "bsp_uart.h"
#include "tim.h"
#include "main.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

static uint8_t s_led = 0;      /* 当前 LED 状态：1 亮 0 灭 */
static uint8_t s_pwm = 0;      /* 当前占空比 0~100 */

static void App_LedSet(uint8_t on)
{
    s_led = on;
    /* PC13 低电平点亮：亮给 RESET，灭给 SET */
    HAL_GPIO_WritePin(LED_GPIO_PORT, LED_PIN, on ? GPIO_PIN_RESET : GPIO_PIN_SET);
}

static void App_PwmSet(uint8_t duty)
{
    s_pwm = duty;
    /* TIM2：PSC=71、ARR=999 → 72MHz/72/1000 = 1kHz；
       CCR = 占空比 × 10（1000 个计数里占 10 个 = 1%） */
    __HAL_TIM_SET_COMPARE(&htim2, TIM_CHANNEL_1, (uint32_t)duty * 10U);
}

void App_CmdInit(void)
{
    App_LedSet(0);
    App_PwmSet(0);
    HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1);   /* PA0 开始输出 PWM */
}

void App_CmdPoll(void)
{
    char line[UART_LINE_SIZE];
    uint16_t len = BSP_UART_GetLine(line, sizeof(line));
    if (len == 0) return;                       /* 还没有完整的一行 */

    if (strcmp(line, "led on") == 0) {
        App_LedSet(1);
        printf("led=1\r\n");
    } else if (strcmp(line, "led off") == 0) {
        App_LedSet(0);
        printf("led=0\r\n");
    } else if (strncmp(line, "pwm ", 4) == 0) {
        int d = atoi(&line[4]);                 /* "pwm 50" → 50 */
        if (d < 0)   d = 0;
        if (d > 100) d = 100;
        App_PwmSet((uint8_t)d);
        printf("pwm=%d\r\n", d);
    } else if (strcmp(line, "status") == 0) {
        printf("led=%d pwm=%d\r\n", s_led, s_pwm);
    } else if (strcmp(line, "reboot") == 0) {
        printf("rebooting\r\n");
        HAL_Delay(20);                          /* 等最后几个字节发完 */
        NVIC_SystemReset();                     /* CMSIS 软复位 */
    } else {
        printf("ERR\r\n");                      /* 无法识别 */
    }
}
```
**文件：`Core/Src/main.c`**
```c
#include "main.h"
#include "dma.h"
#include "gpio.h"
#include "tim.h"
#include "usart.h"
#include "bsp_uart.h"
#include "app_cmd.h"
#include <stdio.h>

static void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_DMA_Init();              /* 必须先于 MX_USART1_UART_Init */
  MX_USART1_UART_Init();      /* 115200-8-N-1，BRR = (39<<4)|1 = 0x271 */
  MX_TIM2_Init();             /* PSC=71、ARR=999，PA0 复用推挽 */

  /* USER CODE BEGIN 2 */
  BSP_UART_Init(&huart1);     /* 打开 IDLE 中断 + 启动 DMA 接收 */
  App_CmdInit();              /* LED 初始化 + 启动 PWM */
  printf("STM32 ready\r\n");
  /* USER CODE END 2 */

  while (1)
  {
    App_CmdPoll();            /* 取一行 → 解析 → 执行，永不阻塞 */
    HAL_Delay(1);
  }
}

static void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  /* HSE 8MHz × 9 = 72MHz；APB1 = 36MHz（USART2），APB2 = 72MHz（USART1） */
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

**文件：`Core/Src/stm32f1xx_it.c`**（CubeMX 生成，只需这一处 USER CODE 改动）
```c
#include "main.h"
#include "usart.h"
#include "bsp_uart.h"

void USART1_IRQHandler(void)
{
  /* USER CODE BEGIN USART1_IRQn 0 */
  BSP_UART_IdleHandler(&huart1);
  /* USER CODE END USART1_IRQn 0 */

  HAL_UART_IRQHandler(&huart1);      /* CubeMX 原有的一行，不能删 */

  /* USER CODE BEGIN USART1_IRQn 1 */
  /* USER CODE END USART1_IRQn 1 */
}
```

::: note 这个项目里哪些代码是 CubeMX 生成的
- `MX_USART1_UART_Init()`（在 `usart.c`）：115200、8 位、无校验、1 停止位。BRR 由 CubeMX 按 PCLK2 = 72MHz 算成 `0x271`（`USARTDIV = 72M/(16×115200) = 39.0625`）。
- `HAL_UART_MspInit()`（在 `usart.c`）：开 USART1 和 DMA1 时钟、PA9/PA10 配复用推挽、`hdma_usart1_rx` 绑到 `huart1.hdmarx`。
- `MX_DMA_Init()`（在 `dma.c`）：开 DMA1 时钟、配 NVIC。**漏掉它的现象是 `HAL_UART_Receive_DMA` 返回 `HAL_ERROR`，一个字节都收不到。**
- `MX_TIM2_Init()`（在 `tim.c`）：TIM2 CH1 PWM，PSC = 71、ARR = 999 → 1kHz；PA0 复用推挽。
- `SystemClock_Config()` 放在 `main.c` 里（CubeMX 也生成它），决定 PCLK1 = 36MHz、PCLK2 = 72MHz。**改了主频就必须重新生成 BRR**，否则就是第 2 节说的"全乱码"。
:::

::: note 为什么这样拆文件
- `bsp_uart.c` 只管"字节怎么进来、怎么排成一行"，不关心命令含义；`app_cmd.c` 只管"这一行是什么意思、要做什么"。所以换协议只改 App，换串口只改 Hardware。
- `main.c` 里没有环形缓冲、没有中断逻辑、没有 `printf` 重定向，只剩初始化和一个 `while(1)`——出了问题是先去 App 找解析、再去 Hardware 找驱动，责任边界清楚。
- `stm32f1xx_it.c` 只留一行调用：CubeMX 重新生成工程时，USER CODE 段不会被覆盖，业务逻辑也不会丢。
:::
:::

---

## 8. 本课小结

- 一帧 = 起始位(0) + 8 位数据（**低位在前**）+ 可选校验 + 停止位(1)；空闲为高。
- `USARTDIV = fPCLK / (16 × baud)`；USART1 是 72MHz，USART2/3 是 36MHz，**别搞混**。
- BRR = 整数部分 << 4 | 小数×16；反算误差要 **< 2%**。
- 115200 时一位 8.68μs，一帧 86.8μs，约 11.5KB/s。
- 收数据**不能用轮询**；`HAL_UART_Receive_IT` 是**定长**的，不定长要用 **IDLE + DMA**。
- 中断里只搬字节进**环形缓冲区**，解析放主循环；指针要 `volatile`。
- `printf` 重定向：GCC 实现 `_write`，Keil 实现 `fputc`；换行用 `\r\n`。
- 乱码先查波特率，再查 TX/RX 交叉，再查共地。

::: selfcheck 自检
- [ ] 我能画出一帧 8-N-1 的波形并标出每一位
- [ ] 我能手算 115200 的 BRR 并验证误差
- [ ] 我知道 USART1 和 USART2 的时钟为什么不同
- [ ] 我能说出 HAL 定长接收的问题和 IDLE+DMA 的解法
- [ ] 我能写出环形缓冲区的 put/get 并说明为什么用 `& (SIZE-1)`
- [ ] 我知道 `printf` 重定向在 GCC 和 Keil 下分别改哪个函数
- [ ] 我能按顺序排查"串口全是乱码"
:::

---

## 9. 下一课预告

串口是**点对点**的：一根线，两个设备。接下来要讲的总线是**一主多从**的——一根线上挂好几个芯片，靠地址区分。

下一课 `s13 I2C 总线`：你会看到 s3 学的"开漏输出"在这里变成硬性要求，也会第一次接触"时序图"这种描述通信的通用语言。
