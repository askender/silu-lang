# Silu

**English** | [简体中文](README_zh.md)

**A concise, self-hosted, compiled language with Python syntax.**

Silu is an early-stage language with a documented Python-syntax subset, an LLVM native compiler, and a compiler written in Silu itself. The wider toolchain includes a reference interpreter and a Z3-backed prover for checked arithmetic and indexing errors.

```python
def greet(name: str) -> str:
    return "Hello, " + name + "!"

print(greet("Silu"))
```

## Download and compile

The current binary bundle contains the native compiler (`siluc` and its companion `siluc1`), not the Python interpreter or `silu prove`. No Python installation is needed to use it. You need macOS or Linux and `clang` on PATH.

1. Download the archive for your machine from [Releases](https://github.com/askender/silu-lang/releases).
2. Extract it, keeping `siluc` and `siluc1` together:

```sh
tar -xzf siluc-<version>-<platform>.tar.gz
cd siluc-<version>-<platform>
chmod +x siluc siluc1
./siluc hello.si -o hello
./hello
# Hello, Silu!
```

For macOS, install the Xcode Command Line Tools if needed. On Debian/Ubuntu, use `sudo apt install clang`.

Each archive includes `hello.si`, `fib.si`, a README and a SHA-256 checksum. See [examples/hello.si](examples/hello.si) in this repository as well.

## What defines Silu

- **Python syntax, explicit subset.** Functions, annotations, containers, records and control flow are documented rather than assumed compatible with arbitrary CPython programs.
- **Self-hosted compiler.** The lexer, parser, IR generator and LLVM code generator are written in Silu. A fixed-point check reproduces the compiler's own build output byte-for-byte.
- **Native representation.** Static annotations select unboxed scalars, owned string buffers and raw containers; no garbage collector is used. Ownership and lifetime trade-offs are documented.
- **Proofs where the tool can justify them.** In the Python toolchain, `silu prove` checks division by zero, index bounds and dictionary keys. Loops have a finite verification bound, and unproved obligations are reported rather than silently accepted.
- **Measured performance.** The v1.9.0 report covers 15 programs: 15.6× CPython and 515× the reference interpreter in geometric mean. The same report is 0.9× against hand-written Rust twins overall — some programs faster, some slower. See the full [benchmark report](docs/benchmarks.md).

## Documentation

Project site: [silu.askender.xyz](https://silu.askender.xyz/) ([中文](https://silu.askender.xyz/zh.html))

- [Language guide](docs/language.md) / [语言指南](docs/language_zh.md)
- [Semantics and limits](docs/semantics.md) / [语义契约与限制](docs/semantics_zh.md)
- [Benchmarks](docs/benchmarks.md) / [性能评测](docs/benchmarks_zh.md)
- [Memory design](docs/memory.md) / [内存设计](docs/memory_zh.md)
- [C interop](docs/interop.md) / [C 互操作](docs/interop_zh.md)
- [Symbolic roadmap](docs/symbolic_roadmap.md) / [符号执行路线图](docs/symbolic_roadmap_zh.md)

## Source availability

This repository publishes documentation, examples and native binary releases. The compiler source is being prepared for staged publication. The separate `silu-nightly` repository is a private development backup; the older `silu` repository is paused.

## License

To be announced before source publication.
