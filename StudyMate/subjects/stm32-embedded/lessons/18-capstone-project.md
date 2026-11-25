---
node: s18
title: 综合项目：环境监测小站
type: project
duration: 180
---

## 这一课要解决的问题

::: goal
这一课不教新外设。它要解决的是另一个问题：**学过的十几种东西，怎么拼成一个能跑、能演示、能在面试里讲的项目**。读完你能独立完成需求拆解、引脚分配、模块划分、分阶段调试，并写出一份像样的项目说明。
:::

很多人卡在这一步：单个实验都会做，一到"做个完整的东西"就不知道从哪下手，最后堆成一坨 `main.c`，改一个地方崩三个地方。

**项目能力 = 拆分能力 + 调试顺序 + 验收标准。** 这一课就练这三件事。

---

## 1. 先把需求写成人话

不要一上来就写代码。先写清楚"这个东西要干什么"。

### 1.1 功能需求（必须做的）

| 编号 | 需求 | 用到的技术 | 验收方式 |
| --- | --- | --- | --- |
| F1 | 每 500ms 采集一次环境温度 | ADC + 热敏电阻 | 串口打印的数值随体温变化 |
| F2 | OLED 显示温度、阈值、运行时间 | I2C + SSD1306 | 屏幕每秒刷新，不闪不花 |
| F3 | 按键切换显示页面 | EXTI + 消抖 | 按一下换页，不跳页 |
| F4 | 超阈值时蜂鸣器报警 | GPIO 输出 | 温度超过阈值蜂鸣器响 |
| F5 | 通过串口向上位机上报数据 | UART + 协议帧 | 上位机/串口助手能解析 |
| F6 | 参数（阈值、亮度）掉电保存 | 内部 Flash | 断电重上电参数不变 |

### 1.2 非功能需求（容易被忽略，但面试会问）

- **刷新率**：屏幕 ≥ 5 帧/秒，按键响应 < 50ms。
- **稳定性**：连续运行 24 小时不死机（配合看门狗）。
- **可维护性**：换一个传感器只改一个文件，不动主逻辑。
- **资源**：RAM 占用 < 10KB，Flash < 40KB。

::: note 为什么要写"非功能需求"
面试官问"你的项目有什么难点"，如果你只答"我用了 I2C 和 ADC"，那是**功能罗列**，不是难点。

真正的难点往往来自非功能需求：
- "屏幕刷新和传感器采集抢 I2C 总线，我加了互斥量/分时调度。"
- "连续跑 8 小时会死机，最后定位到是环形缓冲区溢出没处理。"
- "RAM 只剩 2KB，我把字库从 RAM 挪到了 Flash。"

**能讲出"约束 → 取舍 → 验证"，才叫项目经验。**
:::

---

## 2. 画一张系统框图，先看全局

<svg class="diagram" viewBox="0 0 860 380" xmlns="http://www.w3.org/2000/svg">
  <rect x="300" y="140" width="200" height="100" rx="8" fill="none" stroke="#c0392b" stroke-width="2"/>
  <text class="sub" x="356" y="180" font-size="12">STM32F103C8T6</text>
  <text class="sub" x="338" y="204" font-size="10">调度 / 采集 / 显示 / 上报</text>

  <rect x="40" y="40" width="150" height="60" rx="6" fill="none" stroke="#2c6fbb" stroke-width="1.5"/>
  <text class="sub" x="76" y="76" font-size="10.5">温度传感器</text>

  <rect x="40" y="150" width="150" height="60" rx="6" fill="none" stroke="#2c6fbb" stroke-width="1.5"/>
  <text class="sub" x="76" y="186" font-size="10.5">按键 ×2</text>

  <rect x="40" y="260" width="150" height="60" rx="6" fill="none" stroke="#2c6fbb" stroke-width="1.5"/>
  <text class="sub" x="76" y="296" font-size="10.5">蜂鸣器</text>

  <rect x="650" y="40" width="160" height="60" rx="6" fill="none" stroke="#2c6fbb" stroke-width="1.5"/>
  <text class="sub" x="700" y="76" font-size="10.5">OLED (I2C)</text>

  <rect x="650" y="150" width="160" height="60" rx="6" fill="none" stroke="#2c6fbb" stroke-width="1.5"/>
  <text class="sub" x="694" y="186" font-size="10.5">USB-TTL</text>

  <rect x="650" y="260" width="160" height="60" rx="6" fill="none" stroke="#2c6fbb" stroke-width="1.5"/>
  <text class="sub" x="700" y="296" font-size="10.5">内部 Flash</text>

  <line class="arrow" x1="190" y1="70" x2="295" y2="160"/>
  <polygon class="arrowhead" points="290,152 302,162 288,166"/>
  <line class="arrow" x1="190" y1="180" x2="295" y2="190"/>
  <polygon class="arrowhead" points="295,186 305,190 295,194"/>
  <line class="arrow" x1="190" y1="290" x2="295" y2="220"/>
  <polygon class="arrowhead" points="288,214 302,218 290,228"/>

  <line class="arrow" x1="505" y1="160" x2="645" y2="72"/>
  <polygon class="arrowhead" points="640,82 650,70 638,68"/>
  <line class="arrow" x1="505" y1="190" x2="645" y2="180"/>
  <polygon class="arrowhead" points="645,176 655,180 645,184"/>
  <line class="arrow" x1="505" y1="220" x2="645" y2="288"/>
  <polygon class="arrowhead" points="638,292 650,290 640,280"/>

  <text class="sub" x="60" y="360" font-size="10">先把"谁连谁、走什么接口"画清楚，再动手写代码。</text>
</svg>

画图时立刻能发现冲突：**OLED 和外部传感器如果都挂在 I2C 上，就共用 I2C1**，这就是后面要处理的共享资源问题。本项目的温度走 ADC，不占 I2C，但"一个总线只能被一个任务完整性访问"的规则仍然成立。

---

## 3. 引脚分配表：动手前必须填完

