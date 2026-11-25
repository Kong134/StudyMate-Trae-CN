---
node: s14
title: SPI 总线：四种模式与外设选型
type: practice
duration: 70
---

## 这一课要解决的问题

::: goal
读完你能：说清 SPI 四根线各干什么、为什么它能全双工；根据 CPOL/CPHA 判断设备该用模式 0/1/2/3；用 SPI 读 W25Q64 的 ID、擦除扇区、写读数据；说清 I2C 和 SPI 各自适合什么场合。
:::

上一课 I2C 用两根线换来了"多设备"，代价是慢。SPI 反过来：**多用两根线，换速度**。

---

## 1. 四根线，各管一件事

| 线 | 全称 | 方向 | 作用 |
| --- | --- | --- | --- |
| **SCK** | Serial Clock | 主机 → 从机 | 时钟，所有数据都踩着它走 |
| **MOSI** | Master Out Slave In | 主机 → 从机 | 主机发、从机收 |
| **MISO** | Master In Slave Out | 从机 → 主机 | 从机发、主机收 |
| **CS/NSS** | Chip Select | 主机 → 从机 | 片选，**低电平有效**，拉低谁就选谁 |

和 I2C 最大的区别：

1. **没有地址**。靠 CS 一根线一根线地选，所以每多一个从机就多一根 CS（N 个从机 = 3 + N 根线）。
2. **全双工**。MOSI 和 MISO 是两根独立的线，发的同时就能收。
3. **推挽输出**。SPI 不需要线与，所以可以是推挽，速度快得多（常见 10~50MHz）。

::: note 全双工是怎么做到的：两个移位寄存器转圈
SPI 的内部模型特别简单：主机和从机各有一个 8 位**移位寄存器**，首尾通过 MOSI/MISO 连成一个环。

- 主机把自己寄存器的**最高位**从 MOSI 推出去，从机从 MOSI 收进来放到自己最低位；
- 同时从机把最高位从 MISO 推出去，主机收进来；
- 一个时钟沿，两边各移一位。

**8 个时钟后，两个寄存器的内容正好交换完毕**。

所以 SPI 的"发"和"收"是同一个动作。你想读一个字节，就必须发一个字节（发什么无所谓，通常是 0xFF 或 0x00），这叫"**dummy byte**"。这一点是新手最大的困惑来源：**"我只想读，为什么函数叫 TransmitReceive？"**
:::

---

## 2. 四种模式：CPOL 和 CPHA

SPI 没有统一标准，每个芯片对"时钟空闲是高还是低""在哪个沿采样"的约定可能不同。这两个约定就是：

- **CPOL**（Clock Polarity）：空闲时 SCK 是高还是低。0 = 低，1 = 高。
- **CPHA**（Clock Phase）：在第几个边沿采样。0 = 第一个边沿，1 = 第二个边沿。

组合起来就是四种模式：

| 模式 | CPOL | CPHA | 空闲电平 | 采样沿 | 常见芯片 |
| --- | --- | --- | --- | --- | --- |
| **Mode 0** | 0 | 0 | 低 | 上升沿 | W25Q64、多数 Flash、nRF24L01 |
| **Mode 1** | 0 | 1 | 低 | 下降沿 | 部分传感器 |
| **Mode 2** | 1 | 0 | 高 | 下降沿 | 少 |
| **Mode 3** | 1 | 1 | 高 | 上升沿 | 部分 AD 芯片、SD 卡 |

<svg class="diagram" viewBox="0 0 860 260" xmlns="http://www.w3.org/2000/svg">
  <text class="label" x="16" y="26" font-size="11.5">Mode 0（CPOL=0, CPHA=0）：空闲低，第 1 个沿（上升）采样</text>
  <path d="M 60 76 L 60 52 L 100 52 L 100 76 L 140 76 L 140 52 L 180 52 L 180 76 L 220 76 L 220 52 L 260 52 L 260 76 L 300 76 L 300 52 L 340 52 L 340 76 L 380 76 L 380 52 L 420 52 L 420 76 L 460 76 L 460 52 L 500 52 L 500 76 L 540 76 L 540 52 L 580 52 L 580 76"
        stroke="#2c6fbb" stroke-width="2" fill="none"/>
  <text class="sub" x="60" y="96" font-size="9.5">采样点：每个上升沿</text>

  <text class="label" x="16" y="150" font-size="11.5">Mode 3（CPOL=1, CPHA=1）：空闲高，第 2 个沿（上升）采样</text>
  <path d="M 60 206 L 60 182 L 100 182 L 100 206 L 140 206 L 140 182 L 180 182 L 180 206 L 220 206 L 220 182 L 260 182 L 260 206 L 300 206 L 300 182 L 340 182 L 340 206 L 380 206 L 380 182 L 420 182 L 420 206 L 460 206 L 460 182 L 500 182 L 500 206 L 540 206 L 540 182 L 580 182 L 580 206"
        stroke="#c0392b" stroke-width="2" fill="none"/>
  <text class="sub" x="60" y="226" font-size="9.5">空闲高：第一个沿是下降（改数据），第二个沿是上升（采样）</text>
</svg>

