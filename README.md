loop2

Minimal deterministic Prolog loop compiler.

loop2 converts a small supported subset of nondeterministic Prolog into deterministic recursive loop predicates. It focuses on:

* findall/3 elimination
* flattening nested findall + member
* splicing simple nondeterministic predicates
* converting fact generators into list generators
* generating explicit recursive loops

The project intentionally avoids full Prolog compilation, WAM implementation, or complete backtracking preservation.

⸻

Philosophy

loop2 treats simple nondeterministic predicates as:

generator -> list source -> deterministic recursive loop

Instead of:

findall(Y, Goal, Result)

the compiler generates:

loop001(InputList, Result)

with explicit recursion.

The generated code is intended to be:

* educational
* inspectable
* deterministic
* pl2c/pl2js-friendly
* easy to optimise further

⸻

Features

Supported

Direct fact generators

colour(red).
colour(blue).
p(R) :-
    findall(X, colour(X), R).

member/2 generators

p(R) :-
    findall([X,X], member(X, List), R).

Simple transformations

Y = c-X
Y is X + 1
Y = [X,X]

Nested findall + member flattening

findall([Y,Y],
    (findall(X, colour(X), Xs),
     member(Y, Xs)),
    R)

becomes a single-pass loop.

Simple predicate splicing

q(Z) :-
    colour(X),
    Z = c-X.

can be inlined into a loop pipeline.

⸻

Unsupported

loop2 intentionally rejects more complex Prolog constructs.

Unsupported constructs produce:

%% unsupported(reason(...)).

Unsupported:

!
;
->
\+
call/1
assert/retract
repeat
side effects
infinite generators
meta-calls

This project is deliberately minimal.

⸻

Example

Input

colour(red).
colour(blue).
p(R) :-
    findall(Y,
        (colour(X),
         Y = c-X),
        R).

⸻

Output

%% correctness(claimed_for(finite_pure_supported_generator_patterns)).
%% preserves([finite_result_list, order, simple_transformations, deterministic_single_success]).
%% not_preserved(full_prolog_backtracking_semantics).
colours([red, blue]).
p(R) :-
    colours(A),
    loop001(A, R).
loop001([], []).
loop001([X|Xs], [Y|Ys]) :-
    Y = c-X,
    loop001(Xs, Ys).

⸻

Installation

SWI-Prolog

swipl

Load the module:

?- [loop2].

⸻

API

loop2_translate/2

Translate Prolog source text.

loop2_translate(+InputAtom, -OutputAtom)

Example:

?- loop2_translate(
       "p(R):-findall(X,colour(X),R).",
       Output).

⸻

loop2_file/2

Translate a file.

loop2_file(+InputFile, +OutputFile)

Example:

?- loop2_file('input.pl', 'output.pl').

⸻

loop2_analyse/2

Generate an intermediate plan representation.

loop2_analyse(+Input, -Plan)

Example IR:

plan(
    [base_list(colours, [red, blue])],
    [pipeline(...)]
)

⸻

loop2_emit/2

Emit deterministic Prolog from a plan.

loop2_emit(+Plan, -OutputAtom)

⸻

Optimisation Passes

loop2 currently implements three minimal optimisation passes.

⸻

1. findall_to_loop

Converts:

findall(X, colour(X), R)

into:

colours(Xs),
loop001(Xs, R)

⸻

2. flatten_loop_pipeline

Converts nested:

findall(Y,
    (findall(X, colour(X), Xs),
     member(Y, Xs)),
    R)

into a single loop pipeline.

⸻

3. splice_supported_nested_predicate

Inlines supported predicates:

q(Z) :-
    colour(X),
    Z = c-X.

into the current loop transform.

⸻

Generated Loop Structure

Generated loops follow this structure:

loop001([], []).
loop001([X|Xs], [Y|Ys]) :-
    Transform,
    loop001(Xs, Ys).

This replaces nondeterministic collection with deterministic recursion.

⸻

Correctness Model

loop2 only claims correctness for:

finite
pure
supported
generator patterns

Preserved:

- finite result list
- order
- simple transformations
- deterministic single success

Not preserved:

- full Prolog backtracking semantics
- cuts
- choicepoint behaviour
- meta-level execution

⸻

Internal Pipeline

parse_input
    ->
detect_unsupported
    ->
loop2_analyse
    ->
optimisation passes
    ->
loop2_emit

⸻

Design Goals

loop2 is intended as:

* a minimal educational compiler
* a preprocessing stage for pl2c/pl2js
* a deterministic subset extractor
* a loop fusion experiment
* a recursive-to-iterative transformation system

⸻

Future Work

Possible future extensions:

* multiple loop fusion
* accumulator optimisation
* tail recursion conversion
* nested list flattening
* recursive pipeline chaining
* Spec-to-Algorithm integration
* pl2js/pl2c backend integration
* recursive generator compression
* Gaussian elimination loop optimisation

⸻

Example Transformation Classes

Fact Generator

findall(X, colour(X), R)

↓

colours(Xs),
loop001(Xs, R)

⸻

Mapping

findall(Y,
    (colour(X),
     Y = c-X),
    R)

↓

loop001([X|Xs], [Y|Ys]) :-
    Y = c-X,
    loop001(Xs, Ys).

⸻

Duplication

findall([X,X],
    member(X, List),
    R)

↓

loop001([X|Xs], [[X,X]|Ys]) :-
    loop001(Xs, Ys).

⸻

License

BSD 3-Clause License.

⸻

Author

Lucian Green