| 引脚 | 功能 | 方向 | 备注 |
| --- | --- | --- | --- |
| PA0 | ADC1_IN0 | 模拟输入 | 热敏电阻分压 |
| PA9 | USART1_TX | 复用推挽 | 接 USB-TTL 的 RX |
| PA10 | USART1_RX | 浮空/上拉输入 | 接 USB-TTL 的 TX |
| PB6 | I2C1_SCL | 开漏 | 4.7k 上拉 |
| PB7 | I2C1_SDA | 开漏 | 4.7k 上拉 |
| PB0 | 按键 1 | 上拉输入 + EXTI0 | 低电平按下 |
| PB1 | 按键 2 | 上拉输入 + EXTI1 | 低电平按下 |
| PB5 | 蜂鸣器 | 推挽输出 | 经三极管驱动 |
| PC13 | 板载 LED | 推挽输出 | 低电平亮 |

::: warn 引脚冲突是"玄学 bug"的头号来源
常见冲突：

- **PA13/PA14 是 SWD 调试口**，配成普通 GPIO 后就再也下载不了程序，只能接 BOOT0 用串口救砖。
- **PB3/PB4/PA15 默认是 JTAG 引脚**，要当 GPIO 用必须先关 JTAG（`__HAL_AFIO_REMAP_SWJ_NOJTAG()`）。
- **PC13/PC14/PC15 驱动能力弱**（只有 3mA），只能带 LED，不能驱动蜂鸣器或做输出通信。
- **PA0 同时是 WKUP 引脚**，配成 ADC 输入后就不能当待机唤醒用了。

**填完表，逐个对照原理图和芯片数据手册的"引脚定义表"检查一遍**，比调三天 bug 便宜。
:::

---

## 4. 分层：别把一切塞进 main.c

按 CubeIDE 的真实工程目录来放文件（第 7 节项目会给出每个文件的完整代码）：

```
EnvStation/
├── Core/
│   ├── Inc/
│   │   ├── main.h
│   │   ├── gpio.h   i2c.h   adc.h   usart.h
│   │   └── stm32f1xx_it.h
│   └── Src/
│       ├── main.c                  // 只做初始化 + 主循环
│       ├── gpio.c  i2c.c  adc.c  usart.c   // CubeMX 生成
│       ├── stm32f1xx_it.c          // 中断入口
│       ├── stm32f1xx_hal_msp.c
│       └── system_stm32f1xx.c
├── Drivers/                        // CMSIS + HAL，CubeMX 生成，不手改
├── Hardware/
│   ├── Inc/
│   │   ├── bsp_key.h
│   │   ├── bsp_oled.h
│   │   ├── bsp_adc.h
│   │   ├── bsp_buzzer.h
│   │   ├── bsp_flash.h
│   │   └── bsp_uart.h
│   └── Src/
│       └── bsp_key.c  bsp_oled.c  bsp_adc.c  bsp_buzzer.c  bsp_flash.c  bsp_uart.c
├── App/
│   ├── Inc/
│   │   ├── app_main.h
│   │   ├── app_page.h
│   │   └── app_test.h
│   └── Src/
│       └── app_main.c  app_page.c  app_test.c
└── Middlewares/                    // 本课不用 FreeRTOS；要加就放这里
```

规则只有一条：**上层只调下层的接口，下层不知道上层的存在**。

- `Hardware/bsp_key.c` 只提供 `BSP_KeyScan()` 返回键值，不关心按键按下后是翻页还是报警。
- `App/app_page.c` 只做"按键事件 → 页面迁移"，不关心是硬件 I2C 还是软件 I2C。

好处：换屏幕只改 `bsp_oled.c`；换传感器只改 `bsp_adc.c`。面试官问"你的代码结构"，这就是答案。

---

## 5. 用一个状态机管页面

界面是典型的**状态机**：当前在第几页，按键后跳到第几页。它放在 `App/app_page.c`，只处理"事件 → 页面迁移"，不碰硬件。

**文件：`App/Inc/app_page.h`**

```c
#ifndef __APP_PAGE_H
#define __APP_PAGE_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"
#include "bsp_key.h"

typedef enum {
    PAGE_MAIN = 0,
    PAGE_SET_TH,
    PAGE_SET_BRIGHT,
    PAGE_MAX
} Page_t;

extern uint8_t g_threshold;      /* 报警阈值 ℃，上电从 Flash 覆盖 */
extern uint8_t g_bright;         /* 亮度 0~100 */

void    App_PageInit(uint8_t threshold_c, uint8_t bright_pct);
void    App_PageTick(KeyEvent_t key);
Page_t  App_PageGet(void);
uint8_t App_PageIsDirty(void);   /* 1 = 参数被改过，App 负责存 Flash */
void    App_PageClearDirty(void);

#ifdef __cplusplus
}
#endif

#endif /* __APP_PAGE_H */
```

**文件：`App/Src/app_page.c`**

```c
#include "app_page.h"

static Page_t  s_page = PAGE_MAIN;   /* static：当前页只在本文件可见 */
static uint8_t s_dirty;

uint8_t g_threshold = 30;            /* 默认值，App_PageInit 会用 Flash 里的值覆盖 */
uint8_t g_bright    = 50;

void App_PageInit(uint8_t threshold_c, uint8_t bright_pct)
{
    s_page    = PAGE_MAIN;
    s_dirty   = 0;
    g_threshold = threshold_c;
    g_bright    = (bright_pct <= 100U) ? bright_pct : 50U;
}

void App_PageTick(KeyEvent_t key)
{
    switch (s_page)
    {
    case PAGE_MAIN:
        if (key == KEY1_SHORT) { s_page = PAGE_SET_TH; }       /* 短按进设置 */
        if (key == KEY2_SHORT) { s_page = PAGE_SET_BRIGHT; }
        break;

    case PAGE_SET_TH:
        if (key == KEY1_SHORT && g_threshold < 99U) {          /* 加并封顶 */
            g_threshold++;
            s_dirty = 1;
        }
        if (key == KEY2_SHORT) { s_page = PAGE_MAIN; }         /* 退出，落盘交给 App */
        break;

    case PAGE_SET_BRIGHT:
        if (key == KEY1_SHORT) {
            g_bright = (uint8_t)((g_bright + 10U) % 110U);     /* 10→…→100→0 循环 */
            s_dirty = 1;
        }
        if (key == KEY2_SHORT) { s_page = PAGE_MAIN; }
        break;

    default:
        s_page = PAGE_MAIN;                                    /* 枚举被写坏时的兜底 */
        break;
    }
}

Page_t App_PageGet(void)
{
    return s_page;
}

uint8_t App_PageIsDirty(void)
{
    return s_dirty;
}

void App_PageClearDirty(void)
{
    s_dirty = 0;
}
```

