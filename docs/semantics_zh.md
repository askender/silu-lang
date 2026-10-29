# Silu 语义契约（Semantics Contract）

本文档写明 Silu 与 Python 语义**一致**的地方、**有意分歧**的地方，
以及原生编译（typed 后端）下的性能与内存契约。它的定位是"系统程序员
一页纸"：写高性能 Silu 代码前读这一篇就够。

## 1. 数值语义

| 方面 | 行为 |
|---|---|
| 整数表示 | 有符号 64 位（i64），**不是** Python 的任意精度 bigint |
| 整数溢出 | 默认（`SILU_CHECKS=1`）panic 并报行号，等同 Rust debug 构建；`SILU_CHECKS=0` 时二进制补码回绕（wrap），等同 Rust release 构建 |
| 浮点 | IEEE 754 双精度（f64）；`int / int` 恒为 float（Python 语义），`//` 与 `%` 遵循 Python 的向下取整语义（与被除数符号无关） |
| 除零 | 任何配置下都 panic（Rust 亦如此） |
| NaN | `!=` 对 NaN 恒为真（Python 语义），其余比较为假 |
| int/float 混合运算 | int 提升为 float（Python 语义） |
| int → float 精度 | `float(int)` 与比较遵循 IEEE 最近舍入；`int(float)` 截断，不可表示时 panic（checks 开启） |

**与 Python 的最大分歧就是 bigint**：超过 i64 范围的整数运算在默认配置下
会 panic（而不是静默正确），在 `SILU_CHECKS=0` 下会回绕（而不是报错）。
需要任意精度的程序目前不适合 Silu。

## 2. 字符串语义

- **码点语义（与 Python 完全一致）**：`len(s)`、`s[i]`、`s[a:b]`、
  `for ch in s` 都按 Unicode 码点计，已在多字节文本（CJK）上与
  CPython 逐字节对拍验证。代价是 `s[i]` 为 O(n) 走查（与 Rust 的
  `chars().nth(i)` 相同）；`for` 迭代整体仍为 O(字节数)。
- **等值/比较/成员判断**：按 UTF-8 字节序，与码点序等价（memcmp 语义）。
- **可变性的幻觉**：Python 的 str 不可变，Silu 的 rawstr 槽用
  Rust String 式所有权模拟：`s = s + x` 摊销 O(1) 原地追加，但
  `t = s` 是**拷贝**——之后改 `t` 不影响 `s`，与 Python 一致。
- **内存**：槽被覆写时释放旧缓冲（drop-on-assign）；表达式临时量
  （拼接/比较/包含的操作数、被丢弃的表达式语句结果）在使用后立即释放；
  函数退出时释放其全部 rawstr 局部槽与参数槽。重赋值循环与高频调用
  均为常量内存。
- **lexer 内建**（自举前置，docs/selfhosting.md）：`ord`/`chr` 按码点
  编解码 UTF-8；`split()`（空白运行合并，空串抑制）与 `split(sep)`
  （字面分隔，保留空字段，空分隔符 panic）；`strip()` 去两端 ASCII
  空白；`startswith`/`endswith`；`isdigit`/`isalpha`/`isspace` 对
  ASCII 精确，非 ASCII 码点归入 alpha（其余 False）；空串的
  is* 全为 False。`read_file(path)` 整读文件（不存在则 panic
  OSError）；`read_stdin()` 读 stdin 到 EOF（保留换行）。

## 3. 容器语义

- **list / dict 是 Python 引用语义**：`b = a` 共享同一对象，
  函数参数传入的也是引用。这与 rawstr 的拷贝语义**有意不同**，
  因为 Python 程序员对容器的预期就是共享。
- 因此 int/float 元素的 rawlist 与 rawdict **不做作用域 drop**：参数、
  名字赋值、返回值都可能共享指针，没有逃逸分析就释放会是
  use-after-free。其缓冲区随进程生命周期存在（无 GC）。需要严格
  内存上限的长驻程序应注意。
- **`list[str]` 是例外**：槽持有元素的**拷贝**（写入时 copy-in），
  读取交出**新拷贝**（读出即拥有，改 `l[0]` 不影响已读出的值）——
  因此它可以安全地做逐元素 drop（clear/覆写/作用域退出），与
  rawdict 的 str 键同一套所有权约定。
- `dict[int, int]` / `dict[int, float]` 的键序不保证与 CPython 一致
  （开放寻址哈希表，`print(d)` 的顺序是表序而非插入序）；`len`、
  查找、`del` 语义一致。
- 边界检查：默认 panic 并报行号；`SILU_CHECKS=0` 时下标越界是
  未定义行为（UB）——只在已验证的程序上关。

## 3.5 类（record 类型，dataclass 语义）

- **每个 class 都是记录类型**：类体只允许注解字段（按声明顺序）
  与方法（首参 `self`）；继承、类变量、用户 `__init__` 一律拒绝。
  对应 Rust 的 `struct` + `impl`。