::: note 记不住四种模式？记住两句话
1. **CPOL 决定"空闲在哪"**：0 空闲低，1 空闲高。
2. **CPHA 决定"第几个沿采样"**：0 第一个，1 第二个。

采样沿的对侧沿就是"改数据"的沿。所以：

- Mode 0：空闲低，上升沿采样（下降沿改数据）
- Mode 3：空闲高，上升沿采样（下降沿改数据）

**Mode 0 和 Mode 3 的采样沿都是上升沿，只差空闲电平**，实际波形只在"两次传输之间的空隙"不同。很多芯片同时兼容 0 和 3。

**配错的判断方法**：拿逻辑分析仪看 MISO 上的数据，如果每个 bit 都**错位一位**（读回的值是真实值左移或右移一位），就是 CPHA 反了；如果数据整体是 0x00/0xFF，多半是 CPOL 反了或根本没通信。
:::

::: warn SPI 配错的典型现象
| 现象 | 最可能的原因 |
| --- | --- |
| 读回全是 **0xFF** | MISO 没人驱动（CS 没拉低、从机没供电、模式完全不对） |
| 读回全是 **0x00** | MISO 被拉低（接线短路、从机没上电） |
| 数据错位一位、值差 2 倍或一半 | **CPHA 反了** |
| 时好时坏，跑一会儿就错 | SCK 太快 / 杜邦线太长 / 没共地 |
| 只有第一个字节对，后面全错 | **CS 中途被拉高**，或两次 `HAL_SPI_Transmit` 之间被别的代码插入 |
| 完全没波形 | SPI 时钟没使能、引脚没配成复用、CS 接错引脚 |
:::

---

## 3. W25Q64：SPI 的"Hello World"

W25Q64 是一颗 **8MB（64Mbit）** 的 SPI Flash，价格便宜、引脚少，几乎每块开发板都带。它的操作流程能覆盖 SPI 的所有要点。

### 3.1 常用命令

| 命令 | 码 | 作用 |
| --- | --- | --- |
| JEDEC ID | **0x9F** | 读厂商+容量，应返回 `EF 40 17` |
| 写使能 | **0x06** | 擦/写之前必须先发 |
| 读状态 | **0x05** | bit0 = BUSY，bit1 = WEL |
| 读数据 | **0x03** | 后跟 24 位地址，然后连续读 |
| 页编程 | **0x02** | 后跟 24 位地址 + 最多 256 字节 |
| 扇区擦除 | **0x20** | 后跟 24 位地址，擦 4KB |
| 块擦除 | 0xD8 | 擦 64KB |
| 整片擦除 | 0xC7 | 擦全部（很慢） |

### 3.2 三条铁律

1. **写/擦之前必须发 0x06（写使能）**，否则芯片直接忽略命令。
2. **擦除最小单位是扇区 4KB**，不能擦一个字节。要改一个字节，得读出整个扇区 → 改 → 擦 → 写回。
3. **每次写/擦后芯片要"忙"一段时间**（页写约 0.7ms、扇区擦约 45ms），期间只响应读状态，其他命令全忽略。必须轮询 BUSY 位。

::: warn 不做这三步会看到什么
- **忘发 0x06**：写入看起来"成功"（函数返回 OK），读回来还是 0xFF。因为芯片默默拒绝了。
- **忘等 BUSY**：连续写两个扇区，第二个丢失；或者读到的数据是旧的。
- **直接覆盖写**：Flash 只能把 1 写成 0，不能把 0 写回 1。不擦除就写，结果是"新旧数据按位与"，读出来是乱码。

**Flash 的本质：擦除 = 全部置 1（0xFF），写入 = 把某些位清零。** 这是它和 RAM/EEPROM 最根本的区别。
:::

### 3.3 HAL 代码：读 ID

完整驱动放两个文件：`Hardware/Inc/w25q64.h` 声明接口，`Hardware/Src/w25q64.c` 实现所有命令（读 ID、读数据、擦除、页写，下面 3.4 节讲的就是这四个函数为什么这么写）：

**文件：`Hardware/Inc/w25q64.h`**
```c
#ifndef __W25Q64_H
#define __W25Q64_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define W25Q64_PAGE_SIZE     256U        /* 页编程一次最多 256 字节 */
#define W25Q64_SECTOR_SIZE   4096U       /* 擦除最小单位 4KB */
#define W25Q64_JEDEC_ID      0xEF4017U   /* EF = Winbond，40 = 64Mbit，17 = 系列 */

uint32_t W25Q_ReadID(void);
void     W25Q_Read(uint32_t addr, uint8_t *buf, uint16_t len);
void     W25Q_SectorErase(uint32_t addr);                    /* addr 需 4KB 对齐 */
void     W25Q_PageProgram(uint32_t addr, const uint8_t *buf, uint16_t len);

#ifdef __cplusplus
}
#endif

#endif /* __W25Q64_H */
```

