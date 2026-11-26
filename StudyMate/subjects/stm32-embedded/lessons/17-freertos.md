---
node: s17
title: FreeRTOS 入门：任务、队列与信号量
type: concept
duration: 90
---

## 这一课要解决的问题

::: goal
读完你能：说清裸机"前后台"框架在任务变多后会撞上什么墙；用 FreeRTOS 创建多个任务并排优先级；用队列在任务之间传数据、用信号量在中断和任务之间同步；知道任务栈该给多大、什么代码绝对不能出现在中断里。
:::

前面 16 课写的都是**裸机**程序：一个 `while(1)` 里轮流调用各个功能。功能少的时候很好用，功能一多就开始互相拖累。

---

## 1. 裸机的墙：一个慢任务拖死所有人

假设你的 `while(1)` 长这样（`SystemClock_Config()` 与 s16 相同，由 CubeMX 生成）：

**文件：`Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "usart.h"
#include "i2c.h"
#include "adc.h"
#include "bsp_key.h"
#include "bsp_oled.h"
#include "bsp_adc.h"
#include "bsp_uart.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();
  MX_USART1_UART_Init();
  MX_I2C1_Init();
  MX_ADC1_Init();

  BSP_KeyInit();
  BSP_OledInit();
  BSP_AdcInit();
  BSP_UartInit();

  while (1)
  {
    BSP_KeyScan();                     /* 约 10ms */
    BSP_OledRefresh();                 /* 约 30ms，I2C 刷整屏 */
    (void)BSP_AdcReadMv();             /* 约 5ms */
    BSP_UartPrintf("mv=%u\r\n", BSP_AdcReadMv());   /* 约 200ms：阻塞等最后一个字节发完 */
    HAL_Delay(10);
  }
}

/* 72MHz：HSE 8MHz × 9；APB1 = 36MHz；ADCCLK = 72MHz / 6 = 12MHz */
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

函数体都放在 `Hardware/` 里（本课项目会逐个给出完整实现），`main.c` 只负责排队。**为什么只能这么写**：裸机只有一个执行流，函数不返回，后面的代码就永远轮不到；想让串口不挡路，只能把 `BSP_UartPrintf()` 改写成状态机或 DMA + 标志位，功能一多代码就失控——这正是第 1 节 note 里 RTOS 要解决的问题。**哪些没写**：这些 `BSP_xxx()` 的实现在各 `bsp_*.c` 里，`HAL_Delay` 靠 SysTick 中断累加，初值由 `HAL_Init()` 设好——都不是这段代码的一部分。

问题立刻出现：

- 执行到串口打印时，**200ms 内按键完全没反应**，屏幕也不刷新。
- 如果传感器换成"等 I2C 应答最多 100ms"，情况更糟。
- 你想给按键加个"长按 500ms"的判断，结果因为循环周期不稳定，时长时短。

**根本原因**：裸机的所有任务共享一个执行流，**一个任务阻塞，后面全部排队**。你只能靠"把每个函数都写成不阻塞的状态机"来缓解，但代码会迅速变得难写难维护。

::: note RTOS 解决的不是"跑得更快"，是"响应更及时"
FreeRTOS 不会让你的代码变快——调度本身还有开销。它解决的是**响应时间**：

- 裸机：按键响应时间 = 最坏情况下一圈的耗时（200ms+）。
- RTOS：按键任务优先级高，按键一按下，**下一个 tick（1ms）内就能响应**。

代价是：每个任务要有独立栈（吃 RAM）、调度要时间、共享数据要加保护（否则出诡异的 bug）。

**什么时候该上 RTOS**：任务超过 3~4 个、有明显"慢任务"、有硬实时要求。功能简单的小项目用裸机 + 状态机反而更省心。
:::

---

## 2. 任务：一个有自己栈的无限循环

FreeRTOS 里，"任务"就是一个**永不返回的函数**，长得和裸机的 `while(1)` 一模一样：

**文件：`App/Src/app_task_led.c`**

```c
#include "app_tasks.h"

/* 心跳灯：最低优先级，只在别人都阻塞时跑，证明调度器还活着 */
void vTaskLed(void *pvParameters)
{
    (void)pvParameters;                       /* 没用到参数，显式丢弃，避免编译告警 */

    for (;;) {                                /* 死循环不能退出：return 会触发 prvTaskExitError */
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        vTaskDelay(pdMS_TO_TICKS(500));       /* 阻塞 500ms，期间调度器把 CPU 给别人 */
    }
}
```

它用到的接口先在头文件里定死，后面所有任务都往这里加声明：

**文件：`App/Inc/app_comm.h`**

```c
#ifndef __APP_COMM_H
#define __APP_COMM_H