- **构造**：`P(a, b)` 按声明顺序位置构造；`P(x=a)` 关键字构造；
  带默认值的字段之后不能再出现无默认值字段（dataclass 规则）。
  每个实参按字段注解 coerce，违约：解释器 TypeError / 编译 panic
  （int 字段收 float 属于违约，不做静默截断）。
- **方法与 self**：`st.m(a)` 脱糖为 `P__m(st, a)`；`self.x` 读写
  走字段偏移；方法可互调。self 是只读绑定。
- **表示**（编译路径）：实例是一块 `8 × 字段数` 字节的堆缓冲，
  无对象头、无 vtable；字段按编译期布局表做偏移 load/store。
  str 字段写入时 copy-in、读出时 copy-on-read（与 rawstr 槽同一
  纪律）。
- **容器字段（list/dict）是引用语义**：字段槽存指针，读出交出
  共享引用（`lst = b.items` 后 `lst.append(...)` 直接影响字段），
  与 Silu 容器的全局规则（§3）一致。容器默认值**每实例独立**——
  Python 的共享可变默认值陷阱在 Silu 不存在。
- **实例不 drop**（正式决定）：实例允许自由别名（`b = a` 共享），
  没有借用检查器，对共享实例做 drop 就是 use-after-free；实例内存
  随进程生命周期。Rust 的 drop 依赖所有权系统，没有对应物就不做。
- **实例引用语义**：`b = a` 共享同一实例（与 list/dict 一致）。
- **编译路径第一版的边界**：嵌套实例字段（字段是另一个 class）暂
  不支持（明确报错）；实例不可装箱——`print(p)` 是编译错误，
  打印字段（`print(p.x)`）即可。

## 4. 标量光标提升（SILU_SCALARS=1，默认开）

`list[int]` 若在一个函数作用域内**只以 `x[0]` 形式出现**（读或写），
编译器把它提升为局部 i64 槽（入口播种一次）——递归下降解析器的
`pos[0] += 1` 光标从每次 4 次装箱下标变为纯寄存器算术。保守规则：
名字在**多个函数的参数表**中出现（跨函数共享游标）、有任何其他使用
（传参、`len(x)`、非 0 下标、`x = ...` 改绑）或是 `list[float]` 时
一律不提升；不提升即走普通装箱路径，**永远不会产生错误代码**。
`SILU_SCALARS=0` 可整体关闭。

**热循环惯用法**：若分析器不覆盖你的场景（如光标跨函数共享），
可手动把 `pos[0]` 提出为 `p: int` 局部量、在调用边界前后同步——
实测对 jsonparse 这类"每字符都要物化字符对象"的负载**无收益**
（差距主体在字符物化而非光标装箱），仅当循环体内有大量独立于字符
访问的游标算术时才值得。

## 5. 类型推断契约

- 注解（`x: int`、`def f(a: int) -> int`）是**用户契约**：编译器
  无条件相信，违背注解的改绑会被强制转换或 panic。
- 未注解的名字经**保守推断**升级为原始类型：只有证明该作用域内
  所有赋值都产生同一类型时才升级；任何冲突（如 `x = 7` 后 `x = x / 2`）
  都回落 PyObject 动态存储，Python 改绑语义完整保留。
- 跨函数推断同样保守：参数从未在函数体内改绑、且所有调用点传同一
  原始类型才非装箱传递；返回表达式全部解析为同一类型才非装箱返回。
  递归、关键字参数、元数不符、调用点类型冲突一律回落动态 ABI。

## 6. 检查开关

| 配置 | 溢出 | 边界 | 除零 | 适用 |
|---|---|---|---|---|
| `SILU_CHECKS=1`（默认） | panic | panic | panic | 开发、调试、正确性优先 |
| `SILU_CHECKS=0` | 回绕 | UB | panic | 已验证程序的最后几个百分点 |

`SILU_CODEGEN=dynamic` 可回到全 PyObject 的旧后端用于对照调试。

## 7. 验证工具

- `silu verify program.si`：解释器（参考语义）与编译产物对拍，
  任何分歧都是编译器 bug。
- 运行时错误带源码行号：`IndexError: list index out of range (line 3)`。
- `silu symbolic program.si`：Z3 符号执行，枚举路径并生成测试输入。

### 8. 证明器的范围

- `silu prove program.si` 检查除零/取模除零、可静态分析的下标边界和字典键；可达错误给出反例。
- `require(condition)` 声明函数的证明定义域，函数独立证明，调用点另行检查契约。
- 路径条件参与推理，循环按有限界验证。求解器不能判定的义务报告为未证明，绝不静默视为安全。
- 证明不覆盖内存耗尽、栈溢出、任意动态行为、FFI 故障、关闭原生检查后的未定义行为，以及编译器实现缺陷。
- 首个原生 `siluc` 二进制包不包含这些 Python 工具链命令。
