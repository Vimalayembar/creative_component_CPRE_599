#!/usr/bin/env node
/*
  CFG Tool: Build and compare static Control Flow Graphs (CFGs) for JS files.

  Folders covered: `original/`, `obfuscated/`, `deobfuscated/` (if present).

  Outputs:
  - cfg_reports/<set>/functions/*.json  (per-function CFG + fingerprint)
  - cfg_reports/compare/*.json          (pairwise comparisons and aggregates)

  Usage:
    - npm run cfg            # build + compare for default folders
    - npm run cfg:build      # build CFGs only
    - npm run cfg:compare    # compare using existing CFG builds
    - node cfg_tool.js --help
*/

import fs from 'fs';
import path from 'path';
import esprima from 'esprima';
import esgraph from 'esgraph';
import estraverse from 'estraverse';
import minimist from 'minimist';
import { globby } from 'globby';

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
// Hashing and small utilities
// ------------------------------

function stableStringify(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function simpleHash(input) {
  // Fowler–Noll–Vo hash variant
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function multisetToVectorLabelCounts(labels) {
  const counts = {};
  for (const l of labels) counts[l] = (counts[l] || 0) + 1;
  return counts;
}

function cosineSimilarity(countsA, countsB) {
  const keys = new Set([...Object.keys(countsA), ...Object.keys(countsB)]);
  let dot = 0, normA = 0, normB = 0;
  for (const k of keys) {
    const a = countsA[k] || 0;
    const b = countsB[k] || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jaccardIndex(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// ------------------------------
// AST -> Function discovery
// ------------------------------

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

function getLocStart(node) {
  return node && node.loc ? node.loc.start.line : null;
}

// ------------------------------
// Node normalization
// ------------------------------

function categorizeAstNode(astNode) {
  if (!astNode) return 'EMPTY';
  switch (astNode.type) {
    case 'IfStatement':
    case 'ConditionalExpression':
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'SwitchStatement':
      return 'COND';
    case 'ReturnStatement':
      return 'RET';
    case 'ThrowStatement':
      return 'THROW';
    case 'BreakStatement':
    case 'ContinueStatement':
      return 'JUMP';
    case 'ExpressionStatement':
      if (astNode.expression && astNode.expression.type === 'CallExpression') return 'CALL';
      if (astNode.expression && astNode.expression.type === 'AssignmentExpression') return 'ASSIGN';
      return 'EXPR';
    case 'VariableDeclaration':
      return 'ASSIGN';
    case 'TryStatement':
      return 'TRY';
    case 'EmptyStatement':
      return 'EMPTY';
    default:
      return 'OTHER';
  }
}

function normalizeCfgNodes(graph) {
  // graph: [entry, exit, nodes] from esgraph
  const [entry, exit, nodes] = graph;
  const nodeIdMap = new Map();
  const normalized = nodes.map((n, idx) => {
    const label = categorizeAstNode(n.astNode);
    const id = `n${idx}`;
    nodeIdMap.set(n, id);
    return { id, label, orig: n };
  });
  // Add entry/exit
  const entryId = 'ENTRY';
  const exitId = 'EXIT';
  nodeIdMap.set(entry, entryId);
  nodeIdMap.set(exit, exitId);
  const normEntry = { id: entryId, label: 'ENTRY', orig: entry };
  const normExit = { id: exitId, label: 'EXIT', orig: exit };
  const allNodes = [normEntry, normExit, ...normalized];

  // Edges
  const edges = [];
  function pushEdges(fromNode) {
    if (!fromNode || !fromNode.successors) return;
    for (const s of fromNode.successors) {
      const fromId = nodeIdMap.get(fromNode);
      const toId = nodeIdMap.get(s);
      if (fromId && toId) edges.push([fromId, toId]);
    }
  }
  pushEdges(entry);
  for (const n of nodes) pushEdges(n);

  return { nodes: allNodes, edges };
}

function buildAdjacency(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outMap = new Map(nodes.map(n => [n.id, new Set()]));
  const inDegree = new Map(nodes.map(n => [n.id, 0]));
  for (const [u, v] of edges) {
    outMap.get(u).add(v);
    inDegree.set(v, (inDegree.get(v) || 0) + 1);
  }
  return { byId, outMap, inDegree };
}

function collapseLinearChains(cfg) {
  const { nodes, edges } = cfg;
  const { byId, outMap, inDegree } = buildAdjacency(nodes, edges);
  const isSpecial = new Set(['ENTRY', 'EXIT']);

  // Build a mutable representation
  const out = new Map();
  const incoming = new Map();
  for (const n of nodes) {
    out.set(n.id, new Set());
    incoming.set(n.id, new Set());
  }
  for (const [u, v] of edges) {
    out.get(u).add(v);
    incoming.get(v).add(u);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      const id = n.id;
      if (isSpecial.has(id)) continue;
      const outs = out.get(id);
      const ins = incoming.get(id);
      if (outs.size === 1) {
        const [succ] = [...outs];
        if (!isSpecial.has(succ) && incoming.get(succ).size === 1) {
          // Merge n -> succ
          const succNode = byId.get(succ);
          const mergedLabel = `${n.label}+${succNode.label}`;
          n.label = mergedLabel;

          // Redirect edges id -> succOuts
          const succOuts = out.get(succ);
          out.set(id, new Set(succOuts));
          for (const so of succOuts) {
            incoming.get(so).delete(succ);
            incoming.get(so).add(id);
          }
          // Remove succ
          out.delete(succ);
          incoming.delete(succ);
          byId.delete(succ);
          changed = true;
        }
      }
    }
  }

  // Rebuild node list and edge list
  const keptIds = new Set([...out.keys()]);
  const keptNodes = nodes.filter(n => keptIds.has(n.id));
  const keptEdges = [];
  for (const [u, outs] of out.entries()) {
    for (const v of outs) keptEdges.push([u, v]);
  }
  return { nodes: keptNodes, edges: keptEdges };
}

// Simple WL-like hashing (labels + neighbor multiset propagation)
function wlHash(cfg, iterations = 2) {
  const { nodes, edges } = cfg;
  const neighbors = new Map(nodes.map(n => [n.id, []]));
  for (const [u, v] of edges) {
    neighbors.get(u).push(v);
    neighbors.get(v).push(u);
  }
  let labels = new Map(nodes.map(n => [n.id, n.label]));
  for (let it = 0; it < iterations; it++) {
    const next = new Map();
    for (const n of nodes) {
      const neighLabels = neighbors.get(n.id).map(id => labels.get(id)).sort();
      const combined = `${labels.get(n.id)}|${neighLabels.join(',')}`;
      next.set(n.id, simpleHash(combined));
    }
    labels = next;
  }
  const multiset = [...labels.values()].sort();
  return simpleHash(multiset.join('|'));
}

function edgeIdList(cfg) {
  // Edge id = fromLabel->toLabel (after collapse)
  const { nodes, edges } = cfg;
  const idToLabel = new Map(nodes.map(n => [n.id, n.label]));
  return edges.map(([u, v]) => `${idToLabel.get(u)}->${idToLabel.get(v)}`);
}

function degreeHistogram(cfg) {
  const { nodes, edges } = cfg;
  const outCounts = Object.create(null);
  const outDegree = new Map(nodes.map(n => [n.id, 0]));
  for (const [u] of edges) outDegree.set(u, (outDegree.get(u) || 0) + 1);
  for (const n of nodes) {
    const d = outDegree.get(n.id) || 0;
    outCounts[d] = (outCounts[d] || 0) + 1;
  }
  return outCounts;
}

// ------------------------------
// CFG build per function
// ------------------------------

function buildFunctionCfgsFromCode(code, filePath) {
  let ast;
  try {
    ast = esprima.parseScript(code, { loc: true, range: true, tolerant: true, comment: false });
  } catch (e1) {
    try {
      ast = esprima.parseModule(code, { loc: true, range: true, tolerant: true, comment: false });
    } catch (e2) {
      return [];
    }
  }
  const fnNodes = findFunctionNodes(ast);
  const cfgs = [];
  // Always include a synthesized top-level "program" function so files without functions are comparable
  try {
    const programBody = { type: 'BlockStatement', body: Array.isArray(ast.body) ? ast.body : [] };
    const progGraph = esgraph(programBody);
    const base = normalizeCfgNodes(progGraph);
    const collapsed = collapseLinearChains(base);
    const edges = edgeIdList(collapsed);
    const labels = collapsed.nodes.map(n => n.label);
    const labelCounts = multisetToVectorLabelCounts(labels);
    const wl = wlHash(collapsed);
    const fingerprint = {
      nodeCount: collapsed.nodes.length,
      edgeCount: collapsed.edges.length,
      degreeHistogram: degreeHistogram(collapsed),
      labelCounts,
      wlHash: wl
    };
    cfgs.push({
      functionName: '(program)',
      params: 0,
      startLine: 1,
      file: filePath,
      nodes: collapsed.nodes.map(n => ({ id: n.id, label: n.label })),
      edges: collapsed.edges,
      edgeIds: edges,
      fingerprint
    });
  } catch (_) {
    // ignore
  }
  for (const { node, parent } of fnNodes) {
    const name = getFunctionName(node, parent);
    let graph;
    try {
      // esgraph requires a BlockStatement (function body)
      const body = node.body && node.body.type === 'BlockStatement' ? node.body : { type: 'BlockStatement', body: [{ type: 'ReturnStatement' }] };
      graph = esgraph(body);
    } catch (_) {
      continue;
    }
    const base = normalizeCfgNodes(graph);
    const collapsed = collapseLinearChains(base);
    const edges = edgeIdList(collapsed);
    const labels = collapsed.nodes.map(n => n.label);
    const labelCounts = multisetToVectorLabelCounts(labels);
    const wl = wlHash(collapsed);
    const fingerprint = {
      nodeCount: collapsed.nodes.length,
      edgeCount: collapsed.edges.length,
      degreeHistogram: degreeHistogram(collapsed),
      labelCounts,
      wlHash: wl
    };
    cfgs.push({
      functionName: name,
      params: (node.params || []).length,
      startLine: getLocStart(node),
      file: filePath,
      nodes: collapsed.nodes.map(n => ({ id: n.id, label: n.label })),
      edges: collapsed.edges,
      edgeIds: edges,
      fingerprint
    });
  }
  return cfgs;
}

async function buildForFolder(folder, outRoot) {
  const exists = fs.existsSync(folder) && fs.lstatSync(folder).isDirectory();
  if (!exists) return null;
  const rel = path.basename(folder);
  const outDir = path.join(outRoot, rel);
  ensureDirSync(outDir);

  const files = await globby([`${folder.replace(/\\/g, '/')}/**/*.js`], { gitignore: false, absolute: true });
  const all = [];
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    const cfgs = buildFunctionCfgsFromCode(code, path.relative(process.cwd(), f));
    for (const c of cfgs) {
      const id = `${path.relative(folder, f).replace(/[\\/]/g, '__')}__${c.functionName}__L${c.startLine || 0}`;
      writeJsonSync(path.join(outDir, 'functions', `${id}.json`), c);
      all.push({ id, meta: { file: c.file, name: c.functionName, startLine: c.startLine, params: c.params }, fingerprint: c.fingerprint });
    }
  }
  writeJsonSync(path.join(outDir, 'summary.json'), { folder, functionCount: all.length });
  writeJsonSync(path.join(outDir, 'fingerprints.json'), all);
  return { folder, outDir, functions: all };
}

// ------------------------------
// Matching and comparison
// ------------------------------

function fingerprintToVector(fp) {
  // Build a simple sparse vector from degreeHistogram + labelCounts + node/edge
  const vec = {};
  vec[`nodeCount:${fp.nodeCount}`] = 1;
  vec[`edgeCount:${fp.edgeCount}`] = 1;
  for (const [k, v] of Object.entries(fp.degreeHistogram || {})) vec[`deg:${k}`] = v;
  for (const [k, v] of Object.entries(fp.labelCounts || {})) vec[`lab:${k}`] = v;
  return vec;
}

function vectorCosine(a, b) {
  return cosineSimilarity(a, b);
}

function wlSimilarity(hashA, hashB) {
  return hashA === hashB ? 1 : 0;
}

function compareFunctionPair(funcA, funcB) {
  const edgeJ = jaccardIndex(funcA.edgeIds || [], funcB.edgeIds || []);
  const wl = wlSimilarity(funcA.fingerprint.wlHash, funcB.fingerprint.wlHash);
  const vecA = fingerprintToVector(funcA.fingerprint);
  const vecB = fingerprintToVector(funcB.fingerprint);
  const vecSim = vectorCosine(vecA, vecB);
  const composite = 0.5 * edgeJ + 0.3 * vecSim + 0.2 * wl;
  return { edgeJaccard: edgeJ, vectorSim: vecSim, wlSim: wl, composite };
}

function greedyMatch(functionsA, functionsB, topK = 3) {
  const candidates = [];
  for (const a of functionsA) {
    const scored = functionsB.map(b => ({ a, b, score: compareFunctionPair(a, b).composite }))
      .sort((x, y) => y.score - x.score)
      .slice(0, topK);
    candidates.push(...scored);
  }
  candidates.sort((x, y) => y.score - x.score);
  const usedA = new Set();
  const usedB = new Set();
  const pairs = [];
  for (const c of candidates) {
    if (usedA.has(c.a.id) || usedB.has(c.b.id)) continue;
    usedA.add(c.a.id);
    usedB.add(c.b.id);
    pairs.push(c);
  }
  return pairs;
}

function aggregateReport(pairs) {
  if (pairs.length === 0) return { matched: 0, meanComposite: 0, over06: 0 };
  const scores = pairs.map(p => p.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const over06 = scores.filter(s => s >= 0.6).length / scores.length;
  return { matched: pairs.length, meanComposite: mean, pctOver06: over06 };
}

function compareFolders(builtA, builtB, outRoot, label) {
  const A = readJsonSync(path.join(builtA.outDir, 'fingerprints.json'), []);
  const B = readJsonSync(path.join(builtB.outDir, 'fingerprints.json'), []);

  // Normalize a file basename by stripping obf/deobf infixes before extension
  function normalizedBase(filePath) {
    const base = path.basename(filePath || '');
    return base.replace(/\.deobf(?=\.js$)/, '').replace(/\.obf(?=\.js$)/, '');
  }

  // Group functions by normalized basename to ensure file-scoped comparisons only
  function groupByBase(arr) {
    const map = new Map();
    for (const item of arr) {
      const base = normalizedBase((item.meta && item.meta.file) || '');
      if (!map.has(base)) map.set(base, []);
      map.get(base).push(item);
    }
    return map;
  }

  // Load full function JSON lazily only when necessary
  function loadFull(dir, item) {
    const funcPath = path.join(dir, 'functions', `${item.id}.json`);
    return readJsonSync(funcPath, null);
  }

  const byBaseA = groupByBase(A);
  const byBaseB = groupByBase(B);
  const commonBases = [...byBaseA.keys()].filter(k => byBaseB.has(k));

  const pairs = [];
  for (const base of commonBases) {
    const subsetA = byBaseA.get(base);
    const subsetB = byBaseB.get(base);
    const localPairs = greedyMatch(subsetA, subsetB, 3).map(({ a, b, score }) => {
      const fullA = loadFull(builtA.outDir, a);
      const fullB = loadFull(builtB.outDir, b);
      const metrics = compareFunctionPair(fullA, fullB);
      return {
        a: { id: a.id, name: fullA.functionName, file: fullA.file, startLine: fullA.startLine },
        b: { id: b.id, name: fullB.functionName, file: fullB.file, startLine: fullB.startLine },
        metrics,
        score: metrics.composite,
        fileBase: base
      };
    });
    pairs.push(...localPairs);
  }

  const agg = aggregateReport(pairs);
  const outFile = path.join(outRoot, 'compare', `${label}.json`);
  writeJsonSync(outFile, { label, pairs, aggregate: agg });
  return { pairs, aggregate: agg, outFile };
}

// ------------------------------
// CLI
// ------------------------------

function printHelp() {
  console.log(`CFG Tool\n\nCommands:\n  build               Build CFGs for default folders\n  compare             Compare using existing CFG builds\n  (default: both)\n\nOptions:\n  --folders=a,b,c     Override folders (default: original,obfuscated,deobfuscated)\n  --out=DIR           Output root (default: cfg_reports)\n`);
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
  const outRoot = path.resolve(process.cwd(), argv.out || 'cfg_reports');
  ensureDirSync(outRoot);

  const doBuild = cmd === 'build' || cmd === 'both' || cmd === undefined;
  const doCompare = cmd === 'compare' || cmd === 'both' || cmd === undefined;

  const built = {};
  if (doBuild) {
    for (const f of folders) {
      const res = await buildForFolder(f, outRoot);
      if (res) built[path.basename(f)] = res;
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
      // Compare pairs: original-obfuscated, obfuscated-deobfuscated, original-deobfuscated where available
      const pairs = [
        ['original', 'obfuscated', 'original_vs_obfuscated'],
        ['obfuscated', 'deobfuscated', 'obfuscated_vs_deobfuscated'],
        ['original', 'deobfuscated', 'original_vs_deobfuscated']
      ];
      for (const [a, b, label] of pairs) {
        if (built[a] && built[b]) {
          compareFolders(built[a], built[b], outRoot, label);
        }
      }
    }
  }

  console.log(`CFG processing complete. Output at: ${outRoot}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


