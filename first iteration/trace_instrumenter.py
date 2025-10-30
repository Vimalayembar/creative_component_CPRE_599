#!/usr/bin/env python3
"""
Complete code instrumentation and trace analysis system.
Instruments JavaScript code to collect execution traces and compares them.
"""

import os
import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import List, Dict, Optional, Tuple
import time


class TraceInstrumenter:
    """Instruments JavaScript code to collect execution traces."""
    
    def instrument(self, code: str) -> str:
        """
        Wrap JavaScript code with trace collection.
        Adds instrumentation that records function calls and line execution.
        """
        # Parse the code into lines
        lines = code.split('\n')
        
        # Build instrumented code
        instrumented = []
        
        # Add trace collector at the start
        instrumented.extend([
            "(function() {",
            "const __trace = {",
            "  entries: [],",
            "  currentFunc: 'global',",
            "  add(func, line) {",
            "    this.entries.push({function: func, line: line});",
            "  },",
            "  output() {",
            "    if (this.entries.length > 0) {",
            "      process.stderr.write(JSON.stringify(this.entries) + '\\n');",
            "    }",
            "  }",
            "};",
            ""
        ])
        
        # Track current function context
        current_function = "global"
        line_number = 0
        in_function = False
        brace_count = 0
        
        for line in lines:
            line_number += 1
            original_line = line
            
            # Detect function declarations
            if re.match(r'^\s*function\s+(\w+)', line):
                match = re.match(r'^\s*function\s+(\w+)', line)
                if match:
                    current_function = match.group(1)
                    in_function = True
            elif 'function(' in line or 'function (' in line:
                # Anonymous function as parameter
                if 'process.stdin.on' in lines[max(0, line_number-2):line_number+2]:
                    current_function = "data_handler"
                    in_function = True
            
            # Track braces to detect function boundaries
            brace_count += line.count('{') - line.count('}')
            if brace_count == 0 and in_function:
                in_function = False
                current_function = "global"
            
            # Add trace before executing significant lines
            if line.strip() and not line.strip().startswith('//'):
                # Add trace point
                instrumented.append(f'  __trace.add("{current_function}", {line_number});')
            
            # Add the original line
            instrumented.append(line)
        
        # Add cleanup and output
        instrumented.extend([
            "",
            "// Output traces",
            "process.on('beforeExit', () => __trace.output());",
            "setTimeout(() => __trace.output(), 1000);",
            "})();"
        ])
        
        return '\n'.join(instrumented)
    
    def execute_and_trace(self, code: str, input_data: str = "", timeout: int = 5) -> List[Dict]:
        """
        Execute instrumented code and collect traces.
        Returns list of trace entries.
        """
        # Create temporary file
        fd, temp_path = tempfile.mkstemp(suffix='.js', text=True)
        
        try:
            with os.fdopen(fd, 'w') as f:
                f.write(code)
            
            # Execute with Node.js
            result = subprocess.run(
                ['node', temp_path],
                input=input_data,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            
            # Parse traces from stderr
            traces = []
            if result.stderr:
                for line in result.stderr.strip().split('\n'):
                    if line.strip():
                        try:
                            parsed = json.loads(line)
                            if isinstance(parsed, list):
                                traces = parsed
                                break
                        except json.JSONDecodeError:
                            continue
            
            return traces
            
        except subprocess.TimeoutExpired:
            print(f"    Timeout after {timeout}s")
            return []
        except Exception as e:
            print(f"    Execution error: {e}")
            return []
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)


