---
node: s20
title: 进阶：Bootloader 与 IAP 固件升级
type: practice
duration: 90
---

## 这一课要解决的问题

::: goal
读完你能：说清 Bootloader 和 App 在 Flash 里怎么分区；写出"关中断 → 设栈顶 → 设向量表 → 跳转"的跳转代码；让 App 在偏移地址上正常跑中断；用串口把新固件分包写进 Flash 并校验；知道跳转失败最常见的原因和救砖方法。
:::

一个装在现场的设备，固件有 bug 要修，你不可能每次都爬上去拆开、接 ST-Link。**IAP（In-Application Programming）** 就是让设备通过串口、CAN、4G 自己接收新固件并升级。

这一课把前面学的 **UART（s12）+ 内部 Flash（s16）** 组合成一个真正有用的功能。

---

## 1. 先分清三个概念

| 概念 | 含义 |
| --- | --- |
| **ICP** | In-Circuit Programming，用 SWD/JTAG 烧，就是你现在做的事 |
| **ISP** | In-System Programming，靠芯片自带的 Boot ROM，拉高 BOOT0 用串口下载 |
| **IAP** | In-Application Programming，**你自己的程序**去擦写 Flash、跳转 |

IAP 的核心是：**芯片里同时存在两段程序**。

- **Bootloader**：上电先跑它，负责"检查有没有新固件 / 决定跳不跳 App"。
- **App**：真正的业务程序，平时运行的是它。

---

## 2. Flash 分区：先画地图再动手

以 F103C8T6（64KB Flash）为例：

| 区域 | 起始地址 | 大小 | 内容 |
| --- | --- | --- | --- |
| **Bootloader** | `0x08000000` | 12KB | 上电先运行，负责升级和跳转 |
| **App** | `0x08003000` | 50KB | 业务程序（0x08003000 ~ 0x0800F7FF） |
| **升级请求页** | `0x0800F800` | 1KB | App 写入 magic，请求下次上电进升级模式 |
| **状态页** | `0x0800FC00` | 1KB | App 有效标志、版本号、长度、CRC |

<svg class="diagram" viewBox="0 0 860 260" xmlns="http://www.w3.org/2000/svg">
  <rect x="80" y="40" width="700" height="50" fill="none" stroke="#c0392b" stroke-width="2"/>
  <text class="sub" x="330" y="70" font-size="11">Bootloader（12KB，0x08000000）</text>

  <rect x="80" y="100" width="700" height="90" fill="none" stroke="#2c6fbb" stroke-width="2"/>
  <text class="sub" x="340" y="140" font-size="11">App（50KB，0x08003000）</text>
  <text class="sub" x="316" y="165" font-size="9.5">复位向量在 0x08003004，必须让 VTOR 指过来</text>

  <rect x="80" y="200" width="700" height="40" fill="none" stroke="#2c6fbb" stroke-width="2"/>
  <text class="sub" x="330" y="226" font-size="10.5">升级请求 0x0800F800 / 状态 0x0800FC00</text>

  <text class="sub" x="18" y="70" font-size="9.5">低地址</text>
  <text class="sub" x="18" y="226" font-size="9.5">高地址</text>
</svg>

::: warn 分区是"一次定死"的，改起来很麻烦
Bootloader 的大小决定了 App 的起始地址，而 App 的起始地址写死在**链接脚本**、**VTOR** 和**跳转代码**里。

如果 Bootloader 一开始只留了 8KB，后来功能加多了超过 8KB，就会**覆盖 App 的开头**——现象是"升级完 App 就起不来"，因为 App 的向量表被 Bootloader 的代码盖掉了。

**经验：Bootloader 预留空间按"预计大小 × 2"给**。串口 IAP 的 Bootloader 通常 8~16KB，留 12KB 是稳妥的。
:::

---

## 3. 跳转：四件事，顺序不能错

从 Bootloader 跳到 App，本质是**手动模拟一次复位**。但复位是硬件做的，现在要软件做，所以四件事必须自己来。代码放在 Bootloader 工程的 `App/boot_jump.c`：

**文件：`IAP_Bootloader/App/Inc/boot_jump.h`**

```c
#ifndef __BOOT_JUMP_H
#define __BOOT_JUMP_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define APP_ADDR   0x08003000U   /* 与 App 工程链接脚本 ORIGIN 一致 */

void JumpToApp(uint32_t app_addr);   /* 成功则永不返回 */

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_JUMP_H */
```

**文件：`IAP_Bootloader/App/Src/boot_jump.c`**

```c
#include "boot_jump.h"

typedef void (*pFunction)(void);      /* 无参无返回，用来接复位向量 */

void JumpToApp(uint32_t app_addr)
{
    uint32_t sp = *(volatile uint32_t *)app_addr;         /* 第 1 个字：栈顶 */
    uint32_t pc = *(volatile uint32_t *)(app_addr + 4U);  /* 第 2 个字：复位向量 */

    /* 0. 检查栈顶是否落在 SRAM 范围（0x20000000 ~ 0x20005000，20KB） */
    if ((sp & 0x2FFE0000U) != 0x20000000U) {
        return;                       /* App 区是空的（0xFFFFFFFF）或没烧好，别跳 */
    }

    /* 1. 关中断，清掉 Bootloader 留下的所有中断状态 */
    __disable_irq();
    HAL_RCC_DeInit();                 /* 时钟退回 HSI，外设时钟全关 */
    HAL_DeInit();                     /* HAL 反初始化钩子，外设由 App 重新配 */
    SysTick->CTRL = 0;                /* 保险起见再手工停一次 */
    SysTick->LOAD = 0;
    SysTick->VAL  = 0;
    for (int i = 0; i < 8; i++) {     /* Cortex-M3 最多 240 个中断，8 个寄存器够覆盖 */
        NVIC->ICER[i] = 0xFFFFFFFFU;  /* 关掉所有 NVIC 中断 */
        NVIC->ICPR[i] = 0xFFFFFFFFU;  /* 清所有挂起 */
    }

    /* 2. 把中断向量表指到 App 的位置 */
    SCB->VTOR = app_addr;

    /* 3. 设置主栈指针 */
    __set_MSP(sp);

    /* 4. 跳到 App 的复位向量（之后不能再调用普通函数，栈已经换了） */
    __enable_irq();
    ((pFunction)pc)();
}
```

调用点：Bootloader 的 `Boot_Main()` 里判断完标志、校验完 App 后调 `JumpToApp(APP_ADDR)`，这一句之后不会返回。

**为什么关得这么彻底**：`__disable_irq()` 只关 CPU 的中断总开关，NVIC 里已挂起的标志还在；一旦 App 里 `__enable_irq()`，那些旧标志会立刻触发，而向量表已经换成 App 的，处理函数对不上就进 `Default_Handler`。所以还要 `HAL_RCC_DeInit()`（时钟退回 HSI，App 自己会重新配 72MHz，不能让 Bootloader 的 PLL 状态带过去）、`HAL_DeInit()`（HAL 留的空钩子，调它表示"Bootloader 这一层到此结束"，实际外设由 App 的 `MX_xxx_Init()` 重配）、清 `ICER/ICPR`。**为什么用函数指针跳而不用 `goto`/软复位**：软复位会从 0x08000000 重新执行，又回 Bootloader 了；`goto` 跨函数不合法。**哪些没写**：`__set_MSP`、`__disable_irq` 是 CMSIS intrinsic（`cmsis_gcc.h`），不用额外头文件；App 的向量表内容由 App 工程的启动文件 `startup_stm32f103xb.s` 生成，栈顶值写在链接脚本的 `_estack`；`SCB`、`NVIC` 结构体定义在 `core_cm3.h` 里。

