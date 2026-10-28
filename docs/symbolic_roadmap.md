# Symbolic Execution Roadmap

Status: proposed (2026-10-27). The symbolic subsystem is **kept by
decision** — it is not on any compilation critical path today, and
this document is the plan for turning it from an experimental analyzer
into a load-bearing tool.

## What exists today

- ~5,890 lines: `silu/symbolic_executor.py` (2,070), `symbolic_utils.py`
  (~790), `symbolic/` package (condition/loop/builtin/z3/report utils),
  `symbolic_pathlib.py` (execution-path manager)
- Entry points: `silu symbolic <file>` (CLI, lazy-imported so the z3 +
  loguru chain costs nothing otherwise) and the Python API
  (`SymbolicExecutor`, `execute_symbolic_from_file_with_executor`)
- Fast-layer coverage 20–60% per module; 13 dead functions removed in
  the v1.11.2 quality pass, the remaining surface is live
- Dependencies: `z3-solver` (optional at runtime — Z3_AVAILABLE gates),
  `loguru`

## The proven recipe (v1.3, tests/test_symbolic_invariants.py)

The one place symbolic execution has already paid for itself:
container-runtime invariants proved over ALL inputs, not samples.

1. re-express the runtime operation as a Silu program over a symbolic
   list header `{len, cap, items}` (the .si-level model of the C
   runtime),
2. let `SymbolicExecutor` explore paths,
3. hand the obligations to Z3.

Discharged this way: append preserves len/cap for all inputs, growth
is monotone, negative subscripts read from `i + len`, in-bounds reads
never panic and out-of-bounds always panics. The runtime history that
motivated this (list_insert leaving capacity stale → heap overflow)
is exactly the bug class the recipe kills.

## Three application lines, cheapest first

### Phase 1 — extend the invariant gates to the raw families (cheap, direct reuse)

v1.3 covered the pyobj list runtime. The typed backend now has three
more hand-written runtime families with the same bug surface:

- `rawstr` (header `{len, cap, data}`): `rawstr_append` growth
  monotone; `rawstr_slice` clamps match emission (I3/I4 analogues);
  `rawstr_at_*` bounds
- `rawdict` (entries + open-addressed index table): `rawdict_set`
  preserves "slot holds entry_index+1, 0 = empty, -1 = deleted";
  reindex preserves membership; `rawdict_del` tombstone discipline
- `rawutf8` (cp_count/cp_offset): offset < cp_count lands inside the
  buffer; byte-length invariants

Each is a new test class in `test_symbolic_invariants.py` following
the v1.3 template: model header symbolically, execute the operation's
reference semantics, discharge with Z3. The reference semantics are
the exact expressions the emitters generate (`_emit_rawstr_core` and
family), so a proof covers the emitted runtime.

**Exit criterion:** rawstr/rawdict/rawutf8 invariant suites green in
the fast layer; a deliberately broken clamp (mutate the reference)
turns them red (mutation check, as done for the scope-discipline CI
audit in v1.2).

### Phase 2 — `silu verify`: panic-free proofs for user programs (the user-visible feature)

The language's failure policy is abort-with-message on the checked
operations: division by zero, subscript out of range, string index
out of range. That makes "does it ever abort?" a precise, checkable
property — and symbolic execution is the right tool for it.

- CLI: `silu verify program.si [--func name]`
- For each function: symbolic arguments (respecting annotations —
  annotated `int` gets an unconstrained i64, `str` a symbolic header),
  path exploration, Z3 query "is any abort reachable?"
- Output: `ok — no abort reachable` / `possible abort: division by
  zero at line N under [path condition]` — a counterexample path,
  which is what sampling fuzzers cannot give
- Scope control: loops bounded (k-unrolling, as the loop analyzer
  already does), unannotated/pyobj-heavy functions skipped with a note
  (the pyobj heap is out of scope for soundness at first)

This ships the subsystem as a differentiator: a small compiled
language with push-button absence-of-crash proofs for the arithmetic
and indexing core, in the same binary that compiles the program.

**Exit criterion:** verify passes on the 14 benchmark programs' pure
functions (fib, spectral's inner loop, jsonparse's scanner over a
symbolic next-byte model); each of the three abort sites has a
positive test (a program where the abort IS reachable and the tool
says so, with the witness).

### Phase 3 — transform-equivalence proofs (DONE v1.15.2, tests/test_transform_equivalence.py)

Discharged 2026-10-28: T1 borrowed-str callee contract (reads
indistinguishable from a copy; rebind += never mutates the caller)
and T2 the rawlist writeback guard (length-preserved keeps element
identity, growth replaces the pointer, branches mutually exclusive,
post-call state equals the callee's final content). Obligation-
discharge over Z3; the mutation check (guard removed) flips the
suite red. The original plan text follows.

### Phase 3 (original plan) — transform-equivalence proofs (hard, later)

The byte-identical gates prove build reproducibility, not semantic
correctness of the optimizations themselves. The two transforms with
real semantic content — borrowed-str parameter passing (v1.7.1) and
the rawlist aliasing writeback guard (v1.8) — are defined by
invariants ("a borrowed parameter is never freed by the callee", "a
length-unchanged call keeps the caller's slot pointer"). Phase 3 is
discharging those as symbolic obligations over the call protocol,
the way Phase 1 does over the container headers.

Deferred until Phases 1–2 have hardened the engine, because it needs
interprocedural reasoning the current single-function explorer does
not have.

## Maintenance policy until then

- The subsystem stays in `silu/` (not archived), tests stay in the
  fast layer
- New work lands test-first on the invariant template; no broad
  refactors of the explorer until Phase 2 needs them
- Coverage target: raise `symbolic_executor.py` from 41% to at least
  the levels Phase 1–2 exercise; measure again after Phase 1

## Non-goals

- Full pyobj heap modeling (unsound to approximate; skipped, stated)
- Concurrency, floats beyond what Z3's FP theory handles cleanly
- Replacing the byte-identity gates — symbolic proofs complement
  them, they do not subsume them
