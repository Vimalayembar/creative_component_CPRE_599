#!/usr/bin/env node
/*
  Call Graph Tool: Build and compare call graphs for JS files (static-first).

  Folders covered by default: `original/`, `obfuscated/`, `deobfuscated/`.

  Outputs:
  - callgraph_reports/<set>/functions/*.json   (per-function node with metadata)
  - callgraph_reports/<set>/graph.json        (folder-level call graph summary)
  - callgraph_reports/compare/*.json          (pairwise comparisons and aggregates)

  Usage:
    - npx node callgraph_tool.js           # build + compare
    - node callgraph_tool.js build         # build only
    - node callgraph_tool.js compare       # compare only (uses existing builds)
    - node callgraph_tool.js --help

  Notes:
    - Static collection: esprima + AST traversal of CallExpression/NewExpression.
    - Indirect/dynamic calls (eval, Function, .call/.apply) are labeled accordingly.
    - Matching/compare uses fingerprints, edge overlap, and neighborhood similarity.
*/

import fs from 'fs';
import path from 'path';
import esprima from 'esprima';
import estraverse from 'estraverse';
import minimist from 'minimist';
import { globbySync } from 'globby';

// ------------------------------
// Filesystem helpers
// ------------------------------

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJsonSync(filePath, data) {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJsonSync(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ------------------------------
// Hashing and utilities
// ------------------------------

function simpleHash(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function bodyFingerprint(node) {
  if (!node || !node.body) return 'na';
  const src = JSON.stringify(normalizeAst(node.body));
  return simpleHash(src);
}

function normalizeName(name) {
  if (!name) return '(anonymous)';
  if (/^(?:_0x|a0_0x|_0x[a-f0-9]+)$/i.test(name)) return 'OBF_NAME';
  return name;
}

function getLocStart(node) {
  return node && node.loc ? node.loc.start.line : null;
}

// ------------------------------
// AST parsing and normalization
// ------------------------------

function parseWithFallback(code) {
  try {
    return esprima.parseScript(code, { loc: true, range: true, tolerant: true });
  } catch (e1) {
    try {
      return esprima.parseModule(code, { loc: true, range: true, tolerant: true });
    } catch (e2) {
      return null;
    }
  }
}

function findFunctionNodes(ast) {
  const functions = [];
  estraverse.traverse(ast, {
    enter(node, parent) {
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        functions.push({ node, parent });
      }
    }
  });
  return functions;
}

function getFunctionName(node, parent) {
  if (node.id && node.id.name) return node.id.name;
  if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name) return parent.id.name;
  if (parent && parent.type === 'Property' && parent.key) return parent.key.name || parent.key.value;
  return '(anonymous)';
}

function countStatements(block) {
  if (!block) return 0;
  if (block.type === 'BlockStatement' && Array.isArray(block.body)) return block.body.length;
  return 1;
}

function normalizeAst(node) {
  // Strip identifiers and literals to get a body-based fingerprint
  return estraverse.replace(node, {
    enter(n) {
      if (n.type === 'Identifier') return { type: 'Identifier', name: 'ID' };
      if (n.type === 'Literal') return { type: 'Literal', value: 'LIT', raw: 'LIT' };
      return n;
    }
  });
}

// ------------------------------
// Call extraction within a function
// ------------------------------

function calleeLabel(callNode) {
  if (!callNode) return { key: 'unknown', type: 'direct' };
  if (callNode.type === 'Identifier') {
    const name = callNode.name || 'unknown';
    if (name === 'eval') return { key: 'eval', type: 'dynamic' };
    return { key: `id:${normalizeName(name)}`, type: 'direct' };
  }
  if (callNode.type === 'MemberExpression') {
    let prop = '';
    if (callNode.computed) {
      prop = '[expr]';
    } else if (callNode.property && callNode.property.name) {
      prop = callNode.property.name;
    } else {
      prop = 'prop';
    }
    // Detect .call/.apply
    if (prop === 'call' || prop === 'apply') return { key: `.call/${prop}`, type: 'indirect' };
    return { key: `prop:${normalizeName(prop)}`, type: 'method' };
  }
  return { key: 'expr', type: 'indirect' };
}

function extractCallsFromFunction(fnNode) {
  const calls = [];
  const has = { eval: false, newFunction: false };
  estraverse.traverse(fnNode.body ? fnNode.body : fnNode, {
    enter(node) {
      if (node.type === 'CallExpression') {
        const c = calleeLabel(node.callee);
        calls.push({ kind: 'call', callee: c.key, callType: c.type });
      } else if (node.type === 'NewExpression') {
        const c = calleeLabel(node.callee);
        if (c.key === 'id:Function') has.newFunction = true;
        calls.push({ kind: 'new', callee: c.key, callType: 'constructor' });
      } else if (node.type === 'Identifier' && node.name === 'eval') {
        has.eval = true;
      }
    }
  });
  return { calls, flags: has };
}

// ------------------------------
// Build per-file call graph
// ------------------------------

function buildFunctionsFromCode(code, filePath) {
  const ast = parseWithFallback(code);
  if (!ast) return [];
  const fns = findFunctionNodes(ast);
  const results = [];

  // Synthesize a top-level pseudo-function for program body
  const programNode = { type: 'FunctionDeclaration', id: { name: '(program)' }, params: [], body: { type: 'BlockStatement', body: ast.body || [] }, loc: { start: { line: 1 } } };
  const programCalls = extractCallsFromFunction(programNode);
  results.push({
    file: filePath,
    name: '(program)',
    normName: '(program)',
    startLine: 1,
    params: 0,
    bodyHash: bodyFingerprint(programNode),
    stmtCount: countStatements(programNode.body),
    flags: programCalls.flags,
    calls: programCalls.calls
  });

  for (const { node, parent } of fns) {
    const name = getFunctionName(node, parent);
    const normName = normalizeName(name);
    const calls = extractCallsFromFunction(node);
    results.push({
      file: filePath,
      name,
      normName,
      startLine: getLocStart(node),
      params: (node.params || []).length,
      bodyHash: bodyFingerprint(node),
      stmtCount: countStatements(node.body),
      flags: calls.flags,
      calls: calls.calls
    });
  }
  return results;
}

function buildGraphForFolderSync(folder, outRoot) {
  const exists = fs.existsSync(folder) && fs.lstatSync(folder).isDirectory();
  if (!exists) return null;
  const rel = path.basename(folder);
  const outDir = path.join(outRoot, rel);
  ensureDirSync(outDir);

  const files = globbySync([`${folder.replace(/\\/g, '/')}/**/*.js`], { gitignore: false, absolute: true });
  const allFns = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    const fns = buildFunctionsFromCode(code, path.relative(process.cwd(), f));
    for (const fn of fns) {
      const id = `${path.relative(folder, f).replace(/[\\/]/g, '__')}__${fn.normName}__L${fn.startLine || 0}`;
      const record = { id, meta: { file: fn.file, name: fn.name, normName: fn.normName, startLine: fn.startLine, params: fn.params, stmtCount: fn.stmtCount, flags: fn.flags }, calls: fn.calls, bodyHash: fn.bodyHash };
      writeJsonSync(path.join(outDir, 'functions', `${id}.json`), record);
      allFns.push(record);
    }
  }

  // Build graph nodes and edges (static): node ids are function ids; edges derived by name-based heuristic
  const nodes = allFns.map(fn => ({ id: fn.id, file: fn.meta.file, name: fn.meta.name, normName: fn.meta.normName, startLine: fn.meta.startLine, params: fn.meta.params, bodyHash: fn.bodyHash }));
  const nameIndex = new Map();
  for (const n of nodes) {
    const key = `${path.basename(n.file)}::${n.normName}`;
    if (!nameIndex.has(key)) nameIndex.set(key, []);
    nameIndex.get(key).push(n.id);
  }
  const edges = [];
  for (const fn of allFns) {
    const caller = fn.id;
    for (const c of fn.calls) {
      const label = c.callee;
      let targets = [];
      if (label.startsWith('id:')) {
        // Try to resolve to any function in same file by normalized name
        const key = `${path.basename(fn.meta.file)}::${label.substring(3)}`;
        targets = nameIndex.get(key) || [];
      }
      if (targets.length === 0) {
        // Unresolved — keep abstract edge to label
        edges.push({ from: caller, to: `@${label}`, callType: c.callType, kind: c.kind, weight: 1 });
      } else {
        for (const t of targets) edges.push({ from: caller, to: t, callType: c.callType, kind: c.kind, weight: 1 });
      }
    }
  }

  // Aggregate multiple edges into weights
  const keyToEdge = new Map();
  for (const e of edges) {
    const k = `${e.from}->${e.to}|${e.callType}|${e.kind}`;
    if (!keyToEdge.has(k)) keyToEdge.set(k, { ...e });
    else keyToEdge.get(k).weight += 1;
  }
  const finalEdges = [...keyToEdge.values()];

  writeJsonSync(path.join(outDir, 'graph.json'), { nodes, edges: finalEdges });
  writeJsonSync(path.join(outDir, 'summary.json'), { folder, functionCount: nodes.length, edgeCount: finalEdges.length });
  return { folder, outDir };
}