**文件：`Hardware/Src/w25q64.c`**
```c
#include "w25q64.h"
#include "spi.h"          /* hspi1 在这里 extern 声明 */

#define W25Q_CS_PORT   GPIOA
#define W25Q_CS_PIN    GPIO_PIN_4      /* PA4 软件片选：CubeMX 配 Output，初始 High */
#define CS_LOW()       HAL_GPIO_WritePin(W25Q_CS_PORT, W25Q_CS_PIN, GPIO_PIN_RESET)
#define CS_HIGH()      HAL_GPIO_WritePin(W25Q_CS_PORT, W25Q_CS_PIN, GPIO_PIN_SET)

/* 事务内发送/接收：超时 100ms，8MHz 下 4 字节约 4μs，余量极大 */
static void W25Q_Send(const uint8_t *buf, uint16_t len)
{
    HAL_SPI_Transmit(&hspi1, (uint8_t *)buf, len, 100);
}

static void W25Q_Recv(uint8_t *buf, uint16_t len)
{
    HAL_SPI_Receive(&hspi1, buf, len, 100);
}

/* 写使能必须单独一个事务：WEL 位要对"下一个命令"生效 */
static void W25Q_WriteEnable(void)
{
    uint8_t cmd = 0x06;
    CS_LOW();
    W25Q_Send(&cmd, 1);
    CS_HIGH();
}

/* 读状态寄存器：bit0 = BUSY，bit1 = WEL */
static uint8_t W25Q_ReadStatus(void)
{
    uint8_t cmd = 0x05, sr = 0;
    CS_LOW();
    W25Q_Send(&cmd, 1);
    W25Q_Recv(&sr, 1);
    CS_HIGH();
    return sr;
}

uint32_t W25Q_ReadID(void)
{
    uint8_t cmd = 0x9F;               /* JEDEC ID 命令 */
    uint8_t id[3] = {0};

    CS_LOW();                         /* 整个事务期间片选不能放开 */
    W25Q_Send(&cmd, 1);
    W25Q_Recv(id, 3);                 /* 厂商 + 容量 + 系列 */
    CS_HIGH();

    return ((uint32_t)id[0] << 16) | ((uint32_t)id[1] << 8) | id[2];
}

void W25Q_Read(uint32_t addr, uint8_t *buf, uint16_t len)
{
    uint8_t cmd[4];
    cmd[0] = 0x03;                    /* 读数据 */
    cmd[1] = (uint8_t)(addr >> 16);   /* 24 位地址，高字节先发 */
    cmd[2] = (uint8_t)(addr >> 8);
    cmd[3] = (uint8_t)addr;

    CS_LOW();
    W25Q_Send(cmd, 4);
    W25Q_Recv(buf, len);
    CS_HIGH();
}

void W25Q_SectorErase(uint32_t addr)
{
    uint8_t cmd[4];
    W25Q_WriteEnable();

    cmd[0] = 0x20;                    /* 扇区擦除，4KB */
    cmd[1] = (uint8_t)(addr >> 16);
    cmd[2] = (uint8_t)(addr >> 8);
    cmd[3] = (uint8_t)addr;
    CS_LOW();
    W25Q_Send(cmd, 4);
    CS_HIGH();

    while (W25Q_ReadStatus() & 0x01U) { }   /* 轮询 BUSY，典型 45ms */
}

void W25Q_PageProgram(uint32_t addr, const uint8_t *buf, uint16_t len)
{
    uint8_t cmd[4];
    if (len == 0U || len > W25Q64_PAGE_SIZE) return;   /* 跨页会回卷覆盖 */

    W25Q_WriteEnable();

    cmd[0] = 0x02;                    /* 页编程 */
    cmd[1] = (uint8_t)(addr >> 16);
    cmd[2] = (uint8_t)(addr >> 8);
    cmd[3] = (uint8_t)addr;
    CS_LOW();
    W25Q_Send(cmd, 4);
    W25Q_Send(buf, len);
    CS_HIGH();

    while (W25Q_ReadStatus() & 0x01U) { }   /* 轮询 BUSY，典型 0.7ms */
}
```

正常返回 `0xEF4017`（EF = Winbond，40 = 容量 64Mbit，17 = 系列）。

::: note 为什么是这几句
- `CS_LOW()` 到 `CS_HIGH()` 之间**必须一次做完**：W25Q64 把"命令 + 后续数据"当成一个事务，中途放开 CS 会直接终止，命令作废。现象是**只有第一个字节对、后面全错**。
- 超时 `100` 是毫秒。8MHz 下 4 个字节不到 5μs，给 100ms 已经非常宽松；写太小（比如 1）会在调试器暂停后误超时。
- 先 `Transmit` 再 `Receive` 是为了让代码看起来像"发完再收"，但两次调用之间有几微秒空隙。9MHz 以下 W25Q64 能忍；再快就得换成 `HAL_SPI_TransmitReceive` 一次收发，否则会**偶发错位**。
- 组 ID 时先转 `uint32_t` 再左移：`id[0]` 是 `uint8_t`，不转的话 `id[0] << 16` 直接把 8 位数据移出变量范围，结果是 0，现象是**读回 `0x000017`**。
:::

::: note 为什么不干脆用寄存器操作 CS
可以直接写 `GPIOA->BSRR`，快几个周期，但可读性差、换引脚要改两处。读 ID 这种"一次几个字节"的场合，HAL 的 `WritePin` 开销完全无所谓；只有刷屏、读大块 Flash 时才值得优化。**先让代码对，再谈快。**
:::

