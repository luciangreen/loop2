'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {loop2Translate} = require('../web/loop2.js');

test('converts unary facts and findall into an ordered list loop', () => {
  const output = loop2Translate(`
    colour(red).
    colour(blue).
    p(R) :- findall(X, colour(X), R).
  `);

  assert.match(output, /colours\(\[red,blue\]\)\./);
  assert.match(output, /p\(A\):-colours\(B\),loop001\(B,A\)\./);
  assert.match(output, /loop001\(\[A\|B\],\[A\|C\]\):-loop001\(B,C\)\./);
});

test('converts member generators and structured templates', () => {
  const output = loop2Translate(
    'p(R) :- findall([X,X], member(X, [a,b]), R).'
  );

  assert.match(output, /p\(A\):-loop001\(\[a,b\],A\)\./);
  assert.match(output, /loop001\(\[A\|B\],\[\[A,A\]\|C\]\):-loop001\(B,C\)\./);
});

test('preserves a supported arithmetic transformation', () => {
  const output = loop2Translate(`
    num(1).
    num(2).
    double_all(R) :- findall(Y, (num(X), Y is X * 2), R).
  `);

  assert.match(output, /nums\(\[1,2\]\)\./);
  assert.match(output, /C is A\*2/);
});

test('flattens nested findall and member into one loop', () => {
  const output = loop2Translate(`
    colour(red).
    colour(blue).
    p(R) :-
      findall([Y,Y],
        (findall(X, colour(X), Xs), member(Y, Xs)),
        R).
  `);

  assert.match(output, /colours\(\[red,blue\]\)\./);
  assert.doesNotMatch(output, /findall001|findall002/);
  assert.match(output, /loop001\(\[A\|B\],\[\[A,A\]\|C\]\)/);
});

test('splices a supported one-clause predicate', () => {
  const output = loop2Translate(`
    colour(red).
    colour(blue).
    q(Z) :- colour(X), Z = c-X.
    p(R) :- findall(Z, q(Z), R).
  `);

  assert.match(output, /colours\(\[red,blue\]\)\./);
  assert.match(output, /loop001\(\[A\|B\],\[C\|D\]\):-C=c-A,loop001\(B,D\)\./);
});

test('rejects unsupported control flow and side effects', () => {
  for (const [source, reason] of [
    ['p(R) :- findall(X, (colour(X), !), R).', 'cut'],
    ['p(R) :- findall(X, (colour(X); other(X)), R).', 'disjunction'],
    ['p(R) :- findall(X, (colour(X), writeln(X)), R).', 'side_effect(writeln)'],
  ]) {
    assert.equal(loop2Translate(source), `%% unsupported(reason(${reason})).\n`);
  }
});

test('rejects a second generator instead of emitting nondeterministic loop bodies', () => {
  const output = loop2Translate(`
    colour(red).
    shape(square).
    p(R) :- findall(X, (colour(X), shape(Y)), R).
  `);

  assert.equal(output, '%% unsupported(reason(unsupported_shape)).\n');
});

test('reports malformed terms instead of translating partial input', () => {
  assert.match(loop2Translate('p(R) :- findall(X, member(X, [a]), R)'), /^%% parse_error/);
  assert.match(loop2Translate('p(R) :- findall(X, member(X, [a]), R). /*'), /^%% parse_error/);
  assert.match(loop2Translate("p(R) :- findall('open, member(X, [a]), R)."), /^%% parse_error/);
  assert.match(loop2Translate('p(R) :- findall(X, member(X, [a]), R). @'), /^%% parse_error/);
});

test('reports empty input and documents the semantic boundary', () => {
  assert.match(loop2Translate(' \n % comment only'), /unsupported\(reason\(empty_input\)\)/);
  assert.match(loop2Translate('p(R) :- findall(X, member(X, [a]), R).'),
    /not_preserved\(full_prolog_backtracking_semantics\)/);
});
