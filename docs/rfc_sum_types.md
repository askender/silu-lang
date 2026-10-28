# RFC: Typed Sum Types (tagged unions) for heterogeneous containers

Status: draft for review (2026-10-27). Target: close the last
benchmark gap (jsonparse 0.4x vs Rust) by giving heterogeneous
containers a typed representation, and give the language the one
Rust-core feature it still lacks next to move-class narrowing.

## 1. Problem

`items: list` cannot be given a type parameter when the elements are
mixed (int/str/list/dict in a JSON tree). Such containers stay pyobj:
every element costs a `{tag, ptr}` box allocation, every read a tag
check plus unbox, and container operations go through the dynamic
list/dict runtime. jsonparse spends 6ms of its 10.7ms on this
(pyobj construction is the residual vs Rust's serde_json::Value).

The pyobj box is already a tagged union - the problem is that it is
heap-allocated per value with a payload pointer indirection, and that
containers holding it are fully dynamic. What is missing is a
user-declarable sum type with a compact single-block layout and
typed containers over it.

## 2. Proposed surface syntax

A union is declared with a new `union` statement (subclassing the
established "no inheritance, annotated fields only" class model):

```
union Json:
    null
    bool
    int
    float
    str
    list[Json]
    dict[str, Json]

def parse_value(s: str, pos: list[int]) -> Json:
    ...
    return [v for ...]          # list[Json] construction

def sum_tree(v: Json) -> int:
    match v:
        case int:        # narrow + unbox in one branch
            return v + 1
        case list[Json]:
            total = 0
            for item in v:
                total += sum_tree(item)
            return total
```

- `union Name:` members are kinds, not fields. Members supported in
  v1: `null`, `bool`, `int`, `float`, `str`, `list[T]`, `dict[K, V]`
  where T/V may be the union itself (the recursive case JSON needs).
- The annotation `x: Json` / `list[Json]` / `dict[str, Json]` drives
  everything downstream - same authority model as existing
  annotations.

## 3. Representation

A value of union type is one heap block:

```
{i32 tag, i64 payload}   # 16 bytes, one malloc per value
```

- scalar members carry the value inline (bool as i1-in-i64, int i64,
  float bits)
- `str` carries a rawstr* in the payload (owned; freed recursively)
- `list[T]` carries a rawlist-of-payload-pointer* (elements are
  union blocks: `rawlist_tagged` - a new rawlist family whose element
  width is 8 and whose slot owns each element block)
- `dict[K, V]` carries a rawdict variant with tagged value pointers
  (`rawdict_str_tagged` / `rawdict_int_tagged`)

Tag numbering is declaration order, 0 = first member. The nullary
member (`null`) needs no payload.

This is serde_json::Value's design: enum + Box'd Vec/Map, except our
containers reuse the existing rawlist/rawdict open-addressing
machinery (the emitter families `_emit_rawlist_*` / `_emit_rawdict_*`
grow two element families rather than a new container runtime).

## 4. Runtime surface (emitted, `_emit_tagged_*` family)

- `tagged_new_scalar(tag, bits) -> blk*`
- `tagged_new_str(tag, rawstr*) -> blk*`
- `tagged_new_list(tag, rawlist_tagged*) -> blk*`   (dict same)
- `tagged_tag(blk*) -> i32`
- `tagged_bits(blk*) -> i64`          (scalar unbox; narrow-verified)
- `tagged_str(blk*) -> rawstr*`       (borrowed read)
- `tagged_list(blk*) -> rawlist_tagged*` (borrowed read)
- `tagged_free(blk*)`                 (recursive; JSON is a tree, no
                                       cycles by construction)
- `rawlist_tagged_push/get/set/clear` (slot owns blocks)

Borrow discipline follows the v1.7.1 rules verbatim: reads are
borrowed pointers, rebinding an owned slot frees the old block only
when the slot is owned (`_owned_strs` generalizes to
`_owned_tagged`), function-exit drops owned slots, borrowed
parameters are never freed by the callee.

## 5. Codegen paths

1. IR: `union Json: ...` desugars to a class_def whose "fields" are
   member descriptors; the front end records
   `union_members["Json"] = [(name, member_kind), ...]`.
2. `_annotation_kind`: `Json` resolves to kind `"tagged:Json"` (new
   kind family, carried as a string like the raw kinds);
   `list[Json]` -> `rawlist_tagged`, `dict[str, Json]` ->
   `rawdict_str_tagged`.
3. Construction: a list literal with element kind tagged emits
   per-element `tagged_new_*` + `rawlist_tagged` build (same shape as
   the existing comprehension desugar).
4. Narrowing: `match v: case int:` reuses the v1.7 match-class
   narrowing - the case tests `tagged_tag` against the member's tag
   constant, then the body sees `v` re-typed to the member kind
   (scalar slots load `tagged_bits`, str slots `tagged_str`).
5. Subscript/iteration over `list[Json]` yields kind `"tagged:Json"`
   through the same `RAWLIST_KINDS` table used by the v1.11.3
   subscript inference (one new row).

## 6. Staged delivery (byte-gate discipline)

- S0 probe: hand-write the `tagged_new/tagged_tag/tagged_bits`
  emitter + a 20-line .si using inline IR calls, measure a
  construction loop vs pyobj. Go/no-go on >=2x.
- S1 runtime: full `_emit_tagged_*` family + `rawlist_tagged`
  element family (emitters only; corpus byte-identical since no
  program reaches them).
- S2 front end + annotations: union parse, kind resolution,
  construction/narrowing emission; new tests; corpus unchanged
  (opt-in syntax).
- S3 four-plane: flatten/`.si` subset for any new dual-valid idioms;
  fixed points rebuilt; jsonparse.si rewritten to the Json union
  (benchmark change, output-verified against the pyobj version).
- S4 ownership audit: borrowed-read rules, exit drops, a
  double-free probe test; symbolic invariant proof of
  `tagged_free` acyclicity-by-construction (roadmap Phase 1 tie-in).

## 7c. S3 result (2026-10-28): landed on every plane, measured honestly

benchmarks/jsonparse_json.si - the full parser rewritten over the
built-in Json type (blocks riding raw containers, json_* builtins,
recursive json_free of the whole tree). All four planes agree on the
87KB document, byte-identical to the class-based twin and to the
Rust serde_json twin: 4498500 3000 22890 3000.

The id/name "emission bug" from the S3 WIP was NOT an emission bug:
tagged_dict_free read field 4 (the open-addressing TABLE - small
entry indices!) as the value array; freeing table entries as block
pointers segfaults exactly when a dict has two live keys. vals is
field 6. One-line fix.

Performance (official harness, this machine): class twin 8.9ms,
Json twin 10.1ms - the Json version is NET 1.2ms SLOWER. The ~0.3ms
construction saving (as the 7b measurement predicted) is outweighed
by consumption-side costs the model missed: every read pays a
tagged_tag dispatch plus a checked unwrap call (~25ns x thousands
of reads). Expression-value completeness landed; performance parity
with the class twin would need inline tag checks at narrow points -
a separate, optional optimization.

## 7b. S1 benefit measurement (2026-10-27, tools/probes/s1_benefit.py)

With the REAL S1 emitters (not the S0 hand-rolled malloc shapes), a
mixed construction probe matching jsonparse's value distribution
(int + str + small array per group, values escaped to a global sink
so clang cannot eliminate them):

    pyobj  (create_int + create_str + create_list + appends +
            pyobj_make_instance):  ~47ns/value
    tagged (new_scalar + new_ptr + rawlist + wrap):   ~37ns/value
    ratio: 1.20x

Far below the S0 scalar-only 1.96x: str copies and container
construction are shared costs. Re-projected for jsonparse: the
construction share (~1.9ms) shrinks by ~20% = **~0.3-0.4ms**,
taking 8.0ms to ~7.6ms - NOT enough to overtake Rust on its own.
The J1 v_noinst delta (1.64ms) includes the CONSUMPTION side
(class-pattern narrowing); the remaining gap needs a consumption-
side attribution before more construction-side work. S2 proceeds
for the expressive-completeness motivation (heterogeneous
containers get a typed home), with performance expectations
recorded honestly here.

## 7. Expected outcome - REVISED after S0 (2026-10-27)

S0 probe result (tools/probes/): tagged construction is **1.96x**
faster than pyobj (93.4ms vs 47.7ms for 3M values, 11-run median) -
meets the go bar on the construction loop itself.

However, the same day's attribution study revised the jsonparse
projection. Construction (instances + containers) is only ~12% of
jsonparse's runtime (16.24ms full vs 14.60ms without instance
wrapping vs 14.34ms without containers); the dominant cost is the
per-character 1-byte str allocation of `ch = s[i]` (~62ns/char x 87k
chars ~= 5.4ms, matching the whole 5.2ms gap to Rust; an ord()-
rewrite probe scans 2.7x faster). So:

- Landing tagged unions alone moves jsonparse by ~0.9ms
  (0.5x -> ~0.55x), NOT the 1.0-1.2x originally projected here.
- The jsonparse gap's main lever is character-access
  zero-allocation (extending RAWCHAR_VIEW emission to subscript
  reads, `s[i] == "c"` comparison folding) - tracked separately.
- Tagged unions remain the right call for the language's expressive
  completeness (heterogeneous containers get a typed home, all
  parser/AST programs), and their 2x construction win compounds once
  character access is fixed. Delivery order: character access first
  (bigger, cheaper), tagged unions second.

The original projection is kept below for the record:
jsonparse: pyobj box (2 mallocs + payload indirection per value) ->
one 16-byte block (str leaves still need their data block) and
typed containers. Prediction from the wordcount arithmetic (85ns ->
~27ns per eliminated box): 10.7ms -> ~5-6ms, i.e. 1.0-1.2x vs the
Rust serde_json baseline.

## 8. Risks / open questions

- Representation freeze: 16-byte blocks are hard to change after
  C-ABI export; keep `tagged_*` out of `@export` until S3 lands.
- Error mode: narrowing a wrong tag must abort loudly (same policy
  as subscript bounds) - not return a default.
- Only one union per element type family in v1 (Json-shaped); user
  unions with arbitrary members are deliberately phase 2.
