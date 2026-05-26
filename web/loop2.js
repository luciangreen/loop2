// loop2.js — JavaScript port of the loop2 Prolog-to-Prolog translator.
// Converts simple nondeterministic Prolog patterns into deterministic
// recursive loop predicates.
'use strict';

// ════════════════════════════════════════════════════════════════════════
// TERM MODEL
// ════════════════════════════════════════════════════════════════════════

const mkAtom = name        => ({tag: 'atom', name});
const mkNum  = value       => ({tag: 'num',  value});
const mkVar  = name        => ({tag: 'var',  name});
const mkComp = (f, args)   => ({tag: 'compound', functor: f, args});
const mkNil  = ()          => mkAtom('[]');
const mkCons = (h, t)      => mkComp('.', [h, t]);

function mkList(elems, tail) {
  if (tail === undefined) tail = mkNil();
  for (let i = elems.length - 1; i >= 0; i--) tail = mkCons(elems[i], tail);
  return tail;
}

function termEq(a, b) {
  if (a.tag !== b.tag) return false;
  if (a.tag === 'atom') return a.name  === b.name;
  if (a.tag === 'num')  return a.value === b.value;
  if (a.tag === 'var')  return a.name  === b.name;
  if (a.tag === 'compound') {
    if (a.functor !== b.functor || a.args.length !== b.args.length) return false;
    return a.args.every((x, i) => termEq(x, b.args[i]));
  }
  return false;
}

function* subTerms(t) {
  yield t;
  if (t.tag === 'compound') for (const a of t.args) yield* subTerms(a);
}

// ════════════════════════════════════════════════════════════════════════
// TOKENIZER
// ════════════════════════════════════════════════════════════════════════

function isGraphicChar(c) {
  // Standard Prolog graphic chars except '.' (handled separately)
  // and ';' '!' '|' (handled as individual tokens).
  return '#&*+\\-/:<=?>@^~'.indexOf(c) >= 0;
}

function tokenize(text) {
  const toks = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c <= ' ') { i++; continue; }  // whitespace

    // Line comment
    if (c === '%') { while (i < n && text[i] !== '\n') i++; continue; }

    // Block comment
    if (c === '/' && i + 1 < n && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && i + 1 < n && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Integer or float
    if (c >= '0' && c <= '9') {
      let s = '';
      while (i < n && text[i] >= '0' && text[i] <= '9') s += text[i++];
      if (i < n && text[i] === '.' && i + 1 < n && text[i + 1] >= '0' && text[i + 1] <= '9') {
        s += text[i++];
        while (i < n && text[i] >= '0' && text[i] <= '9') s += text[i++];
      }
      toks.push({t: 'num', v: +s});
      continue;
    }

    // Quoted atom
    if (c === "'") {
      i++;
      let s = '';
      while (i < n) {
        if (text[i] === "'" && i + 1 < n && text[i + 1] === "'") { s += "'"; i += 2; }
        else if (text[i] === "'") { i++; break; }
        else s += text[i++];
      }
      toks.push({t: 'atom', v: s});
      continue;
    }

    // Variable (uppercase or _)
    if ((c >= 'A' && c <= 'Z') || c === '_') {
      let s = '';
      while (i < n && /[A-Za-z0-9_]/.test(text[i])) s += text[i++];
      toks.push({t: 'var', v: s});
      continue;
    }

    // Lowercase atom
    if (c >= 'a' && c <= 'z') {
      let s = '';
      while (i < n && /[A-Za-z0-9_]/.test(text[i])) s += text[i++];
      toks.push({t: 'atom', v: s});
      continue;
    }

    // Fixed single-character punctuation
    if (c === '(') { toks.push({t: 'lp'});    i++; continue; }
    if (c === ')') { toks.push({t: 'rp'});    i++; continue; }
    if (c === '[') { toks.push({t: 'lb'});    i++; continue; }
    if (c === ']') { toks.push({t: 'rb'});    i++; continue; }
    if (c === ',') { toks.push({t: 'comma'}); i++; continue; }
    if (c === '|') { toks.push({t: 'pipe'});  i++; continue; }
    if (c === '!') { toks.push({t: 'atom', v: '!'}); i++; continue; }
    if (c === ';') { toks.push({t: 'op',   v: ';'}); i++; continue; }

    // '.' — clause terminator or graphic operator
    if (c === '.') {
      i++;
      if (i >= n || text[i] <= ' ') {
        toks.push({t: 'dot'});
      } else {
        // Could be start of a multi-dot graphic op (e.g. shouldn't happen much)
        let s = '.';
        while (i < n && isGraphicChar(text[i])) s += text[i++];
        toks.push({t: 'op', v: s});
      }
      continue;
    }

    // '=..' must be recognised before the generic graphic handler
    if (c === '=' && i + 2 < n && text[i + 1] === '.' && text[i + 2] === '.') {
      toks.push({t: 'op', v: '=..'});
      i += 3;
      continue;
    }

    // Generic graphic operator (maximal munch)
    if (isGraphicChar(c)) {
      let s = '';
      while (i < n && isGraphicChar(text[i])) s += text[i++];
      toks.push({t: 'op', v: s});
      continue;
    }

    i++; // skip unknown character
  }

  toks.push({t: 'eof'});
  return toks;
}