::: note 哪些代码"故意没写"
`MX_SPI1_Init()` 和 `HAL_SPI_MspInit()` 由 CubeMX 生成：前者设 **Mode 0（CPOL = Low、CPHA = 1 Edge）**、8 位、MSB 先行、波特率预分频（72MHz / 8 = 9MHz），后者开 SPI1 时钟、把 PA5/PA6/PA7 配成复用推挽。手写这些最容易错在模式：**CPOL/CPHA 配成 Mode 1/3 时，读 ID 会得到 0xFF 或错位一位**，而不是报错。

另外 CS **没有用 SPI 硬件 NSS**，而是普通 GPIO：硬件 NSS 在每次 `Transmit` 结束时自动放开，长事务会被拆断；软件 CS 才能保证"命令 + 地址 + 数据"连成一个事务。
:::

### 3.4 扇区擦除 + 页写

擦除和页写的实现已经在上面 `Hardware/Src/w25q64.c` 的 `W25Q_SectorErase` / `W25Q_PageProgram` 里（写使能 → 发命令和 24 位地址 → 轮询 BUSY）。下面给一个完整的上电自检文件，验证"擦 → 写 → 读"这条链路：

**文件：`App/Inc/app_flash_test.h`**
```c
#ifndef __APP_FLASH_TEST_H
#define __APP_FLASH_TEST_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void App_FlashSelfTest(void);   /* 擦 0x001000 扇区 → 写入 → 读回比对 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_FLASH_TEST_H */
```

**文件：`App/Src/app_flash_test.c`**
```c
#include "app_flash_test.h"
#include "w25q64.h"
#include <stdio.h>
#include <string.h>

void App_FlashSelfTest(void)
{
    static const uint8_t pattern[] = "STM32 SPI FLASH TEST";
    uint8_t buf[sizeof(pattern)];

    printf("--- flash self test ---\r\n");
    W25Q_SectorErase(0x001000U);                                    /* 4KB 对齐 */
    W25Q_PageProgram(0x001000U, pattern, (uint16_t)sizeof(pattern));
    W25Q_Read(0x001000U, buf, (uint16_t)sizeof(buf));

    printf("write : %s\r\n", pattern);
    printf("read  : %s\r\n", buf);
    printf("result: %s\r\n",
           (memcmp(buf, pattern, sizeof(pattern)) == 0U) ? "PASS" : "FAIL");
}
```

::: note 为什么是这几句
- `0x06` 单独一次 `CS_LOW/CS_HIGH`：写使能只对"下一个写/擦命令"有效，芯片收到后会置 WEL 位；跟后面的命令拼在一个事务里，WEL 还没来得及生效，写就被忽略。现象是**函数返回成功、读回还是 0xFF**。
- 地址 `{addr>>16, addr>>8, addr}` 是**高字节先发**（大端）。写成低字节先发，会写到完全不相干的地址，现象是"写完读不回来、别的区域被改了"。
- 轮询 `0x05` 的 bit0 而不是 `HAL_Delay(45)`：固定延时要么太短（写得慢的芯片没写完，下一帧命令被忽略），要么太长（每次擦除都白等）。轮询是**实际时间到就走**，代价是这段时间 CPU 空转；对 45ms 的擦除来说可以接受。
- `len > 256` 直接返回：Flash 页内地址到页尾会回卷到本页开头，超长写入会覆盖自己刚写的数据。跨页要拆成多次调用（见下面的 note）。
:::

::: note 为什么擦除要"先擦后写"
NOR Flash 的写入只能把 bit 从 1 变 0，不能把 0 变回 1。擦除是唯一能把整块变回 0xFF 的操作。所以"改写一个字节"的标准流程是：**读出整个 4KB 扇区 → 内存里改那个字节 → 擦扇区 → 整块写回**。省掉擦除直接写，得到的是"新旧数据按位与"的乱码。

这一整套如果要频繁做，就得引入"日志式/双扇区轮换"的磨损均衡，那是文件系统的活，不是这一课的范围。
:::

::: note 为什么这里全用阻塞收发，不用 DMA
9MHz SPI 一次页写 256 字节约 0.23ms，阻塞一会儿没人感觉得到；写一次 Flash 之前还有 45ms 的擦除在等。DMA 的优势要到"连续读几 MB"才体现，那时候用 `HAL_SPI_Receive_DMA` 一次搬完，CPU 才有活干。

同理，**软件模拟 SPI**（GPIO 翻转 SCK）也能跑通 W25Q64，但每个 bit 都要几条指令，最高几十~几百 kHz，读 8MB 要几分钟。硬件 SPI 的代价只是"占用 3 个固定复用引脚"，换来 10 倍以上的速度和零 CPU 占用——**能用硬件就用硬件**。
:::

::: note 为什么一次最多写 256 字节（一页）
W25Q64 内部按 **256 字节一页**组织。页编程命令只给一个起始地址，然后连续收数据，**地址在页内自动递增，到页尾会自动回卷到本页开头**。

