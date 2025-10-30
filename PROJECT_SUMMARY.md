# Project Summary: Code Instrumentation and Trace Analysis

## Overview

This project implements a comprehensive code instrumentation and trace analysis system for comparing execution traces across different code versions (original, obfuscated, and deobfuscated).

## Created Files

### Core System Files

1. **`trace_instrumenter.py`** - Main instrumentation system
   - `TraceInstrumenter` class: Instruments JavaScript code
   - `SimilarityCalculator` class: Compares traces using LCS algorithm
   - `CodeAnalyzer` class: Orchestrates the entire analysis process
   - Main execution function that processes all files

2. **`run_analysis.py`** - Convenient runner script
   - Simple wrapper for easy execution
   - Error handling and user-friendly interface

### Documentation Files

3. **`README.md`** - Comprehensive user documentation
   - Features and usage
   - Output format explanation
   - How it works
   - Requirements and troubleshooting

4. **`EXAMPLE_OUTPUT.md`** - Example outputs
   - Sample trace files
   - Sample similarity results
   - Console output examples
   - Interpretation guide

5. **`PROJECT_SUMMARY.md`** - This file
   - Project overview
   - Architecture explanation
   - Usage instructions

### Configuration Files

6. **`requirements.txt`** - Python dependencies
   - Standard library only (no external deps needed)
   - Optional enhancements listed

## Architecture

### Components

```
┌─────────────────────────────────────────────┐
│         trace_instrumenter.py               │
├─────────────────────────────────────────────┤
│                                             │
│  TraceInstrumenter                           │
│  ├── instrument(code)                       │
│  │   └── Wraps code with trace collection  │
│  └── execute_and_trace(code, input)         │
│      └── Runs instrumented code & collects  │
│                                             │
│  SimilarityCalculator                       │
│  ├── calculate(trace1, trace2)              │
│  │   └── Uses LCS algorithm                 │
│  └── detailed_comparison()                  │
│      └── Multiple similarity metrics        │
│                                             │
│  CodeAnalyzer                                │
│  ├── find_file_variations()                 │
│  ├── get_test_input()                       │
│  └── process_file()                         │
│      └── Orchestrates entire workflow       │
└─────────────────────────────────────────────┘
```

### Data Flow

```
Original Files          Instrumentation        Execution
─────────────────      ──────────────────     ────────────
original/              ┌──────────────────┐   ┌──────────┐
├── file1.js    ──────→│  Add tracing     │──→│  Execute │
obfuscated/            │  code around     │   │  with    │
├── file1.js    ──────→│  original logic  │   │  test    │
deobfuscated/           │                  │   │  input   │
└── file1.js    ──────→└──────────────────┘   └────┬─────┘
                                                     │
                                    Traces           │
                                      ↓              │
                                ┌──────────┐        │
                                │   trace  │        │
                                │  entries │        │
                                └────┬─────┘        │
                                     │              │
                    Comparison ←────┘              │
                    ┌──────────────┐               │
                    │  LCS-based   │               │
                    │  similarity  │               │
                    │  calculation │               │
                    └────┬─────────┘               │
                         ↓                         │
                  JSON Output                      ↓
            ┌──────────────────────┐    ┌──────────────┐
            │  traces/             │    │  similarity_ │
            │  file1_original.json │    │  results/    │
            │  file1_obfuscated...│    │  file1_sim...│
            └──────────────────────┘    └──────────────┘
```

## Key Features

### 1. Non-Invasive Instrumentation
- Does not modify original functionality
- Wraps code with trace collection
- Preserves execution order

### 2. Execution Trace Collection
- Records function names
- Records line numbers
- Maintains execution order
- JSON format output

### 3. Advanced Similarity Calculation
- Longest Common Subsequence (LCS) algorithm
- Handles different code structures
- Line number sequence comparison
- Function call sequence comparison

### 4. Multi-Version Comparison
- Original vs Obfuscated
- Obfuscated vs Deobfuscated
- Deobfuscated vs Original

### 5. Comprehensive Output
- Individual trace files
- Per-file similarity results
- Overall summary statistics

## Usage

### Basic Usage

```bash
# Run the analysis
python trace_instrumenter.py

# Or use the runner
python run_analysis.py
```

### Expected Workflow

1. **Place files** in `original/`, `obfuscated/`, `deobfuscated/` folders
2. **Run analysis**: `python run_analysis.py`
3. **Check results**:
   - `traces/` - individual trace files
   - `similarity_results/` - similarity scores
4. **Analyze**: Open summary JSON for overall statistics

## Trace Format

Each trace entry contains:
```json
{
  "function": "function_name",
  "line": 123
}
```

Complete trace:
```json
[
  {"function": "global", "line": 1},
  {"function": "global", "line": 2},
  {"function": "main", "line": 5},
  {"function": "main", "line": 7}
]
```

## Similarity Score

Range: **0.0 to 1.0**
- **0.0**: Completely different execution
- **1.0**: Identical execution

Calculation:
```
similarity = LCS_length(trace1, trace2) / average_length(trace1, trace2)
```

## Extending to Other Languages

### Python Support

```python
class PythonInstrumenter:
    def instrument(self, code):
        # Use sys.settrace() to hook into execution
        pass
```

### C/C++ Support

```python
class CppInstrumenter:
    def instrument(self, code):
        # Compile with gcc -finstrument-functions
        # or use debugger (gdb)
        pass
```

## Limitations and Future Work

### Current Limitations
- Focused on JavaScript/Node.js
- Requires manual test input specification
- Some obfuscation techniques may interfere

### Future Enhancements
- [ ] Python instrumentation support
- [ ] C/C++ instrumentation support
- [ ] Automatic test input generation
- [ ] Web-based visualization
- [ ] Batch processing optimization
- [ ] Semantic similarity (AST-based)

## Performance Considerations

- Timeout: 5 seconds per execution
- Memory: Traces stored in memory during processing
- Disk: JSON files for persistence
- Scalability: Can handle hundreds of files

## Error Handling

The system gracefully handles:
- Missing files
- Execution timeouts
- Parse errors
- Invalid code
- Missing dependencies

All errors are logged to console and processing continues with remaining files.

## Testing

To test the system:

1. Ensure Node.js is installed
2. Run: `python run_analysis.py`
3. Check console for progress
4. Verify output files in `traces/` and `similarity_results/`
5. Review `similarity_results/summary.json`

## Support

For issues:
1. Check console output for errors
2. Verify file structure (original/, obfuscated/, deobfuscated/)
3. Ensure Node.js is available
4. Check individual trace files for execution results

## Summary

This system provides a complete solution for:
- ✅ Instrumenting JavaScript code
- ✅ Collecting execution traces
- ✅ Comparing multiple versions
- ✅ Calculating similarity scores
- ✅ Producing comprehensive reports

All without modifying the original code functionality.