调用点在 `App/app_main.c` 的 `App_Loop()` 里：拿到 `KeyEvent_t` 后调一次 `App_PageTick(key)`，再由显示函数按 `App_PageGet()` 选择画哪一页；发现 `App_PageIsDirty()` 就把新值写进 `g_param` 并 `Param_Save()`。

**为什么用 `switch` + `static`**：每个 `case` 只写"本状态下这个键干什么"，加页面就是加 `case`；`s_page` 加 `static` 是 C 的私有化，别的文件改不到它，只能通过 `App_PageTick` 迁移。**为什么不用一堆 `if`**：见下面的 note；补充一点，`if` 链在页面多时每个条件都要把 `key` 和页码各判一次，改一个页面要动整段。**哪些没写**：`KeyEvent_t`（含短按）由 `Hardware/bsp_key.c` 产生，`Param_Save()` 在 `Hardware/bsp_flash.c`，页面绘制在 `App/app_main.c`，都不属于状态机。

::: note 为什么用状态机而不是一堆 if
`if (page == 0) ... else if (page == 1) ...` 在页面少时能跑，但页面一多：

- 每个按键要在所有 `if` 分支里重复判断；
- 加一个页面要改所有分支；
- 出现"在设置页按了某个键，结果主页也响应了"这种 bug。

状态机的本质是：**每个状态只关心"在这个状态下，某个事件该做什么"**。加页面只是加一个 `case`，互不干扰。这是嵌入式 UI、协议解析、流程控制的通用写法。
:::

---

## 6. 调试顺序：一定按这个顺序来

**不要一次性把所有模块都接上再上电。** 按依赖顺序逐个验证，出错才能定位。

| 阶段 | 做什么 | 通过标准 |
| --- | --- | --- |
| M1 电源与时钟 | 只跑点亮 LED + 串口打印 | 串口能看到 `"boot, sysclk=72MHz"` |
| M2 单个外设 | 逐个验证 OLED、按键、ADC、蜂鸣器 | 每个都有独立的测试函数/命令 |
| M3 数据通路 | ADC → 变量 → 串口打印 | 串口数值随手指温度变化 |
| M4 显示 | 把变量显示到 OLED | 屏幕数值和串口一致 |
| M5 交互 | 按键翻页、改参数 | 不跳页、不卡死 |
| M6 持久化 | 参数存 Flash | 断电重上电参数不变 |
| M7 可靠性 | 加看门狗、长时间运行 | 24 小时不死机 |

::: warn 一次全接上，出问题就是"猜"
现象：屏幕不亮、串口没输出、按键没反应，同时发生。

你根本不知道是电源问题、时钟没配对、还是某个模块把总线拉死了。只能一个个拔了试，效率极低。

**M1 阶段只要"LED 会闪 + 串口能打印"就算过**。这两件事证明了：供电正常、时钟正常、下载正常、串口正常。后面所有问题都可以在这两个"锚点"上二分定位。
:::

### 6.1 每个模块都要有"独立可测"的入口

测试命令放在 `App/app_test.c`，主循环收到一行命令就转给它，和业务逻辑完全分离。

**文件：`App/Inc/app_test.h`**

```c
#ifndef __APP_TEST_H
#define __APP_TEST_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_TestCmd(const char *cmd);

#ifdef __cplusplus
}
#endif

#endif /* __APP_TEST_H */
```

**文件：`App/Src/app_test.c`**

```c
#include "app_test.h"
#include "bsp_oled.h"
#include "bsp_adc.h"
#include "bsp_buzzer.h"
#include "bsp_flash.h"
#include "bsp_uart.h"
#include <string.h>

void App_TestCmd(const char *cmd)
{
    if (strcmp(cmd, "oled") == 0) {
        BSP_OledClear();
        BSP_OledShowStr(0, 0, "OLED OK");
        BSP_OledShowStr(2, 0, "1234567890");
        BSP_OledRefresh();
        BSP_UartPrintf("oled: pattern drawn\r\n");
    } else if (strcmp(cmd, "adc") == 0) {
        BSP_UartPrintf("adc: mv=%u t=%d.%d\r\n",
                       (unsigned)BSP_AdcReadMv(),
                       (int)(BSP_AdcReadTempC10() / 10),
                       (int)(BSP_AdcReadTempC10() % 10));
    } else if (strcmp(cmd, "beep") == 0) {
        BSP_BuzzerBeep(200);
        BSP_UartPrintf("beep: 200ms done\r\n");
    } else if (strcmp(cmd, "flash") == 0) {
        Param_t p;
        Param_Load(&p);
        BSP_UartPrintf("flash: th=%u bright=%u\r\n",
                       (unsigned)p.threshold_c, (unsigned)p.bright_pct);
    } else if (strcmp(cmd, "help") == 0) {
        BSP_UartPrintf("oled adc beep flash help\r\n");
    } else {
        BSP_UartPrintf("bad cmd\r\n");
    }
}
```

调用点：串口接收中断收满一行后，在 `App_Loop()` 里取行并调 `App_TestCmd(line)`。

**为什么用 `strcmp` 不用 `==`**：C 里字符串是地址，`cmd == "oled"` 比的是两个指针，永远不相等，现象是"命令一个都不生效"。**为什么每条命令都走独立分支/函数**：单测时能精确回答"是模块坏了还是集成坏了"；命令是调试期的临时入口，加一条就加一行，删掉也不牵连别人。**哪些没写**：串口收包、行缓冲、环形队列在 `Hardware/bsp_uart.c`；`BSP_OledShowStr` 等是各模块自己的接口；`printf` 没有直接重定向，统一走 `BSP_UartPrintf()`，省掉 `syscalls.c` 那一套。

集成出问题时，先跑单模块测试：**单模块正常 → 问题在集成（资源冲突/时序）；单模块也异常 → 问题在模块本身**。这一步能把排查范围砍一半。

---

## 7. 联调最常见的四个坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 屏幕偶发花屏，传感器偶尔读错 | I2C 被两个任务同时访问 | 加互斥量，或统一在一个任务里访问 |
| 串口打印乱码，重启就好 | 波特率或时钟被 Stop 模式改回 HSI | 唤醒后重配时钟 |
| 跑几分钟就死机 | 栈溢出 / 环形缓冲区越界 | 开 `configCHECK_FOR_STACK_OVERFLOW`，检查数组下标 |
| 按键偶尔连跳两页 | 消抖时间太短 / 没做边沿检测 | 20ms 消抖 + 只在"松开"时计一次 |

