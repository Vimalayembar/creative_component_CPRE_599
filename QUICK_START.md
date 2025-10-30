# Quick Start Guide

## 🚀 Get Started in 3 Steps

### Step 1: Verify Your Setup

Make sure you have:
- ✅ Python 3.7 or higher
- ✅ Node.js installed (check with `node --version`)
- ✅ Files in folders: `original/`, `obfuscated/`, `deobfuscated/`

### Step 2: Run the Analysis

Simply run:

```bash
python trace_instrumenter.py
```

Or use the convenient runner:

```bash
python run_analysis.py
```

### Step 3: Check Results

After execution, you'll have:

```
traces/
├── C77-0_01_codenet_p00002_1_original.json
├── C77-0_01_codenet_p00002_1_obfuscated.json
├── C77-0_01_codenet_p00002_1_deobfuscated.json
└── ...

similarity_results/
├── C77-0_01_codenet_p00002_1_similarity.json
├── summary.json
└── ...
```

## 📊 Understanding the Output

### Trace Files

Show the execution flow:

```json
[
  {"function": "global", "line": 1},
  {"function": "global", "line": 2},
  {"function": "data", "line": 5}
]
```

### Similarity Scores

Range: 0.0 (different) to 1.0 (identical)

- **> 0.7**: High similarity
- **0.4 - 0.7**: Moderate similarity  
- **< 0.4**: Low similarity

### Expected Results

For well-deobfuscated code:
- `deobfuscated_vs_original`: High (> 0.7) ✓
- `original_vs_obfuscated`: Low (< 0.4) (expected)
- `obfuscated_vs_deobfuscated`: Varies

## 🎯 Quick Commands

```bash
# Run analysis
python run_analysis.py

# View summary
cat similarity_results/summary.json

# View specific trace
cat traces/C77-0_01_codenet_p00002_1_original.json

# View similarities for a file
cat similarity_results/C77-0_01_codenet_p00002_1_similarity.json
```

## 🔧 Troubleshooting

### "No files found"

**Problem**: No `.js` files in `original/` folder

**Solution**: Place JavaScript files in the `original/` folder

### "Node.js not found"

**Problem**: Node.js not installed or not in PATH

**Solution**: Install Node.js from https://nodejs.org/

### "Timeout errors"

**Problem**: Some code runs too long

**Solution**: This is normal for obfuscated code with anti-debugging. The system handles it gracefully.

### "Low similarity scores"

**Problem**: Lower than expected similarity

**Explanation**: This is expected for heavily obfuscated code. Focus on relative patterns:
- Deobfuscated should be more similar to Original than Obfuscated is

## 📝 What You Get

1. **Trace Files** (`traces/` folder)
   - JSON files showing execution traces
   - One file per version of each original file
   - Format: `{filename}_{version}.json`

2. **Similarity Results** (`similarity_results/` folder)
   - JSON files with similarity scores
   - One file per original file
   - Format: `{filename}_similarity.json`

3. **Summary** (`similarity_results/summary.json`)
   - Overall statistics
   - All similarity scores
   - Average/min/max metrics

## 💡 Pro Tips

1. **Check the summary first**: Look at `similarity_results/summary.json` for overall patterns

2. **Focus on deobfuscated vs original**: This tells you how well deobfuscation worked

3. **Look at trace lengths**: Obfuscated files often have much longer traces

4. **Compare patterns**: Good deobfuscation should have similar trace patterns to original

## 🎓 Next Steps

- Read `README.md` for detailed documentation
- Check `EXAMPLE_OUTPUT.md` for output examples
- See `PROJECT_SUMMARY.md` for architecture details
- Extend the system for other languages (see docs)

## 📞 Quick Reference

```bash
# Run
python run_analysis.py

# Check results
ls traces/
ls similarity_results/

# View summary
cat similarity_results/summary.json | python -m json.tool
```

That's it! You're ready to go. 🎉