::: note 为什么顺序是"关中断 → 设 VTOR → 设 MSP → 跳"
- **先关中断**：Bootloader 可能开了串口中断、定时器中断。跳过去之后 App 还没来得及初始化自己的中断，旧中断一触发，向量表还指着 Bootloader，就会跳到不存在的处理函数。
- **VTOR 要在跳转前设**：App 的向量表在 `0x08003000`，硬件默认从 `0x08000000` 取向量。不设 VTOR，App 里任何一个中断都会跳到 Bootloader 的向量表，**跑飞或死循环**。
- **MSP 最后设**：设完 MSP，当前 C 函数的栈就换成了 App 的栈，Bootloader 栈上的局部变量全部失效，**不能再调用普通函数**。所以 `__enable_irq()` 必须是内联的 intrinsic（`CPSIE i`，不依赖栈），跳转也必须用函数指针直接跳，不能经过一层普通函数调用。

**这四步是面试原题**，顺序错一步就起不来。
:::

### 3.1 App 侧必须改的两处

App 不再是"从 0x08000000 开始"，所以工程根目录、链接地址、向量表偏移要一起改。两个工程的结构：

```
IAP_Bootloader/              IAP_App/
├── Core/                    ├── Core/
│   ├── Inc/main.h           │   ├── Inc/main.h
│   └── Src/main.c           │   └── Src/main.c      ← 这里设 VTOR
│       stm32f1xx_it.c       │       stm32f1xx_it.c
├── App/                     ├── App/
│   ├── Inc/                 │   ├── Inc/app_upgrade.h
│   └── Src/boot_main.c      │   └── Src/app_upgrade.c
│       boot_jump.c          ├── Drivers/            ← CubeMX 生成
│       boot_iap.c           └── STM32F103C8TX_FLASH.ld  ← 改 ORIGIN/LENGTH
│       boot_verify.c
├── Hardware/
│   ├── Inc/bsp_param.h bsp_uart.h
│   └── Src/bsp_param.c bsp_uart.c
└── Drivers/
```

1. **链接脚本改起始地址和长度**。CubeIDE 的 `.ld` 文件：

**文件：`IAP_App/STM32F103C8TX_FLASH.ld`**

```ld
/* 链接脚本：App 工程专用。ORIGIN/LENGTH 必须和 Bootloader 的 APP_ADDR 完全一致 */
ENTRY(Reset_Handler)

_estack = ORIGIN(RAM) + LENGTH(RAM);

_Min_Heap_Size  = 0x200;   /* 512B，够 HAL 少量动态使用 */
_Min_Stack_Size = 0x400;   /* 1KB */

MEMORY
{
  RAM   (xrw) : ORIGIN = 0x20000000, LENGTH = 20K
  FLASH (rx)  : ORIGIN = 0x08003000, LENGTH = 50K
}

SECTIONS
{
  .isr_vector :
  {
    . = ALIGN(4);
    KEEP(*(.isr_vector))
    . = ALIGN(4);
  } >FLASH

  .text :
  {
    . = ALIGN(4);
    *(.text)
    *(.text*)
    *(.glue_7)
    *(.glue_7t)
    *(.eh_frame)
    KEEP(*(.init))
    KEEP(*(.fini))
    . = ALIGN(4);
    _etext = .;
  } >FLASH

  .rodata :
  {
    . = ALIGN(4);
    *(.rodata)
    *(.rodata*)
    . = ALIGN(4);
  } >FLASH

  .ARM.extab : { *(.ARM.extab* .gnu.linkonce.armextab.*) } >FLASH
  .ARM : {
    __exidx_start = .;
    *(.ARM.exidx*)
    __exidx_end = .;
  } >FLASH

  .preinit_array :
  {
    PROVIDE_HIDDEN(__preinit_array_start = .);
    KEEP(*(.preinit_array*))
    PROVIDE_HIDDEN(__preinit_array_end = .);
  } >FLASH

  .init_array :
  {
    PROVIDE_HIDDEN(__init_array_start = .);
    KEEP(*(SORT(.init_array.*)))
    KEEP(*(.init_array*))
    PROVIDE_HIDDEN(__init_array_end = .);
  } >FLASH

  .fini_array :
  {
    PROVIDE_HIDDEN(__fini_array_start = .);
    KEEP(*(SORT(.fini_array.*)))
    KEEP(*(.fini_array*))
    PROVIDE_HIDDEN(__fini_array_end = .);
  } >FLASH

  _sidata = LOADADDR(.data);

  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data)
    *(.data*)
    . = ALIGN(4);
    _edata = .;
  } >RAM AT> FLASH

  . = ALIGN(4);
  .bss :
  {
    _sbss = .;
    __bss_start__ = _sbss;
    *(.bss)
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
    __bss_end__ = _ebss;
  } >RAM

  ._user_heap_stack :
  {
    . = ALIGN(8);
    PROVIDE(end = .);
    PROVIDE(_end = .);
    . = . + _Min_Heap_Size;
    . = . + _Min_Stack_Size;
    . = ALIGN(8);
  } >RAM
}
```

2. **向量表偏移**。有两种等价写法，只能选一种：

- 改 `IAP_App/Core/Src/system_stm32f1xx.c` 顶部的 `#define VECT_TAB_OFFSET 0x0U` 为 `0x3000U`。这个文件是 CubeMX 生成的，`SystemInit()` 里执行 `SCB->VTOR = FLASH_BASE | VECT_TAB_OFFSET`。
- 或者不改库文件，在 App 的 `main()` 第一行手动 `SCB->VTOR = 0x08003000U;`（本课用这种，代码可见性更好）。

**为什么是 0x3000**：`FLASH_BASE` 固定 0x08000000，偏移就是 App 相对 Bootloader 的位置，12KB = 0x3000。**为什么不用别的**：不能只改链接脚本不改 VTOR（现象见下面警告）；也不能改启动文件里向量表的位置——那张表永远在 App 自己的开头，只是 CPU 不知道去哪找。**哪些没写**：`SystemInit()` 由启动文件在 `main` 之前调用，属于 CMSIS/ST 模板；`0x3000` 同时对应链接脚本的 `ORIGIN` 和 `VECT_TAB_OFFSET`，三处必须一起改。

App 的 `main.c` 完整内容（含 VTOR、时钟、升级命令轮询）：

**文件：`IAP_App/Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "usart.h"
#include "app_upgrade.h"
#include <string.h>

#define APP_VECT_TAB   0x08003000U   /* 必须与链接脚本 ORIGIN 一致 */

void SystemClock_Config(void);

static void Log(const char *s)
{
  HAL_UART_Transmit(&huart1, (uint8_t *)s, (uint16_t)strlen(s), 100U);
}

int main(void)
{
  SCB->VTOR = APP_VECT_TAB;      /* 第一行就设，晚于任何中断都会出错 */

  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART1_UART_Init();

  Log("app v1.0 running\r\n");
  Log("send 'upgrade' to request update\r\n");

  App_UpgradeInit();

  while (1)
  {
    App_UpgradeTick();           /* 轮询串口，收到 upgrade 就写请求页并复位 */
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

::: warn 只改链接脚本、不改 VTOR 的现象
App 能跑起来，`main` 里的代码都正常，**但一开中断就死**。

具体表现：
- 串口发送（轮询方式）正常，一开接收中断就进 HardFault；
- `HAL_Delay` 卡死（SysTick 中断跳错地方）；
- 定时器中断不响应。

因为中断向量还指向 `0x08000000`，那里是 Bootloader 的向量表，App 的处理函数地址根本不在里面。

**判断方法**：在 App 的 `SysTick_Handler` 里打断点，如果永远不进，就是 VTOR 没设。
:::

---

## 4. 升级流程：一次完整的 IAP

以"串口接收新固件"为例，最朴素的单区方案：

```
上电 → Bootloader
        ├─ 读请求页：有"升级请求"吗？
        │    ├─ 有 → 进入升级模式：等串口数据 → 分包写 App 区 → 校验 → 写有效标志 → 清请求 → 重启
        │    └─ 无 → 检查 App 是否有效 → 跳转
        └─ App 运行中收到 upgrade 命令 → 写请求页 → 软复位
