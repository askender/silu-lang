# Silu

**A compiled language that matches Rust's speed — and proves its own code can't crash.**

Silu compiles to native binaries through LLVM with performance at parity
with Rust (geometric mean 1.0× across 15 benchmarks), bootstraps its own
compiler (the toolchain is written in Silu and compiled by itself), and
ships a built-in Z3-backed prover that verifies your functions cannot
abort — with counterexample witnesses when they can.

```
$ cat safe.si
def safe_div(a: int, b: int) -> int:
    require(b != 0)
    return a / b

$ silu prove safe.si
safe_div: ok (1 checked abort site(s) proved safe)
verify: ok - no abort reachable
```

## Why Silu

| Property | Detail |
|---|---|
| **Performance** | 1.0× vs Rust (geomean, 15 benchmarks); 14× vs CPython; 500× vs the reference interpreter |
| **Panic-free proofs** | `silu prove` uses Z3 to discharge abort obligations — division by zero, index out of range, KeyError — over ALL inputs, not sampling |
| **Contracts** | `require(cond)` declares a function's domain; the function proves safe standalone, callers are checked separately — removing a caller never invalidates a proof |
| **Self-hosted** | The compiler is written in Silu and compiled by itself; `silu bootstrap` builds the zero-Python toolchain from source in ~25 seconds |
| **Fast compilation** | `./siluc hello.si -o hello` in 0.11 seconds (vs rustc 0.13s) — LTO by default |
| **Memory-safe without GC** | Static type annotations drive the representation; no garbage collector, no borrow checker — the discipline is in the compiler |

## Benchmarks

15 programs compared across six planes (interpreter, CPython, compiled
native, Rust, C, and a self-hosted interpreter). All outputs verified
byte-identical across every plane.

| Program | Silu native | Rust | vs Rust |
|---|---|---|---|
| wordcount | 8.8ms | 15.3ms | **1.8×** |
| dict | 2.2ms | 2.8ms | **1.3×** |
| knucleotide | 11.0ms | 14.8ms | **1.3×** |
| mandelbrot | 2.4ms | 2.7ms | **1.2×** |
| fib | 2.5ms | 2.8ms | **1.1×** |
| spectral | 4.2ms | 4.4ms | **1.05×** |
| arith | 3.3ms | 3.4ms | **1.03×** |
| list | 2.4ms | 2.4ms | 1.0× |
| string | 3.0ms | 2.2ms | 0.7× |
| jsonparse | 8.7ms | 6.4ms | 0.7× |
| **Geometric mean** | | | **1.0×** |

Full methodology and per-program analysis: [docs/benchmarks.md](docs/benchmarks.md)

## The prover

Silu's checked-error policy (abort with a message on division by zero,
out-of-range index, missing key) makes "can this function ever crash?"
a precisely decidable property. `silu prove` drives a symbolic executor
with Z3 to answer it:

- **Real proofs, not sampling**: `a / (b*b + 1)` is proved safe by
  algebraic reasoning (the divisor is always ≥ 1), not by testing
  inputs
- **Witnesses for real bugs**: `m / (n - n)` is flagged with the
  counterexample — the divisor is identically zero
- **Contracts compose**: a function's proof stands alone under its
  declared `require()` domain; removing a caller never invalidates it

```
$ cat spectral.si
def a(i: int, j: int) -> float:
    require(i >= 0 and j >= 0)
    return 1.0 / ((i + j) * (i + j + 1) / 2 + i + 1)

$ silu prove spectral.si
a: ok (1 checked abort site(s) proved safe)
multiply: ok (no checked operations)
multiply_transposed: ok (no checked operations)
verify: ok - no abort reachable
```

## Quick start

```bash
# Install (pip)
pip install pysilu

# Or download pre-built binaries from Releases

# Run a program
silu hello.si

# Compile to a native binary (needs clang)
silu build hello.si -o hello && ./hello

# Build the self-hosted toolchain (one-time, ~25s)
silu bootstrap

# Now use the fast path: zero Python, ~0.13s per compile
./siluc hello.si -o hello

# Prove your code
silu prove my_program.si
```

## Language

Silu is a Python subset with static type annotations that drive the
representation:

```python
def fib(n: int) -> int:
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

def word_frequency(text: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for word in text.split(" "):
        counts[word] = counts.get(word, 0) + 1
    return counts
```

Annotated `int` stays on the stack (i64), `float` stays on the stack
(double), `str` gets a Rust-String-style owned representation, and
containers (`list[int]`, `dict[str, float]`) use unboxed raw storage.
Unannotated code falls back to a dynamic PyObject runtime — both
worlds interoperate through explicit box/unbox boundaries.

The built-in `Json` sum type gives heterogeneous containers a typed
home:

```python
data: Json = [1, "two", {"three": 3}]
items: list[Json] = [data, 5]
print(json_int(items[1]) + len(items))  # 3
json_free(data)  # recursive teardown of the whole tree
```

## Documentation

- [Benchmarks — methodology, six-plane comparison, per-program analysis](docs/benchmarks.md)
- [Memory design — no GC, no borrow checker, measured](docs/memory.md)
- [Sum types RFC — the tagged-union design](docs/rfc_sum_types.md)
- [Symbolic execution roadmap — invariants, prove, equivalence](docs/symbolic_roadmap.md)
- [C interop — @export, from c import, the siluc toolchain](docs/interop.md)

## Toolchain

```
source (.si) → siluc1 (front end + converter, written in Silu) → .ll → clang -flto → native binary
```

The entire compiler — lexer, parser, IR generator, LLVM code generator —
is written in Silu and compiled to a native binary by itself. The
fixed-point proof (the self-hosted converter reproducing its own build
output byte-for-byte) runs in the test suite.

## License

TBD (will be announced before source release)