// ════════════════════════════════════════════════════════════════════════
// PARSER  (Pratt / operator-precedence)
// ════════════════════════════════════════════════════════════════════════

// Binary infix operators  name -> {p: precedence, t: associativity}
const BINOP = {
  ':-':   {p: 1200, t: 'xfx'},
  '-->':  {p: 1200, t: 'xfx'},
  ';':    {p: 1100, t: 'xfy'},
  '->':   {p: 1050, t: 'xfy'},
  ',':    {p: 1000, t: 'xfy'},
  'is':   {p: 700,  t: 'xfx'},
  '=':    {p: 700,  t: 'xfx'},
  '\\=':  {p: 700,  t: 'xfx'},
  '=:=':  {p: 700,  t: 'xfx'},
  '=\\=': {p: 700,  t: 'xfx'},
  '==':   {p: 700,  t: 'xfx'},
  '\\==': {p: 700,  t: 'xfx'},
  '=..':  {p: 700,  t: 'xfx'},
  '<':    {p: 700,  t: 'xfx'},
  '>':    {p: 700,  t: 'xfx'},
  '=<':   {p: 700,  t: 'xfx'},
  '>=':   {p: 700,  t: 'xfx'},
  ':':    {p: 600,  t: 'xfy'},
  '+':    {p: 500,  t: 'yfx'},
  '-':    {p: 500,  t: 'yfx'},
  '*':    {p: 400,  t: 'yfx'},
  '/':    {p: 400,  t: 'yfx'},
  '//':   {p: 400,  t: 'yfx'},
  'mod':  {p: 400,  t: 'yfx'},
  'rem':  {p: 400,  t: 'yfx'},
  '**':   {p: 200,  t: 'xfx'},
  '^':    {p: 200,  t: 'xfy'},
};

// Prefix operators
const PREOP = {
  '\\+': {p: 900, t: 'fy'},
  'not': {p: 900, t: 'fy'},
  '-':   {p: 200, t: 'fy'},
  '+':   {p: 200, t: 'fy'},
  ':-':  {p: 1200, t: 'fx'},
  '?-':  {p: 1200, t: 'fx'},
};

class Parser {
  constructor(tokens) { this.toks = tokens; this.pos = 0; }

  peek()    { return this.toks[this.pos]; }
  consume() { return this.toks[this.pos++]; }

  expect(type) {
    const tok = this.peek();
    if (tok.t !== type) throw new Error(`Expected ${type}, got ${tok.t} ("${tok.v}")`);
    return this.consume();
  }

  parseClauses() {
    const clauses = [];
    while (this.peek().t !== 'eof') {
      clauses.push(this.parseTerm(1200));
      this.expect('dot');
    }
    return clauses;
  }

  // Returns the binary-operator name for the current token, or null.
  peekBinOp() {
    const tok = this.peek();
    if (tok.t === 'op'   && BINOP[tok.v]) return tok.v;
    if (tok.t === 'atom' && BINOP[tok.v]) return tok.v;
    if (tok.t === 'comma')                return ',';
    return null;
  }