class SimilarityCalculator:
    """Calculates similarity scores between execution traces."""
    
    def calculate(self, trace1: List[Dict], trace2: List[Dict]) -> float:
        """
        Calculate similarity score between two traces using LCS algorithm.
        Returns score between 0.0 and 1.0.
        """
        if not trace1 or not trace2:
            if not trace1 and not trace2:
                return 1.0  # Both empty
            return 0.0  # One empty
        
        # Extract line sequences
        seq1 = [entry.get('line', 0) for entry in trace1]
        seq2 = [entry.get('line', 0) for entry in trace2]
        
        # Calculate longest common subsequence
        lcs_length = self._lcs(seq1, seq2)
        
        # Calculate similarity as LCS length / average length
        avg_length = (len(seq1) + len(seq2)) / 2
        if avg_length == 0:
            return 1.0
        
        similarity = lcs_length / avg_length
        return min(1.0, max(0.0, similarity))
    
    def _lcs(self, seq1: List, seq2: List) -> int:
        """
        Calculate the length of the longest common subsequence.
        Uses dynamic programming.
        """
        m, n = len(seq1), len(seq2)
        
        # Create DP table
        dp = [[0] * (n + 1) for _ in range(m + 1)]
        
        # Fill DP table
        for i in range(1, m + 1):
            for j in range(1, n + 1):
                if seq1[i - 1] == seq2[j - 1]:
                    dp[i][j] = dp[i - 1][j - 1] + 1
                else:
                    dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
        
        return dp[m][n]
    
    def detailed_comparison(self, trace1: List[Dict], trace2: List[Dict]) -> Dict:
        """Get detailed comparison metrics."""
        similarity = self.calculate(trace1, trace2)
        
        return {
            "similarity": round(similarity, 4),
            "trace1_length": len(trace1),
            "trace2_length": len(trace2),
            "lcs_length": self._lcs(
                [e.get('line', 0) for e in trace1],
                [e.get('line', 0) for e in trace2]
            )
        }


class CodeAnalyzer:
    """Main class for analyzing code versions."""
    
    def __init__(self):
        self.instrumenter = TraceInstrumenter()
        self.similarity = SimilarityCalculator()
    
    def find_file_variations(self, original_file: Path) -> Dict[str, Optional[Path]]:
        """
        Find corresponding files in obfuscated and deobfuscated folders.
        """
        files = {
            "original": original_file,
            "obfuscated": None,
            "deobfuscated": None
        }
        
        base_name = original_file.name
        stem = original_file.stem
        
        # Try to find obfuscated version
        for folder in ["obfuscated", "deobfuscated"]:
            folder_path = Path(folder)
            
            # Try exact match
            if (folder_path / base_name).exists():
                files[folder] = folder_path / base_name
                continue
            
            # Try variations
            variations = [
                base_name.replace('.js', '.obf.js'),
                stem + '.obf.js',
                base_name
            ]
            
            for variant in variations:
                if (folder_path / variant).exists():
                    files[folder] = folder_path / variant
                    break
            
            # Try partial stem match
            if not files[folder]:
                for file in folder_path.glob("*"):
                    if stem in file.stem or file.stem in stem:
                        files[folder] = file
                        break
        
        return files
    
    def get_test_input(self, filename: str) -> str:
        """Get appropriate test input for a file."""
        test_cases = {
            "codenet_p00002": "12 34\n56 78\n",
            "codenet_p00003": "3 4 5\n",
            "codenet_p00005": "10\n20\n",
            "codenet_p00006": "5\n",
            "codenet_p00007": "3\n"
        }
        
        for pattern, input_data in test_cases.items():
            if pattern in filename:
                return input_data
        
        return "1\n"
    
    def process_file(self, original_file: Path) -> Optional[Dict]:
        """
        Process a file through all three versions.
        Returns analysis results or None if failed.
        """
        print(f"\n{original_file.name}")
        print("-" * 50)
        
        # Find all versions
        files = self.find_file_variations(original_file)
        
        if not files["obfuscated"] or not files["deobfuscated"]:
            print("  Warning: Could not find all versions")
            return None
        
        # Get test input
        input_data = self.get_test_input(original_file.name)
        
        # Process each version
        traces = {}
        for version_name, file_path in files.items():
            if not file_path:
                traces[version_name] = []
                continue
            
            try:
                print(f"  {version_name:15}...", end=" ")
                
                # Read code
                with open(file_path, 'r', encoding='utf-8') as f:
                    code = f.read()
                
                # Instrument
                instrumented = self.instrumenter.instrument(code)
                
                # Execute and trace
                trace = self.instrumenter.execute_and_trace(instrumented, input_data)
                traces[version_name] = trace
                
                print(f"✓ {len(trace):4} trace entries")
                
                # Save individual trace
                trace_file = Path("traces") / f"{original_file.stem}_{version_name}.json"
                with open(trace_file, 'w') as f:
                    json.dump(trace, f, indent=2)
                
            except Exception as e:
                print(f"✗ Error: {e}")
                traces[version_name] = []
        
        # Calculate similarities
        results = {
            "file": original_file.stem,
            "traces": {k: len(v) for k, v in traces.items()}
        }
        
        # Original vs Obfuscated
        if traces.get("original") and traces.get("obfuscated"):
            sim = self.similarity.calculate(traces["original"], traces["obfuscated"])
            results["original_vs_obfuscated"] = round(sim, 4)
            print(f"  Original ↔ Obfuscated: {sim:.3f}")
        
        # Obfuscated vs Deobfuscated
        if traces.get("obfuscated") and traces.get("deobfuscated"):
            sim = self.similarity.calculate(traces["obfuscated"], traces["deobfuscated"])
            results["obfuscated_vs_deobfuscated"] = round(sim, 4)
            print(f"  Obfuscated ↔ Deobfuscated: {sim:.3f}")
        
        # Deobfuscated vs Original
        if traces.get("deobfuscated") and traces.get("original"):
            sim = self.similarity.calculate(traces["deobfuscated"], traces["original"])
            results["deobfuscated_vs_original"] = round(sim, 4)
            print(f"  Deobfuscated ↔ Original: {sim:.3f}")
        
        return results


