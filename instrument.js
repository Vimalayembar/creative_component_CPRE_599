#!/usr/bin/env node
/**
 * instrument.js — AST + stealth runtime wrappers
 *
 * Usage:
 *   node instrument.js input.js output_instrumented.js
 *
 * Requires: esprima estraverse escodegen
 *   npm install esprima estraverse escodegen
 *
 * Notes:
 * - Produces instrumented file that writes trace JSON to stderr.
 * - Uses non-enumerable property definitions where possible to be stealthier.
 * - Exposes globalThis.__wrapObjectFunctions(obj, prefix) for manual wrapping.
 */

const fs = require('fs');
const esprima = require('esprima');
const estraverse = require('estraverse');
const escodegen = require('escodegen');

if (process.argv.length < 4) {
  console.error('Usage: node instrument.js <input.js> <output_instrumented.js>');
  process.exit(1);
}

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const code = fs.readFileSync(inputPath, 'utf8');

// ---------- Parse source AST ----------
let origAst;
try {
  origAst = esprima.parseScript(code, { loc: true, range: true, tolerant: true });
} catch (err) {
  console.error('Failed to parse input JS:', err && (err.message || err));
  process.exit(1);
}

// ---------- Stealthy runtime header ----------
const headerCode = [
  '/* __TRACE_HEADER_START__ */',
  '(function(){',
  '  try {',
  "    var g = (function(){ return (typeof globalThis !== 'undefined') ? globalThis : (typeof global !== 'undefined' ? global : this); })();",
  '',
  '    var __trace = {',
  '      entries: [],',
  '      add: function(func, line) {',
  '        try { this.entries.push({ function: func, line: line }); } catch(e) {}',
  '      },',
  '      output: function() {',
  '        try {',
  '          if (this.entries && this.entries.length) {',
  "            try { if (typeof process !== 'undefined' && process.stderr && process.stderr.write) process.stderr.write(JSON.stringify(this.entries) + '\\n'); }",
  '            catch(e) { console.log(JSON.stringify(this.entries)); }',
  '          }',
  '        } catch(e) {}',
  '      }',
  '    };',
  '',
  "    try { Object.defineProperty(g, '__trace', { value: __trace, configurable: true, writable: true, enumerable: false }); } catch (e) { g.__trace = __trace; }",
  '',
  "    try { if (typeof process !== 'undefined' && process && process.on) process.on('beforeExit', function(){ __trace.output(); }); } catch(e){}",
  "    try { setTimeout(function(){ __trace.output(); }, 1000); } catch(e){}",
  '',
  '    var __genCount = 0;',
  '    function wrapGeneratedFunction(fn, name) {',
  "      if (typeof fn !== 'function') return fn;",
  "      if (fn.__is_traced) return fn;",
  '      var wrapped = function() {',
  "        try { __trace.add(name || ('generated_' + (++__genCount)), 0); } catch (e) {}",
  '        return fn.apply(this, arguments);',
  '      };',
  "      try { Object.defineProperty(wrapped, 'name', { value: name || fn.name || 'generated', configurable: true }); } catch(e){}",
  "      try { wrapped.prototype = fn.prototype; } catch(e){}",
  "      try { wrapped.__is_traced = true; } catch(e){}",
  '      return wrapped;',
  '    }',
  '',
  '    (function(){',
  '      try {',
  '        var OriginalFunction = Function;',
  '        function TracedFunction() {',
  '          var created = OriginalFunction.apply(this, arguments);',
  "          try { return wrapGeneratedFunction(created, 'generated_fn'); } catch(e) { return created; }",
  '        }',
  '        try { TracedFunction.prototype = OriginalFunction.prototype; } catch(e){}',
  "        try { Object.defineProperty(g, 'Function', { value: TracedFunction, configurable: true, writable: true, enumerable: false }); } catch(e){ g.Function = TracedFunction; }",
  '      } catch(e) {}',
  '    })();',
  '',
  '    (function(){',
  '      try {',
  '        var origEval = eval;',
  '        function tracedEval(s) {',
  "          try { __trace.add('eval', 0); } catch(e){}",
  '          return origEval(s);',
  '        }',
  "        try { Object.defineProperty(g, 'eval', { value: tracedEval, configurable: true, writable: true, enumerable: false }); } catch(e){ g.eval = tracedEval; }",
  '      } catch(e) {}',
  '    })();',
  '',
  '    (function(){',
  '      try {',
  '        var origSetTimeout = g.setTimeout;',
  '        if (typeof origSetTimeout === "function") {',
  '          function tracedSetTimeout(cb, t) {',
  '            try { if (typeof cb === "function") cb = wrapGeneratedFunction(cb, cb.name || "timer_callback"); } catch(e){}',
  '            return origSetTimeout.apply(this, [cb, t].concat(Array.prototype.slice.call(arguments,2)));',
  '          }',
  "          try { Object.defineProperty(g, 'setTimeout', { value: tracedSetTimeout, configurable: true, writable: true, enumerable: false }); } catch(e){ g.setTimeout = tracedSetTimeout; }",
  '        }',
  '      } catch(e) {}',
  '      try {',
  '        var origSetInterval = g.setInterval;',
  '        if (typeof origSetInterval === "function") {',
  '          function tracedSetInterval(cb, t) {',
  '            try { if (typeof cb === "function") cb = wrapGeneratedFunction(cb, cb.name || "timer_callback"); } catch(e){}',
  '            return origSetInterval.apply(this, [cb, t].concat(Array.prototype.slice.call(arguments,2)));',
  '          }',
  "          try { Object.defineProperty(g, 'setInterval', { value: tracedSetInterval, configurable: true, writable: true, enumerable: false }); } catch(e){ g.setInterval = tracedSetInterval; }",
  '        }',
  '      } catch(e) {}',
  '    })();',
  '',
  '    function __wrapObjectFunctions(obj, prefix) {',
  '      try {',
  '        if (!obj || typeof obj !== "object") return;',
  '        prefix = prefix || "";',
  '        for (var k in obj) {',
  '          try {',
  '            if (typeof obj[k] === "function" && !obj[k].__is_traced) {',
  '              obj[k] = wrapGeneratedFunction(obj[k], (prefix ? prefix + "." : "") + k);',
  '            }',
  '          } catch (e) {}',
  '        }',
  '      } catch (e) {}',
  '    }',
  '',
  "    try { Object.defineProperty(g, '__wrapObjectFunctions', { value: __wrapObjectFunctions, configurable: true, writable: true, enumerable: false }); } catch(e){ g.__wrapObjectFunctions = __wrapObjectFunctions; }",
  '',
  '  } catch (err) {',
  "    try { (typeof process !== 'undefined' && process.stderr && process.stderr.write) && process.stderr.write(''); } catch(e) {}",
  '  }',
  '})();',
  '/* __TRACE_HEADER_END__ */'
].join('\n');