所以如果你从页中间开始写 300 字节，写到页尾后不会跳到下一页，而是**回到本页开头把前面的数据覆盖掉**。

正确做法：一次写入不超过"到页尾的剩余空间"。跨页要拆成多次页编程，每次重新发地址。
:::

---

## 4. I2C 和 SPI 怎么选

| 维度 | I2C | SPI |
| --- | --- | --- |
| 线数 | **2**（SCL/SDA） | **3 + N**（SCK/MOSI/MISO + 每设备一根 CS） |
| 速度 | 100k / 400k / 1M | **几 MHz ~ 几十 MHz** |
| 双工 | 半双工 | **全双工** |
| 寻址 | 7 位地址，软件寻址 | 硬件片选，无地址 |
| 应答 | 每字节 ACK | **无 ACK**，可靠性靠上层 |
| 多设备 | 一根总线挂很多 | 每个设备一根 CS，引脚多 |
| 典型用途 | 传感器、EEPROM、OLED | **Flash、屏幕、SD 卡、无线模块** |
| 电平 | 必须开漏 + 上拉 | 推挽 |

**一句话选型**：**要速度、要刷屏、要存大量数据 → SPI；要省引脚、挂一堆慢速传感器 → I2C。**

::: note 为什么 SPI 没有 ACK，却比 I2C 可靠
看起来矛盾：I2C 有 ACK 反而容易死锁，SPI 没有 ACK 却很稳。

原因是**出错模型不同**：

- I2C 是共享总线，多设备靠开漏"线与"，一旦某个从机把 SDA 拉死，整条总线瘫痪——这是**结构性的死锁风险**。
- SPI 是点对点（一根 CS 一个从机），推挽驱动，没有共享冲突。虽然单次传输可能因为干扰出错，但**不会影响其他设备**，而且主机可以随时重新拉 CS 重发。

另外，需要可靠性的场景（Flash 存参数）会在**应用层加 CRC**，这比 I2C 的 1 位 ACK 强得多。工程上"简单 + 可重试"往往比"硬件应答"更可靠。
:::

---

## 5. 算一算

::: exercise 练习 1：判断模式
逻辑分析仪上看到：SCK 空闲时是**低电平**，数据在**下降沿**变化、在**上升沿**稳定。这是哪个模式？

::: answer
- 空闲低 → **CPOL = 0**
- 在第一个边沿（上升沿）稳定并采样 → **CPHA = 0**

所以是 **Mode 0**。

补充判断法：如果看到"空闲高、上升沿采样"，那是 Mode 3；"空闲低、下降沿采样"是 Mode 1；"空闲高、下降沿采样"是 Mode 2。

**数据在哪个沿变化，就在它的对侧沿采样**——这句话能推出所有四种模式。
:::
:::

::: exercise 练习 2：8MB Flash 要读多久
SPI 时钟 8MHz，读满整个 W25Q64（8MB）。理论最短时间？如果换成 I2C 400kHz 呢？

::: answer
SPI 8MHz，每个时钟传 1 bit：

$$8\text{MB} = 8 \times 1024 \times 1024 \times 8 \text{ bit} = 67\,108\,864 \text{ bit}$$

$$67\,108\,864 / 8\,000\,000 \approx 8.39s$$

I2C 400kHz，每个字节 9 个时钟（含 ACK）：

$$8\,388\,608 \text{ 字节} \times 9 / 400\,000 \approx 188.7s \approx 3.1\text{ 分钟}$$

**相差 22 倍**。这就是为什么大容量存储、屏幕、SD 卡一律用 SPI 或更快的接口，没人用 I2C 传大文件。

（实际读 Flash 还有命令开销和页边界，但数量级就是这样。）
:::
:::

---

## 6. 动手项目

::: project
**SPI Flash 参数存储器**

用 W25Q64 做一个"掉电不丢"的配置存储：

1. 上电先读 ID，串口打印 `EF4017` 验证通信正常。
2. 定义一块区域（比如地址 `0x000000` 开始的 4KB 扇区）存结构体：`Config_t` 放在 `Core/Inc/main.h` 的 `USER CODE BEGIN ET` 段，完整定义见下面文件列表里的 `main.h`。
3. 每次上电 `boot_count++`，串口打印出来的值应该**逐次递增**（证明掉电保存成功）。
4. 按键修改亮度，松手后保存。

**验收标准**：

1. 断电 10 秒再上电，`boot_count` 继续加 1，不是从 0 开始。
2. 串口打印的 ID 每次都是 `EF4017`。
3. 快速连续按键 20 次修改亮度，**最后一次的值被正确保存**（不能因为 BUSY 没等就丢）。
4. 擦除扇区后再读，读到的全是 `0xFF`。

**加分**：加 CRC16 校验，模拟"写到一半断电"时能检测出数据损坏并回退到默认值。

**文件放置表**