#ifdef __cplusplus
extern "C" {
#endif

#include "FreeRTOS.h"
#include "queue.h"
#include "semphr.h"
#include <stdint.h>

/* 采集任务 → 显示任务的消息，按值拷贝 */
typedef struct {
    uint16_t voltage_mv;
    int16_t  temp_c10;      /* 温度 ×10，避免浮点 */
} SensorMsg_t;

/* 按键事件：中断只发信号，具体是哪个键由按键任务判断 */
typedef enum {
    APP_KEY1_SHORT = 0,
    APP_KEY2_SHORT
} AppKeyMsg_t;

extern QueueHandle_t     xSensorQueue;   /* 长度 5，元素 SensorMsg_t */
extern QueueHandle_t     xKeyQueue;      /* 长度 5，元素 AppKeyMsg_t */
extern SemaphoreHandle_t xKeySem;        /* 二值信号量：EXTI → 按键任务 */

void App_CommInit(void);                 /* 创建上面三个对象，必须在建任务之前调用 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_COMM_H */
```

**文件：`App/Inc/app_tasks.h`**

```c
#ifndef __APP_TASKS_H
#define __APP_TASKS_H

#ifdef __cplusplus
extern "C" {
#endif

#include "app_comm.h"
#include "task.h"
#include "main.h"

void vTaskKey(void *pvParameters);       /* 优先级 4 */
void vTaskSensor(void *pvParameters);    /* 优先级 3 */
void vTaskDisplay(void *pvParameters);   /* 优先级 2 */
void vTaskLed(void *pvParameters);       /* 优先级 1 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_TASKS_H */
```

**为什么用 `vTaskDelay` 而不是 `HAL_Delay`**：`HAL_Delay` 是"原地空转等 SysTick"，任务没让出 CPU，同优先级的其他任务照样饿着；`vTaskDelay` 会把任务挂到延时列表，调度器立刻切走。**哪些没写**：`pcTaskGetName`、栈分配、TCB（任务控制块）都是 `xTaskCreate` 内部从 `heap_4` 里申请的，你不用声明栈数组。

关键区别：**每个任务有自己的栈**。调度器切换任务时，把当前任务的寄存器、局部变量保存到它自己的栈里，再从另一个任务的栈恢复。

所以：

- 任务函数**绝不能 return**（return 会触发 `prvTaskExitError` 死循环）。
- 每个任务要分配栈空间，**栈太小会踩坏别的内存**（下一节细说）。

### 2.1 创建任务

任务的创建集中放在 `App/app_main.c`，`main.c` 只调用一次 `App_Init()`，然后启动调度器。

**文件：`App/Inc/app_main.h`**

```c
#ifndef __APP_MAIN_H
#define __APP_MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_Init(void);   /* 外设 + 队列/信号量 + 创建全部任务；不启动调度器 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_MAIN_H */
```

**文件：`App/Src/app_main.c`**

```c
#include "app_main.h"
#include "app_tasks.h"
#include "app_comm.h"
#include "bsp_key.h"
#include "bsp_oled.h"
#include "bsp_adc.h"
#include "bsp_uart.h"

void App_Init(void)
{
    /* 1. 外设先就绪，任务一跑起来就不会访问空句柄 */
    BSP_KeyInit();
    BSP_OledInit();
    BSP_AdcInit();
    BSP_UartInit();

    /* 2. 队列/信号量必须在 xTaskCreate 之前创建 */
    App_CommInit();

    /* 3. 参数：任务函数、名字、栈字数、参数、优先级、句柄 */
    xTaskCreate(vTaskKey,     "KEY",  256, NULL, 4, NULL);   /* 256 字 = 1KB */
    xTaskCreate(vTaskSensor,  "SEN",  256, NULL, 3, NULL);
    xTaskCreate(vTaskDisplay, "DISP", 512, NULL, 2, NULL);   /* 512 字 = 2KB */
    xTaskCreate(vTaskLed,     "LED",  128, NULL, 1, NULL);   /* 128 字 = 512B */
}
```

`main()` 里的形态是 `HAL_Init(); SystemClock_Config(); MX_xxx_Init(); App_Init(); vTaskStartScheduler();`——**调度器启动后 `main` 的 `while(1)` 永远不会执行**，所以按工程规范把 `vTaskStartScheduler()` 放在 `main.c`，`App_Init()` 里只建任务、不启动。完整 `main.c` 在第 7 节给出。

**为什么这样写**：三个 `xTaskCreate` 后面的参数依次是"函数、名字、栈字数、参数、优先级、句柄"。名字只在调试器/`vTaskList` 里出现，占几个字节；句柄传 `NULL` 是因为这类任务不会被别的任务删除或通知，不需要外部引用。**为什么不用别的**：不用 `xTaskCreateStatic`——它要求你自己提供 `StaticTask_t` 和栈数组，CubeMX 默认没开 `configSUPPORT_STATIC_ALLOCATION`，普通项目没必要。**哪些没写**：`SysTick_Handler`、`PendSV_Handler`、`SVC_Handler` 由 FreeRTOS 移植层（`port.c`）和 `stm32f1xx_it.c` 提供，`heap_4.c` 提供堆——都别手写，否则会和内核重复定义。

::: warn 栈的单位是"字"，不是"字节"
`xTaskCreate` 的第三个参数 `usStackDepth` 单位是 **StackType_t（32 位机上是 4 字节）**。

写 `128` 就是 **512 字节**，不是 128 字节。很多人以为给了 128 字节，结果一个 `printf` 就溢出。

粗略估算：一个只做 GPIO 翻转的任务 128 字够；调用了 `printf`/浮点/I2C 驱动的任务，建议 **256~512 字**（1~2KB）。
:::

### 2.2 优先级和调度

FreeRTOS 默认是**抢占式**调度：

- **高优先级任务就绪，立刻抢占低优先级任务**。
- **同优先级任务**按时间片轮转（默认 1ms 一个 tick），轮流跑。
- 高优先级任务如果一直不阻塞（死循环不让出），低优先级任务**永远得不到执行**——这叫"饿死"。

所以规则是：**每个任务里都必须有阻塞点**（`vTaskDelay`、等队列、等信号量）。纯死循环的高优先级任务是事故。

| 任务 | 建议优先级 | 理由 |
| --- | --- | --- |
| 按键/急停 | 高（4） | 要最快响应 |
| 传感器采集 | 中（3） | 周期性，可容忍几 ms |
| 显示刷新 | 低（2） | 慢一点人看不出 |
| 串口上报 | 低（2） | 后台工作 |
| 空闲任务 | 0（系统自带） | 不能占用 |

本课项目里还多一个心跳灯 `vTaskLed`，优先级 1：它只用来证明"调度器没死"，不能和业务抢 CPU。

---

## 3. 任务之间怎么传数据：队列

多个任务共享变量是危险的：一个任务写到一半被切换，另一个任务读到"半新半旧"的值。

FreeRTOS 的**队列**是线程安全的：发的一方 `xQueueSend`，收的一方 `xQueueReceive`，内部有临界区保护。

队列的特点是**值拷贝**：发进去的是数据的副本，不是指针。所以发一个结构体，队列里存的就是整个结构体。

队列和信号量的创建统一放 `App/app_comm.c`，句柄通过 `app_comm.h` 暴露给各任务。

**文件：`App/Src/app_comm.c`**

```c
#include "app_comm.h"

QueueHandle_t     xSensorQueue = NULL;
QueueHandle_t     xKeyQueue    = NULL;
SemaphoreHandle_t xKeySem      = NULL;

void App_CommInit(void)
{
    /* 5 个元素 × 4 字节（两个 int16），给显示端留 500ms 缓冲 */
    xSensorQueue = xQueueCreate(5, sizeof(SensorMsg_t));

    /* 按键事件最多 5 个未处理，再多说明显示任务已经卡死 */
    xKeyQueue = xQueueCreate(5, sizeof(AppKeyMsg_t));

    /* 二值信号量：初值是"空"，必须等 EXTI give 才能 take */
    xKeySem = xSemaphoreCreateBinary();
}
```

**文件：`App/Src/app_task_sensor.c`**

```c
#include "app_tasks.h"
#include "bsp_adc.h"

void vTaskSensor(void *p)
{
    SensorMsg_t msg;
    (void)p;

    for (;;) {
        msg.voltage_mv = BSP_AdcReadMv();
        msg.temp_c10   = BSP_AdcReadTempC10();

        /* 队列满说明显示端跟不上：这里丢掉本次数据，不阻塞采集 */
        (void)xQueueSend(xSensorQueue, &msg, 0);

        vTaskDelay(pdMS_TO_TICKS(100));   /* 每 100ms 采一次 */
    }
}
```

**文件：`App/Src/app_task_display.c`**

```c
#include "app_tasks.h"
#include "bsp_oled.h"
#include "bsp_uart.h"
#include <stdio.h>

#define LOG_INTERVAL_MS   1000U

static void DrawSensor(const SensorMsg_t *m, uint8_t show_volt)
{
    char buf[20];

    BSP_OledClear();
    if (show_volt) {
        (void)snprintf(buf, sizeof(buf), "U=%uMV", (unsigned)m->voltage_mv);
    } else {
        int16_t t = m->temp_c10;
        (void)snprintf(buf, sizeof(buf), "T=%d.%dC", (int)(t / 10), (int)(t % 10));
    }
    BSP_OledShowStr(2, 16, buf);
    BSP_OledRefresh();
}

void vTaskDisplay(void *p)
{
    SensorMsg_t msg;
    AppKeyMsg_t key;
    uint8_t  show_volt = 0;
    uint32_t last_log  = 0;

    (void)p;
    BSP_OledShowStr(0, 8, "ENV MONITOR");
    BSP_OledRefresh();

    for (;;) {
        /* 1. 先看按键：10ms 轮询一次，保证按键响应 < 50ms */
        if (xQueueReceive(xKeyQueue, &key, 0) == pdTRUE) {
            if (key == APP_KEY1_SHORT) {
                show_volt = (uint8_t)!show_volt;
                BSP_OledShowStr(5, 8, show_volt ? "SHOW: VOLT" : "SHOW: TEMP");
                BSP_OledRefresh();
            }
        }

        /* 2. 再等传感器数据，最多等 10ms；等到就重画 */
        if (xQueueReceive(xSensorQueue, &msg, pdMS_TO_TICKS(10)) == pdTRUE) {
            DrawSensor(&msg, show_volt);

            if ((HAL_GetTick() - last_log) >= LOG_INTERVAL_MS) {
                last_log = HAL_GetTick();
                BSP_UartPrintf("mv=%u t=%d.%d\r\n",
                               (unsigned)msg.voltage_mv,
                               (int)(msg.temp_c10 / 10), (int)(msg.temp_c10 % 10));
            }
        }
    }
}
```

**为什么用队列不用全局变量**：全局变量能被任意任务随时读写，一次写两个字段时被切换，读方就拿"半新半旧"；队列的入队/出队带临界区，是一次完整拷贝。队列长度 5 是给显示端留 500ms 缓冲，防止偶尔一帧变慢就丢数据；长度 1 也能跑，但抗抖动差。**为什么不用别的**：事件组只能传"位"，传不了结构体；任务通知（Task Notification）更轻，但一个任务只有一个通知值，多生产者时不适合。**哪些没写**：`pxCurrentTCB`、就绪链表、阻塞链表都是内核内部结构，`configASSERT` 和堆分配在 `FreeRTOSConfig.h` 里配。

**为什么显示任务"轮询两个队列"而不是用队列集**：队列集（Queue Set）能同时等多个队列，但要多一个句柄和 `xQueueSelectFromSet` 调用，代码更长；本课两个队列、10ms 超时已满足响应要求。数据一多就该换成队列集或事件组。

::: note 队列满了/空了会怎样
`xQueueSend` 的第三个参数是"最多等多久"：

- 队列满时，任务**阻塞**在这里等空位，超时返回 `errQUEUE_FULL`。
- `xQueueReceive` 在队列空时阻塞等待，`portMAX_DELAY` 表示永远等。

这个"阻塞等待"恰恰是 RTOS 的价值：**任务在等数据时不占 CPU**，调度器会把 CPU 让给别的任务。

裸机里你只能写 `while(!flag);` 死等——CPU 全烧在这，还挡住了所有其他事。
:::

### 3.1 中断里必须用 FromISR 版本

中断服务函数里**不能调用** `xQueueSend`/`xSemaphoreGive`，必须用带 `FromISR` 的版本。中断入口在 `Core/Src/stm32f1xx_it.c`，业务回调统一放 `App/app_isr.c`：

**文件：`App/Src/app_isr.c`**

```c
#include "app_comm.h"
#include "main.h"

/* 覆盖 HAL 的弱回调：EXTI 中断入口由 CubeMX 生成在 stm32f1xx_it.c */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    BaseType_t woken = pdFALSE;      /* 本 ISR 是否唤醒了更高优先级任务 */

    if (pin == KEY1_Pin || pin == KEY2_Pin) {
        xSemaphoreGiveFromISR(xKeySem, &woken);
        portYIELD_FROM_ISR(woken);   /* 需要时在退出中断的瞬间切任务 */
    }
}
```

**文件：`Core/Src/stm32f1xx_it.c`**

```c
/* 中断入口集中在这里；CubeMX 生成后只保留本工程用到的几个，其余弱定义 */
#include "main.h"
#include "stm32f1xx_it.h"
#include "FreeRTOS.h"
#include "task.h"
#include "tim.h"

extern TIM_HandleTypeDef htim2;      /* HAL 时基定时器（SYS → Timebase = TIM2） */

void NMI_Handler(void)
{
  while (1) { }
}

/* 正式工程应把下面这个函数换成 s19 的 hardfault_report 版本 */
void HardFault_Handler(void)
{
  while (1) { }
}

/* FreeRTOS 接管 SysTick：它只负责 tick 计数和任务切换 */
void SysTick_Handler(void)
{
  xPortSysTickHandler();
}

/* HAL 的 1ms 时基改由 TIM2 提供 */
void TIM2_IRQHandler(void)
{
  HAL_TIM_IRQHandler(&htim2);
}

/* KEY1 = PB0 → EXTI0；KEY2 = PB1 → EXTI1。CubeMX 已是这个映射 */
void EXTI0_IRQHandler(void)
{
  HAL_GPIO_EXTI_IRQHandler(KEY1_Pin);
}

void EXTI1_IRQHandler(void)
{
  HAL_GPIO_EXTI_IRQHandler(KEY2_Pin);
}

/* 未用到的中断向量走弱定义的 Default_Handler，不用在这里写 */
```

**为什么写在 `HAL_GPIO_EXTI_Callback` 而不是 `EXTI0_IRQHandler`**：CubeMX 生成的 `EXTI0_IRQHandler` 已经调用 `HAL_GPIO_EXTI_IRQHandler(KEY1_Pin)`，后者清标志再调这个弱回调。你覆盖回调就行，不用碰中断入口，多根 EXTI 线也不会互相覆盖。**为什么必须 FromISR + `portYIELD_FROM_ISR`**：普通 `xSemaphoreGive` 内部可能阻塞或触发断言；`woken = pdTRUE` 表示有个更高优先级任务被解锁，但中断上下文不能直接切，得靠 `portYIELD_FROM_ISR` 挂起 PendSV，等 ISR 返回再切。**哪些没写**：向量名、NVIC 使能、GPIO 的 EXTI 映射都在 CubeMX 生成的 `gpio.c`/启动文件里；`configASSERT` 在 `FreeRTOSConfig.h` 里，优先级检查就靠它。

::: warn 在中断里用错 API 会直接卡死
在 ISR 里调用 `xQueueSend`（非 FromISR 版本），FreeRTOS 会触发 `configASSERT` 死循环，或者更隐蔽地破坏调度器状态。

现象：一按键就死机，或者程序跑着跑着卡在 `HardFault_Handler`。

**记法：函数名带 `FromISR` 的才能在中断里用；用完必须 `portYIELD_FROM_ISR`。**
:::

---

## 4. 信号量：只传"发生了"，不传数据

很多时候中断只需要告诉任务"**有事了**"，不需要传具体数据。这时用**二值信号量**（binary semaphore）比队列更轻。

信号量在 `App_CommInit()` 里创建，中断里 give（上一节），任务里 take：

**文件：`App/Src/app_task_key.c`**

```c
#include "app_tasks.h"
#include "bsp_key.h"

void vTaskKey(void *p)
{
    AppKeyMsg_t evt;
    (void)p;

    for (;;) {
        /* 平时阻塞在这里，不占 CPU；EXTI 一来立刻被唤醒 */
        if (xSemaphoreTake(xKeySem, portMAX_DELAY) == pdTRUE) {
            vTaskDelay(pdMS_TO_TICKS(20));      /* 软件消抖，等电平稳定 */

            KeyEvent_t k = BSP_KeyScan();       /* 再读一次引脚，确认不是抖动 */
            if (k == KEY1_SHORT) {
                evt = APP_KEY1_SHORT;
                (void)xQueueSend(xKeyQueue, &evt, 0);
            } else if (k == KEY2_SHORT) {
                evt = APP_KEY2_SHORT;
                (void)xQueueSend(xKeyQueue, &evt, 0);
            }
        }
    }
}
```

**为什么信号量比队列更合适**：按键只需要知道"发生了"，不需要带数据；队列每次要拷元素、还要维护读写指针，信号量只翻一个计数值，更轻。**为什么不用互斥量代替**：互斥量有"所有者"，只能在任务里给，中断里 `xSemaphoreGiveFromISR` 一个互斥量是非法的；它解决的是"保护资源"，不是"通知"。**哪些没写**：`xSemaphoreCreateBinary` 内部从 `heap_4` 申请 `Queue_t` 结构（二值信号量本质是长度为 1、初始为空的队列），删除用 `vSemaphoreDelete`。

| 类型 | 用途 | 特点 |
| --- | --- | --- |
| **二值信号量** | 中断 → 任务的通知 | 只有 0/1，给多了不累加 |
| **计数信号量** | 统计事件次数 | 可以累加到 N |
| **互斥量 Mutex** | 保护共享资源 | 有"所有者"，支持优先级继承 |

::: note 互斥量和二值信号量的区别（高频面试题）
看起来都是"拿/放"，区别在**所有权**：

- **二值信号量**：谁都能给（包括中断），谁都能拿。适合"通知"。
- **互斥量**：**谁拿的必须谁放**，且不能在中断里用。适合"保护一段代码/一个外设"。

更重要的是**优先级继承**：低优先级任务拿着互斥量时，如果高优先级任务来抢，低优先级任务会被**临时提升**到高优先级，尽快执行完释放锁——避免"优先级反转"（高优先级被中优先级任务间接卡住）。

二值信号量没有这个机制。所以**保护资源必须用互斥量**，用二值信号量会出优先级反转。
:::

---

## 5. CubeMX 配置 + 中断优先级的硬性规定

`Middleware → FREERTOS`：

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| Interface | **CMSIS_V1** | 教程通用，API 是 `osXxx` 或原生 `xXxx` |
| TICK_RATE_HZ | 1000 | 1ms 一个 tick |
| TOTAL_HEAP_SIZE | **10240** | 10KB 堆，够 4~5 个任务 |
| Memory Management | **heap_4** | 支持碎片合并，最常用 |
| USE_MUTEXES | Enabled | 用互斥量必须开 |
| USE_COUNTING_SEMAPHORES | Enabled | — |

另外必须把 **SYS → Timebase Source 从 SysTick 改成 TIM2**（或 TIM6/TIM7），否则 `HAL_Delay` 和内核抢 SysTick。

::: warn 中断优先级必须 ≥ 5，否则 FromISR 会崩
FreeRTOS 在 Cortex-M 上把中断分成两类：

- 优先级**数值 ≥ `configMAX_SYSCALL_INTERRUPT_PRIORITY`（CubeMX 默认 5）**：可以调用 `FromISR` API。
- 数值 **< 5**（更高优先级）：**绝对不能**调用任何 FreeRTOS API，也不能被 RTOS 屏蔽。

Cortex-M 的优先级是**数值越小越高**，这一点和任务优先级正好相反，是新手最大的坑。

现象：把 EXTI 优先级设成 2（很高），然后在里面调 `xSemaphoreGiveFromISR`，一按键就进 `HardFault` 或断言死循环。

**规则：所有会调用 FromISR 的中断，NVIC 优先级数值都设成 5~15。** 本课 CubeMX 里 EXTI0/EXTI1 都设 5。
:::

::: note 为什么 CubeMX 要把 HAL 时基换成 TIM
裸机时 `HAL_Delay` 靠 SysTick。上了 FreeRTOS，SysTick 归调度器所有（每个 tick 要切任务），不能再给 HAL 当时基。

所以 CubeMX 生成 FreeRTOS 工程时，会自动把 HAL 时基改成某个定时器（本课用 TIM2），并在 `HAL_InitTick` 里改掉。`stm32f1xx_it.c` 里的 `SysTick_Handler` 只调 `xPortSysTickHandler()`，`TIM2_IRQHandler` 调 `HAL_TIM_IRQHandler(&htim2)`。

如果你手动移植 FreeRTOS 忘了这一步，现象是：`HAL_Delay` 变得极不准，或者 `HAL_UART_Transmit` 的超时判断失效、串口一卡就是永久阻塞。
:::

---

## 6. 算一算 / 想一想

::: exercise 练习 1：栈给多大
你有 4 个任务：LED 翻转、按键扫描（含 `printf`）、OLED 刷新（含 I2C 和字库数组）、传感器采集（含浮点运算）。每个任务栈给多少？总共占多少 RAM？

::: answer
按经验值（单位：字 = 4 字节）：

| 任务 | 栈（字） | 字节 | 理由 |
| --- | --- | --- | --- |
| LED | 128 | 512 | 只有 GPIO 和 delay |
| 按键 + printf | **384** | 1536 | `printf` 内部缓冲和格式化很吃栈 |
| OLED 刷新 | **512** | 2048 | I2C 驱动 + 局部字库缓冲 |
| 传感器 + 浮点 | **384** | 1536 | 浮点运算的中间变量 |

合计约 **5632 字节**，再加队列/信号量/内核对象（几百字节）和空闲任务栈（128 字 = 512B）。

所以 `TOTAL_HEAP_SIZE` 至少给 **8KB**，留余量给以后加任务。

**验证方法（必须做）**：用 `uxTaskGetStackHighWaterMark(NULL)` 在运行时查"历史最小剩余栈"，小于 20% 就加大。别靠猜。本课项目把 `configCHECK_FOR_STACK_OVERFLOW` 设为 2，溢出直接进钩子。
:::
:::

::: exercise 练习 2：优先级怎么排
系统有：急停按键（必须 1ms 内响应）、传感器采集（每 100ms）、OLED 显示（每秒刷新一次）、串口日志（可慢）。怎么排优先级？为什么不能让传感器任务最高？

::: answer
**优先级从高到低**：

1. **急停按键（4）**：硬实时，必须最高。它平时阻塞在信号量上，不占 CPU。
2. **传感器采集（3）**：周期性，晚几 ms 可以，但不能被显示任务拖。
3. **OLED 显示（2）** 和 **串口日志（2）**：同优先级，时间片轮转，谁都不急。

**为什么传感器不能最高**：如果传感器任务优先级最高且里面有阻塞等待（比如等 I2C 应答 50ms），它会在"等"的时候阻塞——这没问题，因为阻塞会让出 CPU。

真正的问题是：如果它**不阻塞**、一直轮询 I2C 状态位，就会**饿死**低优先级的显示和日志任务。现象是屏幕完全不刷新、串口一个字都不出。

**原则**：优先级按"响应时间要求"排，不按"重要性"排；每个任务必须有阻塞点；拿不准就用同优先级 + 时间片。
:::
:::

---

## 7. 动手项目

::: project
**RTOS 版的三任务小系统**

把 s16 的电压记录仪改造成 FreeRTOS：

| 任务 | 优先级 | 职责 |
| --- | --- | --- |
| `vTaskKey` | 4 | 等 EXTI 信号量，消抖，把"按键事件"发进队列 |
| `vTaskSensor` | 3 | 每 100ms 读一次 ADC，做滤波，把结果发进队列 |
| `vTaskDisplay` | 2 | 从队列收数据，刷新 OLED；每 1 秒串口打印 |
| `vTaskLed` | 1 | 500ms 翻转 LED，证明调度器还活着 |

**验收标准**：

1. 三个任务**同时**工作：按键按下 10ms 内屏幕有反应，传感器数据仍在每 100ms 更新。
2. 把 OLED 刷新改成"故意延时 500ms"，按键响应**仍然及时**（证明高优先级抢占生效）。
3. 用 `uxTaskGetStackHighWaterMark` 检查，每个任务剩余栈 > 25%。
4. 拔掉 OLED（I2C 无应答），系统不崩，其他任务照常跑（证明任务隔离）。
5. 连续运行 30 分钟不死机、不复位。

**加分**：加一个互斥量保护 I2C 总线，让显示任务和传感器任务（如果共用 I2C）不会互相打断传输。

### 7.1 文件放置表

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `main.c` | `Core/Src` | 初始化 + 启动调度器 |
| `main.h` | `Core/Inc` | 引脚宏、`Error_Handler` 声明 |
| `stm32f1xx_it.c` | `Core/Src` | SysTick（给内核）、TIM2（HAL 时基）、EXTI0/1 入口 |
| `app_main.c` / `.h` | `App/Src`、`App/Inc` | 外设初始化、创建任务 |
| `app_comm.c` / `.h` | `App/Src`、`App/Inc` | 队列、信号量、消息类型定义 |
| `app_tasks.h` | `App/Inc` | 四个任务函数声明 |
| `app_task_key.c` | `App/Src` | 按键任务（等信号量 + 消抖 + 发事件） |
| `app_task_sensor.c` | `App/Src` | 采集任务 |
| `app_task_display.c` | `App/Src` | 显示 + 日志任务 |
| `app_task_led.c` | `App/Src` | 心跳灯任务 |
| `app_isr.c` | `App/Src` | `HAL_GPIO_EXTI_Callback` |
| `bsp_key.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 读引脚判键值 |
| `bsp_oled.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | SSD1306 I2C 驱动 |
| `bsp_adc.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | ADC 采样、mV、温度换算 |
| `bsp_uart.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 串口打印与行缓冲 |

CubeMX 生成、**不用手写**：`gpio.c`、`i2c.c`、`adc.c`、`usart.c`、`tim.c`（TIM2 1ms 时基）、`stm32f1xx_hal_msp.c`、`system_stm32f1xx.c`、启动文件、链接脚本、`Drivers/`、`Middlewares/Third_Party/FreeRTOS/Source/`（`tasks.c`、`queue.c`、`list.c`、`port.c`、`heap_4.c`）以及 `FreeRTOSConfig.h`。

下面按"头文件 → 驱动 → App → main.c"给全部文件的完整代码。

### 7.2 头文件

**文件：`Core/Inc/main.h`**

```c
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "stm32f1xx_hal.h"

#define KEY1_Pin        GPIO_PIN_0
#define KEY1_GPIO_Port  GPIOB
#define KEY2_Pin        GPIO_PIN_1
#define KEY2_GPIO_Port  GPIOB
#define LED_Pin         GPIO_PIN_13
#define LED_GPIO_Port   GPIOC

void Error_Handler(void);

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
```

**文件：`Hardware/Inc/bsp_key.h`**

```c
#ifndef __BSP_KEY_H
#define __BSP_KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

typedef enum {
    KEY_NONE = 0,
    KEY1_SHORT,
    KEY2_SHORT
} KeyEvent_t;

void        BSP_KeyInit(void);
KeyEvent_t  BSP_KeyScan(void);   /* 读一次引脚：按下为低电平 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_KEY_H */
```

**文件：`Hardware/Inc/bsp_oled.h`**

```c
#ifndef __BSP_OLED_H
#define __BSP_OLED_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define OLED_ADDR      0x3CU    /* SSD1306 常见的 7 位地址 */
#define OLED_WIDTH     128U
#define OLED_PAGES     8U

void BSP_OledInit(void);
void BSP_OledClear(void);
void BSP_OledShowStr(uint8_t page, uint8_t col, const char *s);   /* page 0~7, col 像素 0~127 */
void BSP_OledRefresh(void);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_OLED_H */
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
uint16_t BSP_AdcReadMv(void);
int16_t  BSP_AdcReadTempC10(void);   /* 简化线性换算的温度 ×10 */

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
uint8_t BSP_UartReadLine(char *out, uint16_t out_size);
void    BSP_UartPrintf(const char *fmt, ...);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_UART_H */
```

**文件：`App/Inc/app_comm.h`**

```c
#ifndef __APP_COMM_H
#define __APP_COMM_H

#ifdef __cplusplus
extern "C" {
#endif

#include "FreeRTOS.h"
#include "queue.h"
#include "semphr.h"
#include <stdint.h>

typedef struct {
    uint16_t voltage_mv;
    int16_t  temp_c10;
} SensorMsg_t;

typedef enum {
    APP_KEY1_SHORT = 0,
    APP_KEY2_SHORT
} AppKeyMsg_t;

extern QueueHandle_t     xSensorQueue;
extern QueueHandle_t     xKeyQueue;
extern SemaphoreHandle_t xKeySem;

void App_CommInit(void);

#ifdef __cplusplus
}
#endif

#endif /* __APP_COMM_H */
```

**文件：`App/Inc/app_tasks.h`**

```c
#ifndef __APP_TASKS_H
#define __APP_TASKS_H

#ifdef __cplusplus
extern "C" {
#endif

#include "app_comm.h"
#include "task.h"
#include "main.h"

void vTaskKey(void *pvParameters);
void vTaskSensor(void *pvParameters);
void vTaskDisplay(void *pvParameters);
void vTaskLed(void *pvParameters);

#ifdef __cplusplus
}
#endif

#endif /* __APP_TASKS_H */
```

**文件：`App/Inc/app_main.h`**

```c
#ifndef __APP_MAIN_H
#define __APP_MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_Init(void);

#ifdef __cplusplus
}
#endif