::: note 资源冲突的本质：外设是"独占"的
I2C 一次传输由"起始 → 地址 → 数据 → 停止"组成，中间不能被打断。

如果任务 A 发到一半被任务 B 抢占，B 也去发 I2C，两条传输就会交织，从机收到的是垃圾。现象是"单独测都正常，一起跑就偶发失败"。

解法：
1. **互斥量**包住整个传输（推荐）。
2. **单任务访问**：所有 I2C 操作都发消息给一个"I2C 任务"，由它串行执行。
3. 硬件 I2C 有 BUSY 标志，但靠轮询判断不可靠，还是要有软件层的锁。

**"单独正常、一起异常"是并发问题的典型特征**，记住这个信号。
:::

---

## 8. 验收、演示与项目说明

### 8.1 演示脚本（2 分钟，按顺序演）

1. 上电，屏幕显示欢迎页和版本号（证明系统启动）。
2. 手指按住传感器，温度上升，屏幕数值变化（证明采集 + 显示）。
3. 超过阈值，蜂鸣器报警，LED 闪（证明逻辑联动）。
4. 按键进入设置页，改阈值，退出（证明交互 + 状态机）。
5. 断电，重上电，阈值还是刚才改的值（证明持久化）。
6. 打开串口助手，展示数据帧格式（证明通信）。

**每一步都要有一句话说明"这证明了什么"**，而不是默默操作。

### 8.2 项目说明（README）模板

```markdown
# 环境监测小站

## 1. 功能
- 500ms 采集温度，OLED 显示，超阈值报警
- 按键设置阈值/亮度，参数存内部 Flash
- 串口 115200 上报，帧格式：AA 55 LEN DATA CRC16

## 2. 硬件
- STM32F103C8T6 最小系统板
- 0.96" OLED（SSD1306，I2C 0x3C）
- NTC 热敏电阻 + 10k 分压 → PA0
- 有源蜂鸣器（PB5，三极管驱动）
- 两个轻触按键（PB0/PB1，上拉，低电平按下）

## 3. 软件结构
- Core/：CubeMX 初始化 + main.c 主循环 + 中断入口
- Hardware/：每个外设一个 bsp_xxx.c，只暴露 init/read/write
- App/：页面状态机 + 调度 + 调试命令

## 4. 关键设计
- 按键 EXTI 只置标志，主循环消抖后读电平
- 参数 magic + CRC16，防写一半断电
- 看门狗 2s，主循环喂狗
- 串口帧带长度和 CRC16，上位机可校验

## 5. 遇到的问题与解决
- 问题：屏幕偶发花屏，单独测试正常
  定位：合跑异常 → 怀疑 I2C 并发
  解决：所有 I2C 访问收口到一个任务/加互斥量
- 问题：连续运行 4 小时后死机
  定位：栈水位显示某任务只剩 8 字
  解决：栈从 256 加到 512

## 6. 演示步骤
（见上面的演示脚本）
```

::: note 这段"遇到的问题"才是简历和面试的核心
面试官不关心你用了几个外设——那是教程内容。他关心的是：

- 你**遇到过什么真实问题**？
- 你**怎么定位**的（用了什么工具、什么现象让你缩小范围）？
- 你**怎么权衡**的（为什么选这个方案，代价是什么）？

所以从今天开始，**建一个 `debug-log.md`**，每次卡住超过 20 分钟就记一条：现象、怀疑、验证、结论。项目做完，这份日志就是你面试的弹药库。
:::

---

## 9. 动手项目

::: project
**按上面的需求，独立完成"环境监测小站"**

分七个里程碑推进（M1~M7 见第 6 节），**每个里程碑都要能独立演示**，不要等全做完再测。

**验收标准（全部满足才算完成）**：

1. M1~M7 每个阶段都有截图或串口日志留证。
2. 三个功能需求（采集/显示/报警）同时工作，互不阻塞。
3. 按键响应 < 50ms，屏幕刷新 ≥ 5 帧/秒。
4. 断电重上电，阈值和亮度保持不变。
5. 拔掉 OLED 再插上，系统能恢复（或至少不死机）。
6. 连续运行 **2 小时**不死机（有条件就跑 24 小时）。
7. 写出完整的 `README.md`，包含第 8.2 节的全部六部分。
8. 有一份 `debug-log.md`，至少记录 5 个真实问题和定位过程。

**加分项**：

- 用 FreeRTOS 重写调度部分，对比裸机版的响应时间。
- 加 Bootloader，支持串口升级（s20 会讲）。
- 数据存外部 SPI Flash，支持历史曲线回放。

### 9.1 文件放置表

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `main.c` | `Core/Src` | 初始化 + `App_Init()` + `while(1) App_Loop()` |
| `main.h` | `Core/Inc` | 引脚宏、`Error_Handler` 声明 |
| `stm32f1xx_it.c` | `Core/Src` | SysTick、EXTI0/EXTI1 入口 |
| `bsp_key.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | EXTI 标志 + 20ms 消抖 + 键值 |
| `bsp_oled.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | SSD1306 I2C 驱动、5×7 字库、对比度 |
| `bsp_adc.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | ADC1_IN0 采样、mV、温度换算 |
| `bsp_buzzer.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 蜂鸣器开关与定时响 |
| `bsp_flash.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 参数结构、CRC16、读写 |
| `bsp_uart.c` / `.h` | `Hardware/Src`、`Hardware/Inc` | 中断收字节、行缓冲、协议帧发送 |
| `app_page.c` / `.h` | `App/Src`、`App/Inc` | 页面状态机 |
| `app_test.c` / `.h` | `App/Src`、`App/Inc` | 单模块串口测试命令 |
| `iwdg.c` / `iwdg.h` | `Core/Src`、`Core/Inc` | IWDG 2 秒初始化与句柄 |
| `app_main.c` / `.h` | `App/Src`、`App/Inc` | 调度循环、页面绘制、报警、上报 |

CubeMX 生成、**不手写**：`gpio.c`（PA0 模拟输入、PB0/PB1 上拉+EXTI、PB5 推挽、PC13 推挽）、`i2c.c`（I2C1 400kHz）、`adc.c`（ADC1_IN0、12 位、ADC 时钟 12MHz）、`usart.c`（115200-8-N-1、RXNE 中断）、`stm32f1xx_it.c` 里除本课列出的其他向量、`stm32f1xx_hal_msp.c`、`system_stm32f1xx.c`、启动文件、链接脚本、`Drivers/`。

下面按"头文件 → 驱动源文件 → App 源文件 → `main.c`"给出**全部文件**的完整代码。

### 9.2 头文件

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
#define BEEP_Pin        GPIO_PIN_5
#define BEEP_GPIO_Port  GPIOB
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

void       BSP_KeyInit(void);
KeyEvent_t BSP_KeyScan(void);   /* 主循环每 10ms 调一次 */

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

#define OLED_ADDR      0x3CU
#define OLED_WIDTH     128U
#define OLED_PAGES     8U

void BSP_OledInit(void);
void BSP_OledClear(void);
void BSP_OledShowStr(uint8_t page, uint8_t col, const char *s);
void BSP_OledSetContrast(uint8_t contrast);   /* 0~255，映射"亮度"设置 */
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
int16_t  BSP_AdcReadTempC10(void);   /* 温度 ×10 */

#ifdef __cplusplus
}
#endif

#endif /* __BSP_ADC_H */
```

