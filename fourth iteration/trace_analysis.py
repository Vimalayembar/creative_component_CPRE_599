#!/usr/bin/env python3
"""
Enhanced AST-based JS instrumentation & trace analysis system.

- Requires: instrument.js (AST instrumenter using esprima/estraverse/escodegen)
- Place original/, obfuscated/, deobfuscated/ folders with matching files.
- Produces traces/ and similarity_results/ as output.
"""

import os
import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Dict, Optional
import re

# ---------- Utilities ----------

def parse_json_lines_from_stderr(stderr_text: str) -> List[List[Dict]]:
    """Parse stderr lines containing JSON arrays of trace entries."""
    traces = []
    for line in stderr_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
            if isinstance(parsed, list) and all(isinstance(x, dict) for x in parsed):
                traces.append(parsed)
        except json.JSONDecodeError:
            continue
    return traces

def merge_traces(trace_lists: List[List[Dict]]) -> List[Dict]:
    """Concatenate multiple trace arrays into one."""
    merged = []
    for t in trace_lists:
        merged.extend(t)
    return merged

# ---------- Canonicalization ----------

OBFUSCATOR_NAME_PATTERN = re.compile(r'^(?:a0_0x|_0x|_0x[a-f0-9]+|0x)[0-9a-fA-F_]*')

def canonicalize_entry(entry: Dict) -> str:
    """Convert a trace entry {function:..., line:...} into a stable token."""
    func = entry.get('function') or entry.get('event') or ''
    if not isinstance(func, str):
        func = str(func)
    func_norm = func.strip()

    if OBFUSCATOR_NAME_PATTERN.match(func_norm):
        return 'OBFUSCATOR_WRAPPER'

    lower = func_norm.lower()

    # common handlers
    if 'process.on' in lower or lower in ('data_handler', 'data', 'handler', 'ondata', 'on_data'):
        return 'HANDLER'
    if lower in ('global', '<module>', 'root'):
        return 'GLOBAL'
    if 'parseint' in lower or 'parse_int' in lower:
        return 'PARSE_INT'
    if 'to_string' in lower or 'tostring' in lower:
        return 'TO_STRING'
    if 'console' in lower or 'log' in lower:
        return 'CONSOLE_LOG'
    if lower.startswith('anonymous') or lower.startswith('<anonymous>'):
        return 'ANON_FN'

    cleaned = re.sub(r'[^0-9a-zA-Z_]', '_', func_norm)
    if not cleaned:
        cleaned = 'FN_UNKNOWN'
    return f'FN:{cleaned}'

def canonicalize_trace(raw_trace: List[Dict], include_line: bool = False) -> List[str]:
    """Convert raw trace into token sequence."""
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

# ---------- LCS-based Similarity ----------

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
                cur[j] = max(prev[j], cur[j - 1])
        prev = cur
    return prev[n]

def similarity_lcs(seq1: List[str], seq2: List[str]) -> float:
    """Returns LCS similarity in [0,1]."""
    if not seq1 and not seq2:
        return 1.0
    if not seq1 or not seq2:
        return 0.0
    lcs = lcs_length(seq1, seq2)
    return lcs / max(len(seq1), len(seq2))

# ---------- Trace Instrumentation ----------

class TraceInstrumenter:
    def __init__(self, instrumenter_path: str = "instrument.js"):
        self.instrumenter_path = Path(instrumenter_path)
        if not self.instrumenter_path.exists():
            raise FileNotFoundError(f"{instrumenter_path} not found")

    def instrument_file(self, src_path: Path) -> str:
        """Instrument JS file and return instrumented code as string."""
        fd_out, out_path = tempfile.mkstemp(suffix=".instr.js")
        os.close(fd_out)
        try:
            subprocess.run(
                ["node", str(self.instrumenter_path), str(src_path), out_path],
                check=True,
                capture_output=True,
                text=True
            )
            return Path(out_path).read_text(encoding='utf-8')
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)

    def execute_instrumented_code_and_collect_traces(self, instrumented_code: str, input_data: str = "", timeout: int = 50) -> List[Dict]:
        """
        Write instrumented code to a temp file, append an auto-wrap call to catch object-attached functions,
        run node, parse stderr lines for JSON arrays, and return the merged trace (list of dicts).
        """
        # Append auto-wrap snippet so functions on module.exports/globalThis get wrapped at runtime
        auto_wrap_snippet = (
            "\n// auto-wrap exported functions to catch object-attached callbacks\n"
            "try { if (globalThis && globalThis.__wrapObjectFunctions) "
            "globalThis.__wrapObjectFunctions((typeof module!=='undefined' && module.exports) ? module.exports : globalThis, 'root'); } catch (e) {}\n"
        )
        instrumented_code_to_run = instrumented_code + auto_wrap_snippet

        fd, path = tempfile.mkstemp(suffix=".js", text=True)
        os.close(fd)
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(instrumented_code_to_run)

            result = subprocess.run(
                ["node", path],
                input=input_data,
                capture_output=True,
                text=True,
                timeout=timeout
            )

            # parse all JSON lists from stderr
            parsed_lists = parse_json_lines_from_stderr(result.stderr)
            merged = merge_traces(parsed_lists)
            return merged
        except subprocess.TimeoutExpired:
            print(f"    Execution timed out after {timeout}s.")
            return []
        except Exception as e:
            print(f"    Execution error: {e}")
            return []
        finally:
            if os.path.exists(path):
                os.unlink(path)