#endif /* __APP_MAIN_H */
```

### 7.3 驱动源文件

**文件：`Hardware/Src/bsp_key.c`**

```c
#include "bsp_key.h"

void BSP_KeyInit(void)
{
    /* 引脚方向/上拉/EXTI 映射全部由 CubeMX 的 MX_GPIO_Init() 配好，这里无事可做 */
}

KeyEvent_t BSP_KeyScan(void)
{
    if (HAL_GPIO_ReadPin(KEY1_GPIO_Port, KEY1_Pin) == GPIO_PIN_RESET) {
        return KEY1_SHORT;
    }
    if (HAL_GPIO_ReadPin(KEY2_GPIO_Port, KEY2_Pin) == GPIO_PIN_RESET) {
        return KEY2_SHORT;
    }
    return KEY_NONE;
}
```

**文件：`Hardware/Src/bsp_oled.c`**

```c
#include "bsp_oled.h"
#include "i2c.h"
#include <string.h>

/* 显存：8 页 × 128 列，每字节竖着 8 个像素，bit0 在上 */
static uint8_t s_buf[OLED_PAGES][OLED_WIDTH];

/* 5×7 点阵：每字符 5 列，低位在上；只做数字 + 大写字母 + 几个符号 */
static const uint8_t FONT_DIGIT[10][5] = {
    {0x3E,0x51,0x49,0x45,0x3E}, {0x00,0x42,0x7F,0x40,0x00},
    {0x42,0x61,0x51,0x49,0x46}, {0x21,0x41,0x45,0x4B,0x31},
    {0x18,0x14,0x12,0x7F,0x10}, {0x27,0x45,0x45,0x45,0x39},
    {0x3C,0x4A,0x49,0x49,0x30}, {0x01,0x71,0x09,0x05,0x03},
    {0x36,0x49,0x49,0x49,0x36}, {0x06,0x49,0x49,0x29,0x1E}
};

