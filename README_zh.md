# Silu（斯路）

[English](README.md) | **简体中文**

**简明 Python 语法的自举编译型语言。**

Silu 是一个早期语言项目：采用文档明确说明的 Python 语法子集，通过 LLVM 生成原生程序，编译器本身也用 Silu 编写。完整工具链还包括参考解释器，以及检查算术与索引错误的 Z3 证明器。

```python
def greet(name: str) -> str:
    return "Hello, " + name + "!"

print(greet("Silu"))
```

## 下载并编译

当前二进制包提供原生编译器（`siluc` 及其配套 `siluc1`），**不包含** Python 解释器或 `silu prove`。使用时不需要安装 Python；需要 macOS 或 Linux，以及 PATH 中的 `clang`。

1. 从 [Releases](https://github.com/askender/silu-lang/releases) 下载对应机器的压缩包。
2. 解压，保持 `siluc` 与 `siluc1` 位于同一目录：

```sh
tar -xzf siluc-<版本>-<平台>.tar.gz
cd siluc-<版本>-<平台>
chmod +x siluc siluc1
./siluc hello.si -o hello
./hello
# Hello, Silu!
```

macOS 可按需安装 Xcode Command Line Tools；Debian/Ubuntu 可运行 `sudo apt install clang`。

每个压缩包都包含 `hello.si`、`fib.si`、使用说明和 SHA-256 校验文件。仓库中也有 [hello 示例](examples/hello.si)。

## Silu 的特点

- **Python 语法，明确的子集。** 函数、类型注解、容器、记录和控制流都有文档，不宣称任意 CPython 程序都可运行。
- **自举编译器。** 词法、语法、IR 生成和 LLVM 代码生成都用 Silu 编写；不动点检查要求编译器逐字节复现自己的构建输出。
- **原生内存表示。** 静态注解选择非装箱标量、独占字符串缓冲和原生容器，不使用垃圾回收器；所有权和生命周期的取舍明确写入文档。
- **有依据才给出证明。** Python 工具链中的 `silu prove` 检查除零、下标边界和字典键。循环按有限界验证，无法证明的义务会明确报告，不会静默视为安全。
- **性能以报告为准。** v1.9.0 报告覆盖 15 个程序：几何平均为 CPython 的 15.6 倍、参考解释器的 515 倍。同报告对手写 Rust 孪生整体为 0.9 倍——部分更快，部分更慢。见[完整评测](docs/benchmarks_zh.md)。

## 文档

项目网站：[silu.askender.xyz](https://silu.askender.xyz/zh.html)（[English](https://silu.askender.xyz/)）

- [语言指南](docs/language_zh.md) / [Language guide](docs/language.md)
- [语义契约与限制](docs/semantics_zh.md) / [Semantics and limits](docs/semantics.md)
- [性能评测](docs/benchmarks_zh.md) / [Benchmarks](docs/benchmarks.md)
- [内存设计](docs/memory_zh.md) / [Memory design](docs/memory.md)
- [C 互操作](docs/interop_zh.md) / [C interop](docs/interop.md)
- [符号执行路线图](docs/symbolic_roadmap_zh.md) / [Symbolic roadmap](docs/symbolic_roadmap.md)

## 源码发布安排

本仓库发布文档、示例和原生二进制。编译器源码将分阶段公开。`silu-nightly` 是私有开发备份仓库；旧的 `silu` 仓库已暂停发布。

## 许可证

将在源码公开前公布。
