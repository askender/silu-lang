#!/usr/bin/env python3
"""Build bilingual (EN default / _zh) HTML doc pages from markdown sources.

Convention: xxx.md is English, xxx_zh.md is Chinese. Each generated page
carries the unified nav (Home + 5 docs, language-appropriate targets) and a
per-page language toggle linking xxx.html <-> xxx_zh.html.
"""
import html
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

DOCS = [
    ("benchmarks", "Benchmarks", "性能评测"),
    ("memory", "Memory", "内存管理"),
    ("rfc_sum_types", "Sum Types RFC", "和类型 RFC"),
    ("symbolic_roadmap", "Symbolic Roadmap", "符号执行路线图"),
    ("interop", "C Interop", "C 互操作"),
]

# Links to repo files that are not part of the public showcase -> plain text.
DEAD_LINKS = re.compile(r"\[([^\]]+)\]\((?:\.\./)?(?:benchmarks/)?README\.md\)")

CSS = """:root{--bg:#0d1117;--fg:#e6edf3;--accent:#58a6ff;--accent2:#3fb950;--dim:#8b949e;--card:#161b22;--border:#30363d}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.lang-switch{position:fixed;top:1.2rem;right:1.2rem;display:flex;gap:0;border:1px solid var(--border);border-radius:8px;overflow:hidden;z-index:100}
.lang-switch a{padding:.45rem 1rem;font-size:.85rem;text-decoration:none;color:var(--dim);background:var(--card);transition:all .2s}
.lang-switch a:hover{color:var(--fg);text-decoration:none}
.lang-switch a.active{background:var(--accent);color:var(--bg);font-weight:600}
.md-nav{position:fixed;top:1.2rem;left:1.2rem;display:flex;gap:.5rem;z-index:100;flex-wrap:wrap}
.md-nav a{padding:.35rem .9rem;font-size:.8rem;text-decoration:none;color:var(--dim);background:var(--card);border:1px solid var(--border);border-radius:6px;transition:all .2s}
.md-nav a:hover{color:var(--fg);border-color:var(--accent);text-decoration:none}
.md-nav a.home{color:var(--accent);font-weight:600}
.md-body{max-width:920px;margin:0 auto;padding:5.5rem 2rem 4rem}
.md-body h1{font-size:2rem;margin-bottom:1.5rem;color:var(--accent);letter-spacing:-.02em}
.md-body h2{font-size:1.5rem;margin:2.5rem 0 1rem;padding-bottom:.5rem;border-bottom:1px solid var(--border)}
.md-body h3{font-size:1.15rem;margin:2rem 0 .8rem}
.md-body p{margin:.8rem 0;color:var(--fg)}
.md-body li{margin:.4rem 0;color:var(--fg)}
.md-body code{background:rgba(88,166,255,.1);color:var(--accent);padding:.15rem .4rem;border-radius:4px;font-family:'SF Mono',Consolas,monospace;font-size:.88em}
.md-body pre{background:#0d1117;border:1px solid var(--border);border-radius:8px;padding:1.2rem;overflow-x:auto;margin:1.2rem 0}
.md-body pre code{background:none;color:var(--fg);padding:0;font-size:.82rem;line-height:1.6}
.md-body table{width:100%;border-collapse:collapse;font-size:.9rem;margin:1.5rem 0}
.md-body th{text-align:left;padding:.6rem 1rem;border-bottom:2px solid var(--border);color:var(--dim);font-weight:600}
.md-body td{padding:.5rem 1rem;border-bottom:1px solid var(--border)}
.md-body blockquote{border-left:3px solid var(--accent);padding:.8rem 1.2rem;margin:1.2rem 0;color:var(--dim);background:rgba(88,166,255,.05);border-radius:0 8px 8px 0}
.md-body strong{color:var(--accent2)}
.md-body hr{border:none;border-top:1px solid var(--border);margin:2.5rem 0}
.md-body ul,.md-body ol{padding-left:1.5rem}
footer{padding:2.5rem 2rem;text-align:center;color:var(--dim);font-size:.85rem;border-top:1px solid var(--border);margin-top:2rem}"""


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def inline(s: str) -> str:
    """Inline markdown -> HTML. Code spans first so their content stays raw."""
    parts = re.split(r"(`[^`]+`)", s)
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) > 2:
            out.append("<code>" + esc(part[1:-1]) + "</code>")
        else:
            t = esc(part)
            t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', t)
            t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
            out.append(t)
    return "".join(out)