| 文件 | 文件夹 | 作用 |
| --- | --- | --- |
| `w25q64.h` | `Hardware/Inc/` | Flash 命令接口、页/扇区尺寸、JEDEC ID |
| `main.h` | `Core/Inc/` | `Config_t`、魔数、Flash 地址、按键引脚宏 |
| `key.h` | `Hardware/Inc/` | 按键扫描接口 |
| `app_cfg.h` | `App/Inc/` | 配置加载/保存接口 |
| `w25q64.c` | `Hardware/Src/` | 读 ID、读数据、扇区擦除、页编程 |
| `key.c` | `Hardware/Src/` | 每 10ms 调一次的消抖扫描 |
| `retarget.c` | `Hardware/Src/` | `printf` 重定向（`_write`） |
| `app_cfg.c` | `App/Src/` | 上电读配置、`boot_count++`、按键改亮度并保存 |
| `main.c` | `Core/Src/` | 初始化调用、主循环 |
| `spi.c/h`、`usart.c/h`、`gpio.c/h` | `Core/Src`、`Core/Inc` | CubeMX 生成，不手写 |

**文件：`Hardware/Inc/w25q64.h`**
```c
#ifndef __W25Q64_H
#define __W25Q64_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

#define W25Q64_PAGE_SIZE     256U        /* 页编程一次最多 256 字节 */
#define W25Q64_SECTOR_SIZE   4096U       /* 擦除最小单位 4KB */
#define W25Q64_JEDEC_ID      0xEF4017U   /* EF = Winbond，40 = 64Mbit，17 = 系列 */

uint32_t W25Q_ReadID(void);
void     W25Q_Read(uint32_t addr, uint8_t *buf, uint16_t len);
void     W25Q_SectorErase(uint32_t addr);                    /* addr 需 4KB 对齐 */
void     W25Q_PageProgram(uint32_t addr, const uint8_t *buf, uint16_t len);

#ifdef __cplusplus
}
#endif

#endif /* __W25Q64_H */
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

/* USER CODE BEGIN ET */
typedef struct {
    uint32_t magic;        /* 0xA5A55A5A，用来判断是否已初始化 */
    uint16_t brightness;   /* 亮度 0~100 */
    uint16_t volume;       /* 音量 0~100 */
    uint32_t boot_count;   /* 开机次数 */
} Config_t;
/* USER CODE END ET */

#define CFG_MAGIC       0xA5A55A5AU   /* 结构体有效标志 */
#define CFG_FLASH_ADDR  0x000000U     /* 用 0 号扇区的前若干字节 */
#define KEY_PIN         GPIO_PIN_0    /* PA0 接按键，按下为低 */
#define KEY_GPIO_PORT   GPIOA

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
```

**文件：`Hardware/Inc/key.h`**
```c
#ifndef __KEY_H
#define __KEY_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

uint8_t Key_Scan(void);   /* 每 10ms 调用一次，返回 1 表示一次有效按下 */

#ifdef __cplusplus
}
#endif

#endif /* __KEY_H */
```

**文件：`App/Inc/app_cfg.h`**
```c
#ifndef __APP_CFG_H
#define __APP_CFG_H

#ifdef __cplusplus
extern "C" {
#endif

#include "main.h"

void      App_CfgInit(void);   /* 读 ID → 读配置 → 校验魔数 → boot_count++ → 保存 */
void      App_CfgPoll(void);   /* 主循环每 10ms 一次：按键改亮度并保存 */
Config_t *App_CfgGet(void);    /* 给显示/打印用 */

#ifdef __cplusplus
}
#endif

#endif /* __APP_CFG_H */
```
**文件：`Hardware/Src/w25q64.c`**
```c
#include "w25q64.h"
#include "spi.h"          /* hspi1 在这里 extern 声明 */

#define W25Q_CS_PORT   GPIOA
#define W25Q_CS_PIN    GPIO_PIN_4      /* PA4 软件片选：CubeMX 配 Output，初始 High */
#define CS_LOW()       HAL_GPIO_WritePin(W25Q_CS_PORT, W25Q_CS_PIN, GPIO_PIN_RESET)
#define CS_HIGH()      HAL_GPIO_WritePin(W25Q_CS_PORT, W25Q_CS_PIN, GPIO_PIN_SET)

static void W25Q_Send(const uint8_t *buf, uint16_t len)
{
    HAL_SPI_Transmit(&hspi1, (uint8_t *)buf, len, 100);
}

static void W25Q_Recv(uint8_t *buf, uint16_t len)
{
    HAL_SPI_Receive(&hspi1, buf, len, 100);
}

/* 写使能必须单独一个事务：WEL 位要对"下一个命令"生效 */
static void W25Q_WriteEnable(void)
{
    uint8_t cmd = 0x06;
    CS_LOW();
    W25Q_Send(&cmd, 1);
    CS_HIGH();
}

/* 读状态寄存器：bit0 = BUSY，bit1 = WEL */
static uint8_t W25Q_ReadStatus(void)
{
    uint8_t cmd = 0x05, sr = 0;
    CS_LOW();
    W25Q_Send(&cmd, 1);
    W25Q_Recv(&sr, 1);
    CS_HIGH();
    return sr;
}

uint32_t W25Q_ReadID(void)
{
    uint8_t cmd = 0x9F;               /* JEDEC ID 命令 */
    uint8_t id[3] = {0};

    CS_LOW();                         /* 整个事务期间片选不能放开 */
    W25Q_Send(&cmd, 1);
    W25Q_Recv(id, 3);
    CS_HIGH();

    return ((uint32_t)id[0] << 16) | ((uint32_t)id[1] << 8) | id[2];
}

void W25Q_Read(uint32_t addr, uint8_t *buf, uint16_t len)
{
    uint8_t cmd[4];
    cmd[0] = 0x03;                    /* 读数据 */
    cmd[1] = (uint8_t)(addr >> 16);   /* 24 位地址，高字节先发 */
    cmd[2] = (uint8_t)(addr >> 8);
    cmd[3] = (uint8_t)addr;

    CS_LOW();
    W25Q_Send(cmd, 4);
    W25Q_Recv(buf, len);
    CS_HIGH();
}

void W25Q_SectorErase(uint32_t addr)
{
    uint8_t cmd[4];
    W25Q_WriteEnable();

    cmd[0] = 0x20;                    /* 扇区擦除，4KB */
    cmd[1] = (uint8_t)(addr >> 16);
    cmd[2] = (uint8_t)(addr >> 8);
    cmd[3] = (uint8_t)addr;
    CS_LOW();
    W25Q_Send(cmd, 4);
    CS_HIGH();

    while (W25Q_ReadStatus() & 0x01U) { }   /* 轮询 BUSY，典型 45ms */
}

void W25Q_PageProgram(uint32_t addr, const uint8_t *buf, uint16_t len)
{
    uint8_t cmd[4];
    if (len == 0U || len > W25Q64_PAGE_SIZE) return;   /* 跨页会回卷覆盖 */

    W25Q_WriteEnable();

    cmd[0] = 0x02;                    /* 页编程 */
    cmd[1] = (uint8_t)(addr >> 16);
    cmd[2] = (uint8_t)(addr >> 8);
    cmd[3] = (uint8_t)addr;
    CS_LOW();
    W25Q_Send(cmd, 4);
    W25Q_Send(buf, len);
    CS_HIGH();

    while (W25Q_ReadStatus() & 0x01U) { }   /* 轮询 BUSY，典型 0.7ms */
}
```

