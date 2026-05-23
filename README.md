```
loop2 — Prolog Program Requirements

loop2 is a Prolog-to-Prolog translator that converts a small, supported subset of nondeterministic Prolog into deterministic Prolog by replacing nondeterministic generators with explicit list loops. It extends the existing findall/3 conversion idea, where nested findall calls are already translated into numbered recursive predicates such as findall001/2, findall002/2, etc.  ￼

1. Goal

Convert:

p(Result) :-
    generator(X),
    transform(X, Y),
    nested_generator(Y, Z),
    Result = ...

into deterministic predicates that:

p(Result) :-
    generator_list(Xs),
    loop001(Xs, Ys),
    loop002(Ys, Result).

The tool should not attempt full Prolog compilation. It should only handle simple, educational, deterministic list conversion.

2. Supported Input Patterns

loop2 must support:

findall(Template, Goal, Result)

simple generators:

fact(X)
member(X, List)

simple transformations:

Y = f(X)
Y is X + 1
Y = [X,X]

simple nested generator chains:

p(R) :-
    findall(Y, q(X, Y), R).

where q/2 can be flattened if it has the supported shape:

q(X, Y) :-
    a(X),
    b(X, Y).

3. Unsupported Cases

loop2 may explicitly reject:

!
;
->
\+
call/1
assert/retract
var/1-sensitive code
side effects inside generators
open-ended infinite generators
complex cuts

The translator should output:

% unsupported(reason(...))

rather than pretending to preserve full Prolog semantics.

4. Core Translation Rules

Rule A — Facts to List Predicate

Input:

colour(red).
colour(blue).

Output:

colours([red, blue]).

Rule B — findall to Loop

Input:

p(R) :-
    findall(Y, (colour(X), Y = c-X), R).

Output:

p(R) :-
    colours(Xs),
    loop001(Xs, R).
loop001([], []).
loop001([X|Xs], [Y|Ys]) :-
    Y = c-X,
    loop001(Xs, Ys).

Rule C — Nested findall Flattening

Input:

p(R) :-
    findall([Y,Y],
        (findall(X, colour(X), Xs),
         member(Y, Xs)),
        R).

Output:

p(R) :-
    colours(Xs),
    loop001(Xs, R).
loop001([], []).
loop001([X|Xs], [[X,X]|Ys]) :-
    loop001(Xs, Ys).

This is a key loop2 improvement: avoid unnecessary intermediate findall001, findall002 where the pipeline can be safely fused.

Rule D — Splicing Simple Nested Predicate Output

Input:

p(R) :-
    findall(Z, q(Z), R).
q(Z) :-
    colour(X),
    Z = c-X.

Output:

p(R) :-
    colours(Xs),
    loop001(Xs, R).
loop001([], []).
loop001([X|Xs], [Z|Zs]) :-
    Z = c-X,
    loop001(Xs, Zs).

5. Main Predicates Required

loop2_translate(+InputAtom, -OutputAtom).

Parses one Prolog clause or small program and emits transformed Prolog.

loop2_file(+InputFile, +OutputFile).

Reads a .pl file and writes translated deterministic Prolog.

loop2_analyse(+Clause, -Plan).

Produces an intermediate plan:

plan(BaseLists, Loops, MainPredicate)
loop2_emit(+Plan, -OutputAtom).

Emits final Prolog source.

6. Intermediate Representation

Use a simple IR:

base_list(Name, Values).
loop(Id, InputVar, OutputVar, Transform).
pipeline(PredicateName, InputList, Steps, FinalOutput).

Example:

loop(1, Xs, Ys, transform(X, Y, Y = c-X)).

7. Optimisation Requirements

loop2 should perform three minimal optimisations:

findall_to_loop
flatten_loop_pipeline
splice_supported_nested_predicate

No WAM, no full choicepoint handling, no full meta-interpreter.

8. Correctness Claim

loop2 only claims correctness for finite, pure, supported generator patterns.

It preserves:

same finite result list
same order
same simple transformations
deterministic single success

It does not claim to preserve full Prolog backtracking semantics.

9. Suggested Repository Description

loop2 is a minimal Prolog-to-Prolog translator that converts simple nondeterministic Prolog patterns into deterministic recursive loop predicates. It combines findall/3 elimination, loop flattening, and simple nested predicate splicing to produce clearer deterministic Prolog for education, optimisation, and later pl2c/pl2js compilation.
```