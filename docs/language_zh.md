# Silu 语言指南

Silu 使用 Python 语法，但支持的是**有明确文档的子集**，不是完整 Python 语言或其第三方包生态。原生编译器通过 LLVM 将带注解程序编译为原生二进制。

## 一个完整程序

```python
def fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(24))
```

保存为 `fib.si`，用原生工具包编译：

```sh
./siluc fib.si -o fib
./fib
```

编译器需要 PATH 中的 `clang`。请保持 `siluc` 与 `siluc1` 位于同一目录。

## 值与类型注解

```python
count: int = 3
ratio: float = 1.5
enabled: bool = True
name: str = "Silu"
numbers: list[int] = [1, 2, 3]
counts: dict[str, int] = {"a": 1}
```

- `int` 是有符号 64 位整数，不是 Python 的任意精度整数。
- `float` 是 IEEE-754 双精度浮点；`int / int` 的结果是浮点数。
- 字符串索引和切片遵循 Python 的 Unicode 码点语义。
- 在文档规定的子集内支持 `bool`、`bytes`、列表、字典、函数和记录式类。
- 保守推断可为未注解局部量选择原生表示；无法确定或类型冲突时使用动态表示。

静态注解会决定原生表示，不是违背也毫无影响的类型提示。

## 函数与控制流

```python
def absolute(x: int) -> int:
    if x < 0:
        return -x
    return x

total = 0
for i in range(10):
    total += absolute(i - 4)

while total > 100:
    total -= 1
```

函数支持递归、默认参数，以及对定义作用域的只读闭包。支持 `if`/`elif`/`else`、`while`、`for`、`break`、`continue` 和文档规定的 `match` 子集。

## 容器

```python
words = ["silu", "native"]
words.append("compiler")
print(len(words))
print(words[0])

counts: dict[str, int] = {}
for word in words:
    counts[word] = counts.get(word, 0) + 1
```

容器赋值与 Python 一样共享对象；字符串值采用独占缓冲纪律。并非所有 CPython 容器实现细节都保留：原生整数/浮点字典的迭代顺序不保证与 CPython 插入顺序一致。

## 记录类型

类是带字段和方法的记录类型，行为类似 dataclass：

```python
class Point:
    x: int
    y: int

    def sum(self) -> int:
        return self.x + self.y

p = Point(3, 4)
print(p.sum())
```

这不是完整的 Python 面向对象模型：继承、任意类变量和用户 `__init__` 不属于当前记录模型。实例和容器字段采用引用语义。

## 错误与运行时检查

默认情况下，除零、整数溢出和下标越界会以运行时错误终止。原生代码可通过 `SILU_CHECKS=0` 切换为发布行为：整数溢出回绕，下标越界是未定义行为，除零仍然检查。仅在完成验证后使用。

完整 Python 工具链还提供：

```sh
silu program.si              # 参考解释器
silu check program.si       # 子集兼容性检查
silu verify program.si      # 原生输出与解释器对拍
silu prove program.si       # 证明受检 abort 不可达，或报告反例
```

首个原生二进制包只包含 `siluc`/`siluc1`，不包含上述 Python 工具链命令。

`require(condition)` 声明仅供证明器使用的函数契约：

```python
def safe_div(a: int, b: int) -> int:
    require(b != 0)
    return a / b
```

证明器当前覆盖除零、下标边界和字典键，循环按有限界验证，未证明的义务会明确报告。它不保证排除所有崩溃，例如内存耗尽、栈溢出、FFI 故障或编译器缺陷。

## 继续阅读

- [语义契约与限制](semantics_zh.html)
- [内存设计](memory_zh.html)
- [C 互操作](interop_zh.html)
- [和类型 RFC](rfc_sum_types_zh.html)
