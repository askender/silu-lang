# 速度评测：Silu vs CPython vs Rust（2026-10-25, v1.9.0）

> 数据由 `python benchmarks/run_benchmarks.py --report` 生成
> （每程序 3 轮取中位数，含进程启动；Apple Silicon；CPython 3.13
> / Rust 1.89 release / clang -O2）。方法学与各程序归因见
> [benchmarks/README.md](../benchmarks/README.md)。复现：
> `python benchmarks/run_benchmarks.py --report`。

## 一、运行速度：15 程序（含 Json 孪生）× 4 平面

| 程序 | Silu 解释器 | CPython | **Silu 原生** | Rust | vs 解释器 | vs CPython | vs Rust | 输出 |
|---|---|---|---|---|---|---|---|---|
|---|---|---|---|---|---|---|---|---|
| arith | 5.532s | 0.080s | 0.0033s | 0.0029s | 1681× | 24.4× | 0.9× | ok |
| dict | 0.269s | 0.034s | 0.0022s | 0.0028s | 125× | 15.6× | **1.3×** | ok |
| fannkuch | 0.049s | 0.032s | 0.0026s | 0.0025s | 19× | 12.1× | 0.9× | ok |
| fib | 1.814s | 0.036s | 0.0025s | 0.0028s | 718× | 14.2× | **1.1×** | ok |
| float | 3.791s | 0.052s | 0.0027s | 0.0028s | 1397× | 19.3× | 1.0× | ok |
| jsonparse | 1.747s | 0.047s | 0.0074s | 0.0036s | 236× | 6.3× | 0.5× | ok |
| jsonparse_json | 1.816s | 0.042s | 0.0079s | — | 231× | 5.3× | (Json 孪生，见 RFC 7c) | ok |
| knucleotide | 15.614s | 0.889s | 0.0110s | 0.0148s | 1421× | 80.9× | **1.3×** | ok |
| list | 0.479s | 0.035s | 0.0024s | 0.0024s | 202× | 14.8× | 1.0× | ok |
| mandelbrot | 1.214s | 0.041s | 0.0024s | 0.0027s | 514× | 17.2× | **1.2×** | ok |
| nbody | 61.200s | 0.214s | 0.0057s | 0.0054s | 10718× | 37.6× | 0.9× | ok |
| spectral | 71.253s | 0.288s | 0.0074s | 0.0047s | 9576× | 38.7× | 0.6×※ | ok |
| string | 0.553s | 0.049s | 0.0030s | 0.0022s | 183× | 16.1× | 0.7× | ok |
| trees | 0.873s | 0.031s | 0.0032s | 0.0034s | 276× | 9.8× | **1.1×** | ok |
| wordcount | 6.740s | 0.088s | 0.0233s | 0.0137s | 289× | 3.8× | 0.6× | ok |

**几何平均：0.9× vs Rust（整体略落后）｜15.6× vs CPython｜515× vs
解释器**；启动基线 silu-int 0.038s / cpython 0.028s / binary 0.0041s。
15 行中 10 项 ≥0.9×（dict/knucleotide 1.3× 最大领先）。

**运行时瘦身注记**：LTO + `-Wl,-dead_strip` 已按符号粒度剥离
未引用的运行时函数（fib 二进制 35KB vs 单体 113KB），"按程序选
择运行时"的瘦身项就此关闭——链接器免费做掉了。

**jsonparse 五方对比**（安静环境 31 次取 min，87KB 文档，输出五方逐字节一致）：

| 平面 | min | 备注 |
|---|---|---|
| C（clang -O2，同构树+realloc，`benchmarks/c/jsonparse.c`） | 2.7ms | **中位数不稳**（10-27ms 摆动，malloc 敏感） |
| Rust（serde_json 形状） | 3.6ms | 稳定 |
| Silu class 孪生 | 6.5ms | 稳定 |
| Silu Json 孪生 | 6.7ms | 稳定 |
| CPython（pycompat） | 42ms | |
| Silu 解释器 | 1735ms | |

**LTO 抹平了 RFC 7c 的 1.2ms**：Json 孪生与 class 孪生现已持平
（unwrap/tag 派发被 -flto 内联进热循环），RFC 7c 的"消费端开销"
结论由 LTO 默认路径自动修正。剩余 vs Rust/C 的差距仍归因构造端
（J1 三层分解的 ~1.9ms instance+容器）。

※ spectral 高方差注记（v1.14.0 复测）：同一二进制三次环境测得
4.5–7.4ms 摆动（几 ms 级程序的毫秒抖动即百分比大幅摆动）；且
**链接策略成本已单独测得**——同一 `.ll` 单体 clang 直编
3.86ms（**1.17× 反超 Rust**），而 siluc 的"程序.o + rt.o"分离
链接 5.58ms（0.81×）：跨翻译单元边界阻止了运行时函数内联。
LTO 单体验证 3.89ms 可复原该收益。