  parseTerm(maxP) {
    let left, leftP;

    // Try prefix operator
    const tok = this.peek();
    const tokName = (tok.t === 'op' || tok.t === 'atom') ? tok.v : null;
    const pre = tokName ? PREOP[tokName] : null;

    if (pre && pre.p <= maxP) {
      this.consume();
      const argMaxP = pre.t === 'fy' ? pre.p : pre.p - 1;
      const arg = this.parseTerm(argMaxP);
      left  = mkComp(tokName, [arg]);
      leftP = pre.p;
    } else {
      [left, leftP] = this.parsePrimary();
    }

    // Extend left with binary operators
    while (true) {
      const opN = this.peekBinOp();
      if (!opN) break;
      const op = BINOP[opN];
      if (op.p > maxP) break;

      const leftMaxP  = op.t[0] === 'y' ? op.p : op.p - 1;
      if (leftP > leftMaxP) break;

      this.consume();
      const rightMaxP = op.t[2] === 'y' ? op.p : op.p - 1;
      const right = this.parseTerm(rightMaxP);
      left  = mkComp(opN, [left, right]);
      leftP = op.p;
    }

    return left;
  }

  parsePrimary() {
    const tok = this.peek();

    if (tok.t === 'num') { this.consume(); return [mkNum(tok.v), 0]; }
    if (tok.t === 'var') { this.consume(); return [mkVar(tok.v), 0]; }

    if (tok.t === 'lp') {
      this.consume();
      const t = this.parseTerm(1200);
      this.expect('rp');
      return [t, 0];
    }

    if (tok.t === 'lb') return [this.parseList(), 0];

    if (tok.t === 'atom' || tok.t === 'op') {
      this.consume();
      const name = tok.v;
      if (this.peek().t === 'lp') {
        this.consume();
        const args = this.parseArgList();
        this.expect('rp');
        return [mkComp(name, args), 0];
      }
      return [mkAtom(name), 0];
    }

    throw new Error(`Unexpected token: ${tok.t} ("${tok.v || ''}")`);
  }

  parseArgList() {
    if (this.peek().t === 'rp') return [];
    const args = [this.parseTerm(999)];
    while (this.peek().t === 'comma') { this.consume(); args.push(this.parseTerm(999)); }
    return args;
  }

  parseList() {
    this.consume(); // '['
    if (this.peek().t === 'rb') { this.consume(); return mkNil(); }

    const elems = [this.parseTerm(999)];
    while (this.peek().t === 'comma') { this.consume(); elems.push(this.parseTerm(999)); }

    let tail = mkNil();
    if (this.peek().t === 'pipe') { this.consume(); tail = this.parseTerm(999); }

    this.expect('rb');
    return mkList(elems, tail);
  }
}

function parse(text) {
  return new Parser(tokenize(text)).parseClauses();
}

// ════════════════════════════════════════════════════════════════════════
// UNIFICATION  (used by splice optimisation)
// ════════════════════════════════════════════════════════════════════════

function resolve(t, env) {
  while (t.tag === 'var' && env.has(t.name)) t = env.get(t.name);
  return t;
}

function unifyInto(t1, t2, env) {
  t1 = resolve(t1, env);
  t2 = resolve(t2, env);
  if (t1.tag === 'var') { env.set(t1.name, t2); return true; }
  if (t2.tag === 'var') { env.set(t2.name, t1); return true; }
  if (t1.tag === 'atom' && t2.tag === 'atom') return t1.name  === t2.name;
  if (t1.tag === 'num'  && t2.tag === 'num')  return t1.value === t2.value;
  if (t1.tag === 'compound' && t2.tag === 'compound') {
    if (t1.functor !== t2.functor || t1.args.length !== t2.args.length) return false;
    for (let i = 0; i < t1.args.length; i++)
      if (!unifyInto(t1.args[i], t2.args[i], env)) return false;
    return true;
  }
  return false;
}

function unify(t1, t2) {
  const env = new Map();
  return unifyInto(t1, t2, env) ? env : null;
}

function applyEnv(t, env) {
  t = resolve(t, env);
  if (t.tag !== 'compound') return t;
  return mkComp(t.functor, t.args.map(a => applyEnv(a, env)));
}

let _freshId = 0;
function freshCopy(t) {
  const map = new Map();
  const id = ++_freshId;
  function copy(t) {
    if (t.tag === 'var') {
      if (!map.has(t.name)) map.set(t.name, mkVar(`_g${id}_${t.name}`));
      return map.get(t.name);
    }
    if (t.tag === 'compound') return mkComp(t.functor, t.args.map(copy));
    return t;
  }
  return copy(t);
}