static const uint8_t FONT_UPPER[26][5] = {
    {0x7E,0x11,0x11,0x11,0x7E}, {0x7F,0x49,0x49,0x49,0x36},
    {0x3E,0x41,0x41,0x41,0x22}, {0x7F,0x41,0x41,0x22,0x1C},
    {0x7F,0x49,0x49,0x49,0x41}, {0x7F,0x09,0x09,0x09,0x01},
    {0x3E,0x41,0x49,0x49,0x7A}, {0x7F,0x08,0x08,0x08,0x7F},
    {0x00,0x41,0x7F,0x41,0x00}, {0x20,0x40,0x41,0x3F,0x01},
    {0x7F,0x08,0x14,0x22,0x41}, {0x7F,0x40,0x40,0x40,0x40},
    {0x7F,0x02,0x0C,0x02,0x7F}, {0x7F,0x04,0x08,0x10,0x7F},
    {0x3E,0x41,0x41,0x41,0x3E}, {0x7F,0x09,0x09,0x09,0x06},
    {0x3E,0x41,0x51,0x21,0x5E}, {0x7F,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31}, {0x01,0x01,0x7F,0x01,0x01},
    {0x3F,0x40,0x40,0x40,0x3F}, {0x1F,0x20,0x40,0x20,0x1F},
    {0x3F,0x40,0x38,0x40,0x3F}, {0x63,0x14,0x08,0x14,0x63},
    {0x07,0x08,0x70,0x08,0x07}, {0x61,0x51,0x49,0x45,0x43}
};

