#!/usr/bin/env node
/**
 * AST-based JavaScript instrumentation.
 * Usage: node instrument.js input.js output.js
 */

const fs = require('fs');
const esprima = require('esprima');
const estraverse = require('estraverse');
const escodegen = require('escodegen');

// Read input/output paths from command line
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error("Usage: node instrument.js input.js output.js");
    process.exit(1);
}

const inputPath = args[0];
const outputPath = args[1];

const code = fs.readFileSync(inputPath, 'utf-8');

// Parse code into AST
let ast;
try {
    ast = esprima.parseScript(code, { loc: true });
} catch (err) {
    console.error("Failed to parse JS:", err);
    process.exit(1);
}

// Create trace collector wrapper
const traceHeader = esprima.parseScript(`
const __trace = {
    entries: [],
    add(func, line) { this.entries.push({ function: func, line: line }); },
    output() { if (this.entries.length > 0) process.stderr.write(JSON.stringify(this.entries)+'\\n'); }
};
process.on('beforeExit', () => __trace.output());
setTimeout(() => __trace.output(), 1000);
`);

ast.body = traceHeader.body.concat(ast.body);

// Helper to create __trace.add() call
function makeTraceCall(funcName, line) {
    return {
        type: 'ExpressionStatement',
        expression: {
            type: 'CallExpression',
            callee: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: '__trace' },
                property: { type: 'Identifier', name: 'add' },
                computed: false
            },
            arguments: [
                { type: 'Literal', value: funcName },
                { type: 'Literal', value: line }
            ]
        }
    };
}

// Traverse AST to instrument
estraverse.traverse(ast, {
    enter: function (node, parent) {
        // Instrument function bodies
        if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.body && node.body.type === 'BlockStatement') {
            const funcName = node.id ? node.id.name : "anonymous";
            const bodyStatements = node.body.body;
            for (let i = 0; i < bodyStatements.length; i++) {
                const stmt = bodyStatements[i];
                if (stmt.loc) {
                    bodyStatements.splice(i, 0, makeTraceCall(funcName, stmt.loc.start.line));
                    i++; // skip inserted
                }
            }
        }
        // Instrument top-level statements
        else if (node.type === 'ExpressionStatement' || node.type === 'VariableDeclaration' || node.type === 'IfStatement' || node.type === 'ReturnStatement') {
            if (node.loc) {
                const traceNode = makeTraceCall('global', node.loc.start.line);
                if (parent.type === 'Program' || parent.type === 'BlockStatement') {
                    const idx = parent.body.indexOf(node);
                    if (idx >= 0) parent.body.splice(idx, 0, traceNode);
                }
            }
        }
    }
});

// Generate instrumented code
const instrumentedCode = escodegen.generate(ast, { comment: true });

// Write to output
fs.writeFileSync(outputPath, instrumentedCode, 'utf-8');
console.log(`Instrumented code written to ${outputPath}`);
