# RFC：类型化 Sum Type（带标签联合）——异构容器的类型归宿

状态：待评审（2026-10-27）。目标：通过给异构容器一个类型化表示
来收掉最后的基准差距（jsonparse 0.4× vs Rust），并给语言补上与
match 类窄化并列的 Rust 核心特性。

## 1. 问题

`items: list` 在元素混合时（JSON 树中的 int/str/list/dict）无法给
出类型参数。这类容器保持 pyobj：每个元素花费一个 `{tag, ptr}` 盒
分配，每次读取一次 tag 检查加拆箱，容器操作走动态 list/dict 运行时。
jsonparse 的 10.7ms 中有 6ms 花在这上面（pyobj 构造是与 Rust 的
serde_json::Value 之间的残余差距）。

pyobj 盒本身已经是带标签联合——问题在于它是每值一次堆分配加
payload 指针间接，而且装它的容器是全动态的。缺的是用户可声明的
sum type，配紧凑的单块布局和其上的类型化容器。

## 2. 语法面

用新的 `union` 声明（沿用既定的"无继承、仅注解字段"类模型）：

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
    return [v for ...]          # list[Json] 构造

def sum_tree(v: Json) -> int:
    match v:
        case int:        # 一分支窄化 + 拆箱
            return v + 1
        case list[Json]:
            total = 0
            for item in v:
                total += sum_tree(item)
            return total
```

- `union Name:` 的成员是种类，不是字段。v1 支持的成员：`null`、
  `bool`、`int`、`float`、`str`、`list[T]`、`dict[K, V]`（T/V 可以
  是联合自身——JSON 需要的递归场景）。
- 注解 `x: Json` / `list[Json]` / `dict[str, Json]` 驱动一切下游
  ——与现有注解相同的权威模型。

## 3. 表示

联合类型的值是一个堆块：

```
{i32 tag, i64 payload}   # 16 字节，每值一次 malloc
```

- 标量成员内联携带值（bool 是 i1-in-i64，int 是 i64，float 是位模式）
- `str` 携带一个 rawstr*（owned；递归释放）
- `list[T]` 携带一个 rawlist-of-payload-pointer*（元素是联合块）
- `dict[K, V]` 携带一个 rawdict 变体

标签编号即声明顺序，0 = 第一个成员。无参成员（`null`）不需要
payload。这是 serde_json::Value 的设计：enum + Box'd Vec/Map，
区别在于我们的容器复用既有的 rawlist/rawdict 开放寻址机制。

## 4. 运行时面（发射为 `_emit_tagged_*` 家族）

- `tagged_new_scalar(tag, bits) -> blk*`
- `tagged_new_str(tag, rawstr*) -> blk*`
- `tagged_new_list(tag, rawlist*) -> blk*`
- `tagged_tag(blk*) -> i32`
- `tagged_bits(blk*) -> i64`
- `tagged_str(blk*) -> rawstr*`（借用读）
- `tagged_list(blk*) -> rawlist*`（借用读）
- `tagged_free(blk*)`（递归释放；JSON 是树形，构造上无环）

借用纪律完全遵循 v1.7.1 规则：读取是借用指针，重绑 owned 槽只在
槽是 owned 时释放旧块（`_owned_strs` 推广为 `_owned_tagged`），
函数退出 drop 全部 owned 槽，被调方永不释放借用参数。

## 5. 编译路径

1. IR：`union Json: ...` 脱糖为 class_def，其"字段"是成员描述；
   前端记录 `union_members["Json"] = [(name, member_kind), ...]`。
2. `_annotation_kind`：`Json` 解析为 kind `"tagged:Json"`；
   `list[Json]` → `rawlist_tagged`，`dict[str, Json]` →
   `rawdict_str_tagged`。
3. 构造：元素 kind 为 tagged 的 list 字面量逐元素发射
   `tagged_new_*` + rawlist_tagged 构建。
4. 窄化：`match v: case int:` 复用 v1.7 match-class 窄化——case
   测试 `tagged_tag` 对成员的标签常量，然后 body 里 `v` 重定型为
   成员 kind。
5. `list[Json]` 的下标/迭代产出 kind `"tagged:Json"`（走与
   v1.11.3 下标推断相同的 `RAWLIST_KINDS` 表，新加一行）。

## 6. 分阶段交付（字节门禁纪律）

- S0 探针：手写 `tagged_new/tagged_tag/tagged_bits` 发射器 + 一个
  20 行 .si 用内联 IR 调用，测一个构造循环 vs pyobj。≥2× 才继续。
- S1 运行时：完整 `_emit_tagged_*` 家族 + rawlist_tagged 元素族
  （仅发射器；语料字节一致，因为没有程序到达它们）。
- S2 前端 + 注解：union 解析、kind 解析、构造/窄化发射；新测试；
  语料不变（opt-in 语法）。
- S3 四平面：flatten/.si 子集；固定点重建；jsonparse.si 改写为
  Json union 版本（benchmark 变更，输出对拍验证）。
- S4 所有权审计：借用读规则、退出 drop、双释放探针测试。

## 7. 预期成果

jsonparse：pyobj 盒（每值 2 次 malloc + payload 间接）→ 一个 16 字节
块（str 叶子仍需其 data 块）和类型化容器。从 wordcount 算术预测
（每消除一个盒 85ns → ~27ns）：10.7ms → ~5-6ms，即 vs Rust
serde_json 基线 1.0-1.2×。次级：任何解析器/AST 遍历程序在用户空间
免费获得同一表示。

## 8. 风险 / 开放问题

- 表示冻结：16 字节块在 C-ABI export 后很难改；S3 落地前保持
  `tagged_*` 不进 `@export`。
- 错误模式：窄化错误标签必须响亮 abort（与下标边界同政策）——
  不静默返回默认值。
- v1 仅一个联合每元素类型族（Json 形态）；任意成员的用户联合
  是明确的第二阶段。
- 递归 `dict[str, Json]` 值在 rawdict 内需要 owned-slot 清理钩子
  （`rawdict_str_tagged_clear` 释放值块）——多一个发射器，同配方。

## 9. 非目标

- 联合上的泛型、C-ABI tagged 导出、环回收（联合值构造上是树）。
