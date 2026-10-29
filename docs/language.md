# Silu Language Guide

Silu uses Python syntax for a **documented subset**, not the whole Python language or its package ecosystem. The native compiler turns annotated programs into native binaries through LLVM.

## A complete program

```python
def fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

print(fib(24))
```

Save as `fib.si` and compile with the native bundle:

```sh
./siluc fib.si -o fib
./fib
```

The compiler requires `clang` on PATH. Keep `siluc` and `siluc1` in the same directory.

## Values and annotations

```python
count: int = 3
ratio: float = 1.5
enabled: bool = True
name: str = "Silu"
numbers: list[int] = [1, 2, 3]
counts: dict[str, int] = {"a": 1}
```

- `int` is signed 64-bit, not an arbitrary-precision Python integer.
- `float` is IEEE-754 double precision. `int / int` produces a float.
- Strings follow Python Unicode code-point indexing and slicing.
- `bool`, `bytes`, lists, dictionaries, functions and record-style classes are supported within the documented subset.
- Conservative inference can give unannotated locals a native representation. Unresolved or conflicting cases use the dynamic representation.

Static annotations determine native representation. They are not optional type hints that can be violated without consequences.

## Functions and control flow

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

Functions support recursion, default arguments, and read-only closures over the defining scope. `if`/`elif`/`else`, `while`, `for`, `break`, `continue`, and a documented `match` subset are available.

## Containers

```python
words = ["silu", "native"]
words.append("compiler")
print(len(words))
print(words[0])

counts: dict[str, int] = {}
for word in words:
    counts[word] = counts.get(word, 0) + 1
```

Container assignment shares the object, as in Python. String values follow an owned-buffer discipline. Not every Python container implementation detail is preserved: native integer/float dictionary iteration order is not promised to match CPython insertion order.

## Records

Classes are record types with dataclass-like fields and methods:

```python
class Point:
    x: int
    y: int

    def sum(self) -> int:
        return self.x + self.y

p = Point(3, 4)
print(p.sum())
```

This is not general Python object orientation: inheritance, arbitrary class variables and user-defined `__init__` are outside this record model. Instance and container fields use reference semantics.

## Errors and checked operations

By default, division by zero, integer overflow and out-of-range indexing stop with a runtime error. `SILU_CHECKS=0` changes the native release behavior: integer overflow wraps and out-of-range indexing is undefined behavior; division by zero remains checked. Use it only after validation.

The wider Python toolchain provides:

```sh
silu program.si              # reference interpreter
silu check program.si       # subset compatibility
silu verify program.si      # compare native output with the interpreter
silu prove program.si       # prove checked aborts unreachable, or report a counterexample
```

The first native binary bundle contains `siluc`/`siluc1`; these Python-toolchain commands are not included in that archive.

`require(condition)` declares a prover-only function contract:

```python
def safe_div(a: int, b: int) -> int:
    require(b != 0)
    return a / b
```

The prover currently targets division by zero, index bounds and dictionary keys. It uses bounded loop verification and explicitly reports unproved obligations. It does not establish absence of every possible crash, such as OOM, stack overflow, FFI failures or compiler defects.

## Read next

- [Semantics and limits](semantics.html)
- [Memory design](memory.html)
- [C interop](interop.html)
- [Sum types RFC](rfc_sum_types.html)
