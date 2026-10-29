# C Interop & the Self-Hosted Toolchain

Silu interoperability has two doors: **@export** (Silu functions become C
symbols, linked and called by C/Rust hosts) and **from c import** (Silu
declares and calls external C functions). Together with the self-hosted
toolchain `siluc` (one command, zero Python), the full usage follows.

## Compilation Commands Overview

```bash
# ① Self-hosted pipeline (recommended): siluc C driver + siluc1 native compiler + clang
./siluc program.si -o program          # One line, zero Python, 0.13s

# ② Emit a linkable object + auto-generated C header
./siluc lib.si -o lib.o --object       # Produces lib.o + lib.o.h

# ③ Python compiler (development/debugging)
python -m silu build program.si -o program

# ④ Fully manual, zero-Python low-level pipeline (compiles all runtime, slow)
./silu_fe < program.si | ./silu_conv > program.ll
clang -O2 program.ll -o program
```

`siluc` and `siluc1` are automatically rebuilt by
`python tools/selfhost_build.py` based on source mtime; first build
takes ~25s, subsequent builds are reused. The runtime .o cache lives in
`~/.cache/silu-runtime/driver/`, cold-cache one-time ~0.4s.

## Direction 1: Silu → C Library (@export)

```python
@export
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)
```

Compile and link:

```bash
./siluc fib.si -o fib.o --object       # fib.o + fib.o.h
```

The generated `fib.o.h`:

```c
long long fibonacci(long long n);
```

Link from C:

```c
#include "fib.o.h"
#include <stdio.h>

int main(void) {
    printf("%lld\n", fibonacci(25));  // 75025
    return 0;
}
```

```bash
clang -O2 main.c fib.o -o demo && ./demo
```

## Direction 2: C Library → Silu (from c import)

```python
from c import sqrt, printf

def hypotenuse(a: float, b: float) -> float:
    return sqrt(a * a + b * b)
```

The compiler emits `declare` statements for the external C functions,
matching the argument kinds at each call site. The function signature
is inferred from how Silu uses it — no separate header file needed.

Link with the C library:

```bash
./siluc math_demo.si -o math_demo -lm
```

## The siluc Toolchain

```
source (.si) → siluc1 (front end + converter, written in Silu) → .ll → clang -flto → native binary
```

| Component | Language | Role |
|---|---|---|
| `siluc` | C (~400 lines) | File-in binary-out driver; spawns siluc1, splits output, invokes clang |
| `siluc1` | Silu | The monolithic compiler: lexer, parser, IR generator, LLVM code generator |
| runtime | compiled .o | Cached C runtime (178 functions, rebuilt on source change) |

### Self-hosting proof

The fixed-point test (in the test suite) proves the self-hosted compiler
reproduces its own build output byte-for-byte:

1. The Silu-written converter compiles its own source
2. The output .ll must be identical to the .ll used to build it
3. This runs on every commit — any divergence fails the build

### Bootstrap command

```bash
pip install pysilu
silu bootstrap    # One-time build: siluc1 (~25s) + siluc C driver
```

After bootstrap, the pipeline contains zero Python:
`./siluc file.si -o program` completes in 0.11 seconds.
