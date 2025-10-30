#!/usr/bin/env python3
"""
Improved AST-based code instrumentation & trace analysis system.

- Requires: instrument.js (AST instrumenter using esprima/estraverse/escodegen)
- Place original/, obfuscated/, deobfuscated/ folders with matching files.
- Produces traces/ and similarity_results/ as output.

This script:
- Invokes instrument.js to instrument each JS file
- Executes instrumented JS, captures trace(s) from stderr (handles multiple JSON writes)
- Canonicalizes traces into event tokens (robust to obfuscation)
- Computes pairwise LCS-based similarity on token sequences
- Always records original_vs_obfuscated, obfuscated_vs_deobfuscated, deobfuscated_vs_original
"""

import os
import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import re

# ---------- Utilities ----------

def parse_json_lines_from_stderr(stderr_text: str) -> List[List[Dict]]:
    """
    Parse stderr text which may contain multiple JSON arrays/objects (one per line).
    Returns list of parsed JSON values (only lists of dicts considered traces).
    """
    traces = []
    if not stderr_text:
        return traces
    for line in stderr_text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
            if isinstance(parsed, list):
                # Heuristic: list of dicts with 'function' and 'line'
                if all(isinstance(x, dict) for x in parsed):
                    traces.append(parsed)
        except json.JSONDecodeError:
            # Skip non-JSON lines
            continue
    return traces

def merge_traces(trace_lists: List[List[Dict]]) -> List[Dict]:
    """
    Merge multiple trace arrays into a single trace sequence.
    Preserves order by concatenation.
    """
    merged = []
    for t in trace_lists:
        merged.extend(t)
    return merged

# ---------- Canonicalization ----------

OBFUSCATOR_NAME_PATTERN = re.compile(r'^(?:a0_0x|_0x|_0x[a-f0-9]+|0x)[0-9a-fA-F_]*')

def canonicalize_entry(entry: Dict) -> str:
    """
    Convert a trace entry {function:..., line:...} into a stable token.
    Strategy:
      - Normalize function name: map obvious obfuscator names to 'OBFUSCATOR_WRAPPER'
      - Map anonymous handlers (e.g., data handlers) to HANDLER
      - Else use FUNCTION:<name> and optionally LINE:<n>
    """
    func = entry.get('function') or entry.get('event') or ''
    if not isinstance(func, str):
        func = str(func)
    func_norm = func.strip()

    # If function name is obfuscator style, mark it
    if OBFUSCATOR_NAME_PATTERN.match(func_norm):
        return 'OBFUSCATOR_WRAPPER'

    lower = func_norm.lower()

    # common process handler heuristics
    if 'process.on' in lower or lower in ('data_handler', 'data', 'handler', 'ondata', 'on_data'):
        return 'HANDLER'
    if 'global' == lower or lower == '<module>' or lower == 'root':
        return 'GLOBAL'

    # parse-int and console heuristics from function names (if recorded)
    if 'parseint' in lower or 'parse_int' in lower:
        return 'PARSE_INT'
    if 'to_string' in lower or 'tostring' in lower:
        return 'TO_STRING'
    if 'console' in lower or 'log' in lower:
        return 'CONSOLE_LOG'

    # If function looks like an anonymous function marker
    if lower.startswith('anonymous') or lower.startswith('<anonymous>'):
        return 'ANON_FN'

    # Fallback: return function token with normalized name
    # Remove non-alphanumeric to reduce noise
    cleaned = re.sub(r'[^0-9a-zA-Z_]', '_', func_norm)
    if cleaned == '':
        cleaned = 'FN_UNKNOWN'
    return f'FN:{cleaned}'

def canonicalize_trace(raw_trace: List[Dict], include_line: bool = False) -> List[str]:
    """
    Convert raw trace (list of entries) into list of tokens for comparison.
    If include_line=True, combine function token with line token to increase specificity.
    """
    tokens = []
    for e in raw_trace:
        token = canonicalize_entry(e)
        if include_line:
            line = e.get('line')
            if isinstance(line, int) and token not in ('OBFUSCATOR_WRAPPER',):
                token = f"{token}@L{line}"
        # Skip pure obfuscator wrappers (they add noise)
        if token == 'OBFUSCATOR_WRAPPER':
            continue
        tokens.append(token)
    return tokens

# ---------- Similarity via LCS ----------

def lcs_length(seq1: List[str], seq2: List[str]) -> int:
    m, n = len(seq1), len(seq2)
    if m == 0 or n == 0:
        return 0
    # DP table with optimized memory (two rows)
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
    """
    Returns similarity in [0,1] computed as LCS_length / max(len(seq1), len(seq2))
    If both empty -> 1.0
    If one empty -> 0.0
    """
    if not seq1 and not seq2:
        return 1.0
    if not seq1 or not seq2:
        return 0.0
    lcs = lcs_length(seq1, seq2)
    denom = max(len(seq1), len(seq2))
    return lcs / denom if denom > 0 else 0.0

# ---------- Trace instrumentation + execution ----------

class TraceInstrumenter:
    """Uses instrument.js to instrument JS files and run them to get traces."""

    def __init__(self, instrumenter_path: str = "instrument.js"):
        self.instrumenter_path = Path(instrumenter_path)
        if not self.instrumenter_path.exists():
            raise FileNotFoundError(f"instrument.js not found at: {self.instrumenter_path}")

    def instrument_file(self, src_path: Path) -> str:
        """
        Calls instrument.js to produce an instrumented JS file path content and returns instrumented code.
        """
        # create temp output file
        fd_out, out_path = tempfile.mkstemp(suffix=".instr.js", text=True)
        os.close(fd_out)
        try:
            subprocess.run(
                ["node", str(self.instrumenter_path), str(src_path), out_path],
                check=True,
                capture_output=True,
                text=True
            )
            with open(out_path, 'r', encoding='utf-8') as rf:
                return rf.read()
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)

    def execute_instrumented_code_and_collect_traces(self, instrumented_code: str, input_data: str = "", timeout: int = 5) -> List[Dict]:
        """
        Write instrumented code to a temp file, run node, parse stderr lines for JSON arrays.
        Returns the merged trace (list of dicts).
        """
        fd, path = tempfile.mkstemp(suffix=".js", text=True)
        os.close(fd)
        try:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(instrumented_code)

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
            print("    Execution timed out.")
            return []
        except Exception as e:
            print(f"    Execution error: {e}")
            return []
        finally:
            if os.path.exists(path):
                os.unlink(path)

