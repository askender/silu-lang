// host.mjs - JS host for freestanding wasm64 Silu compiler modules.
//
// Satisfies the silu_host import surface declared in shim_libc.c:
//   mem_grow, die, write, fmt_double, strtod, getchar, pow,
//   file_open/file_read/file_seek/file_tell/file_close, exit
// All wasm64 i64 boundary values arrive as BigInt; pointers are BigInt.
//
// CLI: node host.mjs <module.wasm> [input-file] [--file NAME=PATH]...
// stdin of the guest = input-file bytes (or --stdin-data); guest stdout
// goes to this process's stdout, exit code propagates.

const latin1Dec = new TextDecoder("latin1");
const latin1 = (bytes) => latin1Dec.decode(bytes);

function concatU8(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) out.set(c, at), (at += c.length);
  return out;
}

/* ---------- C-like double formatting (%f / %e / %g) ----------
 * Byte-compatibility target: the platform C library (verified by
 * wasm/test_shim.mjs against wasm/test_shim_ref.c output).
 * - %f: exact BigInt expansion of the double (toFixed falls back to
 *   exponential notation at >=1e21 and would break byte identity)
 * - rounding: half-even on the exact decimal expansion (IEEE default)
 * - %g: trailing-zero stripping touches the mantissa only */

const f64bits = new DataView(new ArrayBuffer(8));

function decompose(v) {
  f64bits.setFloat64(0, v);
  const bits = f64bits.getBigUint64(0);
  const neg = bits >> 63n === 1n;
  const expF = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  return { neg, expF, frac, M: expF === 0 ? frac : frac | (1n << 52n), E: expF === 0 ? -1074 : expF - 1075 };
}

// exact |v| rendered with exactly `prec` digits after the point
function fixedExact(v, prec) {
  const { M, E } = decompose(v);
  let digits; // |v| * 10^prec, rounded half-even
  if (E >= 0) {
    digits = (M << BigInt(E)) * 10n ** BigInt(prec);
  } else if (prec + E >= 0) {
    digits = M * 5n ** BigInt(prec) << BigInt(E + prec);
  } else {
    const num = M * 5n ** BigInt(prec);
    const den = 1n << BigInt(-(E + prec));
    const q = num / den;
    const r2 = (num % den) * 2n;
    digits = r2 > den || (r2 === den && (q & 1n) === 1n) ? q + 1n : q;
  }
  let s = digits.toString();
  if (prec > 0) {
    s = s.padStart(prec + 1, "0");
    s = s.slice(0, -prec) + "." + s.slice(-prec);
  }
  return s;
}

// exact decimal expansion of a finite |v| > 0, rounded to `sig`
// significant digits with half-even ties (C printf semantics; JS
// toExponential rounds half-UP on the decimal approximation instead)
function expExact(abs, sig) {
  const { M, E } = decompose(abs);
  // |v| = M * 2^E; its decimal expansion is finite:
  //   E >= 0: integer M * 2^E        E < 0: num = M * 5^(-E) over 10^(-E)
  let digits, e10;
  if (E >= 0) {
    digits = (M << BigInt(E)).toString();
    e10 = digits.length - 1;
  } else {
    const k = BigInt(-E);
    const num = (M * 5n ** k).toString();
    e10 = num.length - 1 - Number(k);
    digits = num;
  }
  let keep, rest;
  if (digits.length > sig) {
    keep = digits.slice(0, sig);
    rest = digits.slice(sig);
  } else {
    keep = digits.padEnd(sig, "0");
    rest = "0";
  }
  const restNonzero = /[1-9]/.test(rest.slice(1));
  const gtHalf = rest[0] > "5" || (rest[0] === "5" && restNonzero);
  const tie = rest[0] === "5" && !restNonzero;
  const inc = gtHalf || (tie && BigInt(keep) % 2n === 1n);
  if (inc) {
    keep = (BigInt(keep) + 1n).toString();
    if (keep.length > sig) return { d: "1", frac: "0".repeat(sig - 1), e10: e10 + 1 };
    keep = keep.padStart(sig, "0");
  }
  return { d: keep[0], frac: keep.slice(1), e10 };
}

