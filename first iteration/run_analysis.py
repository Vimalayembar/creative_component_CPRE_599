#!/usr/bin/env python3
"""
Simple runner script for trace analysis.
Usage: python run_analysis.py
"""

import sys
from trace_instrumenter import main

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInterrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