# ---------- Analyzer ----------

class SimilarityCalculator:
    """Wrapper to compute similarities with canonicalization options."""

    def __init__(self, include_line_in_token: bool = False):
        # include_line_in_token True makes tokens more specific (can reduce matches if code reformatted)
        self.include_line_in_token = include_line_in_token

    def compute_pair(self, traceA: List[Dict], traceB: List[Dict]) -> Dict:
        tokensA = canonicalize_trace(traceA, include_line=self.include_line_in_token)
        tokensB = canonicalize_trace(traceB, include_line=self.include_line_in_token)
        sim = similarity_lcs(tokensA, tokensB)
        lcs_len = lcs_length(tokensA, tokensB)
        return {
            "similarity": round(sim, 4),
            "len_a": len(tokensA),
            "len_b": len(tokensB),
            "lcs_length": lcs_len
        }

class CodeAnalyzer:
    def __init__(self, instrumenter: TraceInstrumenter, calc: SimilarityCalculator):
        self.instrumenter = instrumenter
        self.calc = calc

    def find_file_variations(self, original_file: Path) -> Dict[str, Optional[Path]]:
        files = {"original": original_file, "obfuscated": None, "deobfuscated": None}
        base_name = original_file.name
        stem = original_file.stem

        for folder in ["obfuscated", "deobfuscated"]:
            folder_path = Path(folder)
            if not folder_path.exists():
                continue
            # exact match
            cand = folder_path / base_name
            if cand.exists():
                files[folder] = cand
                continue
            # try some variants
            variants = [base_name.replace(".js", ".obf.js"), stem + ".obf.js", stem + ".deob.js", base_name]
            for v in variants:
                mp = folder_path / v
                if mp.exists():
                    files[folder] = mp
                    break
            # fallback partial stem
            if not files[folder]:
                for f in folder_path.glob("*.js"):
                    if stem in f.stem or f.stem in stem:
                        files[folder] = f
                        break
        return files

    def get_test_input(self, filename: str) -> str:
        # same heuristics as before
        test_cases = {
            "codenet_p00002": "12 34\n56 78\n",
            "codenet_p00003": "3 4 5\n",
            "codenet_p00005": "10\n20\n",
            "codenet_p00006": "5\n",
            "codenet_p00007": "3\n"
        }
        for pat, data in test_cases.items():
            if pat in filename:
                return data
        return "12 34\n"  # default multi token input

    def process_file(self, original_file: Path) -> Optional[Dict]:
        print(f"\nProcessing: {original_file.name}")
        files = self.find_file_variations(original_file)
        if not files["obfuscated"] or not files["deobfuscated"]:
            print("  Warning: missing obfuscated or deobfuscated variant; proceeding with whatever exists.")

        traces_raw = {}
        for version, path in files.items():
            traces_raw[version] = []
            if path is None:
                continue
            try:
                print(f"  Instrumenting & executing {version:12}: {path.name} ... ", end="")
                # instrument
                instrumented = self.instrumenter.instrument_file(path)
                # execute and collect
                trace = self.instrumenter.execute_instrumented_code_and_collect_traces(instrumented, input_data=self.get_test_input(original_file.name))
                traces_raw[version] = trace
                print(f"got {len(trace)} entries")
                # save trace
                os.makedirs("traces", exist_ok=True)
                tf = Path("traces") / f"{original_file.stem}_{version}.json"
                with open(tf, "w", encoding="utf-8") as fh:
                    json.dump(trace, fh, indent=2)
            except Exception as e:
                print(f"error: {e}")
                traces_raw[version] = []

        # compute all three pairwise comparisons (always compute keys)
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
    print("Improved AST-based Trace Analysis")
    print("=" * 70)

    # Check instrument.js
    if not Path("instrument.js").exists():
        print("Error: instrument.js not found in current directory. Add the AST instrumenter and try again.")
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
    calc = SimilarityCalculator(include_line_in_token=False)  # set True to include line numbers in tokens
    analyzer = CodeAnalyzer(instrumenter, calc)

    all_results = []
    for orig in original_files:
        res = analyzer.process_file(orig)
        if res:
            all_results.append(res)
            # write per-file result
            outp = Path("similarity_results") / f"{orig.stem}_similarity.json"
            with open(outp, "w", encoding="utf-8") as fh:
                json.dump(res, fh, indent=2)

    # summary
    summary = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_processed": len(all_results),
        "results": all_results
    }
    # compute simple stats across all similarity keys if present
    sims = []
    for r in all_results:
        for k in ("original_vs_obfuscated", "obfuscated_vs_deobfuscated", "deobfuscated_vs_original"):
            if k in r:
                sims.append(r[k])
    if sims:
        summary["statistics"] = {
            "average_similarity": round(sum(sims) / len(sims), 4),
            "min_similarity": round(min(sims), 4),
            "max_similarity": round(max(sims), 4)
        }

    with open(Path("similarity_results") / "summary.json", "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print("\nDone. Results saved under similarity_results/ and traces/")

if __name__ == "__main__":
    main()