# ---------- Analyzer ----------

class SimilarityCalculator:
    def __init__(self, include_line_in_token: bool = False):
        self.include_line_in_token = include_line_in_token

    def compute_pair(self, traceA: List[Dict], traceB: List[Dict]) -> Dict:
        tokensA = canonicalize_trace(traceA, self.include_line_in_token)
        tokensB = canonicalize_trace(traceB, self.include_line_in_token)
        sim = similarity_lcs(tokensA, tokensB)
        lcs_len = lcs_length(tokensA, tokensB)
        return {"similarity": round(sim, 4), "len_a": len(tokensA), "len_b": len(tokensB), "lcs_length": lcs_len}

class CodeAnalyzer:
    def __init__(self, instrumenter: TraceInstrumenter, calc: SimilarityCalculator):
        self.instrumenter = instrumenter
        self.calc = calc

    def find_file_variations(self, original_file: Path) -> Dict[str, Optional[Path]]:
        files = {"original": original_file, "obfuscated": None, "deobfuscated": None}
        stem = original_file.stem
        for folder in ["obfuscated", "deobfuscated"]:
            folder_path = Path(folder)
            if not folder_path.exists():
                continue
            for f in folder_path.glob("*.js"):
                if stem in f.stem:
                    files[folder] = f
                    break
        return files

    def get_test_input(self, filename: str) -> str:
        return "12 34\n"

    def process_file(self, original_file: Path) -> Optional[Dict]:
        print(f"\nProcessing: {original_file.name}")
        files = self.find_file_variations(original_file)
        traces_raw = {}
        for version, path in files.items():
            traces_raw[version] = []
            if path is None:
                continue
            try:
                print(f"  Instrumenting & executing {version:12}: {path.name} ... ", end="")
                instrumented = self.instrumenter.instrument_file(path)
                trace = self.instrumenter.execute_instrumented_code_and_collect_traces(instrumented, input_data=self.get_test_input(original_file.name))
                traces_raw[version] = trace
                print(f"{len(trace)} entries")
                os.makedirs("traces", exist_ok=True)
                tf = Path("traces") / f"{original_file.stem}_{version}.json"
                with open(tf, "w", encoding="utf-8") as fh:
                    json.dump(trace, fh, indent=2)
            except Exception as e:
                print(f"    error: {e}")
                traces_raw[version] = []

        # compute pairwise similarities
        results = {"file": original_file.stem, "traces": {k: len(v) for k, v in traces_raw.items()}}
        pairs = [
            ("original", "obfuscated", "original_vs_obfuscated"),
            ("obfuscated", "deobfuscated", "obfuscated_vs_deobfuscated"),
            ("deobfuscated", "original", "deobfuscated_vs_original")
        ]
        for a, b, key in pairs:
            ta = traces_raw.get(a, [])
            tb = traces_raw.get(b, [])
            comp = self.calc.compute_pair(ta, tb)
            results[key] = comp["similarity"]
            print(f"  {a} ↔ {b}: sim={comp['similarity']:.4f} (lenA={comp['len_a']}, lenB={comp['len_b']}, lcs={comp['lcs_length']})")
        return results

# ---------- Main ----------

def main():
    print("=" * 70)
    print("Enhanced AST-based JS Trace Analysis")
    print("=" * 70)

    if not Path("instrument1.js").exists():
        print("Error: instrument.js not found in current directory.")
        return

    os.makedirs("traces", exist_ok=True)
    os.makedirs("similarity_results", exist_ok=True)

    original_dir = Path("original")
    if not original_dir.exists():
        print("Error: 'original' directory not found.")
        return

    original_files = sorted(original_dir.glob("*.js"))
    if not original_files:
        print("No JS files found in original/")
        return

    instrumenter = TraceInstrumenter("instrument.js")
    calc = SimilarityCalculator(include_line_in_token=False)
    analyzer = CodeAnalyzer(instrumenter, calc)

    all_results = []
    for orig in original_files:
        res = analyzer.process_file(orig)
        if res:
            all_results.append(res)
            outp = Path("similarity_results") / f"{orig.stem}_similarity.json"
            with open(outp, "w", encoding="utf-8") as fh:
                json.dump(res, fh, indent=2)

    # summary
    summary = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_processed": len(all_results),
        "results": all_results
    }
    sims = [r[k] for r in all_results for k in ("original_vs_obfuscated","obfuscated_vs_deobfuscated","deobfuscated_vs_original") if k in r]
    if sims:
        summary["statistics"] = {
            "average_similarity": round(sum(sims)/len(sims),4),
            "min_similarity": round(min(sims),4),
            "max_similarity": round(max(sims),4)
        }

    with open(Path("similarity_results") / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print("\nDone. Results saved under similarity_results/ and traces/")

if __name__ == "__main__":
    main()