```

### 4.1 分包协议（自己定一个简单的）

| 字段 | 长度 | 说明 |
| --- | --- | --- |
| 帧头 | 2 | `0xAA 0x55` |
| 序号 | 2 | 从 0 开始，用于去重/排序；`0xFFFF` 表示结束帧 |
| 长度 | 2 | 本包数据字节数（如 512）；结束帧为 4 |
| 数据 | N | 固件内容；结束帧是整包 CRC32 的 4 字节小端 |
| CRC16 | 2 | 覆盖序号+长度+数据 |

每包 512 字节，正好是**半页**（页 1KB），擦除时两包一页。每收一包回一个字节：`0x06` 表示 ACK，`0x15` 表示 NAK。

### 4.2 Bootloader 收包的骨架

收包、擦页、按半字写，全部封装在 `boot_iap.c`，外面只看得到"开始 / 收完 / 已写入多少"。

**文件：`IAP_Bootloader/App/Inc/boot_iap.h`**

```c
#ifndef __BOOT_IAP_H
#define __BOOT_IAP_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void     IAP_Begin(void);                                   /* 复位写指针 */
uint8_t  IAP_ReceiveAll(uint32_t *fw_size, uint32_t *fw_crc);/* 1 = 收到结束帧 */
uint32_t IAP_GetWrittenSize(void);

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_IAP_H */
```

**文件：`IAP_Bootloader/App/Src/boot_iap.c`**

```c
#include "boot_iap.h"
#include "boot_jump.h"
#include "bsp_uart.h"

#define PAGE_SIZE       1024U      /* F103C8T6 页大小 1KB */
#define PKT_DATA_MAX    512U       /* 一包 512 字节，正好半页 */
#define APP_END_ADDR    0x0800F800U/* App 区上界（升级请求页起始） */

static uint32_t s_write_addr = APP_ADDR;   /* 下一条要写的 Flash 地址 */
static uint32_t s_written;                /* 已写入的固件字节数 */

static uint16_t Crc16Update(uint16_t crc, const uint8_t *p, uint32_t len)
{
    while (len--) {
        crc ^= (uint16_t)(*p++) << 8;
        for (uint8_t i = 0; i < 8U; i++) {
            crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
                                  : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

static uint8_t ReadExact(uint8_t *buf, uint16_t len, uint32_t timeout_ms)
{
    for (uint16_t i = 0; i < len; i++) {
        if (BSP_UartGetByte(&buf[i], timeout_ms) == 0U) {
            return 0;
        }
    }
    return 1;
}

static uint8_t ErasePage(uint32_t addr)
{
    FLASH_EraseInitTypeDef er = {0};
    uint32_t page_err = 0;

    er.TypeErase   = FLASH_TYPEERASE_PAGES;
    er.PageAddress = addr;             /* 必须页首（0x400 对齐） */
    er.NbPages     = 1;

    HAL_FLASH_Unlock();
    if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
        HAL_FLASH_Lock();
        return 0;
    }
    HAL_FLASH_Lock();
    return 1;
}

static uint8_t WritePacketData(uint32_t addr, const uint8_t *data, uint16_t len)
{
    HAL_FLASH_Unlock();
    for (uint16_t i = 0; i < len; i += 2U) {
        uint16_t half = data[i];
        half |= (i + 1U < len) ? (uint16_t)(data[i + 1U] << 8) : 0xFF00U;
        if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD,
                              addr + i, half) != HAL_OK) {
            HAL_FLASH_Lock();
            return 0;
        }
    }
    HAL_FLASH_Lock();
    return 1;
}

static uint8_t IAP_WritePacket(uint16_t seq, const uint8_t *data, uint16_t len)
{
    (void)seq;                         /* 单区方案不用序号；A/B 双区或去重时才用 */

    if ((s_write_addr + len) > APP_END_ADDR) {
        return 0;                      /* 防止写穿到升级请求页/状态页 */
    }

    /* 新的一页开始前，先擦；每页只擦一次 */
    if ((s_write_addr % PAGE_SIZE) == 0U) {
        if (ErasePage(s_write_addr) == 0U) {
            return 0;
        }
    }

    if (WritePacketData(s_write_addr, data, len) == 0U) {
        return 0;
    }

    s_write_addr += (uint32_t)((len + 1U) & ~1U);   /* 半字对齐 */
    s_written    += len;
    return 1;
}

void IAP_Begin(void)
{
    s_write_addr = APP_ADDR;
    s_written    = 0;
}

uint32_t IAP_GetWrittenSize(void)
{
    return s_written;
}

uint8_t IAP_ReceiveAll(uint32_t *fw_size, uint32_t *fw_crc)
{
    uint8_t  hdr[2];
    uint8_t  seqb[2];
    uint8_t  lenb[2];
    uint8_t  data[PKT_DATA_MAX];
    uint8_t  crcb[2];

    for (;;) {
        /* 1. 找帧头，允许上位机从任意位置开始 */
        if (ReadExact(hdr, 2, 5000U) == 0U || hdr[0] != 0xAA || hdr[1] != 0x55) {
            BSP_UartSendByte(0x15);    /* NAK，让上位机重发 */
            continue;
        }

        if (ReadExact(seqb, 2, 1000U) == 0U ||
            ReadExact(lenb, 2, 1000U) == 0U) {
            return 0;
        }

        uint16_t seq = (uint16_t)(seqb[0] | ((uint16_t)seqb[1] << 8));
        uint16_t len = (uint16_t)(lenb[0] | ((uint16_t)lenb[1] << 8));

        if (len > PKT_DATA_MAX) {
            return 0;
        }
        if (len > 0U && ReadExact(data, len, 2000U) == 0U) {
            return 0;
        }
        if (ReadExact(crcb, 2, 1000U) == 0U) {
            return 0;
        }

        uint16_t crc = (uint16_t)(crcb[0] | ((uint16_t)crcb[1] << 8));
        uint16_t calc = 0xFFFFU;
        calc = Crc16Update(calc, seqb, 2);
        calc = Crc16Update(calc, lenb, 2);
        calc = Crc16Update(calc, data, len);

        if (calc != crc) {
            BSP_UartSendByte(0x15);    /* 本包 CRC 错，NAK 等重传 */
            continue;
        }

        /* 2. 结束帧：序号 0xFFFF，长度 4，数据是整包 CRC32 */
        if (seq == 0xFFFFU && len == 4U) {
            *fw_crc = (uint32_t)data[0] | ((uint32_t)data[1] << 8) |
                      ((uint32_t)data[2] << 16) | ((uint32_t)data[3] << 24);
            *fw_size = s_written;
            BSP_UartSendByte(0x06);
            return 1;
        }

        /* 3. 普通数据包 */
        if (IAP_WritePacket(seq, data, len) == 0U) {
            BSP_UartSendByte(0x15);
            return 0;
        }
        BSP_UartSendByte(0x06);       /* ACK，可以发下一包 */
    }
}
```

`HAL_FLASH_Lock()` 在每次写/擦后都要调，所以这里分了独立的解锁窗口；不要在擦除后不解锁直接编程。

**为什么先判 `addr % PAGE_SIZE == 0`**：Flash 只能 1→0，新页不擦就写会得到"旧值 & 新值"的乱码；判断放在写之前，每页只擦一次。**为什么不用别的**：不用"先把整个 App 区擦完再收"——那样中途断电就全丢，而且 50 页擦完要等一两秒；也不用"按字节写"——RM0008 写明 F1 的 FPEC 一次编程一个半字（16 位），根本没有字节编程模式。**哪些没写**：`FLASH` 的等待周期、擦写时序由 HAL 按 72MHz 处理；`HAL_FLASHEx_Erase` 的页地址必须是页首（0x400 对齐），本代码靠 `s_write_addr` 从页首起步、每包 512 字节来保证；重传同包的重复写问题见下面警告。

::: warn 写入前必须确认"这一页是空的"
Flash 只能 1→0。如果 `s_write_addr` 指向的页**没擦过**，写进去的是"旧数据 & 新数据"，读出来是乱码。

上面的代码靠 `(addr % PAGE_SIZE) == 0` 来判断"该擦页了"。但如果**重传**同一包（串口丢包重发），地址又回到页中间，就不会擦——第二次写入会把第一次的数据按位与，变成垃圾。

**稳妥做法**：
1. 每页开始擦之前，先整页读一遍，确认是全 `0xFF`；不是就擦。
2. 或者协议里加"页号"，Bootloader 按页号管理，同一页只擦一次。
3. 最稳的是**双区（A/B）**：新固件写到备份区，校验通过再整体切换，写坏了还能回滚。

本课的串口是全双工 + 每包 ACK，正常不会重传；做产品必须把上面任一条加上。
:::

### 4.3 校验：不做校验等于赌博

**文件：`IAP_Bootloader/App/Inc/boot_verify.h`**

```c
#ifndef __BOOT_VERIFY_H
#define __BOOT_VERIFY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

