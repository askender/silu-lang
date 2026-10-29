# Memory Management: Silu's Two Disciplines (2026-10-25, v1.9.0 measured)

> Silu has no GC. The static world (typed path) uses **Rust-style
> ownership rules**; the dynamic world (pyobj) **deliberately leaks**.
> This document covers mechanisms, measured data, and the analysis of
> why the static world doesn't need a borrow checker.

## 1. The Static World: Ownership Rules (no GC, no borrow checker)

The typed path produces no garbage that needs tracking — every block of
memory has a single owner from birth:

| Type | Representation | Lifetime Management |
|---|---|---|
| `int` / `float` / `bool` | Stack values (i64/double/i1) | No heap allocation |
| `str` (rawstr) | Exclusive heap buffer `{len,cap,data,cp}` | **Full drop discipline**: assignment copies and frees the old buffer; function exit drops all local slots (`_emit_local_rawstr_drops`); parameters are **borrowed zero-copy** (callee is read-only; `s += x` rebinds via concat — Python aliasing semantics hold precisely: `h(d)` returns "abx" while `d` remains "ab") |
| `list[int]` etc. (rawlist) | Exclusive struct | Assignment is ownership transfer; no scope drop (static-program containers are typically built once) |
| `dict[int,int]` etc. (rawdict) | Exclusive hash table | Same |

**Measured** (Apple Silicon):

- 2M pure-scalar loop iterations: RSS 1MB (zero allocation)
- 200K string-concat loop iterations: RSS 27MB (transient copies, properly
  reclaimed)
- 50K `row = row + "*"`: 2.3ms (amortized O(1) in-place append)

## 2. The Dynamic World: Deliberate Leaking (leak by design)

pyobj boxes (`{i32 tag, i8* data}`; `create_int/str/list/dict/instance`)
are malloc'd and **never freed** — the runtime has no free path for
user-level boxes.

**Measured**: 300K loop iterations, each creating a small list + dict:
RSS 172MB (~570B/iteration, pure leak).

This is intentional:

- pyobj is the **compatibility plane** (CPython semantics), not the
  performance plane
- Programs that care about speed use the typed path (annotated variables),
  which has zero pyobj traffic
- The dynamic world's job is correctness of Python semantics, not
  production memory efficiency
- Long-running servers should use the typed path for all hot data

## 3. Why No Borrow Checker

Rust needs a borrow checker because it allows mutation of shared data
and requires preventing dangling references. Silu's static world avoids
the problem structurally:

- **str is immutable** — borrow-checking a value that can never be mutated
  is unnecessary; a borrowed pointer is always valid
- **Containers transfer ownership on assignment** — no shared mutable
  state means no dangling references
- **Function parameters are borrowed for str, owned for containers** —
  the callee cannot free what it doesn't own

The cost is that some Rust programs can't be written exactly (shared
mutable containers with aliases). The benefit is that the compiler is
simpler and the error messages are about types, not lifetimes.

## 4. Comparison Table

| Aspect | Rust | Silu (static) | Silu (dynamic) |
|---|---|---|---|
| GC | No | No | No |
| Borrow checker | Yes | No | No |
| Memory leaks | None (safe code) | None (typed path) | By design |
| Shared mutable refs | Via `Rc<RefCell<T>>` | Not supported | Via pyobj boxing |
| Dangling refs | Prevented by borrow checker | Structurally impossible | Impossible (leak) |
| Learning curve | Steep (lifetimes) | Type annotations only | None |
| Performance overhead | Zero-cost abstractions | Zero (compile-time discipline) | Boxing cost |

## 5. Design Rationale

The choice is deliberate:

1. **GC** adds runtime complexity, pauses, and memory overhead — Silu
   targets systems-level work where these are unacceptable
2. **Borrow checking** is powerful but has a steep learning curve and
   a complex compiler implementation — Silu achieves memory safety through
   simpler structural rules (immutability + ownership transfer)
3. **Leaking** the dynamic plane is the pragmatic compromise: it gives
   full CPython compatibility without GC complexity, and the typed path
   provides the escape hatch for performance-critical code