**文件：`Hardware/Src/key.c`**
```c
#include "key.h"

/* 每 10ms 调一次：连续 3 次读到低电平才认一次按下，省掉 RC 消抖 */
uint8_t Key_Scan(void)
{
    static uint8_t s_last = 1;   /* 上一次电平：1 = 松开 */
    static uint8_t s_cnt  = 0;   /* 稳定为低的次数 */
    uint8_t now = (HAL_GPIO_ReadPin(KEY_GPIO_PORT, KEY_PIN) == GPIO_PIN_SET) ? 1U : 0U;

    if (now != s_last) {         /* 电平变了，重新计数 */
        s_last = now;
        s_cnt  = 0;
        return 0;
    }
    if (now == 0U && s_cnt < 3U) {
        s_cnt++;
        if (s_cnt == 3U) return 1;   /* 只报一次 */
    }
    return 0;
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
**文件：`App/Src/app_cfg.c`**
```c
#include "app_cfg.h"
#include "w25q64.h"
#include "key.h"
#include "main.h"
#include <stdio.h>
#include <string.h>

static Config_t s_cfg;
static uint8_t  s_flash_ok = 0;      /* 读 ID 成功才允许写，避免空写 */

/* 保存：Flash 只能 1→0，必须先擦整个扇区再写 */
static void App_CfgSave(void)
{
    if (!s_flash_ok) return;

    W25Q_SectorErase(CFG_FLASH_ADDR);     /* 4KB 对齐，约 45ms */
    W25Q_PageProgram(CFG_FLASH_ADDR, (const uint8_t *)&s_cfg, (uint16_t)sizeof(s_cfg));
    printf("saved: boot=%lu bright=%u\r\n",
           (unsigned long)s_cfg.boot_count, s_cfg.brightness);
}

void App_CfgInit(void)
{
    uint32_t id = W25Q_ReadID();
    printf("W25Q64 ID = %06lX\r\n", (unsigned long)id);
    s_flash_ok = (id == W25Q64_JEDEC_ID) ? 1U : 0U;

    if (s_flash_ok) {
        W25Q_Read(CFG_FLASH_ADDR, (uint8_t *)&s_cfg, (uint16_t)sizeof(s_cfg));
    } else {
        memset(&s_cfg, 0, sizeof(s_cfg));
    }

    if (s_cfg.magic != CFG_MAGIC) {      /* 第一次上电，或整片擦过 */
        s_cfg.magic      = CFG_MAGIC;
        s_cfg.brightness = 50;
        s_cfg.volume     = 30;
        s_cfg.boot_count = 0;
    }

    s_cfg.boot_count++;                  /* 每上电一次 +1 */
    App_CfgSave();
    printf("boot_count=%lu\r\n", (unsigned long)s_cfg.boot_count);
}

void App_CfgPoll(void)
{
    uint16_t b;

    if (Key_Scan() == 0U) return;

    b = (uint16_t)(s_cfg.brightness + 10U);
    if (b > 100U) b = 0U;                /* 0→10→…→100→0 循环 */
    s_cfg.brightness = b;
    printf("brightness=%u\r\n", b);
    App_CfgSave();                       /* 按键松手才走到这里，保存一次 */
}

