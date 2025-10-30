#!/usr/bin/env node
/**
 * instrument.js (improved)
 * AST-based JavaScript instrumenter with better handling of obfuscation patterns.
 *
 * Usage:
 *   node instrument.js input.js output_instrumented.js
 *
 * Requires: esprima, estraverse, escodegen
 *   npm install esprima estraverse escodegen
 */

const fs = require('fs');
const esprima = require('esprima');
const estraverse = require('estraverse');
const escodegen = require('escodegen');

if (process.argv.length < 4) {
  console.error("Usage: node instrument.js <input.js> <output_instrumented.js>");
  process.exit(1);
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];

const code = fs.readFileSync(inputPath, 'utf-8');

// Parse original code to its own AST (so header won't be re-instrumented)
let origAst;
try {
  origAst = esprima.parseScript(code, { loc: true, range: true, tolerant: true });
} catch (err) {
  console.error("Failed to parse input JS:", err.message || err);
  process.exit(1);
}

// Trace header (collector + flush)
const headerCode = `
/* __TRACE_HEADER_START__ */
var __trace = {
  entries: [],
  add: function(func, line) { this.entries.push({ function: func, line: line }); },
  output: function() { if (this.entries.length) process.stderr.write(JSON.stringify(this.entries) + '\\n'); }
};
process.on('beforeExit', function(){ __trace.output(); });
setTimeout(function(){ __trace.output(); }, 1000);
/* __TRACE_HEADER_END__ */
`;

// Helper: create __trace.add AST node
function makeTraceCallNode(funcName, line) {
  return {
    type: 'ExpressionStatement',
    expression: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        computed: false,
        object: { type: 'Identifier', name: '__trace' },
        property: { type: 'Identifier', name: 'add' }
      },
      arguments: [
        { type: 'Literal', value: funcName },
        { type: 'Literal', value: line ? line : 0 }
      ]
    }
  };
}

// Infer function name heuristically
let anonCounter = 0;
function inferFunctionName(node, parent) {
  // Named function declarations / expressions
  if (node.id && node.id.name) return node.id.name;

  // If assigned to var/const/let: var foo = function() {}
  if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) {
    return parent.id.name;
  }

  // If property: obj = { foo: function() {} } or obj.foo = function() {}
  if (parent && parent.type === 'Property' && parent.key) {
    if (parent.key.type === 'Identifier') return parent.key.name;
    if (parent.key.type === 'Literal') return String(parent.key.value);
  }
  if (parent && parent.type === 'AssignmentExpression' && parent.left) {
    // assignment to a named identifier: foo = function() {}
    if (parent.left.type === 'Identifier') return parent.left.name;
    // assignment to member expression: obj.foo = function() {}
    if (parent.left.type === 'MemberExpression') {
      // try to extract last property name
      const prop = parent.left.property;
      if (prop && prop.type === 'Identifier') return prop.name;
    }
  }

  // If used as callback to process.stdin.on('data', fn) -> call it "data_handler"
  if (parent && parent.type === 'CallExpression' && parent.callee) {
    try {
      const calleeSrc = escodegen.generate(parent.callee);
      if (/process\.stdin|on\(|addListener/.test(calleeSrc)) return 'data_handler';
      if (/setTimeout|setInterval/.test(calleeSrc)) return 'timer_callback';
    } catch (e) { /* ignore */ }
  }

  // fallback: anonymous_N
  anonCounter++;
  return `anonymous_${anonCounter}`;
}

// Decide which top-level statements to instrument with 'global' traces
const TOP_LEVEL_STMT_TYPES = new Set([
  'ExpressionStatement','VariableDeclaration','IfStatement','ReturnStatement',
  'ForStatement','WhileStatement','DoWhileStatement','SwitchStatement',
  'TryStatement','ThrowStatement'
]);

// Traverse original AST and inject trace calls
estraverse.traverse(origAst, {
  enter: function(node, parent) {
    // Instrument functions: add trace at function entry (first line in body or function loc)
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.body) {
      // Only instrument block bodies (skip concise arrow expressions without block)
      if (node.body.type === 'BlockStatement') {
        const funcName = inferFunctionName(node, parent);
        // determine insertion line: first statement's start.line if available, otherwise function's start
        let insertLine = (node.loc && node.loc.start) ? node.loc.start.line : 0;
        if (node.body.body && node.body.body.length > 0 && node.body.body[0].loc && node.body.body[0].loc.start) {
          insertLine = node.body.body[0].loc.start.line;
        }
        // create trace node and insert at top of function body
        const traceNode = makeTraceCallNode(funcName, insertLine);
        // Avoid double-inserting when a function body was already instrumented (detect existing __trace.add)
        const firstStmt = node.body.body[0];
        if (!(firstStmt && firstStmt.type === 'ExpressionStatement'
              && firstStmt.expression && firstStmt.expression.callee
              && firstStmt.expression.callee.object && firstStmt.expression.callee.object.name === '__trace')) {
          node.body.body.unshift(traceNode);
        }
      } else {
        // concise arrow function without block - convert to block with trace? Better to wrap into block
        // To keep safe, skip instrumenting concise arrow functions (they're uncommon for this use-case)
      }
    }

    // Insert global traces before top-level statements inside Program or BlockStatement (only in original AST)
    if (parent && (parent.type === 'Program' || parent.type === 'BlockStatement') && TOP_LEVEL_STMT_TYPES.has(node.type)) {
      if (node.loc && node.loc.start) {
        const traceNode = makeTraceCallNode('global', node.loc.start.line);
        // insert traceNode before node inside parent's body array
        const bodyArr = parent.body || parent.consequent || (parent.block && parent.block.body);
        if (Array.isArray(bodyArr)) {
          const idx = bodyArr.indexOf(node);
          if (idx >= 0) {
            // Check if previous node is already a trace to avoid duplicate inserts
            const prev = bodyArr[idx - 1];
            const isPrevTrace = prev && prev.type === 'ExpressionStatement' &&
              prev.expression && prev.expression.callee &&
              prev.expression.callee.object && prev.expression.callee.object.name === '__trace';
            if (!isPrevTrace) {
              bodyArr.splice(idx, 0, traceNode);
            }
          }
        }
      }
    }
  }
});

// Build final AST: header + instrumented original body
let headerAst;
try {
  headerAst = esprima.parseScript(headerCode, { loc: false });
} catch (err) {
  console.error("Failed to parse header code:", err);
  process.exit(1);
}

const finalAst = {
  type: 'Program',
  body: headerAst.body.concat(origAst.body),
  sourceType: 'script'
};

// Generate instrumented code
const instrumentedCode = escodegen.generate(finalAst, { comment: true });

// Write output
fs.writeFileSync(outputPath, instrumentedCode, 'utf-8');
console.log(`Instrumented code written to ${outputPath}`);
