# Silu 性能评测结果（2026-10-25）

由 `python benchmarks/run_benchmarks.py --report` 生成。
Apple Silicon，CPython / Rust release / clang -O2，多轮中位数（含进程启动）。

几何平均：**457x vs silu-int，14.1x vs CPython，0.9x vs Rust**

| 程序 | silu 解释器 | CPython | silu 二进制 | Rust | vs 解释器 | vs CPython | vs Rust | 输出 |
|---|---|---|---|---|---|---|---|---|
| arith | 5.821s | 0.090s | 0.0043s | 0.0045s | 1341x | 20.7x | 1.0x | ok |
| dict | 0.283s | 0.036s | 0.0034s | 0.0036s | 82x | 10.5x | 1.0x | ok |
| fannkuch | 0.057s | 0.034s | 0.0032s | 0.0032s | 18x | 10.6x | 1.0x | ok |
| fib | 1.842s | 0.036s | 0.0055s | 0.0045s | 337x | 6.6x | 0.8x | ok |
| float | 3.794s | 0.055s | 0.0061s | 0.0057s | 624x | 9.0x | 0.9x | ok |
| jsonparse | 1.781s | 0.050s | 0.0107s | 0.0047s | 166x | 4.7x | 0.4x | ok |
| knucleotide | 15.852s | 0.832s | 0.0114s | 0.0163s | 1388x | 72.9x | 1.4x | ok |
| list | 0.491s | 0.036s | 0.0031s | 0.0036s | 159x | 11.6x | 1.2x | ok |
| mandelbrot | 1.283s | 0.045s | 0.0038s | 0.0032s | 339x | 11.8x | 0.9x | ok |
| nbody | 63.042s | 0.215s | 0.0060s | 0.0064s | 10530x | 35.9x | 1.1x | ok |
| spectral | 77.151s | 0.299s | 0.0045s | 0.0049s | 16990x | 65.9x | 1.1x | ok |
| string | 0.580s | 0.053s | 0.0028s | 0.0031s | 207x | 19.0x | 1.1x | ok |
| trees | 0.939s | 0.033s | 0.0030s | 0.0031s | 311x | 11.0x | 1.0x | ok |
| wordcount | 7.143s | 0.093s | 0.0241s | 0.0159s | 296x | 3.9x | 0.7x | ok |

方法学与归因实验见 [README.md](README.md)。