uint8_t Boot_VerifyAndFinish(uint32_t fw_size, uint32_t expected_crc);
void    Boot_MarkInvalid(void);

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_VERIFY_H */
```

**文件：`IAP_Bootloader/App/Src/boot_verify.c`**

```c
#include "boot_verify.h"
#include "boot_jump.h"
#include "bsp_param.h"

/* CRC32，反射多项式 0xEDB88320（即 0x04C11DB7 的位反转）；上位机必须用同一套 */
static uint32_t Crc32(const uint8_t *p, uint32_t len)
{
    uint32_t crc = 0xFFFFFFFFU;
    while (len--) {
        crc ^= *p++;
        for (uint8_t i = 0; i < 8U; i++) {
            crc = (crc & 1U) ? ((crc >> 1) ^ 0xEDB88320U) : (crc >> 1);
        }
    }
    return ~crc;
}

uint8_t Boot_VerifyAndFinish(uint32_t fw_size, uint32_t expected_crc)
{
    BootParam_t p;
    uint32_t sp, pc, crc;

    /* 1. 长度必须落在 App 区，且至少放得下向量表 */
    if (fw_size < 8U || fw_size > (0x0800F800U - APP_ADDR)) {
        return 0;
    }

    /* 2. 向量表体检：栈顶在 SRAM，复位向量在 App 区 */
    sp = *(volatile uint32_t *)APP_ADDR;
    pc = *(volatile uint32_t *)(APP_ADDR + 4U);
    if ((sp & 0x2FFE0000U) != 0x20000000U) {
        return 0;
    }
    if (pc < APP_ADDR || pc >= 0x0800F800U) {
        return 0;
    }

    /* 3. 整区 CRC32，必须和上位机给的一致 */
    crc = Crc32((const uint8_t *)APP_ADDR, fw_size);
    if (crc != expected_crc) {
        return 0;   /* 校验失败：不写"有效"标志，留在 Bootloader 等重传 */
    }

    /* 4. 写有效标志、长度、CRC、版本号，清升级请求 */
    BSP_ParamLoad(&p);
    if (p.magic != BOOT_PARAM_MAGIC) {
        p.magic       = BOOT_PARAM_MAGIC;
        p.app_version = 0;
    }
    p.app_valid = 1U;
    p.app_size  = fw_size;
    p.app_crc   = crc;
    p.app_version++;
    BSP_ParamSave(&p);

    BSP_ReqClear();
    return 1;
}

