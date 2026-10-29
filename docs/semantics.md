# Semantics and Limits

This page records where Silu follows Python and where the native representation deliberately differs. It is the reference to read before writing performance-sensitive code.

## Numbers

| Behavior | Silu |
|---|---|
| Integer representation | Signed 64-bit (`i64`), not Python arbitrary precision |
| Overflow, default | Checked runtime error |
| Overflow, `SILU_CHECKS=0` | Two's-complement wrap |
| Float | IEEE-754 double precision |
| Division | `int / int` yields a float; `//` and `%` follow Python floor semantics |
| Division by zero | Always a checked runtime error |
| Mixed `int`/`float` | Integer is promoted to float |

Programs that require arbitrary-precision integers are not a fit for the current native integer model.

## Strings

`len(s)`, `s[i]`, slices and iteration use Unicode code-point semantics, like Python. Native indexing may require a code-point walk; it is not a promise of constant-time arbitrary indexing.

Native strings use owned buffers. Assignment copies a string value, appending may reuse its buffer, and an overwritten or scope-exit slot releases its storage where the static ownership rules permit. Borrowed arguments avoid copying a string merely to call a function.

## Containers and records

- List/dict assignment and arguments share the object, like Python references.
- To avoid use-after-free in the absence of escape analysis, native integer/float containers and record instances are not scope-dropped; their allocations can live until process exit.
- `list[str]` and string keys use explicit copy-in/copy-out ownership rules. See the [memory design](memory.html) for details.
- Native integer/float dictionaries use open addressing. Iteration/printing order is not guaranteed to match CPython insertion order.
- Classes are record types, not unrestricted Python classes. Instance assignment shares the instance; container fields also share their objects.

These are important limits for long-running programs with large transient container graphs. There is no tracing garbage collector.

## Native checks

| Configuration | Overflow | Index bounds | Division by zero |
|---|---|---|---|
| `SILU_CHECKS=1` (default) | Checked error | Checked error | Checked error |
| `SILU_CHECKS=0` | Wrap | **Undefined behavior** | Checked error |

Disabling bounds checks is only appropriate after the relevant program has been validated. The prover's checks do not turn arbitrary unchecked native code into memory-safe code.

## Verification tools

- `silu verify program.si` compares native output against the reference interpreter.
- `silu symbolic program.si` explores feasible paths and constraints.
- `silu prove program.si` checks supported abort obligations and reports counterexamples for reachable failures.

### Prover scope

The current prover targets division/modulo by zero, statically analyzable index bounds and dictionary keys. `require(condition)` defines a function's proof domain; the function is proved independently, and call sites are checked against that contract.

Path conditions guide the proof. Loops use bounded verification. If the solver cannot discharge an obligation, it is reported as unproved rather than silently treated as safe.

The prover does **not** cover every possible failure: memory exhaustion, stack overflow, arbitrary dynamic behavior, FFI faults, undefined behavior from disabled native checks, and compiler implementation defects are outside its claim.

These Python-toolchain commands are not part of the first native `siluc` binary archive.

## Interoperability

The `@export` and `from c import` forms expose static scalar interfaces to C. Arbitrary dynamic objects do not cross the C boundary. See [C interop](interop.html) for supported signatures and ownership rules.