**文件：`Hardware/Inc/bsp_buzzer.h`**

```c
#ifndef __BSP_BUZZER_H
#define __BSP_BUZZER_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void    BSP_BuzzerInit(void);
void    BSP_BuzzerSet(uint8_t on);       /* 1 响，0 停 */
void    BSP_BuzzerBeep(uint16_t ms);     /* 响 ms 毫秒后自动停（阻塞） */
uint8_t BSP_BuzzerIsOn(void);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_BUZZER_H */
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
#define PARAM_MAGIC              0x5A5AA5A5U
#define PARAM_DEFAULT_THRESHOLD  30U
#define PARAM_DEFAULT_BRIGHT     50U

typedef struct {
    uint32_t magic;
    uint8_t  threshold_c;     /* 报警阈值 ℃ */
    uint8_t  bright_pct;      /* 亮度 0~100 */
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

/* 协议帧：AA 55 LEN payload... CRC16(小端)，返回 1 表示已发出 */
uint8_t BSP_UartSendFrame(const uint8_t *payload, uint8_t len);

#ifdef __cplusplus
}
#endif

#endif /* __BSP_UART_H */
```

**文件：`App/Inc/app_main.h`**

```c
#ifndef __APP_MAIN_H
#define __APP_MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"
#include "bsp_flash.h"

extern Param_t g_param;

void App_Init(void);
void App_Loop(void);   /* 主循环每 10ms 调一次 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_MAIN_H */
```

**文件：`App/Inc/app_page.h`**

```c
#ifndef __APP_PAGE_H
#define __APP_PAGE_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"
#include "bsp_key.h"

typedef enum {
    PAGE_MAIN = 0,
    PAGE_SET_TH,
    PAGE_SET_BRIGHT,
    PAGE_MAX
} Page_t;

extern uint8_t g_threshold;
extern uint8_t g_bright;

void    App_PageInit(uint8_t threshold_c, uint8_t bright_pct);
void    App_PageTick(KeyEvent_t key);
Page_t  App_PageGet(void);
uint8_t App_PageIsDirty(void);
void    App_PageClearDirty(void);

#ifdef __cplusplus
}
#endif

#endif /* __APP_PAGE_H */
```

**文件：`App/Inc/app_test.h`**

```c
#ifndef __APP_TEST_H
#define __APP_TEST_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_TestCmd(const char *cmd);

#ifdef __cplusplus
}
#endif

#endif /* __APP_TEST_H */
```

### 9.3 驱动源文件

**文件：`Hardware/Src/bsp_key.c`**

```c
#include "bsp_key.h"

static volatile uint8_t s_exti_flag;

/* EXTI 只负责"有键按了"，具体是哪个键、算不算数，在主循环里判断 */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    if (pin == KEY1_Pin || pin == KEY2_Pin) {
        s_exti_flag = 1;
    }
}

void BSP_KeyInit(void)
{
    s_exti_flag = 0;
}

KeyEvent_t BSP_KeyScan(void)
{
    if (s_exti_flag == 0U) {
        return KEY_NONE;
    }
    s_exti_flag = 0;

    HAL_Delay(20);      /* 等电平稳定（一次 20ms 足够轻触按键） */

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
    static const uint8_t slash[5] = {0x20,0x10,0x08,0x04,0x02};

    if (c >= '0' && c <= '9') { return FONT_DIGIT[c - '0']; }
    if (c >= 'A' && c <= 'Z') { return FONT_UPPER[c - 'A']; }
    if (c >= 'a' && c <= 'z') { return FONT_UPPER[c - 'a']; }
    switch (c) {
    case '-': return minus;
    case '.': return dot;
    case ':': return colon;
    case '=': return equal;
    case '/': return slash;
    default:  return FONT_BLANK;
    }
}

static void OledCmd(uint8_t cmd)
{
    uint8_t b[2] = {0x00, cmd};
    (void)HAL_I2C_Master_Transmit(&hi2c1, (uint16_t)(OLED_ADDR << 1), b, 2U, 50U);
}

static void OledData(const uint8_t *d, uint16_t n)
{
    uint8_t tmp[OLED_WIDTH + 1U];
    if (n > OLED_WIDTH) {
        return;
    }
    tmp[0] = 0x40;
    memcpy(&tmp[1], d, n);
    (void)HAL_I2C_Master_Transmit(&hi2c1, (uint16_t)(OLED_ADDR << 1), tmp, (uint16_t)(n + 1U), 100U);
}

void BSP_OledInit(void)
{
    static const uint8_t cmds[] = {
        0xAE, 0x20, 0x02, 0xB0, 0xC8, 0x00, 0x10, 0x40,
        0x81, 0x7F, 0xA1, 0xA6, 0xA8, 0x3F, 0xA4, 0xD3,
        0x00, 0xD5, 0x80, 0xD9, 0xF1, 0xDA, 0x12, 0xDB,
        0x40, 0x8D, 0x14, 0xAF
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
        s_buf[page][col + 5U] = 0x00;
        col = (uint8_t)(col + 6U);
    }
}

void BSP_OledSetContrast(uint8_t contrast)
{
    OledCmd(0x81);
    OledCmd(contrast);
}

void BSP_OledRefresh(void)
{
    for (uint8_t p = 0; p < OLED_PAGES; p++) {
        OledCmd((uint8_t)(0xB0U + p));
        OledCmd(0x00);
        OledCmd(0x10);
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
    /* 简化线性：25℃ ≈ 1650mV，约 4.4mV/℃。真实 NTC 用查表或 Steinhart-Hart */
    int32_t mv  = (int32_t)BSP_AdcReadMv();
    int32_t t10 = 250 + ((1650 - mv) * 100) / 44;
    return (int16_t)t10;
}
```