static const uint8_t FONT_BLANK[5] = {0x00,0x00,0x00,0x00,0x00};

static const uint8_t *Font5x7(char c)
{
    static const uint8_t minus[5] = {0x08,0x08,0x08,0x08,0x08};
    static const uint8_t dot[5]   = {0x00,0x00,0x60,0x00,0x00};
    static const uint8_t colon[5] = {0x00,0x24,0x00,0x00,0x00};
    static const uint8_t equal[5] = {0x14,0x14,0x14,0x14,0x14};

    if (c >= '0' && c <= '9') { return FONT_DIGIT[c - '0']; }
    if (c >= 'A' && c <= 'Z') { return FONT_UPPER[c - 'A']; }
    if (c >= 'a' && c <= 'z') { return FONT_UPPER[c - 'a']; }
    switch (c) {
    case '-': return minus;
    case '.': return dot;
    case ':': return colon;
    case '=': return equal;
    default:  return FONT_BLANK;
    }
}

static void OledCmd(uint8_t cmd)
{
    uint8_t b[2] = {0x00, cmd};      /* 0x00 = 后续是命令 */
    (void)HAL_I2C_Master_Transmit(&hi2c1, (uint16_t)(OLED_ADDR << 1), b, 2U, 50U);
}

static void OledData(const uint8_t *d, uint16_t n)
{
    uint8_t tmp[OLED_WIDTH + 1U];
    if (n > OLED_WIDTH) {
        return;
    }
    tmp[0] = 0x40;                   /* 0x40 = 后续是显存数据 */
    memcpy(&tmp[1], d, n);
    (void)HAL_I2C_Master_Transmit(&hi2c1, (uint16_t)(OLED_ADDR << 1), tmp, (uint16_t)(n + 1U), 100U);
}