Config_t *App_CfgGet(void)
{
    return &s_cfg;
}
```

**文件：`Core/Src/main.c`**
```c
#include "main.h"
#include "gpio.h"
#include "spi.h"
#include "usart.h"
#include "app_cfg.h"
#include <stdio.h>

static void SystemClock_Config(void);

int main(void)
{
  HAL_Init();
  SystemClock_Config();
  MX_GPIO_Init();          /* PA4 = CS 输出高；PA0 = 按键输入上拉 */
  MX_SPI1_Init();          /* Mode 0：CPOL=Low、CPHA=1Edge；72MHz/8 = 9MHz */
  MX_USART1_UART_Init();   /* 115200-8-N-1，打印 ID 和开机次数 */

  /* USER CODE BEGIN 2 */
  App_CfgInit();           /* 读 ID → 读配置 → 校验 → boot_count++ → 保存 */
  /* USER CODE END 2 */

  while (1)
  {
    App_CfgPoll();         /* 每 10ms 扫一次按键，按下就改亮度并保存 */
    HAL_Delay(10);
  }
}

static void SystemClock_Config(void)
{
  RCC_OscInitTypeDef osc = {0};
  RCC_ClkInitTypeDef clk = {0};

  /* HSE 8MHz × 9 = 72MHz；APB1 = 36MHz，APB2 = 72MHz */
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
- `MX_SPI1_Init()`（在 `spi.c`）：Mode 0（CPOL = Low、CPHA = 1 Edge）、8 位、MSB 先行、波特率预分频 8 → 72MHz / 8 = **9MHz**。配成 Mode 1/3 的现象是读 ID 得到 0xFF 或错位一位。
- `HAL_SPI_MspInit()`（在 `spi.c`）：开 SPI1 时钟，PA5/PA6/PA7 配复用推挽。
- `MX_GPIO_Init()`（在 `gpio.c`）：PA4 配推挽输出、初始高（CS 空闲高）；PA0 配输入上拉（按键按下接地）。
- `MX_USART1_UART_Init()`：115200-8-N-1，用来打印 ID、`boot_count` 和亮度。
- **CS 用普通 GPIO，不用硬件 NSS**：硬件 NSS 会在每次 `HAL_SPI_Transmit` 结束时自动放开片选，把"命令 + 地址 + 数据"拆断，现象是只有第一个字节生效。
:::

::: note 为什么这样拆文件
- `w25q64.c` 只认命令码和时序，不认识 `Config_t`；`app_cfg.c` 只认"配置怎么存、什么时候存"，不认识 SPI。以后换 24C02 或内部 Flash，只改 Hardware 层。
- `key.c` 单独一个文件，因为消抖需要"每 10ms 调一次"的固定节奏；把它塞进主循环会让扫描节奏随 `printf` 变慢。
- `main.c` 只剩初始化 + 主循环，`Config_t` 按 CubeMX 的习惯放 `main.h` 的 `USER CODE BEGIN ET`，重新生成代码不会被覆盖。
:::
:::

---

## 7. 本课小结

- SPI 四根线：**SCK / MOSI / MISO / CS**；无地址，靠 CS 选设备；推挽、全双工、速度快。
- 全双工的本质是**两个移位寄存器连成环**，所以"读"必须"发 dummy 字节"。
- **CPOL 决定空闲电平，CPHA 决定第几个沿采样**；数据在采样沿的对侧变化。
- 配错现象：全 0xFF → MISO 无驱动；数据错位一位 → CPHA 反了。
- W25Q64 三铁律：**写前 0x06 写使能、擦除最小 4KB、写擦后等 BUSY**。
- Flash 只能 1→0，擦除把整块置 1；不擦就写会得到"按位与"的乱码。
- 页编程最多 256 字节，**到页尾会回卷**，跨页要拆。
- 选型：**速度/刷屏/大容量 → SPI；省引脚/多慢速传感器 → I2C**。
- 8MHz SPI 读 8MB 约 8.4 秒；I2C 400k 要 3 分钟，差 22 倍。

::: selfcheck 自检
- [ ] 我能说出 SPI 四根线的作用和方向
- [ ] 我能用"移位寄存器环"解释为什么读必须发
- [ ] 我能由 CPOL/CPHA 判断四种模式，也能从波形反推模式
- [ ] 我知道数据在采样沿的对侧变化
- [ ] 我能背出 W25Q64 的读 ID、写使能、页写、扇区擦除命令
- [ ] 我能解释 Flash 为什么必须先擦后写、为什么最多写 256 字节
- [ ] 我能列出 I2C 和 SPI 的取舍并给出选型理由
:::

---

## 8. 下一课预告

到这里，三大通信（串口、I2C、SPI）讲完了。它们解决的都是"**数字量**"的传输。

下一课 `s15 ADC 采样与 DMA`：把**模拟电压**变成数字。你会看到"12 位分辨率"到底意味着多少毫伏，也会第一次用 DMA 让数据"自己搬"，CPU 完全不参与。
