# 符号执行路线图

状态：已提议（2026-10-27）。符号子系统**保留是决策**——它不在任何
编译关键路径上，本文档是将其从实验性分析器变成承重工具的计划。

## 现有资产

- 约 5,890 行：`silu/symbolic_executor.py`（2,070）、
  `symbolic_utils.py`（~790）、`symbolic/` 包（condition/loop/
  builtin/z3/report 工具）、`symbolic_pathlib.py`（执行路径管理器）
- 入口：`silu symbolic <file>`（CLI，懒加载所以 z3 + logury 链在
  其他场景零开销）和 Python API（`SymbolicExecutor`、
  `execute_symbolic_from_file_with_executor`）
- 快层覆盖率各模块 20–60%；v1.11.2 质量轮已清理 13 个死函数
- 依赖：`z3-solver`（运行时可选——Z3_AVAILABLE 门控）、`loguru`

## 已验证的配方（v1.3，tests/test_symbolic_invariants.py）

符号执行已经回收过成本的地方：容器运行时不变量在**所有**输入上
证明，不是采样。

1. 把运行时操作重新表达为符号 list 头 `{len, cap, items}` 上的
   Silu 程序，
2. 让 `SymbolicExecutor` 探索路径，
3. 把义务交给 Z3。

这样证明的不变量：append 在所有输入下保持 len/cap；增长单调；
负下标从 `i + len` 读取；界内读取永不 panic、界外总是 panic。

## 三条应用线，最便宜的先做

### 阶段 1 —— 把不变量门禁扩展到 raw 家族（便宜，直接复用）

v1.3 覆盖了 pyobj list 运行时。typed 后端现在有三个手写运行时
家族，同样的 bug 面：

- `rawstr`（头 `{len, cap, data}`）：`rawstr_append` 增长单调；
  `rawstr_slice` clamp 与发射一致；`rawstr_at_*` 边界
- `rawdict`（entries + 开放寻址索引表）：`rawdict_set` 保持
  "槽存 entry_index+1，0 = 空，-1 = 已删除"；reindex 保持成员；
  `rawdict_del` 墓碑纪律
- `rawutf8`（cp_count/cp_offset）：offset < cp_count 落在界内

每项都是 `test_symbolic_invariants.py` 里的新测试类，遵循 v1.3
模板：符号化模型头，执行操作的参考语义，用 Z3 证明。参考语义是
发射器生成的精确表达式（`_emit_rawstr_core` 等），所以证明覆盖
发射出的运行时。

### 阶段 2 —— `silu prove`：用户程序的 panic-free 证明

语言的失败策略是受检操作 abort-with-message：除零、下标越界、
字符串索引越界。这让"会不会 abort？"成为一个精确可判定的性质
——符号执行是正确的工具。

- CLI：`silu prove program.si [--func name]`
- 每个函数：符号参数（尊重注解——注解 `int` 获得无约束 i64，
  `str` 获得符号头），路径探索，Z3 查询"任何 abort 可达吗？"
- 输出：`ok — 无 abort 可达` / `可能 abort: 除零在行 N，条件
  [路径条件]`——一个反例路径，这是采样 fuzzer 给不了的
- 范围控制：循环有界（k-unrolling，循环分析器已有），未注解/
  pyobj 密集函数跳过并注明

这是把子系统作为差异化特性交付：一个小编译语言配上按键式的
算术和索引核心无崩溃证明，在同一个二进制里。

### 阶段 3 —— 变换等价性证明（难，更晚）

字节一致门禁证明构建可重现性，不证明优化本身的语义正确性。
两个有真正语义内容的变换——借用 str 传参（v1.7.1）和 rawlist
别名写回守卫（v1.8）——由不变量定义（"借用参数永不被被调方
释放"，"长度不变的调用保持调用方的槽指针"）。阶段 3 是把这些
作为符号义务在调用协议上证明，就像阶段 1 在容器头上做的。

延迟到阶段 1–2 硬化引擎后再做，因为它需要当前单函数探索器
没有的过程间推理。

## 到时的维护政策

- 子系统留在 `silu/`（不归档），测试留在快层
- 新工作以不变量模板为测试先行；在阶段 2 需要之前不对探索器
  做大重构
- 覆盖率目标：`symbolic_executor.py` 从 41% 提升到至少阶段
  1–2 实际使用的水平；阶段 1 后再测

## 非目标

- 完整 pyobj 堆建模（近似即不可靠；跳过并注明）
- 并发、超出 Z3 FP 理论干净处理范围的浮点
- 替代字节一致门禁——符号证明是补充，不是取代

## 完成记录

### 阶段 1 — 已完成（v1.11.2）

rawstr/rawdict/rawutf8 不变量套件全绿（15 项，变异验证）。

### 阶段 2 — 已完成（v1.15.x）

`silu prove` + `require()` 契约 + 路径敏感证明 + 反例证人。
证明套件 24 项。

### 阶段 3 — 已完成（v1.15.2）

借用传参契约 + 写回守卫等价性证明（tests/test_transform_equivalence.py，
8 项，变异验证）。