void BSP_OledInit(void)
{
    static const uint8_t cmds[] = {
        0xAE,              /* 关显示 */
        0x20, 0x02,        /* 页寻址模式 */
        0xB0, 0xC8,        /* 页 0，COM 反向扫描 */
        0x00, 0x10,        /* 列地址低/高 4 位 = 0 */
        0x40,              /* 显示起始行 0 */
        0x81, 0x7F,        /* 对比度 */
        0xA1,              /* 段重映射，屏幕不左右反 */
        0xA6,              /* 正常显示（非反色） */
        0xA8, 0x3F,        /* 多路复用比 1/64 */
        0xA4,              /* 输出跟随显存 */
        0xD3, 0x00,        /* 显示偏移 0 */
        0xD5, 0x80,        /* 时钟分频 */
        0xD9, 0xF1,        /* 预充电周期 */
        0xDA, 0x12,        /* COM 引脚配置 */
        0xDB, 0x40,        /* VCOMH */
        0x8D, 0x14,        /* 开电荷泵 */
        0xAF               /* 开显示 */
    };

    for (uint32_t i = 0; i < sizeof(cmds); i++) {
        OledCmd(cmds[i]);
    }
    BSP_OledClear();
    BSP_OledRefresh();
}

void BSP_OledClear(void)
{
    memset(s_buf, 0x00, sizeof(s_buf));
}