**文件：`Hardware/Src/bsp_buzzer.c`**

```c
#include "bsp_buzzer.h"

static uint8_t s_on;

void BSP_BuzzerInit(void)
{
    s_on = 0;
    BSP_BuzzerSet(0);
}

void BSP_BuzzerSet(uint8_t on)
{
    s_on = on ? 1U : 0U;
    /* 高电平点亮三极管基极；如果你的板子是低电平驱动，把 SET/RESET 对调 */
    HAL_GPIO_WritePin(BEEP_GPIO_Port, BEEP_Pin, s_on ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

void BSP_BuzzerBeep(uint16_t ms)
{
    BSP_BuzzerSet(1);
    HAL_Delay(ms);
    BSP_BuzzerSet(0);
}

uint8_t BSP_BuzzerIsOn(void)
{
    return s_on;
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
    p->magic       = PARAM_MAGIC;
    p->threshold_c = PARAM_DEFAULT_THRESHOLD;
    p->bright_pct  = PARAM_DEFAULT_BRIGHT;
    p->crc         = Crc16((const uint8_t *)p, offsetof(Param_t, crc));
}

void Param_Load(Param_t *p)
{
    memcpy(p, (const void *)PARAM_ADDR, sizeof(Param_t));

    if (p->magic != PARAM_MAGIC ||
        p->crc != Crc16((const uint8_t *)p, offsetof(Param_t, crc)) ||
        p->bright_pct > 100U) {
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

**文件：`Hardware/Src/bsp_uart.c`**

```c
#include "bsp_uart.h"
#include "usart.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define RX_RING_SIZE   128U
#define LINE_MAX       64U
#define FRAME_MAX      64U

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

/* 帧：AA 55 LEN PAYLOAD... CRC16(覆盖 LEN + PAYLOAD，小端) */
uint8_t BSP_UartSendFrame(const uint8_t *payload, uint8_t len)
{
    uint8_t frame[3U + FRAME_MAX + 2U];
    uint16_t crc;

    if (len > FRAME_MAX) {
        return 0;
    }

    frame[0] = 0xAA;
    frame[1] = 0x55;
    frame[2] = len;
    memcpy(&frame[3], payload, len);

    crc = 0xFFFFU;
    for (uint16_t i = 2U; i < (uint16_t)(3U + len); i++) {
        crc ^= (uint16_t)frame[i] << 8;
        for (uint8_t b = 0; b < 8U; b++) {
            crc = (crc & 0x8000U) ? (uint16_t)((crc << 1) ^ 0x1021U)
                                  : (uint16_t)(crc << 1);
        }
    }

    frame[3U + len] = (uint8_t)(crc & 0xFFU);
    frame[4U + len] = (uint8_t)(crc >> 8);

    return (HAL_UART_Transmit(&huart1, frame, (uint16_t)(len + 5U), 100U) == HAL_OK) ? 1U : 0U;
}
```

**文件：`Core/Src/iwdg.c`**

```c
#include "iwdg.h"

IWDG_HandleTypeDef hiwdg;

void MX_IWDG_Init(void)
{
  hiwdg.Instance = IWDG;
  hiwdg.Init.Prescaler = IWDG_PRESCALER_64;   /* 625Hz */
  hiwdg.Init.Reload = 1250;                   /* 2 秒 */
  if (HAL_IWDG_Init(&hiwdg) != HAL_OK)
  {
    Error_Handler();
  }
}
```

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

### 9.4 App 源文件

**文件：`App/Src/app_page.c`**

```c
#include "app_page.h"

static Page_t  s_page = PAGE_MAIN;
static uint8_t s_dirty;

uint8_t g_threshold = 30;
uint8_t g_bright    = 50;

void App_PageInit(uint8_t threshold_c, uint8_t bright_pct)
{
    s_page      = PAGE_MAIN;
    s_dirty     = 0;
    g_threshold = threshold_c;
    g_bright    = (bright_pct <= 100U) ? bright_pct : 50U;
}

void App_PageTick(KeyEvent_t key)
{
    switch (s_page)
    {
    case PAGE_MAIN:
        if (key == KEY1_SHORT) { s_page = PAGE_SET_TH; }
        if (key == KEY2_SHORT) { s_page = PAGE_SET_BRIGHT; }
        break;

    case PAGE_SET_TH:
        if (key == KEY1_SHORT && g_threshold < 99U) {
            g_threshold++;
            s_dirty = 1;
        }
        if (key == KEY2_SHORT) { s_page = PAGE_MAIN; }
        break;

    case PAGE_SET_BRIGHT:
        if (key == KEY1_SHORT) {
            g_bright = (uint8_t)((g_bright + 10U) % 110U);
            s_dirty = 1;
        }
        if (key == KEY2_SHORT) { s_page = PAGE_MAIN; }
        break;

    default:
        s_page = PAGE_MAIN;
        break;
    }
}

Page_t App_PageGet(void)
{
    return s_page;
}

uint8_t App_PageIsDirty(void)
{
    return s_dirty;
}

void App_PageClearDirty(void)
{
    s_dirty = 0;
}
```

**文件：`App/Src/app_test.c`**

```c
#include "app_test.h"
#include "bsp_oled.h"
#include "bsp_adc.h"
#include "bsp_buzzer.h"
#include "bsp_flash.h"
#include "bsp_uart.h"
#include <string.h>

