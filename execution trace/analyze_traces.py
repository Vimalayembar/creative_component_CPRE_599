import re
import json
from pathlib import Path
from typing import List, Dict, Tuple

# --- Parsing ---
TRACE_CALL_RE = re.compile(r"__trace\.add\(\s*([\'\"])\s*([^'\"]+)\s*\1\s*,\s*(\d+)\s*\)")


def parse_instrumented_file(path: Path) -> List[Dict]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    entries = []
    for m in TRACE_CALL_RE.finditer(text):
        func = m.group(2)
        line = int(m.group(3))
        entries.append({"function": func, "line": line})
    return entries

# --- Canonicalization and LCS (mirrors second iteration/trace_analysis.py) ---
import re as _re

OBFUSCATOR_NAME_PATTERN = _re.compile(r'^(?:a0_0x|_0x|_0x[a-f0-9]+|0x)[0-9a-fA-F_]*')

def canonicalize_entry(entry: Dict) -> str:
    func = entry.get('function') or entry.get('event') or ''
    if not isinstance(func, str):
        func = str(func)
    func_norm = func.strip()
    if OBFUSCATOR_NAME_PATTERN.match(func_norm):
        return 'OBFUSCATOR_WRAPPER'
    lower = func_norm.lower()
    if 'process.on' in lower or lower in ('data_handler', 'data', 'handler', 'ondata', 'on_data'):
        return 'HANDLER'
    if lower == 'global' or lower == '<module>' or lower == 'root':
        return 'GLOBAL'
    if 'parseint' in lower or 'parse_int' in lower:
        return 'PARSE_INT'
    if 'to_string' in lower or 'tostring' in lower:
        return 'TO_STRING'
    if 'console' in lower or 'log' in lower:
        return 'CONSOLE_LOG'
    if lower.startswith('anonymous') or lower.startswith('<anonymous>'):
        return 'ANON_FN'
    cleaned = _re.sub(r'[^0-9a-zA-Z_]', '_', func_norm)
    if cleaned == '':
        cleaned = 'FN_UNKNOWN'
    return f'FN:{cleaned}'


def canonicalize_trace(raw_trace: List[Dict], include_line: bool = False) -> List[str]:
    tokens = []
    for e in raw_trace:
        token = canonicalize_entry(e)
        if include_line:
            line = e.get('line')
            if isinstance(line, int) and token not in ('OBFUSCATOR_WRAPPER',):
                token = f"{token}@L{line}"
        if token == 'OBFUSCATOR_WRAPPER':
            continue
        tokens.append(token)
    return tokens


def lcs_length(seq1: List[str], seq2: List[str]) -> int:
    m, n = len(seq1), len(seq2)
    if m == 0 or n == 0:
        return 0
    prev = [0] * (n + 1)
    for i in range(1, m + 1):
        cur = [0] * (n + 1)
        a = seq1[i - 1]
        for j in range(1, n + 1):
            if a == seq2[j - 1]:
                cur[j] = prev[j - 1] + 1
            else:
                cur[j] = prev[j] if prev[j] >= cur[j - 1] else cur[j - 1]
        prev = cur
    return prev[n]


def similarity_lcs(seq1: List[str], seq2: List[str]) -> float:
    if not seq1 and not seq2:
        return 1.0
    if not seq1 or not seq2:
        return 0.0
    lcs = lcs_length(seq1, seq2)
    denom = max(len(seq1), len(seq2))
    return lcs / denom if denom > 0 else 0.0


def compute_pair(a: List[Dict], b: List[Dict], include_line: bool = False) -> Dict:
    ta = canonicalize_trace(a, include_line=include_line)
    tb = canonicalize_trace(b, include_line=include_line)
    sim = similarity_lcs(ta, tb)
    return {
        "similarity": round(sim, 4),
        "len_a": len(ta),
        "len_b": len(tb),
        "lcs_length": lcs_length(ta, tb),
    }


def main():
    root = Path('.')
    f_deo = root / 'trace_deo6.json'
    f_obf = root / 'trace_obf6.json'
    f_ori = root / 'trace_ori6.json'

    traces = {}
    missing = []
    for key, fp in (('deobfuscated', f_deo), ('obfuscated', f_obf), ('original', f_ori)):
        if not fp.exists():
            missing.append(str(fp))
            traces[key] = []
        else:
            traces[key] = parse_instrumented_file(fp)

    res = {}
    pairs = [
        ("original", "obfuscated", "original_vs_obfuscated"),
        ("obfuscated", "deobfuscated", "obfuscated_vs_deobfuscated"),
        ("deobfuscated", "original", "deobfuscated_vs_original"),
    ]
    for a, b, k in pairs:
        comp = compute_pair(traces.get(a, []), traces.get(b, []), include_line=False)
        res[k] = comp["similarity"]

    # Write SR as simple text
    sr_lines = []
    if missing:
        sr_lines.append("Missing files: " + ", ".join(missing))
    for _, _, k in pairs:
        sr_lines.append(f"{k}: {res[k]:.4f}")
    Path('SR6').write_text("\n".join(sr_lines) + "\n", encoding='utf-8')

if __name__ == '__main__':
    main()
