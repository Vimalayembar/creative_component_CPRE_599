# Example Output

This document shows example output from the trace instrumentation system.

## Directory Structure After Running

```
.
├── original/          # Your original source files
├── obfuscated/        # Obfuscated versions
├── deobfuscated/      # Deobfuscated versions
├── traces/            # Generated trace files
│   ├── C77-0_01_codenet_p00002_1_original.json
│   ├── C77-0_01_codenet_p00002_1_obfuscated.json
│   ├── C77-0_01_codenet_p00002_1_deobfuscated.json
│   └── ...
├── similarity_results/ # Similarity scores
│   ├── C77-0_01_codenet_p00002_1_similarity.json
│   ├── summary.json
│   └── ...
└── trace_instrumenter.py
```

## Example Trace File

**File:** `traces/C77-0_01_codenet_p00002_1_original.json`

```json
[
  {"function": "global", "line": 1},
  {"function": "global", "line": 2},
  {"function": "global", "line": 4},
  {"function": "data", "line": 5},
  {"function": "data", "line": 6},
  {"function": "digit", "line": 7},
  {"function": "digit", "line": 8},
  {"function": "digit", "line": 9},
  {"function": "data", "line": 11}
]
```

## Example Similarity Results

**File:** `similarity_results/C77-0_01_codenet_p00002_1_similarity.json`

```json
{
  "file": "C77-0_01_codenet_p00002_1",
  "traces": {
    "original": 9,
    "obfuscated": 245,
    "deobfuscated": 8
  },
  "original_vs_obfuscated": 0.0236,
  "obfuscated_vs_deobfuscated": 0.0325,
  "deobfuscated_vs_original": 0.8889
}
```

## Summary Report

**File:** `similarity_results/summary.json`

```json
{
  "total_files_processed": 30,
  "timestamp": "2024-01-15 14:30:22",
  "results": [
    {
      "file": "C77-0_01_codenet_p00002_1",
      "traces": {
        "original": 9,
        "obfuscated": 245,
        "deobfuscated": 8
      },
      "original_vs_obfuscated": 0.0236,
      "obfuscated_vs_deobfuscated": 0.0325,
      "deobfuscated_vs_original": 0.8889
    },
    ...
  ],
  "statistics": {
    "average_similarity": 0.6234,
    "min_similarity": 0.0156,
    "max_similarity": 0.9876
  }
}
```

## Console Output Example

```
======================================================================
Code Instrumentation and Trace Analysis System
======================================================================

Found 30 file(s) to process

--------------------------------------------------
C77-0_01_codenet_p00002_1.js
--------------------------------------------------
  original       ... ✓    9 trace entries
  obfuscated     ... ✓  245 trace entries
  deobfuscated   ... ✓    8 trace entries
  Original ↔ Obfuscated: 0.024
  Obfuscated ↔ Deobfuscated: 0.033
  Deobfuscated ↔ Original: 0.889

--------------------------------------------------
C77-0_02_codenet_p00003_1.js
--------------------------------------------------
  ...

======================================================================
Processing Complete!
======================================================================
Files processed: 30
Trace files: traces/
Similarity results: similarity_results/
Summary: similarity_results/summary.json

Statistics:
  Average similarity: 0.623
  Min similarity: 0.016
  Max similarity: 0.988
```

## Interpretation

### Similarity Scores

- **0.0 - 0.3**: Low similarity (heavily obfuscated)
- **0.3 - 0.7**: Moderate similarity
- **0.7 - 1.0**: High similarity (well deobfuscated)

### Trace Length

- **Original**: Baseline execution
- **Obfuscated**: Usually longer due to additional code
- **Deobfuscated**: Should be similar to original

### Expected Patterns

For good deobfuscation:
1. **Deobfuscated vs Original**: High similarity (> 0.7)
2. **Obfuscated vs Deobfuscated**: Lower similarity
3. **Original vs Obfuscated**: Lowest similarity