// ════════════════════════════════════════════════════════════════════════
// UNSUPPORTED DETECTION
// ════════════════════════════════════════════════════════════════════════

const SIDE_EFFECT_PREDS = new Set([
  'write', 'writeq', 'writeln', 'format', 'print', 'nl',
  'put_char', 'put_code', 'get_char', 'get_code',
  'read', 'read_term', 'open', 'close',
  'tell', 'told', 'see', 'seen', 'shell', 'halt',
]);

const ASSERT_RETRACT_PREDS = new Set([
  'assert', 'asserta', 'assertz', 'retract', 'retractall',
]);

function unsupportedSubterm(t) {
  if (t.tag === 'atom') {
    if (t.name === '!')      return 'cut';
    if (t.name === 'repeat') return 'infinite_generator';
  }
  if (t.tag === 'compound') {
    if (t.functor === ';')                                      return 'disjunction';
    if (t.functor === '->')                                     return 'if_then';
    if (t.functor === '\\+')                                    return 'negation';
    if (t.functor === 'not'      && t.args.length === 1)        return 'negation';
    if (t.functor === 'var'      && t.args.length === 1)        return 'var_sensitive';
    if (t.functor === 'call')                                   return 'meta_call';
    if (ASSERT_RETRACT_PREDS.has(t.functor))                    return 'assert_retract';
    if (SIDE_EFFECT_PREDS.has(t.functor))
      return `side_effect(${t.functor})`;
  }
  return null;
}