- Recursive `dict[str, Json]` values inside rawdict need an owned-
  slot clear hook (`rawdict_str_tagged_clear` frees value blocks) -
  one more emitter, same recipe.

## 8b. S4 ownership audit (2026-10-28): reference model, explicit frees

Emitted-call census (static, in tests/test_tagged_ownership.py):
every tagged_free in generated code enters through exactly ONE
user-facing path - the json_free builtin - and the recursive trio
(list_free -> free -> list_free, dict_free -> free -> dict_free)
closes internally. No other emitter reaches a free.

Ownership semantics, decided from the shape of the channels:

- Construction points (coerce wrapping of scalars/str/containers,
  literal specials) each malloc a fresh block: OWNED at birth.
- `y = x` on Json slots coerces JSON->JSON as the same tv: two slots
  SHARE the block (Python reference semantics - unlike RAWSTR,
  whose slot-to-slot coercion copies). Container reads (items[i],
  o[k]) and json_list/json_dict results are BORROWED views into a
  tree the tree itself owns.
- Therefore COMPILER-EMITTED per-slot drops are UNSOUND: a shared
  block has no single owning slot, and a borrowed read must never
  free. The S4 "exit drops" idea from the original staging is
  formally rejected here.

The model that ships: EXPLICIT free with move discipline. json_free
is a move (the caller relinquishes; use-after-free is documented
UB, same class as Rust's mem::forget + dangling). The FIRST slot a
constructed tree lands in is its owner and owes the free; reads and
pass-through assignments are observers. Un-freed trees are
reclaimed at process exit (the pyobj discipline). Long-lived
services free roots explicitly - the jsonparse_json.si twin shows
the pattern (one json_free(data) tears the whole tree down, names
kept as independent str copies stay alive).

Future direction (not promised): a `unique` slot annotation or
static owner inference could restore automatic drops; the reference
semantics make that a breaking change, so it would be opt-in.

## 9. Non-goals

- Generics over unions, C-ABI tagged exports, cycle collection
  (union values are trees by construction).