// ---------- AST instrumentation helpers ----------
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

let anonCounter = 0;
function inferFunctionName(node, parent) {
  if (node && node.id && node.id.name) return node.id.name;
  if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) return parent.id.name;
  if (parent && parent.type === 'Property' && parent.key) {
    if (parent.key.type === 'Identifier') return parent.key.name;
    if (parent.key.type === 'Literal') return String(parent.key.value);
  }
  if (parent && parent.type === 'AssignmentExpression' && parent.left) {
    if (parent.left.type === 'Identifier') return parent.left.name;
    if (parent.left.type === 'MemberExpression' && parent.left.property && parent.left.property.type === 'Identifier') return parent.left.property.name;
  }
  if (parent && parent.type === 'CallExpression' && parent.callee) {
    try {
      var calleeSrc = escodegen.generate(parent.callee);
      if (/process\.stdin|on\(|addListener/.test(calleeSrc)) return 'data_handler';
      if (/setTimeout|setInterval/.test(calleeSrc)) return 'timer_callback';
    } catch (e) {}
  }
  anonCounter++;
  return 'anonymous_' + anonCounter;
}

const TOP_LEVEL_STMT_TYPES = new Set([
  'ExpressionStatement','VariableDeclaration','IfStatement','ReturnStatement',
  'ForStatement','WhileStatement','DoWhileStatement','SwitchStatement',
  'TryStatement','ThrowStatement'
]);

// Traverse AST and inject traces
estraverse.traverse(origAst, {
  enter: function(node, parent) {
    // instrument function entries
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.body) {
      if (node.body.type === 'BlockStatement') {
        var funcName = inferFunctionName(node, parent);
        var insertLine = (node.loc && node.loc.start) ? node.loc.start.line : 0;
        if (node.body.body && node.body.body.length > 0 && node.body.body[0].loc && node.body.body[0].loc.start) {
          insertLine = node.body.body[0].loc.start.line;
        }
        var traceNode = makeTraceCallNode(funcName, insertLine);
        var firstStmt = node.body.body[0];
        if (!(firstStmt && firstStmt.type === 'ExpressionStatement' &&
              firstStmt.expression && firstStmt.expression.callee &&
              firstStmt.expression.callee.object && firstStmt.expression.callee.object.name === '__trace')) {
          node.body.body.unshift(traceNode);
        }
      }
    }

    // instrument top-level statements with a global trace
    if (parent && (parent.type === 'Program' || parent.type === 'BlockStatement') && TOP_LEVEL_STMT_TYPES.has(node.type)) {
      if (node.loc && node.loc.start) {
        var traceNode2 = makeTraceCallNode('global', node.loc.start.line);
        var bodyArr = parent.body || parent.consequent || (parent.block && parent.block.body);
        if (Array.isArray(bodyArr)) {
          var idx = bodyArr.indexOf(node);
          if (idx >= 0) {
            var prev = bodyArr[idx - 1];
            var isPrevTrace = prev && prev.type === 'ExpressionStatement' &&
                              prev.expression && prev.expression.callee &&
                              prev.expression.callee.object && prev.expression.callee.object.name === '__trace';
            if (!isPrevTrace) {
              bodyArr.splice(idx, 0, traceNode2);
            }
          }
        }
      }
    }
  }
});

// ---------- Compose and generate final code ----------
let headerAst;
try {
  headerAst = esprima.parseScript(headerCode, { loc: false, tolerant: true });
} catch (err) {
  console.error('Failed to parse header code:', err && (err.message || err));
  process.exit(1);
}

const finalAst = {
  type: 'Program',
  body: headerAst.body.concat(origAst.body),
  sourceType: 'script'
};

const instrumentedCode = escodegen.generate(finalAst, { comment: true });

// Write output
fs.writeFileSync(outputPath, instrumentedCode, 'utf8');
console.log('Instrumented code written to', outputPath);