// ------------------------------
// Comparison
// ------------------------------

function jaccardIndex(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 1 : inter / uni;
}

function cosineSimilarity(countsA, countsB) {
  const keys = new Set([...Object.keys(countsA), ...Object.keys(countsB)]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const a = countsA[k] || 0;
    const b = countsB[k] || 0;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function functionVector(fn) {
  const vec = {};
  vec[`params:${fn.meta.params}`] = 1;
  vec[`stmts:${fn.meta.stmtCount}`] = 1;
  if (fn.meta.flags && fn.meta.flags.eval) vec['flag:eval'] = 1;
  if (fn.meta.flags && fn.meta.flags.newFunction) vec['flag:newFunction'] = 1;
  return vec;
}

function edgesSignature(graph, resolveAbstract = true) {
  // Build normalized edge ids using version-agnostic node keys
  const idToNode = new Map((graph.nodes || []).map(n => [n.id, n]));
  function normBase(base) {
    // Strip .obf and .deobf infixes before extension
    return base.replace(/\.deobf(?=\.js$)/, '').replace(/\.obf(?=\.js$)/, '');
  }
  function nodeKey(nodeId) {
    const n = idToNode.get(nodeId);
    if (!n) return `node:${nodeId}`;
    const base = normBase(path.basename(n.file));
    return `${base}::${n.normName}`;
  }
  return graph.edges.map(e => {
    const fromKey = nodeKey(e.from);
    const toKey = e.to.startsWith('@') ? e.to : nodeKey(e.to);
    return `${fromKey}->${toKey}:${e.callType}/${e.kind}`;
  });
}

function compareGraphs(graphA, graphB) {
  const eA = edgesSignature(graphA);
  const eB = edgesSignature(graphB);
  const edgeJ = jaccardIndex(eA, eB);
  // Per-node vector similarity where nodes are matched by (file-basename, normName, startLine)
  function nodeKey(n) { return `${path.basename(n.file)}::${n.normName}::${n.startLine || 0}`; }
  const aNodes = readJsonSync(path.join(path.dirname(graphA.path), 'functions_index.json'), []);
  const bNodes = readJsonSync(path.join(path.dirname(graphB.path), 'functions_index.json'), []);
  const mapA = new Map(aNodes.map(x => [x.key, x]));
  const mapB = new Map(bNodes.map(x => [x.key, x]));
  const common = [...mapA.keys()].filter(k => mapB.has(k));
  let vecSim = 0;
  if (common.length > 0) {
    let sum = 0;
    for (const k of common) {
      sum += cosineSimilarity(functionVector(mapA.get(k).fn), functionVector(mapB.get(k).fn));
    }
    vecSim = sum / common.length;
  }
  const composite = 0.7 * edgeJ + 0.3 * vecSim;
  return { edgeJaccard: edgeJ, nodeVectorSim: vecSim, composite };
}

function writeFunctionsIndex(outDir) {
  const funcDir = path.join(outDir, 'functions');
  if (!fs.existsSync(funcDir)) return;
  const files = fs.readdirSync(funcDir).filter(f => f.endsWith('.json'));
  const items = [];
  for (const f of files) {
    const fn = readJsonSync(path.join(funcDir, f));
    const base = path.basename(fn.meta.file).replace(/\.deobf(?=\.js$)/, '').replace(/\.obf(?=\.js$)/, '');
    const key = `${base}::${fn.meta.normName}`;
    items.push({ key, fn });
  }
  writeJsonSync(path.join(outDir, 'functions_index.json'), items);
}

function compareFolders(builtA, builtB, outRoot, label) {
  const graphPathA = path.join(builtA.outDir, 'graph.json');
  const graphPathB = path.join(builtB.outDir, 'graph.json');
  const gA = readJsonSync(graphPathA, null);
  const gB = readJsonSync(graphPathB, null);
  if (!gA || !gB) return null;
  gA.path = graphPathA;
  gB.path = graphPathB;
  const metrics = compareGraphs(gA, gB);
  const outFile = path.join(outRoot, 'compare', `${label}.json`);
  writeJsonSync(outFile, { label, metrics });
  return { outFile, metrics };
}

// ------------------------------
// CLI
// ------------------------------

function printHelp() {
  console.log(`Call Graph Tool\n\nCommands:\n  build               Build call graphs for default folders\n  compare             Compare using existing builds\n  (default: both)\n\nOptions:\n  --folders=a,b,c     Override folders (default: original,obfuscated,deobfuscated)\n  --out=DIR           Output root (default: callgraph_reports)\n`);
}

async function main() {
  const argv = minimist(process.argv.slice(2));
  const cmd = argv._[0] || 'both';
  if (argv.help || argv.h) return printHelp();

  const folders = (argv.folders ? String(argv.folders) : 'original,obfuscated,deobfuscated')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(f => path.resolve(process.cwd(), f));
  const outRoot = path.resolve(process.cwd(), argv.out || 'callgraph_reports');
  ensureDirSync(outRoot);

  const doBuild = cmd === 'build' || cmd === 'both' || cmd === undefined;
  const doCompare = cmd === 'compare' || cmd === 'both' || cmd === undefined;

  const built = {};
  if (doBuild) {
    for (const f of folders) {
      const res = buildGraphForFolderSync(f, outRoot);
      if (res) {
        writeFunctionsIndex(res.outDir);
        built[path.basename(f)] = res;
      }
    }
  } else {
    for (const f of folders) {
      const rel = path.basename(f);
      const outDir = path.join(outRoot, rel);
      if (fs.existsSync(outDir)) built[rel] = { folder: f, outDir };
    }
  }

  if (doCompare) {
    const names = Object.keys(built);
    if (names.length >= 2) {
      const pairs = [
        ['original', 'obfuscated', 'original_vs_obfuscated'],
        ['obfuscated', 'deobfuscated', 'obfuscated_vs_deobfuscated'],
        ['original', 'deobfuscated', 'original_vs_deobfuscated']
      ];
      for (const [a, b, label] of pairs) {
        if (built[a] && built[b]) compareFolders(built[a], built[b], outRoot, label);
      }
    }
  }

  console.log(`Call graph processing complete. Output at: ${outRoot}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