function fixExp(s, upper) {
  // JS "1.5e+0" -> C "1.500000e+00" (exponent >= 2 digits)
  let [m, e] = s.split("e");
  const xi = parseInt(e, 10);
  const sign = xi < 0 ? "-" : "+";
  e = (upper ? "E" : "e") + sign + String(Math.abs(xi)).padStart(2, "0");
  return m + e;
}

/* CPython repr(v): shortest round-trip digits (identical to JS
 * String(v) by the shortest-repr guarantee), CPython's thresholds
 * (exponential when decpt <= -4 or > 16) and the ADD_DOT_0 rule. */
function cReprDouble(v) {
  if (Number.isNaN(v)) return "nan";
  if (v === Infinity) return "inf";
  if (v === -Infinity) return "-inf";
  const neg = Object.is(v, -0) || v < 0;
  const abs = Math.abs(v);
  let s = String(abs);
  let mant, intLen;
  if (s.includes("e")) {
    const parts = s.split("e");
    const m = parts[0];
    const e = parseInt(parts[1], 10);
    mant = m.replace(".", "");
    if (m.includes(".")) intLen = m.indexOf(".") + e;
    else intLen = m.length + e;
  } else if (s.includes(".")) {
    const idx = s.indexOf(".");
    mant = s.replace(".", "");
    intLen = idx;
  } else {
    mant = s;
    intLen = s.length;
  }
  const decpt = intLen;
  // JS gives fixed form "0.000xyz" down to 1e-6, so mant carries the
  // integer-part zero plus fractional leading zeros; the repr
  // exponential rule keys on the ADJUSTED exponent (leading digit),
  // not the raw decpt.
  const lz = mant.length - mant.replace(/^0+/, "").length;
  const adjExp = decpt - 1 - lz;
  let body;
  const mkExp = () => {
    let d = mant.replace(/^0+/, "");
    const e10 = adjExp;
    while (d.length > 1 && d.endsWith("0")) d = d.slice(0, -1);
    const sign = e10 < 0 ? "-" : "+";
    const frac = d.length > 1 ? "." + d.slice(1) : "";
    return d[0] + frac + "e" + sign + String(Math.abs(e10)).padStart(2, "0");
  };
  if (adjExp <= -5 || adjExp >= 16) {
    body = mkExp();
  } else if (decpt <= 0) {
    let f = "0." + "0".repeat(-decpt) + mant;
    if (!f.includes(".") || f.split(".")[1] === "") f += "0";
    body = f;
  } else if (decpt >= mant.length) {
    body = mant + "0".repeat(decpt - mant.length) + ".0";
  } else {
    body = mant.slice(0, decpt) + "." + mant.slice(decpt);
  }
  return (neg ? "-" : "") + body;
}

function cFormatDouble(v, spec, prec) {
  if (prec < 0) prec = 6;
  const { neg, expF, frac } = decompose(v);
  const sign = neg ? "-" : "";
  if (expF === 0x7ff) return sign + (frac === 0n ? "inf" : "nan");
  const abs = Math.abs(v);
  if (spec === "f") return sign + fixedExact(abs, prec);
  if (spec === "e" || spec === "E") {
    if (abs === 0) return sign + (prec > 0 ? "0." + "0".repeat(prec) : "0") + "e+00";
    const { d, frac, e10 } = expExact(abs, prec + 1);
    const body = d + (prec > 0 ? "." + frac : "");
    return sign + body + (spec === "E" ? "E" : "e") + (e10 < 0 ? "-" : "+")
      + String(Math.abs(e10)).padStart(2, "0");
  }
  // %g / %G: round to P significant digits FIRST, then decide the style
  // on the rounded exponent (matches C)
  const P = prec === 0 ? 1 : prec;
  if (abs === 0) return sign + "0";
  const r = expExact(abs, P);
  const X = r.e10;
  if (X >= -4 && X < P) {
    return sign + fixExpTail(fixedExact(abs, P - 1 - X));
  }
  const gf = r.frac.replace(/0+$/, "");
  return sign + r.d + (gf ? "." + gf : "") + (spec === "G" ? "E" : "e")
    + (X < 0 ? "-" : "+") + String(Math.abs(X)).padStart(2, "0");
}