void App_TestCmd(const char *cmd)
{
    if (strcmp(cmd, "oled") == 0) {
        BSP_OledClear();
        BSP_OledShowStr(0, 0, "OLED OK");
        BSP_OledShowStr(2, 0, "1234567890");
        BSP_OledRefresh();
        BSP_UartPrintf("oled: pattern drawn\r\n");
    } else if (strcmp(cmd, "adc") == 0) {
        BSP_UartPrintf("adc: mv=%u t=%d.%d\r\n",
                       (unsigned)BSP_AdcReadMv(),
                       (int)(BSP_AdcReadTempC10() / 10),
                       (int)(BSP_AdcReadTempC10() % 10));
    } else if (strcmp(cmd, "beep") == 0) {
        BSP_BuzzerBeep(200);
        BSP_UartPrintf("beep: 200ms done\r\n");
    } else if (strcmp(cmd, "flash") == 0) {
        Param_t p;
        Param_Load(&p);
        BSP_UartPrintf("flash: th=%u bright=%u\r\n",
                       (unsigned)p.threshold_c, (unsigned)p.bright_pct);
    } else if (strcmp(cmd, "help") == 0) {
        BSP_UartPrintf("oled adc beep flash help\r\n");
    } else {
        BSP_UartPrintf("bad cmd\r\n");
    }
}
```

**文件：`App/Src/app_main.c`**

```c
#include "app_main.h"
#include "app_page.h"
#include "app_test.h"
#include "bsp_key.h"
#include "bsp_oled.h"
#include "bsp_adc.h"
#include "bsp_buzzer.h"
#include "bsp_flash.h"
#include "bsp_uart.h"
#include "iwdg.h"
#include <stdio.h>

Param_t g_param;

static int16_t  s_temp_c10;
static uint32_t s_boot_ms;
static uint32_t s_last_measure_ms;
static uint32_t s_last_render_ms;
static uint32_t s_last_report_ms;

static void Measure(void)
{
    if ((HAL_GetTick() - s_last_measure_ms) < 500U) {
        return;
    }
    s_last_measure_ms = HAL_GetTick();
    s_temp_c10 = BSP_AdcReadTempC10();
}

static void Alarm(void)
{
    uint8_t over = (s_temp_c10 >= (int16_t)(g_threshold * 10U)) ? 1U : 0U;
    BSP_BuzzerSet(over);
    /* 板载 LED 低电平亮 */
    HAL_GPIO_WritePin(LED_GPIO_Port, LED_Pin, over ? GPIO_PIN_RESET : GPIO_PIN_SET);
}

static void SaveIfDirty(void)
{
    if (App_PageIsDirty() == 0U) {
        return;
    }
    g_param.threshold_c = g_threshold;
    g_param.bright_pct  = g_bright;
    Param_Save(&g_param);
    BSP_OledSetContrast((uint8_t)((uint16_t)g_bright * 255U / 100U));
    App_PageClearDirty();
    BSP_UartPrintf("param saved: th=%u bright=%u\r\n",
                   (unsigned)g_param.threshold_c, (unsigned)g_param.bright_pct);
}

static void DrawMain(void)
{
    char buf[20];
    int16_t t = s_temp_c10;
    uint8_t frac = (uint8_t)(((t < 0) ? -t : t) % 10);

    BSP_OledClear();
    (void)snprintf(buf, sizeof(buf), "TEMP: %d.%dC", (int)(t / 10), (int)frac);
    BSP_OledShowStr(0, 0, buf);
    (void)snprintf(buf, sizeof(buf), "TH: %uC", (unsigned)g_threshold);
    BSP_OledShowStr(2, 0, buf);
    (void)snprintf(buf, sizeof(buf), "UP: %luS", (unsigned long)((HAL_GetTick() - s_boot_ms) / 1000U));
    BSP_OledShowStr(4, 0, buf);
    BSP_OledShowStr(6, 0, "K1:SET K2:BRIGHT");
    BSP_OledRefresh();
}

static void DrawSetTh(void)
{
    char buf[20];
    BSP_OledClear();
    BSP_OledShowStr(0, 0, "SET THRESHOLD");
    (void)snprintf(buf, sizeof(buf), "TH: %uC", (unsigned)g_threshold);
    BSP_OledShowStr(2, 0, buf);
    BSP_OledShowStr(4, 0, "K1:+  K2:OK");
    BSP_OledRefresh();
}

static void DrawSetBright(void)
{
    char buf[20];
    BSP_OledClear();
    BSP_OledShowStr(0, 0, "SET BRIGHT");
    (void)snprintf(buf, sizeof(buf), "BRIGHT: %u%%", (unsigned)g_bright);
    BSP_OledShowStr(2, 0, buf);
    BSP_OledShowStr(4, 0, "K1:+  K2:OK");
    BSP_OledRefresh();
}

static void Render(void)
{
    static Page_t  last_page = PAGE_MAX;
    static int16_t last_temp = 0x7FFF;
    Page_t  page = App_PageGet();
    uint32_t now = HAL_GetTick();

    if (page == PAGE_MAIN) {
        if (page != last_page || s_temp_c10 != last_temp ||
            (now - s_last_render_ms) >= 1000U) {
            DrawMain();
            s_last_render_ms = now;
            last_temp = s_temp_c10;
            last_page = page;
        }
    } else if (page != last_page || (now - s_last_render_ms) >= 200U) {
        if (page == PAGE_SET_TH) {
            DrawSetTh();
        } else if (page == PAGE_SET_BRIGHT) {
            DrawSetBright();
        }
        s_last_render_ms = now;
        last_page = page;
    }
}

static void Report(void)
{
    uint8_t payload[6];
    uint32_t up;

    if ((HAL_GetTick() - s_last_report_ms) < 1000U) {
        return;
    }
    s_last_report_ms = HAL_GetTick();

    up = (HAL_GetTick() - s_boot_ms) / 1000U;
    payload[0] = (uint8_t)((uint16_t)s_temp_c10 >> 8);
    payload[1] = (uint8_t)((uint16_t)s_temp_c10 & 0xFFU);
    payload[2] = g_param.threshold_c;
    payload[3] = g_param.bright_pct;
    payload[4] = (uint8_t)(up >> 8);
    payload[5] = (uint8_t)(up & 0xFFU);

    (void)BSP_UartSendFrame(payload, sizeof(payload));
}