def main():
    """Main execution."""
    print("=" * 70)
    print("Code Instrumentation and Trace Analysis System")
    print("=" * 70)
    
    # Create output directories
    os.makedirs("traces", exist_ok=True)
    os.makedirs("similarity_results", exist_ok=True)
    
    # Find original files
    original_path = Path("original")
    if not original_path.exists():
        print("Error: 'original' folder not found!")
        return
    
    original_files = sorted(original_path.glob("*.js"))
    
    if not original_files:
        print("No JavaScript files found in original/")
        return
    
    print(f"\nFound {len(original_files)} file(s) to process\n")
    
    # Initialize analyzer
    analyzer = CodeAnalyzer()
    
    # Process all files
    all_results = []
    for orig_file in original_files:
        result = analyzer.process_file(orig_file)
        if result:
            all_results.append(result)
            
            # Save individual result
            result_file = Path("similarity_results") / f"{orig_file.stem}_similarity.json"
            with open(result_file, 'w') as f:
                json.dump(result, f, indent=2)
    
    # Create summary
    summary = {
        "total_files_processed": len(all_results),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "results": all_results,
        "statistics": {}
    }
    
    # Calculate statistics
    if all_results:
        sim_scores = []
        for r in all_results:
            for key in ["original_vs_obfuscated", "obfuscated_vs_deobfuscated", "deobfuscated_vs_original"]:
                if key in r:
                    sim_scores.append(r[key])
        
        if sim_scores:
            summary["statistics"] = {
                "average_similarity": round(sum(sim_scores) / len(sim_scores), 4),
                "min_similarity": round(min(sim_scores), 4),
                "max_similarity": round(max(sim_scores), 4)
            }
    
    # Save summary
    summary_file = Path("similarity_results") / "summary.json"
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    # Print summary
    print(f"\n{'=' * 70}")
    print(f"Processing Complete!")
    print(f"{'=' * 70}")
    print(f"Files processed: {len(all_results)}")
    print(f"Trace files: traces/")
    print(f"Similarity results: similarity_results/")
    print(f"Summary: similarity_results/summary.json")
    
    if summary.get("statistics"):
        stats = summary["statistics"]
        print(f"\nStatistics:")
        print(f"  Average similarity: {stats.get('average_similarity', 0):.3f}")
        print(f"  Min similarity: {stats.get('min_similarity', 0):.3f}")
        print(f"  Max similarity: {stats.get('max_similarity', 0):.3f}")


if __name__ == "__main__":
    main()