function fixExpTail(s) {
  // strip trailing zeros in the fraction of a plain fixed string
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}


const hexpow = new DataView(new ArrayBuffer(8));
function hexFloat(neg, hexStr, fracLen, pexp) {
  // value = hexStr * 2^(pexp - 4*fracLen), correctly rounded half-even
  let v = BigInt("0x" + (hexStr || "0"));
  let e2 = pexp - 4 * fracLen;
  if (v === 0n) return neg ? -0 : 0;
  let bl = v.toString(2).length;
  if (bl > 53) {
    const shift = BigInt(bl - 53);
    const lost = v & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    v >>= shift;
    e2 += Number(shift);
    if (lost > half || (lost === half && (v & 1n) === 1n)) v += 1n;
    if (v >> 53n !== 0n) { v >>= 1n; e2++; }
    bl = 53;
  }
  // normalize: value = v * 2^e2 with v < 2^53
  let exp = e2 + bl - 1; // unbiased exponent
  let mant = v;
  if (exp > 1023) return neg ? -Infinity : Infinity;
  if (exp < -1074) return neg ? -0 : 0;
  if (exp < -1021) {
    // subnormal: shift mantissa so exponent field is 0
    const sh = -1021 - exp;
    mant = mant >> BigInt(sh - 1);
    const lost = mant & 1n;
    mant >>= 1n;
    if (lost === 1n) mant += 1n; // approx half-even; denormal hex literals never occur in Silu source
    exp = -1022;
    if (mant >> 52n === 1n) { mant >>= 1n; exp = -1021; }
  } else {
    mant -= 1n << BigInt(bl - 1); // remove the implicit leading bit
    mant <<= BigInt(52 - (bl - 1)); // fraction field is top-aligned
  }
  const bits = (BigInt(neg ? 1 : 0) << 63n) | BigInt(exp + 1023) << 52n | mant;
  hexpow.setBigUint64(0, bits);
  return hexpow.getFloat64(0);
}

