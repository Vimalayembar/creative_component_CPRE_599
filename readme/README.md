# Code Instrumentation and Trace Analysis System

This system instruments code to generate execution traces and compares traces across different code versions (original, obfuscated, and deobfuscated).

## Features

- **Multi-Language Support**: Designed to work with JavaScript, Python, C/C++, and other languages
- **Execution Tracing**: Records function calls and line execution in order
- **Trace Comparison**: Computes similarity scores between different code versions
- **JSON Output**: All traces and similarity scores saved in JSON format
- **Non-Invasive**: Does not modify original functionality

## Directory Structure

```
.
├── original/          # Original source code files
├── obfuscated/        # Obfuscated code files
├── deobfuscated/      # Deobfuscated code files
├── traces/            # Generated execution traces (JSON)
├── similarity_results/ # Similarity scores (JSON)
├── trace_instrumenter.py # Main instrumentation script
├── run_analysis.py      # Convenient runner script
└── README.md            # This file
```

## Usage

### Basic Usage

Run the trace analysis:

```bash
python trace_instrumenter.py
```

Or use the convenient runner:

```bash
python run_analysis.py
```

This will:
1. Process all files in the `original/` folder
2. Find corresponding obfuscated and deobfuscated versions
3. Instrument and execute each version
4. Collect execution traces
5. Compute similarity scores
6. Save results to:
   - `traces/` - Individual trace JSON files
   - `similarity_results/` - Similarity score JSON files

### Quick Start

1. Ensure your code structure:
   ```
   original/       - Original code files
   obfuscated/     - Obfuscated versions
   deobfuscated/   - Deobfuscated versions
   ```

2. Run the analysis:
   ```bash
   python run_analysis.py
   ```

3. Check results:
   ```bash
   # View traces
   cat traces/filename_original.json
   
   # View similarities
   cat similarity_results/filename_similarity.json
   
   # View summary
   cat similarity_results/summary.json
   ```

### Output Format

#### Trace Files (`traces/{filename}_{version}.json`)

```json
[
  {"function": "global", "line": 1},
  {"function": "global", "line": 2},
  {"function": "data", "line": 4},
  {"function": "digit", "line": 7}
]
```

#### Similarity Results (`similarity_results/{filename}_similarity.json`)

```json
{
  "file": "filename",
  "original_vs_obfuscated": 0.85,
  "obfuscated_vs_deobfuscated": 0.92,
  "deobfuscated_vs_original": 0.95,
  "trace_lengths": {
    "original": 50,
    "obfuscated": 45,
    "deobfuscated": 48
  }
}
```

## How It Works

### Instrumentation

The system instruments code by:
1. Wrapping the original code in a trace collection framework
2. Adding trace points at key locations (function calls, significant operations)
3. Recording function names and line numbers as execution progresses
4. Outputting traces to stderr for collection

### Similarity Calculation

Similarity scores use the **Longest Common Subsequence (LCS)** algorithm:
- Compares execution order and line sequences
- Handles different code structures while maintaining semantic similarity
- Range: 0.0 (completely different) to 1.0 (identical traces)

### Test Input Generation

The system automatically generates appropriate test inputs based on file patterns:
- `codenet_p00002`: "12 34\n56 78\n"
- `codenet_p00003`: "3 4 5\n"
- etc.

## Requirements

- Python 3.7+
- Node.js (for JavaScript execution)
- Appropriate language runtime for other languages

## Extending to Other Languages

To add support for other languages:

1. **Python**: Use the `sys.settrace()` hook
2. **C/C++**: Use debugger (gdb) or compile with instrumentation flags
3. **Java**: Use Java Agent API with ASM for bytecode instrumentation

Example structure for Python:

```python
class PythonInstrumenter:
    def instrument_code(self, code: str) -> str:
        # Wrap code with tracing hooks
        pass
```

## Troubleshooting

### No traces generated
- Check that Node.js is installed and in PATH
- Verify files exist in all three folders (original, obfuscated, deobfuscated)
- Check for execution errors in the console output

### Timeout errors
- Some obfuscated code may have infinite loops or anti-debugging protection
- Increase timeout value or skip problematic files

### Low similarity scores
- This is expected for heavily obfuscated code
- The obfuscation process changes control flow significantly
- Focus on relative scores (deobfuscated should be more similar to original)

## Limitations

- Current implementation focused on JavaScript
- Some obfuscation techniques may interfere with tracing
- Requires runtime execution (may be slow for large codebases)

## Future Enhancements

- [ ] Add Python instrumentation support
- [ ] Add C/C++ instrumentation support
- [ ] Support for batch processing of large datasets
- [ ] Web-based visualization of traces
- [ ] More sophisticated similarity algorithms (semantic analysis)