void Boot_MarkInvalid(void)
{
    BootParam_t p;
    BSP_ParamLoad(&p);
    if (p.magic != BOOT_PARAM_MAGIC) {
        p.magic = BOOT_PARAM_MAGIC;
    }
    p.app_valid = 0U;
    BSP_ParamSave(&p);
}
```

校验通过后由 `Boot_Main()` 调 `JumpToApp(APP_ADDR)`；也可以在这里直接 `NVIC_SystemReset()` 再走一遍正常上电流程，两者等价。

**为什么必须整区 CRC 而不是逐包校验**：逐包 CRC 只能保证"这一包在线上没错"，保证不了"包与包之间的顺序、有没有漏包、Flash 有没有写错"。整区算一遍，才覆盖"App 区最终内容"。**为什么不用别的**：只检查向量表前 8 字节太弱——写一半的 App 向量表往往正好完整（下面 note 解释）；用简单累加和则检不出字节换位。**哪些没写**：`BootParam_t` 和 `BSP_ParamSave()` 在 `Hardware/bsp_param.c`（第 7 节完整给出）；`0x0800F800` 是 App 区上界，也是升级请求页起点。

::: note 为什么升级必须"先校验再跳转"
串口会丢字节、Flash 会写错、传输可能中途断电。没有校验，你跳进一个**只写了一半的 App**：

- 向量表可能完整（前 8 字节），跳转"成功"；
- 但后面的代码是 `0xFF`（擦除态），CPU 执行 `0xFFFFFFFF` 会触发 HardFault；
- 现象是"升级完就变砖"，而且**每次上电都砖**，因为 Bootloader 还在傻乎乎地跳过去。

所以 Bootloader 必须：
1. 校验 App 区（CRC 或至少检查向量表 + 长度）；
2. 校验失败就**留在 Bootloader**，等上位机重传；
3. 状态页存"App 有效标志"，跳转前检查。
:::

---

## 5. 算一算

::: exercise 练习 1：分区地址
Bootloader 占 12KB，App 从 0x08003000 开始，升级请求页和参数状态页各占最后 1KB。App 区最大多少 KB？状态页起始地址是多少？

::: answer
Flash 总量 64KB：

- Bootloader：0x08000000 ~ 0x08002FFF（12KB）
- App：0x08003000 开始
- 升级请求页：0x0800F800 ~ 0x0800FBFF（1KB）
- 状态页：`0x08000000 + 64KB - 1KB = 0x0800FC00`
- App 上限：0x0800F7FF

$$(0x0800F800 - 0x08003000) = 0xC800 = 51200 \text{ 字节} = 50KB$$

所以 App 最大 **50KB**，链接脚本写 `LENGTH = 50K`。

**多写 1K 编译器不会报错，但运行时会覆盖升级请求页**——App 第一次"请求升级"就把自己的尾部写花了，现象是升级后功能诡异。
:::
:::

::: exercise 练习 2：升级要多久
App 大小 30KB，串口 115200-8-N-1，每包 512 字节数据加 10 字节协议开销。传输最短时间？Flash 擦写时间要不要算进去？

::: answer
**串口时间**：

每包总字节 = 512 + 10 = 522 字节，每字节 10 位：

$$522 \times 10 / 115200 = 45.3ms$$

包数 = $30 \times 1024 / 512 = 60$ 包：

$$60 \times 45.3ms = 2.72s$$

**Flash 时间**：

30KB = 30 页，每页擦除约 **20~40ms**（F103 页擦除典型值），30 页约 **0.6~1.2s**；页编程每半字约 50μs，30KB = 15360 个半字，约 **0.77s**。

合计约 **4~4.7 秒**。

**结论**：串口传输不是瓶颈，**Flash 擦除才是**。所以升级时上位机要等 Bootloader 回 ACK 再发下一包，不能"发完就算"。
:::
:::

---

## 6. 跳转失败的排查表

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 跳转后立刻 HardFault | MSP 没设 / 栈顶值非法 | 检查 App 前 4 字节是否是 0x2000xxxx |
| 跳转后卡在 `Default_Handler` | **VTOR 没设** | 改为 `SCB->VTOR = APP_ADDR` |
| App 能跑，但一开中断就死 | VTOR 或链接地址不一致 | 两处必须都改成 0x08003000 |
| App 的 `HAL_Delay` 卡死 | SysTick 中断跳到 Bootloader | 改成 `SCB->VTOR = APP_ADDR` |
| 跳过去又跳回 Bootloader | App 里有软复位 / 看门狗没喂 | 检查 App 的 IWDG 配置 |
| 升级完变砖，上电没反应 | App 写了一半就跳转 | 加 CRC 校验 + 有效标志 |
| 程序完全下不进去 | 把 SWD 引脚配成了 GPIO | 拉高 BOOT0，用串口 ISP 救砖 |

::: warn 救砖：BOOT0 是你的保险绳
F103 的启动模式由 **BOOT0/BOOT1** 决定：

- BOOT0 = 0：从 **Flash（0x08000000）** 启动，跑你的程序。
- BOOT0 = 1：从**系统存储器（Boot ROM）**启动，跑 ST 出厂的串口下载程序。

只要把 BOOT0 拉高、复位，芯片就完全不看你的 Flash，**即使 App 和 Bootloader 都写坏了也能救回来**。然后用 STM32CubeProgrammer 或 FlyMcu 通过 PA9/PA10 重新烧。

**做 IAP 实验前，先把 BOOT0 跳线/按钮准备好。** 这是唯一不会因为代码写错而失效的恢复手段。
:::

---

## 7. 动手项目

::: project
**串口 IAP：给 s18 的项目加在线升级**

**第一步：拆成两个工程**

1. `IAP_Bootloader`：起始 0x08000000，限制 12KB（链接脚本 `LENGTH = 12K`）。
2. `IAP_App`：起始 0x08003000，链接长度 50KB，`VECT_TAB_OFFSET = 0x3000` 或 `main()` 里设 VTOR。

**第二步：Bootloader 逻辑**

1. 上电读升级请求页（0x0800F800）。
2. 有请求 → 等串口包，按 4.2 的流程写 App 区，收到结束帧拿整包 CRC32。
3. CRC 通过 → 写状态页（有效标志 + 版本 + 长度 + CRC）→ 清请求 → 跳转。
4. CRC 失败 → 留在 Bootloader，串口回 `NAK` / 提示重传。
5. 无请求 → 状态页有效则跳转；无效则停在 Bootloader 打印提示。

**第三步：App 逻辑**

1. 正常运行 s18 的全部功能。
2. 串口收到 `upgrade` 命令 → 擦写升级请求页 → `NVIC_SystemReset()`。

**验收标准**：

1. 正常上电，Bootloader 判断无升级请求，**200ms 内**跳到 App，用户无感。
2. App 收到 `upgrade` 后复位，Bootloader 进入升级模式，串口打印 `"waiting..."`。
3. 上位机（自己写 Python 或串口助手分包发）发送 30KB 固件，**校验通过后自动跳转**，新功能生效。
4. 故意传一个 CRC 错误的固件，Bootloader **拒绝跳转**并停在升级模式，重新上电仍是旧 App（或至少不变砖）。
5. 升级过程中途拔电，重新上电后 Bootloader 检测到请求仍在/App 无效，停在升级模式等待重传。
6. 拉高 BOOT0 能救砖。

**加分**：

- 用 **A/B 双区**：新固件写备份区，校验通过后拷贝/切换，支持回滚。
- 状态页存版本号，串口可查询当前版本。
- 把升级过程做成 OLED 进度条。

### 7.1 文件放置表

| 文件 | 所属工程 / 文件夹 | 作用 |
| --- | --- | --- |
| `main.c` | `IAP_Bootloader/Core/Src` | 时钟/串口初始化，调 `Boot_Main()` |
| `main.h` | `IAP_Bootloader/Core/Inc` | HAL 包含、`Error_Handler` 声明 |
| `boot_jump.c` / `.h` | `IAP_Bootloader/App/Src`、`App/Inc` | 四步跳转 + `APP_ADDR` |
| `boot_iap.c` / `.h` | `IAP_Bootloader/App/Src`、`App/Inc` | 收包、CRC16、擦页、半字写 |
| `boot_verify.c` / `.h` | `IAP_Bootloader/App/Src`、`App/Inc` | CRC32 校验、写状态页 |
| `boot_main.c` / `.h` | `IAP_Bootloader/App/Src`、`App/Inc` | 上电决策流程 |
| `bsp_param.c` / `.h` | `IAP_Bootloader/Hardware/Src`、`Hardware/Inc` | 请求页与状态页读写 |
| `bsp_uart.c` / `.h` | `IAP_Bootloader/Hardware/Src`、`Hardware/Inc` | 单字节收发 + 打印 |
| `main.c` | `IAP_App/Core/Src` | 设 VTOR、跑 App、轮询升级命令 |
| `main.h` | `IAP_App/Core/Inc` | 同 Bootloader |
| `app_upgrade.c` / `.h` | `IAP_App/App/Src`、`App/Inc` | 识别 `upgrade`、写请求页、复位 |
| `STM32F103C8TX_FLASH.ld` | `IAP_App/` | `ORIGIN = 0x08003000`、`LENGTH = 50K` |

CubeMX 生成、**不手写**：两个工程的 `gpio.c`、`usart.c`、`stm32f1xx_it.c`、`stm32f1xx_hal_msp.c`、`system_stm32f1xx.c`、启动文件、`Drivers/`。Bootloader 的链接脚本保持默认（0x08000000 / 64K），但要确认编译产物不超过 12KB（Build Analyzer 看）。

下面按 Bootloader 工程 → App 工程给全部文件的完整代码。

### 7.2 Bootloader：头文件

**文件：`IAP_Bootloader/Core/Inc/main.h`**

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

**文件：`IAP_Bootloader/App/Inc/boot_main.h`**

```c
#ifndef __BOOT_MAIN_H
#define __BOOT_MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void Boot_Main(void);   /* 永不返回：要么跳 App，要么停在 Bootloader */

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_MAIN_H */
```

**文件：`IAP_Bootloader/Hardware/Inc/bsp_param.h`**

```c
#ifndef __BSP_PARAM_H
#define __BSP_PARAM_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define BOOT_PARAM_ADDR    0x0800FC00U   /* 状态页：最后 1KB */
#define BOOT_REQ_ADDR      0x0800F800U   /* 升级请求页：App 区之后 1KB */
#define BOOT_REQ_MAGIC     0x55504752U   /* 'UPGR' */
#define BOOT_PARAM_MAGIC   0x424F4F54U   /* 'BOOT' */

