# loop2

Minimal deterministic Prolog loop compiler.

`loop2` converts a small supported subset of nondeterministic Prolog into deterministic recursive loop predicates. It focuses on:

- `findall/3` elimination
- flattening nested `findall` + `member`
- splicing simple nondeterministic predicates
- converting fact generators into list generators
- generating explicit recursive loops

The project intentionally avoids full Prolog compilation, WAM implementation, or complete backtracking preservation.

## Philosophy

`loop2` treats simple nondeterministic predicates as:

`generator -> list source -> deterministic recursive loop`

Instead of:

```prolog
findall(Y, Goal, Result)
```

the compiler generates:

```prolog
loop001(InputList, Result)
```

with explicit recursion.

The generated code is intended to be:

- educational
- inspectable
- deterministic
- pl2c/pl2js-friendly
- easy to optimise further

## Example Commands

Here are practical examples and commands for what `loop2` can do.

### 1. Load loop2

```prolog
?- [loop2].
```

### 2. Convert facts + findall/3 to a loop

Input:

```prolog
colour(red).
colour(blue).
p(R) :-
    findall(X, colour(X), R).
```

Command:

```prolog
?- loop2_translate("
colour(red).
colour(blue).
p(R) :-
    findall(X, colour(X), R).
", Out),
writeln(Out).
```

Expected kind of output:

```prolog
%% correctness(claimed_for(finite_pure_supported_generator_patterns)).
%% preserves([finite_result_list,order,simple_transformations,deterministic_single_success]).
%% not_preserved(full_prolog_backtracking_semantics).
colours([red,blue]).
p(A):-colours(B),loop001(B,A).
loop001([],[]).
loop001([A|B],[A|C]):-loop001(B,C).
```

### 3. Convert member/2 over a list

Command:

```prolog
?- loop2_translate("
p(R) :-
    findall([X,X], member(X, [a,b,c]), R).
", Out),
writeln(Out).
```

Expected output shape:

```prolog
p(A) :-
    loop001([a,b,c], A).
loop001([], []).
loop001([X|Xs], [[X,X]|Ys]) :-
    loop001(Xs, Ys).
```

### 4. Convert a transformation

Command:

```prolog
?- loop2_translate("
num(1).
num(2).
num(3).
double_all(R) :-
    findall(Y, (num(X), Y is X * 2), R).
", Out),
writeln(Out).
```

Expected output shape:

```prolog
nums([1,2,3]).
double_all(R) :-
    nums(Xs),
    loop001(Xs, R).
loop001([], []).
loop001([X|Xs], [Y|Ys]) :-
    Y is X * 2,
    loop001(Xs, Ys).
```

### 5. Flatten nested findall + member

Command:

```prolog
?- loop2_translate("
colour(red).
colour(blue).
p(R) :-
    findall([Y,Y],
        (findall(X, colour(X), Xs),
         member(Y, Xs)),
        R).
", Out),
writeln(Out).
```

Expected idea:

```prolog
colours([red,blue]).
p(R) :-
    colours(Xs),
    loop001(Xs, R).
loop001([], []).
loop001([X|Xs], [[X,X]|Ys]) :-
    loop001(Xs, Ys).
```

This is the main "flatten and splice" feature.

### 6. Splice a simple nested predicate

Input:

```prolog
colour(red).
colour(blue).
q(Z) :-
    colour(X),
    Z = c-X.
p(R) :-
    findall(Z, q(Z), R).
```

Command:

```prolog
?- loop2_translate("
colour(red).
colour(blue).
q(Z) :-
    colour(X),
    Z = c-X.
p(R) :-
    findall(Z, q(Z), R).
", Out),
writeln(Out).
```

Expected idea:

```prolog
colours([red,blue]).
p(R) :-
    colours(Xs),
    loop001(Xs, R).
loop001([], []).
loop001([X|Xs], [Z|Zs]) :-
    Z = c-X,
    loop001(Xs, Zs).
```

### 7. Translate a file

Create `input.pl`:

```prolog
colour(red).
colour(blue).
p(R) :-
    findall(X, colour(X), R).
```

Run:

```prolog
?- loop2_file('input.pl', 'output.pl').
```

Then inspect:

```prolog
?- read_file_to_string('output.pl', S, []), writeln(S).
```

### 8. Analyse only

```prolog
?- loop2_analyse("
colour(red).
colour(blue).
p(R) :- findall(X, colour(X), R).
", Plan).
```

Expected shape:

```prolog
Plan = plan(
    [base_list(colours,[red,blue])],
    [pipeline(p(_), base_list(colours), [loop(...)], _)]
).
```

### 9. Unsupported example

Command:

```prolog
?- loop2_translate("
p(R) :-
    findall(X, (colour(X), !), R).
", Out),
writeln(Out).
```

Expected:

```prolog
%% unsupported(reason(cut)).
```

### 10. What it can prove by running output

After translation, save output to `output.pl`, then:

```prolog
?- [output].
?- p(R).
```

For colours:

```prolog
R = [red, blue].
```

For duplication:

```prolog
R = [[red, red], [blue, blue]].
```

## License

BSD 3-Clause License.

## Author

Lucian Green