**已落地（f475966）**：LTO 链接现为 siluc 默认——rt.o 改存
LLVM bitcode（一次性 0.15s），用户模块同编 bitcode，链接
`clang -flto -O2 -Wl,-dead_strip`（无冲突）。成本账：每次链接
+20ms（0.05 vs 0.03s），siluc 总时长温态维持 0.11-0.12s。收益
（安静环境手测，vs Rust）：spectral 4.66→4.15ms、fib 1.08×、
dict 1.04×、arith 1.03×；启动基线减半（4.1→2.1ms）。
首次集成失败的两个教训：诊断须用 rt-lifted.ll（internal
global 已提升），spectral 跨分钟摆动 4.15-6.8ms 使套件轮均值
不可作单一依据（三轮 0.9×→0.7×→0.8×，binary 与 rust 双侧
同抖）——单项手测 A/B 是本机可靠口径。
两块已归因的剩余短板见第三节。

## 二、编译速度：siluc vs rustc vs clang

| 编译器 | fib（s/程序） | 说明 |
|---|---|---|
| **siluc（C 驱动 + siluc1）** | **0.136s** | 一行命令、零 Python；运行时 .o 缓存 |
| rustc -C opt-level=3 | 0.128s | 直调无缓存（三连编译恒定 + 磁盘零残留，实证） |
| Python 管线（selfhost_build） | 0.178s | 编排是 Python，编译器本体仍是 siluc1 |
| Python 编译器（silu build） | 0.497s | 全 Python 实现，开发/调试用 |
| clang -O2（C 孪生） | 0.06s | 参照 |

siluc 与 rustc 差距 1.06×，剩余部分全在 clang 用户段+链接本体
（管线 ~0.12s 是 clang 地板价）。cargo 的缓存是工件级（冷
0.274s / 热 0.050s），与我们的 .o 缓存同类但粒度更粗。

## 三、速度演进轨迹（做对了什么）

| 日期 | 里程碑 | jsonparse | 全套几何 vs Rust |
|---|---|---|---|
| 10-14 | 基线（v1.0 前） | 78ms（0.06×） | 0.9×（Rust 略胜） |
| 10-24 | print 特化：静态标量/字符串免 pyobj 盒 | — | — |
| 10-25 | dead_strip 链接（体积 3×↓） | — | — |
| 10-25 | match 类模式窄化：`case JInt(n)` 载荷静态绑定 | 78→75ms | — |
| 10-25 | **str 传参借用**：修复每层递归深拷整个文档 | **78.7→8.3ms（9.5×）** | — |
| 10-25 | 刷新报告（含全部修复） | 10.7ms（0.4×） | **0.9×（持平区间）** |

两个已归因的剩余短板（按需再战）：

- **jsonparse 0.6×（10-27 第三轮：8.0-8.5ms vs rust 4.5-4.8ms，物化池化后）**：
  三层归因（构造 12% / 物化大头）与修复链——v1.11.4 的池最初挂在了
  零调用的 `rawstr_char_at` 上（收益 0.8ms 实为噪音，本轮修正）；真正的
  热路径是 `s[i]` 的 **view→RAWSTR 物化**（`rawstr_new_copy`：2 次
  malloc + memcpy + SIMD 码点计数，每字符 ~62ns）。本轮把物化接到
  `rawstr_char1`（单字节码点走 256 项共享池，cap=-1 永生哨兵）：
  扫描探针 9.9→4.7ms，**与手写 `ord()` 惯用法持平（62→~5ns/字符）**，
  jsonparse 9.8→8.0-8.5ms。**内联策略实测否定**：clang -O2 早已内联
  小运行时函数（汇编证实），剩余单次 `char1` 调用加 alwaysinline
  反而 4.64→4.91ms（icache 伤）。**剩余差距 ≈ 构造成本 1.9ms
  （纯运行口径 5.2 vs 3.5ms 差 1.7ms）**——sum-type（RFC S1-S4）从
  "次要" 升级为收官关键路径：物化修复后构造占比从 12% 升至 ~24%。
- **wordcount 0.6×（10-27 复测）**：v1.11.3 的下标类型推断消除了
  `w = vocab[i]` 的 pyobj 装箱（`.ll` 调用序列验证），但暴露了更深
  一层：`rawlist_str_get` 是**拷贝语义**（slots own copies），每次
  读取 malloc 新块 + free 旧槽，两次堆操作反而贵过单次装箱。
  A/B 实测（旧 `.ll` 21.2ms vs 新 24.3ms，各 15 次取最小值）。
  根治 = 借用读（不可变元素下标返回借用指针）或缓冲复用
  （`rawstr_copy_into`，Rust `clone_from` 思路）——与 jsonparse 的
  字符访问是**同一族不可变值拷贝语义问题**，可一并治理。

## 四、方法学要点

- **四平面先验证后计时**：每个程序先确认解释器/CPython/编译
  产物/Rust 孪生四方输出一致，否则该行标记 MISMATCH 不计。
- CPython 平面经 pycompat 垫片（Silu 类的位置构造器与裸
  CPython 语义不同）；Rust 孪生逐程序手工镜像并比对输出。
- 编译计时中位数 3 次；启动基线单独扣除参照（4.3ms silu /
  2.3ms rust 空程序）。
- 逐项归因采用 ablation + macOS `sample` 采样（示例：jsonparse
  的 70ms 热区被采样锁定为传参深拷贝，修复后 8.3ms）。