typedef struct {
    uint32_t magic;
    uint32_t app_valid;      /* 1 = App 区可信 */
    uint32_t app_version;    /* 每次成功升级 +1 */
    uint32_t app_size;       /* App 字节数 */
    uint32_t app_crc;        /* App 区 CRC32 */
    uint16_t crc16;          /* 本结构体自身的校验 */
    uint16_t pad;
} BootParam_t;

void    BSP_ParamLoad(BootParam_t *p);
void    BSP_ParamSave(const BootParam_t *p);
uint8_t BSP_ReqCheck(void);          /* 1 = 存在升级请求 */
void    BSP_ReqClear(void);          /* 擦除请求页 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_PARAM_H */
```

**文件：`IAP_Bootloader/Hardware/Inc/bsp_uart.h`**

```c
#ifndef __BSP_UART_H
#define __BSP_UART_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void    BSP_UartInit(void);
uint8_t BSP_UartGetByte(uint8_t *b, uint32_t timeout_ms);   /* 1 = 收到 */
void    BSP_UartSendByte(uint8_t b);
void    BSP_UartPrintf(const char *fmt, ...);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_UART_H */
```

**文件：`IAP_Bootloader/App/Inc/boot_jump.h`**

```c
#ifndef __BOOT_JUMP_H
#define __BOOT_JUMP_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define APP_ADDR   0x08003000U

void JumpToApp(uint32_t app_addr);

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_JUMP_H */
```

**文件：`IAP_Bootloader/App/Inc/boot_iap.h`**

```c
#ifndef __BOOT_IAP_H
#define __BOOT_IAP_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void     IAP_Begin(void);
uint8_t  IAP_ReceiveAll(uint32_t *fw_size, uint32_t *fw_crc);
uint32_t IAP_GetWrittenSize(void);

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_IAP_H */
```

**文件：`IAP_Bootloader/App/Inc/boot_verify.h`**

```c
#ifndef __BOOT_VERIFY_H
#define __BOOT_VERIFY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

uint8_t Boot_VerifyAndFinish(uint32_t fw_size, uint32_t expected_crc);
void    Boot_MarkInvalid(void);

#ifdef __cplusplus
}
#endif

#endif /* __BOOT_VERIFY_H */
```

### 7.3 Bootloader：驱动与业务源文件

**文件：`IAP_Bootloader/Hardware/Src/bsp_param.c`**

```c
#include "bsp_param.h"
#include <string.h>
#include <stddef.h>

typedef char param_size_guard[(sizeof(BootParam_t) <= 1024U) ? 1 : -1];

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

static uint8_t ErasePage(uint32_t addr)
{
    FLASH_EraseInitTypeDef er = {0};
    uint32_t page_err = 0;

    er.TypeErase   = FLASH_TYPEERASE_PAGES;
    er.PageAddress = addr;
    er.NbPages     = 1;

    HAL_FLASH_Unlock();
    if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
        HAL_FLASH_Lock();
        return 0;
    }
    HAL_FLASH_Lock();
    return 1;
}

void BSP_ParamLoad(BootParam_t *p)
{
    memcpy(p, (const void *)BOOT_PARAM_ADDR, sizeof(BootParam_t));

    if (p->magic != BOOT_PARAM_MAGIC ||
        p->crc16 != Crc16((const uint8_t *)p, offsetof(BootParam_t, crc16))) {
        memset(p, 0, sizeof(*p));
        p->magic = BOOT_PARAM_MAGIC;
        p->crc16 = Crc16((const uint8_t *)p, offsetof(BootParam_t, crc16));
    }
}

void BSP_ParamSave(const BootParam_t *p)
{
    BootParam_t tmp = *p;
    uint16_t *src = (uint16_t *)&tmp;

    tmp.crc16 = Crc16((const uint8_t *)&tmp, offsetof(BootParam_t, crc16));

    if (ErasePage(BOOT_PARAM_ADDR) == 0U) {
        return;
    }

    HAL_FLASH_Unlock();
    for (uint32_t i = 0; i < (sizeof(BootParam_t) + 1U) / 2U; i++) {
        if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD,
                              BOOT_PARAM_ADDR + i * 2U, src[i]) != HAL_OK) {
            HAL_FLASH_Lock();
            return;
        }
    }
    HAL_FLASH_Lock();
}

uint8_t BSP_ReqCheck(void)
{
    uint32_t v;
    memcpy(&v, (const void *)BOOT_REQ_ADDR, sizeof(v));
    return (v == BOOT_REQ_MAGIC) ? 1U : 0U;
}

void BSP_ReqClear(void)
{
    (void)ErasePage(BOOT_REQ_ADDR);
}
```

**文件：`IAP_Bootloader/Hardware/Src/bsp_uart.c`**

```c
#include "bsp_uart.h"
#include "usart.h"
#include <stdarg.h>
#include <stdio.h>

void BSP_UartInit(void)
{
    /* huart1 已由 CubeMX 的 MX_USART1_UART_Init() 配好，这里不做轮询以外的事 */
}

uint8_t BSP_UartGetByte(uint8_t *b, uint32_t timeout_ms)
{
    return (HAL_UART_Receive(&huart1, b, 1U, timeout_ms) == HAL_OK) ? 1U : 0U;
}

void BSP_UartSendByte(uint8_t b)
{
    (void)HAL_UART_Transmit(&huart1, &b, 1U, 50U);
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
    (void)HAL_UART_Transmit(&huart1, (uint8_t *)buf, (uint16_t)n, 100U);
}
```

**文件：`IAP_Bootloader/App/Src/boot_iap.c`**

```c
#include "boot_iap.h"
#include "boot_jump.h"
#include "bsp_uart.h"

#define PAGE_SIZE       1024U
#define PKT_DATA_MAX    512U
#define APP_END_ADDR    0x0800F800U

static uint32_t s_write_addr = APP_ADDR;
static uint32_t s_written;

static uint16_t Crc16Update(uint16_t crc, const uint8_t *p, uint32_t len)
{
    while (len--) {
        crc ^= (uint16_t)(*p++) << 8;
        for (uint8_t i = 0; i < 8U; i++) {
            crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
                                  : (uint16_t)(crc << 1);
        }
    }
    return crc;
}

static uint8_t ReadExact(uint8_t *buf, uint16_t len, uint32_t timeout_ms)
{
    for (uint16_t i = 0; i < len; i++) {
        if (BSP_UartGetByte(&buf[i], timeout_ms) == 0U) {
            return 0;
        }
    }
    return 1;
}

static uint8_t ErasePage(uint32_t addr)
{
    FLASH_EraseInitTypeDef er = {0};
    uint32_t page_err = 0;

    er.TypeErase   = FLASH_TYPEERASE_PAGES;
    er.PageAddress = addr;
    er.NbPages     = 1;

    HAL_FLASH_Unlock();
    if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
        HAL_FLASH_Lock();
        return 0;
    }
    HAL_FLASH_Lock();
    return 1;
}

static uint8_t WritePacketData(uint32_t addr, const uint8_t *data, uint16_t len)
{
    HAL_FLASH_Unlock();
    for (uint16_t i = 0; i < len; i += 2U) {
        uint16_t half = data[i];
        half |= (i + 1U < len) ? (uint16_t)(data[i + 1U] << 8) : 0xFF00U;
        if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD,
                              addr + i, half) != HAL_OK) {
            HAL_FLASH_Lock();
            return 0;
        }
    }
    HAL_FLASH_Lock();
    return 1;
}