def table_row(line: str) -> list:
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return cells


def is_sep(line: str) -> bool:
    return bool(re.fullmatch(r"\s*\|?[\s:|-]+\|?\s*", line)) and "-" in line


def convert(md: str) -> str:
    md = DEAD_LINKS.sub(r"\1", md)
    lines = md.split("\n")
    out, i = [], 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            buf, i = [], i + 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>" + esc("\n".join(buf)) + "</code></pre>")
        elif stripped.startswith("|") and i + 1 < len(lines) and is_sep(lines[i + 1]):
            head = table_row(line)
            i += 2
            body = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                body.append(table_row(lines[i]))
                i += 1
            t = ["<table>", "<thead><tr>"]
            t += [f"<th>{inline(c)}</th>" for c in head]
            t.append("</tr></thead><tbody>")
            for row in body:
                t.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>")
            t.append("</tbody></table>")
            out.append("\n".join(t))
        elif stripped.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append("<blockquote>" + "<br>".join(inline(b) for b in buf) + "</blockquote>")
        elif re.match(r"^(#+)\s+", stripped):
            m = re.match(r"^(#+)\s+(.*)$", stripped)
            lvl = min(len(m.group(1)), 4)
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
        elif re.fullmatch(r"-{3,}", stripped):
            out.append("<hr>")
            i += 1
        elif re.match(r"^\s*[-*]\s+", line):
            buf = []
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                buf.append(re.sub(r"^\s*[-*]\s+", "", lines[i]))
                i += 1
            out.append("<ul>" + "".join(f"<li>{inline(b)}</li>" for b in buf) + "</ul>")
        elif re.match(r"^\s*\d+\.\s+", line):
            buf = []
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                buf.append(re.sub(r"^\s*\d+\.\s+", "", lines[i]))
                i += 1
            out.append("<ol>" + "".join(f"<li>{inline(b)}</li>" for b in buf) + "</ol>")
        elif stripped == "":
            i += 1
        else:
            buf = []
            while i < len(lines) and lines[i].strip() != "" and not lines[i].strip().startswith(("```", "|", ">", "#")) and not re.match(r"^\s*(?:[-*]|\d+\.)\s+", lines[i]):
                buf.append(lines[i].strip())
                i += 1
            out.append("<p>" + " ".join(inline(b) for b in buf) + "</p>")
    return "\n".join(out)


def page(slug: str, lang: str, md_text: str, title_en: str, title_zh: str) -> str:
    title = title_en if lang == "en" else title_zh
    home = "./" if lang == "en" else "zh.html"
    other = slug + "_zh.html" if lang == "en" else slug + ".html"
    nav_items = []
    for s, en_label, zh_label in DOCS:
        label = en_label if lang == "en" else zh_label
        href = f"{s}.html" if lang == "en" else f"{s}_zh.html"
        cls = ' class="active-page"' if s == slug else ""
        nav_items.append(f'<a href="{href}"{cls}>{label}</a>')
    nav = f'<a href="{home}" class="home">🏠 {"Home" if lang == "en" else "首页"}</a>' + "".join(nav_items)
    body = convert(md_text)
    h1 = re.search(r"^#\s+(.+)$", md_text, re.M)
    footer = ('<a href="https://github.com/askender/silu-lang">GitHub</a> · '
              f'<a href="{other}">{"中文版" if lang == "en" else "English"}</a>')
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)} — Silu</title>
<style>
{CSS}
.md-nav a.active-page{{color:var(--accent);border-color:var(--accent)}}
</style>
</head>
<body>
<div class="md-nav">{nav}</div>
<div class="lang-switch">
  <a href="{slug}.html"{' class="active"' if lang == "en" else ''}>EN</a>
  <a href="{slug}_zh.html"{' class="active"' if lang == "zh" else ''}>中文</a>
</div>
<div class="md-body">
{body}
</div>
<footer>{footer}</footer>
</body>
</html>
"""


def main() -> None:
    for slug, title_en, title_zh in DOCS:
        for lang, suffix in (("en", ""), ("zh", "_zh")):
            src = os.path.join(HERE, f"{slug}{suffix}.md")
            dst = os.path.join(HERE, f"{slug}{suffix}.html")
            with open(src, encoding="utf-8") as f:
                md_text = f.read()
            with open(dst, "w", encoding="utf-8") as f:
                f.write(page(slug, lang, md_text, title_en, title_zh))
            print(f"wrote {os.path.basename(dst)}")


if __name__ == "__main__":
    main()