function cStrtod(bytes, offset, len) {
  let i = offset;
  const end = offset + len;
  const isWs = (c) => c === 32 || (c >= 9 && c <= 13);
  while (i < end && isWs(bytes[i])) i++;
  let j = i;
  let neg = false;
  if (j < end && (bytes[j] === 43 || bytes[j] === 45)) {
    neg = bytes[j] === 45;
    j++;
  }
  const wordStart = j;
  // infinity / nan words
  const lowerFrom = (k, n) => {
    if (k + n > end) return false;
    for (let t = 0; t < n; t++) {
      const c = bytes[k + t];
      if ((c | 32) !== "infinity"[t].charCodeAt(0) % 128) return false;
    }
    return true;
  };
  if (lowerFrom(j, 8) && latin1(bytes.subarray(j, j + 8)).toLowerCase() === "infinity") {
    return { value: neg ? -Infinity : Infinity, consumed: j + 8 - offset };
  }
  if (j + 3 <= end && latin1(bytes.subarray(j, j + 3)).toLowerCase() === "inf") {
    return { value: neg ? -Infinity : Infinity, consumed: j + 3 - offset };
  }
  if (j + 3 <= end && latin1(bytes.subarray(j, j + 3)).toLowerCase() === "nan") {
    return { value: neg ? -NaN : NaN, consumed: j + 3 - offset };
  }
  // hex float: 0x hexdigits [ . hexdigits ] [ pP [sign] decimals ]
  if (j + 2 < end && bytes[j] === 48 && (bytes[j + 1] === 120 || bytes[j + 1] === 88)) {
    const isH = (c) => (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
    let k = j + 2;
    let hd = 0;
    while (k < end && isH(bytes[k])) k++, hd++;
    let fl = 0;
    if (k < end && bytes[k] === 46) {
      k++;
      while (k < end && isH(bytes[k])) k++, hd++, fl++;
    }
    if (hd > 0) {
      let last = k;
      let pexp = 0;
      if (k < end && (bytes[k] === 112 || bytes[k] === 80)) {
        let e = k + 1;
        if (e < end && (bytes[e] === 43 || bytes[e] === 45)) e++;
        let ed = 0;
        while (e < end && bytes[e] >= 48 && bytes[e] <= 57) e++, ed++;
        if (ed > 0) {
          pexp = parseInt(latin1(bytes.subarray(k + 1, e)), 10);
          last = e;
        }
      }
      const hexStr = latin1(bytes.subarray(j + 2, k)).replace(".", "");
      const value = hexFloat(neg, hexStr, fl, pexp);
      return { value, consumed: last - offset };
    }
    // "0x" without hex digits: C consumes just the leading "0"
  }
  // decimal: digits [. digits] [ (e|E) [sign] digits ]
  let k = j;
  let digits = 0;
  while (k < end && bytes[k] >= 48 && bytes[k] <= 57) k++, digits++;
  if (k < end && bytes[k] === 46) {
    k++;
    while (k < end && bytes[k] >= 48 && bytes[k] <= 57) k++, digits++;
  }
  if (digits === 0) return { value: 0, consumed: 0 };
  let last = k;
  if (k < end && (bytes[k] === 101 || bytes[k] === 69)) {
    let e = k + 1;
    if (e < end && (bytes[e] === 43 || bytes[e] === 45)) e++;
    let ed = 0;
    while (e < end && bytes[e] >= 48 && bytes[e] <= 57) e++, ed++;
    if (ed > 0) last = e;
  }
  const text = latin1(bytes.subarray(i, last));
  const value = parseFloat(text);
  return { value, consumed: last - offset };
}

/* ---------- host ---------- */

export async function runWasm({ wasmPath, wasmBytes, stdin = new Uint8Array(), files = new Map() }) {
  const { instantiate } = await makeHost(files, stdin);
  const bytes = wasmBytes ?? new Uint8Array((await import("node:fs")).readFileSync(wasmPath));
  const { module } = await instantiate(bytes);
  return module; // {exports, done: Promise<{exitCode, stdout, stderr}>}
}

function makeHost(files, stdinBytes) {
  let memory = null;
  let stdout = [];
  let stderr = [];
  let exitCode = null;
  let exitResolve;
  const exited = new Promise((r) => (exitResolve = r));

  const dec = (ptr, len) =>
    latin1Dec.decode(new Uint8Array(memory.buffer, Number(ptr), Number(len)));
  const out = (fd, ptr, len) => {
    const chunk = new Uint8Array(memory.buffer, Number(ptr), Number(len)).slice();
    (fd === 2 ? stderr : stdout).push(chunk);
  };

  // stdin cursor
  let stdinPos = 0;
  // file table: id -> {bytes, pos}
  const openFiles = new Map();
  let nextFileId = 1;

  const imports = {
    silu_host: {
      mem_grow(pagesBig) {
        const old = memory.grow(Number(pagesBig));
        return old === -1 ? -1n : BigInt(old);
      },
      die(ptr, len) {
        const msg = dec(ptr, len);
        stderr.push(new TextEncoder().encode(`shim die: ${msg}\n`));
        exitCode = 70;
        exitResolve();
        throw new SiluExit(70);
      },
      write(fd, ptr, len) {
        out(Number(fd), ptr, len);
      },
      fmt_double(buf, cap, v, spec, prec) {
        const sp = String.fromCharCode(Number(spec));
        const s = sp === "r" ? cReprDouble(Number(v)) : cFormatDouble(Number(v), sp, Number(prec));
        const bytes = new TextEncoder().encode(s); // ascii-only by construction
        if (bytes.length + 1 >= Number(cap)) return -1n;
        const dst = new Uint8Array(memory.buffer, Number(buf), bytes.length + 1);
        dst.set(bytes);
        dst[bytes.length] = 0; // NUL: str(blen) scans this buffer too
        return BigInt(bytes.length);
      },
      strtod(ptr, len, consumedPtr) {
        const bytes = new Uint8Array(memory.buffer, Number(ptr), Number(len)).slice();
        const { value, consumed } = cStrtod(bytes, 0, Number(len));
        new DataView(memory.buffer).setBigUint64(Number(consumedPtr), BigInt(consumed), true);
        return value;
      },
      getchar() {
        return stdinPos < stdinBytes.length ? stdinBytes[stdinPos++] : -1;
      },
      pow(a, b) {
        return Math.pow(Number(a), Number(b));
      },
      file_open(ptr, len) {
        const name = dec(ptr, len);
        const data = files.get(name);
        if (!data) return -1n;
        const id = nextFileId++;
        openFiles.set(id, { bytes: data, pos: 0 });
        return BigInt(id);
      },
      file_read(idBig, dst, lenBig) {
        const f = openFiles.get(Number(idBig));
        if (!f) return -1n;
        const n = Math.min(Number(lenBig), f.bytes.length - f.pos);
        if (n > 0) {
          new Uint8Array(memory.buffer, Number(dst), n).set(f.bytes.subarray(f.pos, f.pos + n));
          f.pos += n;
        }
        return BigInt(n);
      },
      file_seek(idBig, offBig, whence) {
        const f = openFiles.get(Number(idBig));
        if (!f) return -1n;
        const off = Number(offBig);
        let p = whence === 0 ? off : whence === 1 ? f.pos + off : f.bytes.length + off;
        if (p < 0) p = 0;
        f.pos = p;
        return 0n;
      },
      file_tell(idBig) {
        const f = openFiles.get(Number(idBig));
        return f ? BigInt(f.pos) : -1n;
      },
      file_close(idBig) {
        openFiles.delete(Number(idBig));
        return 0;
      },
      exit(code) {
        exitCode = Number(code);
        exitResolve();
        throw new SiluExit(exitCode);
      },
    },
  };

  async function instantiate(bytes) {
    const obj = await WebAssembly.instantiate(bytes, imports);
    memory = obj.instance.exports.memory;
    const run = (async () => {
      try {
        // prefer the renamed main; older single-entry modules fall back
        const ex = obj.instance.exports;
        const entry =
          Object.keys(ex).find((k) => k === "silu_main") ||
          Object.keys(ex).find((k) => typeof ex[k] === "function");
        const rv = ex[entry]();
        if (exitCode === null) {
          // main's return value is the process exit code, matching the
          // native driver (wasm64 returns BigInt)
          exitCode = typeof rv === "bigint" ? Number(rv) : (typeof rv === "number" ? rv : 0);
        }
      } catch (e) {
        if (!(e instanceof SiluExit)) {
          stderr.push(new TextEncoder().encode(`host: trap: ${e.message}\n${e.stack || ""}\n`));
          if (exitCode === null) exitCode = 1;
        }
      }
      exitResolve();
      return {
        exitCode,
        stdout: concatU8(stdout),
        stderr: concatU8(stderr),
      };
    })();
    return { module: { exports: obj.instance.exports, done: run } };
  }

  return { instantiate };
}

class SiluExit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/* ---------- CLI ---------- */

const isMain = typeof process !== "undefined" && process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain) {
  const { readFileSync } = await import("node:fs");
  const argv = process.argv.slice(2);
  const wasmPath = argv[0];
  let stdin = new Uint8Array();
  const files = new Map();
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--file") {
      const [name, path] = argv[i + 1].split("=");
      files.set(name, new Uint8Array(readFileSync(path)));
      i++;
    } else if (argv[i] === "--stdin-data") {
      stdin = new TextEncoder().encode(argv[i + 1]);
      i++;
    } else {
      stdin = new Uint8Array(readFileSync(argv[i]));
    }
  }
  const { done } = await runWasm({ wasmPath, stdin, files });
  const r = await done;
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.exitCode ?? 1);
}

export { cFormatDouble, cStrtod, cReprDouble }; // unit-test surface