void BSP_OledShowStr(uint8_t page, uint8_t col, const char *s)
{
    if (page >= OLED_PAGES) {
        return;
    }
    while (*s != '\0' && (uint16_t)col + 6U <= OLED_WIDTH) {
        const uint8_t *g = Font5x7(*s++);
        for (uint8_t i = 0; i < 5U; i++) {
            s_buf[page][col + i] = g[i];
        }
        s_buf[page][col + 5U] = 0x00;   /* 字符间距 1 列 */
        col = (uint8_t)(col + 6U);
    }
}

void BSP_OledRefresh(void)
{
    for (uint8_t p = 0; p < OLED_PAGES; p++) {
        OledCmd((uint8_t)(0xB0U + p));   /* 选中页 */
        OledCmd(0x00);                   /* 列低 4 位 */
        OledCmd(0x10);                   /* 列高 4 位 */
        OledData(s_buf[p], OLED_WIDTH);
    }
}
```

**文件：`Hardware/Src/bsp_adc.c`**

```c
#include "bsp_adc.h"
#include "adc.h"

#define ADC_SAMPLES   8U

void BSP_AdcInit(void)
{
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
    return (uint16_t)((sum * 3300U) / ((uint32_t)n * 4096U));
}

int16_t BSP_AdcReadTempC10(void)
{
    /* 简化线性模型：25℃ 对应 1650mV，约每 4.4mV 变化 1℃；实际项目用查表或 Steinhart */
    int32_t mv = (int32_t)BSP_AdcReadMv();
    int32_t t10 = 250 + ((1650 - mv) * 100) / 44;
    return (int16_t)t10;
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
    HAL_UART_Receive_IT(&huart1, &s_rx_byte, 1);
}

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart)
{
    if (huart->Instance == USART1) {
        uint16_t next = (uint16_t)((s_head + 1U) % RX_RING_SIZE);
        if (next != s_tail) {
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
                continue;
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
            s_line_len = 0;
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

### 7.4 App 源文件

**文件：`App/Src/app_comm.c`**

```c
#include "app_comm.h"

QueueHandle_t     xSensorQueue = NULL;
QueueHandle_t     xKeyQueue    = NULL;
SemaphoreHandle_t xKeySem      = NULL;

void App_CommInit(void)
{
    xSensorQueue = xQueueCreate(5, sizeof(SensorMsg_t));
    xKeyQueue    = xQueueCreate(5, sizeof(AppKeyMsg_t));
    xKeySem      = xSemaphoreCreateBinary();
}
```

**文件：`App/Src/app_task_key.c`**

```c
#include "app_tasks.h"
#include "bsp_key.h"

void vTaskKey(void *p)
{
    AppKeyMsg_t evt;
    (void)p;

    for (;;) {
        if (xSemaphoreTake(xKeySem, portMAX_DELAY) == pdTRUE) {
            vTaskDelay(pdMS_TO_TICKS(20));      /* 软件消抖 */

            KeyEvent_t k = BSP_KeyScan();
            if (k == KEY1_SHORT) {
                evt = APP_KEY1_SHORT;
                (void)xQueueSend(xKeyQueue, &evt, 0);
            } else if (k == KEY2_SHORT) {
                evt = APP_KEY2_SHORT;
                (void)xQueueSend(xKeyQueue, &evt, 0);
            }
        }
    }
}
```

**文件：`App/Src/app_task_sensor.c`**

```c
#include "app_tasks.h"
#include "bsp_adc.h"

void vTaskSensor(void *p)
{
    SensorMsg_t msg;
    (void)p;

    for (;;) {
        msg.voltage_mv = BSP_AdcReadMv();
        msg.temp_c10   = BSP_AdcReadTempC10();
        (void)xQueueSend(xSensorQueue, &msg, 0);
        vTaskDelay(pdMS_TO_TICKS(100));
    }
}
```

**文件：`App/Src/app_task_display.c`**

```c
#include "app_tasks.h"
#include "bsp_oled.h"
#include "bsp_uart.h"
#include <stdio.h>

#define LOG_INTERVAL_MS   1000U

static void DrawSensor(const SensorMsg_t *m, uint8_t show_volt)
{
    char buf[20];

    BSP_OledClear();
    if (show_volt) {
        (void)snprintf(buf, sizeof(buf), "U=%uMV", (unsigned)m->voltage_mv);
    } else {
        int16_t t = m->temp_c10;
        (void)snprintf(buf, sizeof(buf), "T=%d.%dC", (int)(t / 10), (int)(t % 10));
    }
    BSP_OledShowStr(2, 16, buf);
    BSP_OledRefresh();
}

void vTaskDisplay(void *p)
{
    SensorMsg_t msg;
    AppKeyMsg_t key;
    uint8_t  show_volt = 0;
    uint32_t last_log  = 0;

    (void)p;
    BSP_OledClear();
    BSP_OledShowStr(0, 8, "ENV MONITOR");
    BSP_OledShowStr(5, 8, "SHOW: TEMP");
    BSP_OledRefresh();

    for (;;) {
        if (xQueueReceive(xKeyQueue, &key, 0) == pdTRUE) {
            if (key == APP_KEY1_SHORT) {
                show_volt = (uint8_t)!show_volt;
                BSP_OledShowStr(5, 8, show_volt ? "SHOW: VOLT" : "SHOW: TEMP");
                BSP_OledRefresh();
            }
        }

        if (xQueueReceive(xSensorQueue, &msg, pdMS_TO_TICKS(10)) == pdTRUE) {
            DrawSensor(&msg, show_volt);

            if ((HAL_GetTick() - last_log) >= LOG_INTERVAL_MS) {
                last_log = HAL_GetTick();
                BSP_UartPrintf("mv=%u t=%d.%d\r\n",
                               (unsigned)msg.voltage_mv,
                               (int)(msg.temp_c10 / 10), (int)(msg.temp_c10 % 10));
            }
        }
    }
}
```

**文件：`App/Src/app_task_led.c`**

```c
#include "app_tasks.h"

void vTaskLed(void *pvParameters)
{
    (void)pvParameters;

    for (;;) {
        HAL_GPIO_TogglePin(LED_GPIO_Port, LED_Pin);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
```

**文件：`App/Src/app_isr.c`**

```c
#include "app_comm.h"
#include "main.h"

void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    BaseType_t woken = pdFALSE;

    if (pin == KEY1_Pin || pin == KEY2_Pin) {
        xSemaphoreGiveFromISR(xKeySem, &woken);
        portYIELD_FROM_ISR(woken);
    }
}
```

**文件：`App/Src/app_main.c`**

```c
#include "app_main.h"
#include "app_tasks.h"
#include "app_comm.h"
#include "bsp_key.h"
#include "bsp_oled.h"
#include "bsp_adc.h"
#include "bsp_uart.h"

void App_Init(void)
{
    BSP_KeyInit();
    BSP_OledInit();
    BSP_AdcInit();
    BSP_UartInit();

    App_CommInit();

    xTaskCreate(vTaskKey,     "KEY",  256, NULL, 4, NULL);
    xTaskCreate(vTaskSensor,  "SEN",  256, NULL, 3, NULL);
    xTaskCreate(vTaskDisplay, "DISP", 512, NULL, 2, NULL);
    xTaskCreate(vTaskLed,     "LED",  128, NULL, 1, NULL);
}

/* FreeRTOSConfig.h 里开了栈溢出检查（configCHECK_FOR_STACK_OVERFLOW = 2）就必须实现它 */
void vApplicationStackOverflowHook(TaskHandle_t xTask, char *pcTaskName)
{
    (void)xTask;
    (void)pcTaskName;
    taskDISABLE_INTERRUPTS();
    for (;;) { }
}

/* 对应 configUSE_MALLOC_FAILED_HOOK = 1：堆不够时停在这里，方便打断点 */
void vApplicationMallocFailedHook(void)
{
    taskDISABLE_INTERRUPTS();
    for (;;) { }
}
```

**文件：`Core/Src/stm32f1xx_it.c`**

```c
#include "main.h"
#include "stm32f1xx_it.h"
#include "FreeRTOS.h"
#include "task.h"
#include "tim.h"

extern TIM_HandleTypeDef htim2;      /* 由 CubeMX 的 HAL 时基文件定义 */

void NMI_Handler(void)
{
  while (1) { }
}

void HardFault_Handler(void)
{
  while (1) { }
}

void SysTick_Handler(void)
{
  xPortSysTickHandler();             /* 内核 tick，不要再调 HAL_IncTick */
}

void TIM2_IRQHandler(void)
{
  HAL_TIM_IRQHandler(&htim2);        /* HAL_IncTick 在 TIM2 的回调里 */
}

void EXTI0_IRQHandler(void)
{
  HAL_GPIO_EXTI_IRQHandler(KEY1_Pin);
}

void EXTI1_IRQHandler(void)
{
  HAL_GPIO_EXTI_IRQHandler(KEY2_Pin);
}
```

### 7.5 main.c

**文件：`Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "i2c.h"
#include "adc.h"
#include "usart.h"
#include "FreeRTOS.h"
#include "task.h"
#include "app_main.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();                  /* 内部把 HAL 时基切到 TIM2（CubeMX 的 timebase 文件） */
  SystemClock_Config();
  MX_GPIO_Init();
  MX_I2C1_Init();
  MX_ADC1_Init();
  MX_USART1_UART_Init();

  App_Init();                  /* 外设 + 队列/信号量 + 四个任务 */

  vTaskStartScheduler();       /* 正常永远不返回 */

  Error_Handler();             /* 堆不足导致调度器返回时，停在这里 */
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

### 7.6 为什么这样拆 / 没写的是什么

**为什么任务函数一人一个文件**：`app_task_*.c` 各管一件事，改显示不会碰到采集；`app_tasks.h` 是唯一任务清单，加任务只改两处（声明 + `xTaskCreate`）。比全部塞进 `app_tasks.c` 更好定位，也方便把某个任务单独拷到别的项目。

**为什么句柄集中在 `app_comm.c`**：队列/信号量的创建顺序有要求（必须在任务之前），集中一处不会漏；其他文件只 `extern` 使用，不会出现"两个 .c 各定义一个句柄"的链接错误。

**为什么 `SysTick_Handler` 只给内核**：FreeRTOS 的 tick 必须独占 SysTick，HAL 的 1ms 时基改用 TIM2，两者互不干扰。若还让 `HAL_IncTick()` 在 SysTick 里跑，就会和 `xPortSysTickHandler()` 抢同一个异常，表现为 `HAL_Delay` 时快时慢。

**哪些没写、默认值是多少**：`FreeRTOSConfig.h` 由 CubeMX 生成，本课依赖 `configTICK_RATE_HZ = 1000`、`configMAX_PRIORITIES = 7`、`configTOTAL_HEAP_SIZE = 10240`、`configMAX_SYSCALL_INTERRUPT_PRIORITY = 5`、`configCHECK_FOR_STACK_OVERFLOW = 2`；`port.c`/`heap_4.c`/`tasks.c`/`queue.c` 来自 `Middlewares/Third_Party/FreeRTOS/Source/`，不要手改；`gpio.c` 里 KEY1/KEY2 是上拉输入 + 下降沿 EXTI，NVIC 优先级 5；`i2c.c` 是 400kHz 标准模式；`adc.c` 的 ADC 预分频由 CubeMX 配成 12MHz（ADC 时钟不能超过 14MHz）。这些默认值错了，现象分别是：收不到按键中断、OLED 无应答、ADC 读数漂。
:::

---

## 8. 本课小结

- 裸机的墙：**一个阻塞任务拖死全部**；RTOS 换来的是**响应时间**，不是速度。
- 任务是**永不返回的函数 + 独立栈**；`xTaskCreate` 的栈单位是**字（4 字节）**，不是字节。
- 抢占式调度：**高优先级就绪立刻抢**；同优先级时间片轮转；每个任务必须有阻塞点，否则饿死别人。
- **队列**传数据（值拷贝、线程安全）；**二值信号量**只做"有事了"的通知；**互斥量**保护资源且有优先级继承。
- 中断里只能用 **`xxxFromISR`**，用完 `portYIELD_FROM_ISR`。
- **会调 FromISR 的中断，NVIC 优先级数值必须 ≥ 5**（数值越小优先级越高，别搞反）。
- FreeRTOS 工程里 HAL 时基要从 SysTick 换成 TIM，`SysTick_Handler` 只给内核。
- 栈大小用 **High Water Mark** 实测，别靠猜。

::: selfcheck 自检
- [ ] 我能举一个裸机被慢任务拖死的具体例子
- [ ] 我能说出 RTOS 改善的是响应时间而不是吞吐
- [ ] 我知道 `xTaskCreate` 栈的单位和估算方法
- [ ] 我能解释为什么高优先级任务不能让出会饿死别人
- [ ] 我能区分队列、二值信号量、互斥量的用途
- [ ] 我知道中断里为什么只能用 FromISR、优先级为什么必须 ≥ 5
- [ ] 我能说出 FreeRTOS 下 HAL_Delay 为什么会失准
- [ ] 我知道 `SysTick_Handler` 和 `TIM2_IRQHandler` 各干什么
:::

---

## 9. 下一课预告

单个外设你都会用了，多个任务也会调度了。现在缺的是**把它们拼成一个能演示、能讲、能写进简历的完整系统**。

下一课 `s18 综合项目：环境监测小站`：不教新知识，只教**怎么把学过的东西组织成一个项目**——需求拆解、模块划分、调试顺序、验收标准、项目说明。