function detectUnsupported(clauses) {
  for (const clause of clauses)
    for (const sub of subTerms(clause)) {
      const r = unsupportedSubterm(sub);
      if (r) return r;
    }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ════════════════════════════════════════════════════════════════════════

function clauseFacts(clauses) {
  return clauses.filter(
    c => !(c.tag === 'compound' && c.functor === ':-' && c.args.length === 2)
  );
}

function baseListName(pred) { return pred + 's'; }

function collectBaseLists(facts) {
  const grouped = new Map();
  for (const f of facts) {
    if (f.tag === 'compound' && f.args.length === 1) {
      if (!grouped.has(f.functor)) grouped.set(f.functor, []);
      grouped.get(f.functor).push(f.args[0]);
    }
  }
  const result = [];
  for (const [name, values] of [...grouped].sort(([a], [b]) => a < b ? -1 : 1))
    result.push({name: baseListName(name), values});
  return result;
}

// Three generator optimisations (mirror loop2.pl)

function findallToLoop(goal, clauses, facts, visited) {
  // member(ItemVar, List)
  if (goal.tag === 'compound' && goal.functor === 'member' && goal.args.length === 2) {
    const [itemVar, list] = goal.args;
    if (itemVar.tag === 'var')
      return {source: {type: 'input_list', list}, itemVar, transform: null};
  }

  // fact generator: Pred(ItemVar) where facts contain Pred(_)
  if (goal.tag === 'compound' && goal.args.length === 1 && goal.args[0].tag === 'var') {
    const pred = goal.functor;
    if (facts.some(f => f.tag === 'compound' && f.functor === pred && f.args.length === 1))
      return {source: {type: 'base_list', name: baseListName(pred)},
              itemVar: goal.args[0], transform: null};
  }

  // (Generator, Transform)
  if (goal.tag === 'compound' && goal.functor === ',' && goal.args.length === 2) {
    const [gen, transform] = goal.args;
    const inner = supportedGenerator(gen, clauses, facts, visited);
    if (inner && inner.transform === null)
      return {source: inner.source, itemVar: inner.itemVar, transform};
  }

  return null;
}

function flattenLoopPipeline(goal, clauses, facts, visited) {
  // (findall(Inner, InnerGoal, List), member(Item, List))  where Item ≡ Inner
  if (!(goal.tag === 'compound' && goal.functor === ',' && goal.args.length === 2)) return null;
  const [left, right] = goal.args;

  if (!(left.tag === 'compound' && left.functor === 'findall' && left.args.length === 3)) return null;
  const [inner, innerGoal, list] = left.args;

  if (!(right.tag === 'compound' && right.functor === 'member' && right.args.length === 2)) return null;
  const [item, memberList] = right.args;

  // List must be the same variable in both findall and member.
  // item and inner may be different variables — use item as the loop var
  // since the outer template already references item.
  if (!termEq(memberList, list)) return null;
  if (!(item.tag === 'var' || termEq(item, inner))) return null;

  const gen = supportedGenerator(innerGoal, clauses, facts, visited);
  if (!gen || gen.transform !== null) return null;

  // Return item (the member variable) as itemVar so that the outer
  // template (which uses item) shares the same variable after numberVars.
  return {source: gen.source, itemVar: item, transform: null};
}

function spliceSupportedNestedPredicate(goal, clauses, facts, visited) {
  if (goal.tag !== 'compound' || goal.functor === ',') return null;
  const pred = goal.functor;

  if (visited.has(pred)) return null; // guard against mutual recursion
  if (facts.some(f => f.tag === 'compound' && f.functor === pred)) return null;

  visited.add(pred);
  try {
    for (const clause of clauses) {
      if (!(clause.tag === 'compound' && clause.functor === ':-' && clause.args.length === 2)) continue;
      const freshC = freshCopy(clause);
      const [freshHead, freshBody] = freshC.args;
      // Unify freshHead ← goal so fresh vars map to the caller's vars.
      const env = unify(freshHead, goal);
      if (!env) continue;
      const body = applyEnv(freshBody, env);
      const gen = supportedGenerator(body, clauses, facts, visited);
      if (gen) return gen;
    }
  } finally {
    visited.delete(pred);
  }
  return null;
}

function supportedGenerator(goal, clauses, facts, visited = new Set()) {
  return (
    flattenLoopPipeline(goal, clauses, facts, visited) ||
    findallToLoop(goal, clauses, facts, visited) ||
    spliceSupportedNestedPredicate(goal, clauses, facts, visited)
  );
}

function loop2Analyse(clauses) {
  const facts    = clauseFacts(clauses);
  const baseLists = collectBaseLists(facts);
  const pipelines = [];

  for (const clause of clauses) {
    if (!(clause.tag === 'compound' && clause.functor === ':-' && clause.args.length === 2)) continue;
    const [head, body] = clause.args;
    if (!(body.tag === 'compound' && body.functor === 'findall' && body.args.length === 3)) continue;
    const [template, goal, finalOutput] = body.args;

    const gen = supportedGenerator(goal, clauses, facts);
    if (!gen) continue;

    const {source, itemVar, transform} = gen;
    pipelines.push({
      head, source,
      loops: [{id: 1, inputVar: mkVar('_InputVar'), finalOutput, itemVar, template, transform}],
      finalOutput,
    });
  }

  return pipelines.length > 0 ? {baseLists, pipelines} : null;
}

// ════════════════════════════════════════════════════════════════════════
// EMISSION
// ════════════════════════════════════════════════════════════════════════

let _varSeq = 0;
function freshVar(base) { return mkVar(`_${base}${++_varSeq}`); }

function loopPredName(id) {
  return 'loop' + String(id).padStart(3, '0');
}

function emitPipeline({head, source, loops, finalOutput}) {
  const clauses = [];
  const {id, inputVar, itemVar, template, transform} = loops[0];
  const lname = loopPredName(id);

  // Main clause
  let mainBody;
  if (source.type === 'base_list') {
    mainBody = mkComp(',', [mkComp(source.name, [inputVar]), mkComp(lname, [inputVar, finalOutput])]);
  } else {
    mainBody = mkComp(lname, [source.list, finalOutput]);
  }
  clauses.push(mkComp(':-', [head, mainBody]));

  // Base clause: loop001([], []).
  clauses.push(mkComp(lname, [mkNil(), mkNil()]));

  // Step clause
  const xs = freshVar('Xs');
  const ys = freshVar('Ys');
  const stepHead = mkComp(lname, [mkCons(itemVar, xs), mkCons(template, ys)]);
  const recurse  = mkComp(lname, [xs, ys]);
  const noTransform = transform === null ||
                      (transform.tag === 'atom' && transform.name === 'true');
  const stepBody = noTransform ? recurse : mkComp(',', [transform, recurse]);
  clauses.push(mkComp(':-', [stepHead, stepBody]));

  return clauses;
}

function loop2Emit({baseLists, pipelines}) {
  const clauses = [];
  for (const bl of baseLists)  clauses.push(mkComp(bl.name, [mkList(bl.values)]));
  for (const p  of pipelines)  clauses.push(...emitPipeline(p));

  const header =
    '%% correctness(claimed_for(finite_pure_supported_generator_patterns)).\n' +
    '%% preserves([finite_result_list,order,simple_transformations,deterministic_single_success]).\n' +
    '%% not_preserved(full_prolog_backtracking_semantics).\n';

  return header + clauses.map(clauseToString).join('\n') + '\n';
}

// ════════════════════════════════════════════════════════════════════════
// TERM → STRING
// ════════════════════════════════════════════════════════════════════════

// Rename all variables to A, B, C, … in order of first appearance.
function numberVars(term) {
  const map = new Map();
  let counter = 0;
  function getVar(name) {
    if (!map.has(name)) {
      const idx = counter++;
      const letter = String.fromCharCode(65 + (idx % 26));
      const suffix = idx < 26 ? '' : String(Math.floor(idx / 26));
      map.set(name, letter + suffix);
    }
    return map.get(name);
  }
  function walk(t) {
    if (t.tag === 'var')      return mkVar(getVar(t.name));
    if (t.tag === 'compound') return mkComp(t.functor, t.args.map(walk));
    return t;
  }
  return walk(term);
}

function clauseToString(clause) {
  const t = numberVars(clause);
  if (t.tag === 'compound' && t.functor === ':-' && t.args.length === 2) {
    const [head, body] = t.args;
    return `${termStr(head, 999)}:-${termStr(body, 1199)}.`;
  }
  return `${termStr(t, 1200)}.`;
}

function termStr(t, maxP) {
  if (t.tag === 'atom') return fmtAtom(t.name);
  if (t.tag === 'num')  return String(t.value);
  if (t.tag === 'var')  return t.name;

  if (t.tag === 'compound') {
    const {functor: f, args: a} = t;

    // List notation
    if (f === '.' && a.length === 2) return fmtList(t);

    // Binary operator
    if (a.length === 2 && BINOP[f]) {
      const op   = BINOP[f];
      const lp   = op.t[0] === 'y' ? op.p : op.p - 1;
      const rp   = op.t[2] === 'y' ? op.p : op.p - 1;
      const ls   = termStr(a[0], lp);
      const rs   = termStr(a[1], rp);
      const sep  = f === ',' ? ',' : (/[a-z]/i.test(f[0]) ? ` ${f} ` : f);
      const s    = `${ls}${sep}${rs}`;
      return op.p > maxP ? `(${s})` : s;
    }

    // Prefix operator
    if (a.length === 1 && PREOP[f]) {
      const op = PREOP[f];
      const ap = op.t === 'fy' ? op.p : op.p - 1;
      const s  = `${f}(${termStr(a[0], ap)})`;
      return op.p > maxP ? `(${s})` : s;
    }

    // Regular compound
    return `${fmtAtom(f)}(${a.map(x => termStr(x, 999)).join(',')})`;
  }

  return '???';
}

function fmtList(t) {
  const elems = [];
  while (t.tag === 'compound' && t.functor === '.' && t.args.length === 2) {
    elems.push(termStr(t.args[0], 999));
    t = t.args[1];
  }
  const tail = (t.tag === 'atom' && t.name === '[]')
    ? ''
    : `|${termStr(t, 999)}`;
  return `[${elems.join(',')}${tail}]`;
}

function fmtAtom(name) {
  if (/^[a-z][A-Za-z0-9_]*$/.test(name))   return name;       // regular atom
  if (/^[#&*+\-/:<=?>@\\^~]+$/.test(name)) return name;       // operator atom
  if (name === '[]' || name === '{}' || name === '!') return name;
  if (name === '') return "''";
  return "'" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════

function loop2Translate(inputText) {
  let clauses;
  try {
    clauses = parse(inputText.trim());
  } catch (e) {
    return `%% parse_error(${String(e.message).replace(/[()]/g, '_')}).\n`;
  }

  if (clauses.length === 0) {
    return '%% unsupported(reason(empty_input)).\n';
  }

  const reason = detectUnsupported(clauses);
  if (reason) {
    return `%% unsupported(reason(${reason})).\n`;
  }

  const plan = loop2Analyse(clauses);
  if (!plan) {
    return '%% unsupported(reason(unsupported_shape)).\n';
  }

  return loop2Emit(plan);
}

// Export for use from HTML / Node.js
if (typeof module !== 'undefined') module.exports = {loop2Translate};