static uint8_t IAP_WritePacket(uint16_t seq, const uint8_t *data, uint16_t len)
{
    (void)seq;

    if ((s_write_addr + len) > APP_END_ADDR) {
        return 0;
    }
    if ((s_write_addr % PAGE_SIZE) == 0U) {
        if (ErasePage(s_write_addr) == 0U) {
            return 0;
        }
    }
    if (WritePacketData(s_write_addr, data, len) == 0U) {
        return 0;
    }

    s_write_addr += (uint32_t)((len + 1U) & ~1U);
    s_written    += len;
    return 1;
}

void IAP_Begin(void)
{
    s_write_addr = APP_ADDR;
    s_written    = 0;
}

uint32_t IAP_GetWrittenSize(void)
{
    return s_written;
}

uint8_t IAP_ReceiveAll(uint32_t *fw_size, uint32_t *fw_crc)
{
    uint8_t hdr[2], seqb[2], lenb[2], data[PKT_DATA_MAX], crcb[2];

    for (;;) {
        if (ReadExact(hdr, 2, 5000U) == 0U || hdr[0] != 0xAA || hdr[1] != 0x55) {
            BSP_UartSendByte(0x15);
            continue;
        }

        if (ReadExact(seqb, 2, 1000U) == 0U || ReadExact(lenb, 2, 1000U) == 0U) {
            return 0;
        }

        uint16_t seq = (uint16_t)(seqb[0] | ((uint16_t)seqb[1] << 8));
        uint16_t len = (uint16_t)(lenb[0] | ((uint16_t)lenb[1] << 8));

        if (len > PKT_DATA_MAX) {
            return 0;
        }
        if (len > 0U && ReadExact(data, len, 2000U) == 0U) {
            return 0;
        }
        if (ReadExact(crcb, 2, 1000U) == 0U) {
            return 0;
        }

        uint16_t crc  = (uint16_t)(crcb[0] | ((uint16_t)crcb[1] << 8));
        uint16_t calc = 0xFFFFU;
        calc = Crc16Update(calc, seqb, 2);
        calc = Crc16Update(calc, lenb, 2);
        calc = Crc16Update(calc, data, len);

        if (calc != crc) {
            BSP_UartSendByte(0x15);
            continue;
        }

        if (seq == 0xFFFFU && len == 4U) {
            *fw_crc = (uint32_t)data[0] | ((uint32_t)data[1] << 8) |
                      ((uint32_t)data[2] << 16) | ((uint32_t)data[3] << 24);
            *fw_size = s_written;
            BSP_UartSendByte(0x06);
            return 1;
        }

        if (IAP_WritePacket(seq, data, len) == 0U) {
            BSP_UartSendByte(0x15);
            return 0;
        }
        BSP_UartSendByte(0x06);
    }
}
```

**文件：`IAP_Bootloader/App/Src/boot_verify.c`**

```c
#include "boot_verify.h"
#include "boot_jump.h"
#include "bsp_param.h"

static uint32_t Crc32(const uint8_t *p, uint32_t len)
{
    uint32_t crc = 0xFFFFFFFFU;
    while (len--) {
        crc ^= *p++;
        for (uint8_t i = 0; i < 8U; i++) {
            crc = (crc & 1U) ? ((crc >> 1) ^ 0xEDB88320U) : (crc >> 1);
        }
    }
    return ~crc;
}

uint8_t Boot_VerifyAndFinish(uint32_t fw_size, uint32_t expected_crc)
{
    BootParam_t p;
    uint32_t sp, pc, crc;

    if (fw_size < 8U || fw_size > (0x0800F800U - APP_ADDR)) {
        return 0;
    }

    sp = *(volatile uint32_t *)APP_ADDR;
    pc = *(volatile uint32_t *)(APP_ADDR + 4U);
    if ((sp & 0x2FFE0000U) != 0x20000000U) {
        return 0;
    }
    if (pc < APP_ADDR || pc >= 0x0800F800U) {
        return 0;
    }

    crc = Crc32((const uint8_t *)APP_ADDR, fw_size);
    if (crc != expected_crc) {
        return 0;
    }

    BSP_ParamLoad(&p);
    if (p.magic != BOOT_PARAM_MAGIC) {
        p.magic       = BOOT_PARAM_MAGIC;
        p.app_version = 0;
    }
    p.app_valid = 1U;
    p.app_size  = fw_size;
    p.app_crc   = crc;
    p.app_version++;
    BSP_ParamSave(&p);

    BSP_ReqClear();
    return 1;
}

void Boot_MarkInvalid(void)
{
    BootParam_t p;
    BSP_ParamLoad(&p);
    if (p.magic != BOOT_PARAM_MAGIC) {
        p.magic = BOOT_PARAM_MAGIC;
    }
    p.app_valid = 0U;
    BSP_ParamSave(&p);
}
```

**文件：`IAP_Bootloader/App/Src/boot_main.c`**

```c
#include "boot_main.h"
#include "boot_jump.h"
#include "boot_iap.h"
#include "boot_verify.h"
#include "bsp_param.h"
#include "bsp_uart.h"

void Boot_Main(void)
{
    BootParam_t p;

    BSP_UartInit();
    BSP_UartPrintf("bootloader start\r\n");
    /* 1. 有升级请求：进升级模式，收完、校验、跳转 */
    if (BSP_ReqCheck() != 0U) {
        uint32_t fw_size = 0, fw_crc = 0;

        BSP_UartPrintf("waiting...\r\n");
        IAP_Begin();

        if (IAP_ReceiveAll(&fw_size, &fw_crc) != 0U) {
            if (Boot_VerifyAndFinish(fw_size, fw_crc) != 0U) {
                BSP_UartPrintf("verify ok, jump\r\n");
                HAL_Delay(20);
                JumpToApp(APP_ADDR);      /* 成功则永不返回 */
            } else {
                BSP_UartPrintf("verify fail, stay\r\n");
                Boot_MarkInvalid();       /* App 区已被擦/写坏，绝不能跳 */
                while (1) { }
            }
        } else {
            BSP_UartPrintf("recv fail, stay\r\n");
            Boot_MarkInvalid();
            while (1) { }
        }
    }

    /* 2. 没有请求：状态页说 App 有效就跳 */
    BSP_ParamLoad(&p);
    if (p.magic == BOOT_PARAM_MAGIC && p.app_valid == 1U) {
        BSP_UartPrintf("jump to app\r\n");
        HAL_Delay(20);
        JumpToApp(APP_ADDR);
    }

    /* 3. 没有可跳的 App：停在这里等重传 */
    BSP_UartPrintf("no valid app, waiting\r\n");
    while (1) { }
}
```

**文件：`IAP_Bootloader/Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "usart.h"
#include "boot_main.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART1_UART_Init();

  Boot_Main();          /* 内部要么跳 App，要么死循环等升级，不会返回 */

  while (1) { }
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

### 7.4 App 工程：升级命令模块

**文件：`IAP_App/Core/Inc/main.h`**

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

**文件：`IAP_App/App/Inc/app_upgrade.h`**

```c
#ifndef __APP_UPGRADE_H
#define __APP_UPGRADE_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_UpgradeInit(void);
void App_UpgradeTick(void);   /* 主循环轮询串口命令 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_UPGRADE_H */
```

**文件：`IAP_App/App/Src/app_upgrade.c`**