void App_Init(void)
{
    BSP_KeyInit();
    BSP_OledInit();
    BSP_AdcInit();
    BSP_BuzzerInit();
    BSP_UartInit();

    Param_Load(&g_param);
    App_PageInit(g_param.threshold_c, g_param.bright_pct);
    BSP_OledSetContrast((uint8_t)((uint16_t)g_bright * 255U / 100U));

    s_boot_ms = HAL_GetTick();
    s_last_measure_ms = s_boot_ms;
    s_last_render_ms  = s_boot_ms;
    s_last_report_ms  = s_boot_ms;

    BSP_UartPrintf("boot, sysclk=72MHz\r\n");
    BSP_OledClear();
    BSP_OledShowStr(0, 0, "ENV STATION");
    BSP_OledShowStr(2, 0, "V1.0");
    BSP_OledShowStr(4, 0, "INIT OK");
    BSP_OledRefresh();
    HAL_Delay(300);
}

void App_Loop(void)
{
    char line[64];
    KeyEvent_t key;

    /* 1. 按键：EXTI 已置标志，这里消抖并取事件 */
    key = BSP_KeyScan();
    if (key != KEY_NONE) {
        App_PageTick(key);
    }

    /* 2. 调试命令行（M2~M6 阶段靠它单测模块） */
    if (BSP_UartReadLine(line, sizeof(line)) != 0U) {
        App_TestCmd(line);
    }

    /* 3. 周期任务 */
    Measure();
    Alarm();
    SaveIfDirty();
    Render();
    Report();

    /* 4. 所有关键动作都走完了，喂狗。s16 的"任务标志"写法更严谨 */
    HAL_IWDG_Refresh(&hiwdg);
}
```

### 9.5 main.c 与中断入口

**文件：`Core/Src/main.c`**

```c
#include "main.h"
#include "gpio.h"
#include "i2c.h"
#include "adc.h"
#include "usart.h"
#include "iwdg.h"
#include "app_main.h"

void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();             /* 含 PB0/PB1 的 EXTI0/1、PB5、PC13 */
  MX_I2C1_Init();             /* PB6/PB7，400kHz */
  MX_ADC1_Init();             /* PA0，12 位 */
  MX_USART1_UART_Init();      /* PA9/PA10，115200，开 RXNE 中断 */
  MX_IWDG_Init();             /* 2 秒 */

  App_Init();
  HAL_IWDG_Refresh(&hiwdg);

  while (1)
  {
    App_Loop();
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

**文件：`Core/Src/stm32f1xx_it.c`**

```c
#include "main.h"
#include "stm32f1xx_it.h"

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
  HAL_IncTick();          /* 裸机工程：SysTick 就是 HAL 的 1ms 时基 */
}

void EXTI0_IRQHandler(void)
{
  HAL_GPIO_EXTI_IRQHandler(KEY1_Pin);   /* 内部会调用 HAL_GPIO_EXTI_Callback */
}

void EXTI1_IRQHandler(void)
{
  HAL_GPIO_EXTI_IRQHandler(KEY2_Pin);
}
```

### 9.6 为什么这么拆 / 没写的是什么

**为什么 `main.c` 只有二十行有效代码**：`main` 是"上电说明书"，顺序固定、不该有业务。`App_Init()` 把外设和参数准备好，`App_Loop()` 每次只跑一圈非阻塞检查，任何模块出问题都能靠 `App_TestCmd()` 单独定位。

**为什么按键走 EXTI 却还要在主循环读电平**：EXTI 只负责把 CPU 从"没事干"里叫醒并置标志；真判断按没按、是不是抖动，要等 20ms 后读稳定电平。若直接在中断里翻页，抖动会让一次按下跳两页（第 7 节表格里的典型现象）。

**为什么参数改动不立即写 Flash**：页擦除要几十毫秒且磨损有限，按键连加时每按一次都写会把页写坏。所以 `app_page.c` 只置 `dirty`，`App_Loop()` 每圈检查一次——真被连续按也只写最后一次。

**为什么用 CRC16 + magic 而不是只存结构体**：写一半断电时 magic 可能已经写进去了，只有覆盖整段数据的 CRC 才能发现"半成品"，读出来回退默认值。

**哪些没写、默认值是多少**：`gpio.c` 里 PB0/PB1 是上拉输入 + 下降沿 EXTI、NVIC 优先级 4；`i2c.c` 是 400kHz、7 位地址；`adc.c` 是 ADC1_IN0、12 位、采样时间 55.5 周期、ADC 时钟 12MHz（由 `HAL_RCCEx_PeriphCLKConfig` 配 6 分频）；`usart.c` 是 115200-8-N-1 并开启 RXNE 中断；`system_stm32f1xx.c` 决定 `SystemInit` 的时钟和 `VECT_TAB_OFFSET`（本课为 0）。这些默认值任一配错，现象分别是：按键没反应、OLED 无应答、温度跳变、串口乱码。启动文件、链接脚本、`Drivers/` 全部由 CubeMX 生成，不要手改。
:::

---

## 10. 本课小结

- 项目能力 = **需求拆解 + 分层 + 调试顺序 + 验收标准**，不是"会几个外设"。
- 先写**功能需求 + 非功能需求**，非功能需求才是面试里的"难点"。
- 画**系统框图**能提前发现总线共享；填**引脚分配表**能提前发现引脚冲突。
- 代码分层：`Core / Hardware / App`，**上层调下层接口，下层不知道上层**。
- 页面/流程用**状态机**，别用一堆 `if` 堆。
- 调试按 **M1 电源时钟 → M2 单外设 → … → M7 可靠性**，每个模块要有独立测试入口。
- "单独正常、一起异常" = **并发/资源冲突**，用互斥量或单任务访问解决。
- 项目说明里最值钱的是**"遇到的问题 + 怎么定位 + 怎么取舍"**，从第一天就记 `debug-log.md`。

::: selfcheck 自检
- [ ] 我能把一个模糊想法拆成 5~6 条可验收的功能需求
- [ ] 我能说出至少两条非功能需求及其影响
- [ ] 我能在动手前画出系统框图和引脚分配表
- [ ] 我能解释 Core/Hardware/App 三层各放什么
- [ ] 我能用状态机写出页面切换
- [ ] 我能说出 M1 阶段为什么只要"LED + 串口"
- [ ] 我能识别"单独正常、一起异常"是并发问题
- [ ] 我能按模板写出项目 README 和 debug-log
:::

---

## 11. 下一课预告

项目做完了，接下来要把它**讲出去**——简历上写什么、面试怎么答、被追问时怎么不慌。

下一课 `s19 面试专题`：把 18 节课的知识压缩成"高频问题 + 答题框架 + 项目讲述模板"。