```c
#include "app_upgrade.h"
#include "usart.h"
#include <string.h>

#define REQ_ADDR    0x0800F800U   /* 与 Bootloader 的 BOOT_REQ_ADDR 一致 */
#define REQ_MAGIC   0x55504752U   /* 'UPGR' */
#define CMD_MAX     16U

static char    s_cmd[CMD_MAX];
static uint8_t s_cmd_len;

void App_UpgradeInit(void)
{
    s_cmd_len = 0;
}

/* 擦请求页 → 写 magic → 软复位；下次上电 Bootloader 看到 magic 就进升级 */
static void RequestUpgradeAndReset(void)
{
    FLASH_EraseInitTypeDef er = {0};
    uint32_t page_err = 0;
    uint16_t magic[2];

    magic[0] = (uint16_t)(REQ_MAGIC & 0xFFFFU);
    magic[1] = (uint16_t)(REQ_MAGIC >> 16);

    HAL_FLASH_Unlock();

    er.TypeErase   = FLASH_TYPEERASE_PAGES;
    er.PageAddress = REQ_ADDR;
    er.NbPages     = 1;
    if (HAL_FLASHEx_Erase(&er, &page_err) == HAL_OK) {
        (void)HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, REQ_ADDR,      magic[0]);
        (void)HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, REQ_ADDR + 2U, magic[1]);
    }

    HAL_FLASH_Lock();

    HAL_Delay(20);           /* 等串口把最后一帧发完 */
    NVIC_SystemReset();
}

void App_UpgradeTick(void)
{
    uint8_t c;

    /* 每次最多等 10ms，没有字节就返回，不阻塞业务 */
    if (HAL_UART_Receive(&huart1, &c, 1U, 10U) != HAL_OK) {
        return;
    }

    if (c == '\r' || c == '\n') {
        s_cmd[s_cmd_len] = '\0';
        if (strcmp(s_cmd, "upgrade") == 0) {
            RequestUpgradeAndReset();     /* 不返回 */
        }
        s_cmd_len = 0;
        return;
    }

    if (s_cmd_len < (CMD_MAX - 1U)) {
        s_cmd[s_cmd_len++] = (char)c;
    } else {
        s_cmd_len = 0;
    }
}
```

**文件：`IAP_App/Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "usart.h"
#include "app_upgrade.h"
#include <string.h>

#define APP_VECT_TAB   0x08003000U

void SystemClock_Config(void);

static void Log(const char *s)
{
  HAL_UART_Transmit(&huart1, (uint8_t *)s, (uint16_t)strlen(s), 100U);
}

int main(void)
{
  SCB->VTOR = APP_VECT_TAB;      /* 必须与链接脚本 ORIGIN 完全一致 */

  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART1_UART_Init();

  Log("app v1.0 running\r\n");
  Log("send 'upgrade' to request update\r\n");

  App_UpgradeInit();

  while (1)
  {
    App_UpgradeTick();
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

### 7.5 为什么这么拆 / 没写的是什么

**为什么 Bootloader 和 App 必须是两个工程**：两者的链接地址不同（0x08000000 vs 0x08003000），生成的 `.bin` 要分别烧写；同一工程没法产出两个起始地址的固件。CubeIDE 里建两个 project，各自有 `.ioc`、`.ld`、`system_stm32f1xx.c`。

**为什么把请求页和状态页分开**：App 只写请求页（1 页），Bootloader 只写状态页（1 页），两者的擦写互不干扰。若共用一页，App 写请求时会把"App 有效标志"一起擦掉，重启后 Bootloader 直接判定无 App。

**为什么 App 用轮询收命令、Bootloader 用阻塞收包**：App 还要跑业务，不能被串口卡住，所以 10ms 超时轮询；Bootloader 在升级模式里除了收包没别的事，阻塞等更简单，也不必开中断和环形缓冲。

**为什么校验用 CRC32 而不是 CRC16**：CRC16 对 50KB 数据的碰撞概率偏高，整包校验用 CRC32 更稳；每包线上传输用 CRC16 够用，两层各司其职。注意上位机脚本必须用同一个反射多项式 `0xEDB88320`、初值 `0xFFFFFFFF`、结果取反。

**哪些没写、默认值是多少**：两个工程的 `usart.c` 都是 115200-8-N-1；App 工程**不要开** USART 的 RXNE 中断（否则 `HAL_UART_Receive` 轮询和中断抢同一个 DR）；Bootloader 的链接脚本默认 `LENGTH = 64K`，编译后必须用 Build Analyzer 确认不超过 12KB，否则会覆盖 0x08003000 起的 App；`system_stm32f1xx.c` 在 Bootloader 里 `VECT_TAB_OFFSET = 0x0`，在 App 里可以是 `0x3000`（或按本课在 `main()` 里设 VTOR，二者只取其一）；启动文件、`Drivers/`、`stm32f1xx_hal_msp.c` 全部由 CubeMX 生成。
:::

---

## 8. 本课小结

- **Bootloader + App 两段程序**：上电先跑 Bootloader，它决定升级还是跳转。
- 分区要提前规划：**Bootloader 预留按预计大小 ×2**；App 上限 = 总容量 − Bootloader − 请求页 − 状态页。
- 跳转四步，**顺序不能错**：关中断 → 设 VTOR → 设 MSP → 跳复位向量；跳转前检查栈顶是否在 SRAM 范围。
- App 侧必改：**链接脚本 ORIGIN/LENGTH** 和 **VECT_TAB_OFFSET / VTOR**，只改一处会"能跑但中断全死"。
- 升级流程：**分包 → 按页擦 → 按半字写 → 全量 CRC32 → 有效标志 → 跳转**。
- 不做校验就跳转 = 赌博，写一半的 App 会让设备**每次上电都变砖**。
- **BOOT0 拉高是唯一的救砖保险**，做实验前先准备好。

::: selfcheck 自检
- [ ] 我能画出 Bootloader / App / 请求页 / 状态页的地址地图
- [ ] 我能说出跳转的四步和为什么顺序不能错
- [ ] 我知道 App 侧要改链接地址和 VTOR 两处
- [ ] 我能解释"App 能跑但一开中断就死"的原因
- [ ] 我能写出分包写 Flash 的流程并说明为什么要先擦页
- [ ] 我知道为什么必须 CRC 校验后才能跳转
- [ ] 我能算出 App 区上限和升级耗时
- [ ] 我知道 BOOT0 怎么救砖
:::

---

## 9. 课程收尾

到这里，`s1 ~ s20` 全部走完。回头看这条线：

| 阶段 | 课程 | 你获得的能力 |
| --- | --- | --- |
| 入门 | s1–s4 | 认识板子、会烧写调试、会读写引脚 |
| 内核 | s5–s8 | 时钟、SysTick、中断、EXTI |
| 定时器 | s9–s11 | 定时、PWM、输入捕获、编码器 |
| 通信 | s12–s14 | UART、I2C、SPI |
| 采集与可靠 | s15–s16 | ADC+DMA、看门狗、低功耗、Flash |
| 系统 | s17–s18 | FreeRTOS、综合项目 |
| 输出 | s19–s20 | 面试表达、Bootloader |

**接下来的路**，按兴趣选一条深入：

- **做产品**：学 RTOS 深入（事件组、任务通知、内存管理）、低功耗设计、EMC、硬件基础。
- **做驱动**：读数据手册、写裸机寄存器驱动、学 Linux 驱动模型。
- **做算法**：在 MCU 上跑滤波（卡尔曼）、PID、简单神经网络（TinyML）。

不管走哪条，方法都一样：**先想清楚要解决什么问题，再选工具，最后用现象验证**。这门课教的就是这个循环。


