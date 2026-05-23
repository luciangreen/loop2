:- module(loop2,
    [ loop2_translate/2,
      loop2_file/2,
      loop2_analyse/2,
      loop2_emit/2
    ]).

:- use_module(library(readutil)).

loop2_translate(InputAtom, OutputAtom) :-
    parse_input(InputAtom, Clauses),
    (   detect_unsupported(Clauses, Reason)
    ->  unsupported_output(Reason, OutputAtom)
    ;   loop2_analyse(Clauses, Plan)
    ->  loop2_emit(Plan, OutputAtom)
    ;   unsupported_output(unsupported_shape, OutputAtom)
    ).

loop2_file(InputFile, OutputFile) :-
    read_file_to_string(InputFile, InputAtom, []),
    loop2_translate(InputAtom, OutputAtom),
    setup_call_cleanup(
        open(OutputFile, write, Stream),
        format(Stream, '~s', [OutputAtom]),
        close(Stream)
    ).

loop2_analyse(Input, plan(BaseLists, Loops, MainPredicate)) :-
    normalise_clauses(Input, Clauses),
    clause_facts(Clauses, Facts),
    collect_base_lists(Facts, BaseLists),
    member((Head :- Body), Clauses),
    Body = findall(Template, Goal, Result),
    supported_generator(Goal, Clauses, Facts, Source, ItemVar, Transform),
    MainPredicate = main(Head, Source, Result),
    Loops = [loop(1, xs, ys, transform(ItemVar, Template, Transform))].

loop2_emit(plan(BaseLists, [loop(1, _, _, transform(ItemVar, Template, Transform))], main(Head, Source, Result)), OutputAtom) :-
    emit_base_list_clauses(BaseLists, BaseListClauses),
    loop_name(1, LoopName),
    main_clause(Head, Source, Result, LoopName, MainClause),
    loop_clauses(LoopName, ItemVar, Template, Transform, LoopClauses),
    append([BaseListClauses, [MainClause], LoopClauses], Clauses),
    clauses_atom(Clauses, OutputAtom).

parse_input(Input, Clauses) :-
    (   string(Input)
    ->  read_clauses_from_string(Input, Clauses)
    ;   atom(Input)
    ->  atom_string(Input, Text),
        read_clauses_from_string(Text, Clauses)
    ;   normalise_clauses(Input, Clauses)
    ).

detect_unsupported(Clauses, Reason) :-
    member(Clause, Clauses),
    unsupported_term(Clause, Reason),
    !.

unsupported_term(Term, Reason) :-
    sub_term(SubTerm, Term),
    unsupported_subterm(SubTerm, Reason),
    !.

unsupported_subterm(!, cut).
unsupported_subterm((_ ; _), disjunction).
unsupported_subterm((_ -> _), if_then).
unsupported_subterm((\+ _), negation).
unsupported_subterm(var(_), var_sensitive).
unsupported_subterm(repeat, infinite_generator).
unsupported_subterm(SubTerm, meta_call) :-
    compound(SubTerm),
    functor(SubTerm, call, Arity),
    Arity >= 1.
unsupported_subterm(SubTerm, assert_retract) :-
    compound(SubTerm),
    functor(SubTerm, Pred, _),
    memberchk(Pred, [assert, asserta, assertz, retract, retractall]).
unsupported_subterm(SubTerm, side_effect(Pred)) :-
    compound(SubTerm),
    functor(SubTerm, Pred, _),
    memberchk(Pred,
        [ write, writeq, writeln, format, print, nl,
          put_char, put_code, get_char, get_code,
          read, read_term, open, close,
          tell, told, see, seen,
          shell, halt
        ]).

read_clauses_from_string(Text, Clauses) :-
    setup_call_cleanup(
        open_string(Text, Stream),
        read_all_clauses(Stream, Clauses),
        close(Stream)
    ).

read_all_clauses(Stream, Clauses) :-
    read_term(Stream, Term, []),
    (   Term == end_of_file
    ->  Clauses = []
    ;   Clauses = [Term|Rest],
        read_all_clauses(Stream, Rest)
    ).

normalise_clauses((A, B), Clauses) :-
    !,
    normalise_clauses(A, Left),
    normalise_clauses(B, Right),
    append(Left, Right, Clauses).
normalise_clauses([], []) :- !.
normalise_clauses([H|T], [H|Rest]) :-
    !,
    normalise_clauses(T, Rest).
normalise_clauses(Clause, [Clause]).

clause_facts(Clauses, Facts) :-
    findall(Fact,
        ( member(Fact, Clauses),
          Fact \= (_ :- _)
        ),
        Facts).

collect_base_lists(Facts, BaseLists) :-
    group_unary_facts(Facts, Grouped),
    findall(base_list(BaseName, Values),
        ( member(group(Name, Values), Grouped),
          Values \= [],
          base_list_name(Name, BaseName)
        ),
        BaseLists).

emit_base_list_clauses([], []).
emit_base_list_clauses([base_list(BaseName, Values)|Rest], [Clause|Clauses]) :-
    !,
    Clause =.. [BaseName, Values],
    emit_base_list_clauses(Rest, Clauses).
emit_base_list_clauses([Clause|Rest], [Clause|Clauses]) :-
    emit_base_list_clauses(Rest, Clauses).

group_unary_facts(Facts, Grouped) :-
    findall(Name,
        ( member(Fact, Facts),
          functor(Fact, Name, 1)
        ),
        Names0),
    sort(Names0, Names),
    findall(group(Name, Values),
        ( member(Name, Names),
          findall(Value,
              ( member(Fact, Facts),
                Fact =.. [Name, Value]
              ),
              Values)
        ),
        Grouped).

% Rule C — Nested findall + member (flatten_loop_pipeline optimisation)
supported_generator((findall(Inner, InnerGoal, List), member(Item, List)), Clauses, Facts, Source, Inner, true) :-
    !,
    Item = Inner,
    supported_generator(InnerGoal, Clauses, Facts, Source, Inner, true).

% Rule B — Generator followed by a transform
supported_generator((Generator, Transform), Clauses, Facts, Source, ItemVar, Transform) :-
    !,
    supported_generator(Generator, Clauses, Facts, Source, ItemVar, true).

% Rule B — Direct list generator
supported_generator(member(ItemVar, List), _Clauses, _Facts, input_list(List), ItemVar, true) :-
    !.

% Rule B — Simple unary fact generator
supported_generator(Generator, _Clauses, Facts, base_list(BaseName), ItemVar, true) :-
    Generator =.. [Pred, ItemVar],
    member(Fact, Facts),
    Fact =.. [Pred, _],
    base_list_name(Pred, BaseName).

% Rule D — Splice a supported nested predicate (splice_supported_nested_predicate optimisation)
supported_generator(Goal, Clauses, Facts, Source, ItemVar, Transform) :-
    Goal =.. [Pred | _],
    Pred \= ',',
    \+ (member(Fact, Facts), functor(Fact, Pred, _)),
    member((Goal :- Body), Clauses),
    supported_generator(Body, Clauses, Facts, Source, ItemVar, Transform).

base_list_name(Pred, BaseName) :-
    atom_concat(Pred, s, BaseName).

main_clause(Head, base_list(BaseName), Result, LoopName, (Head :- (BaseCall, LoopCall))) :-
    BaseCall =.. [BaseName, Xs],
    LoopCall =.. [LoopName, Xs, Result].
main_clause(Head, input_list(List), Result, LoopName, (Head :- LoopCall)) :-
    LoopCall =.. [LoopName, List, Result].

loop_clauses(LoopName, ItemVar, Template, Transform, [BaseClause, StepClause]) :-
    BaseClause =.. [LoopName, [], []],
    StepHead =.. [LoopName, [ItemVar|Xs], [Template|Ys]],
    step_body(Transform, LoopName, Xs, Ys, Body),
    StepClause = (StepHead :- Body).

step_body(true, LoopName, Xs, Ys, Recurse) :-
    !,
    Recurse =.. [LoopName, Xs, Ys].
step_body(Transform, LoopName, Xs, Ys, (Transform, Recurse)) :-
    Recurse =.. [LoopName, Xs, Ys].

loop_name(Id, Name) :-
    format(atom(Name), 'loop~|~`0t~d~3+', [Id]).

clauses_atom(Clauses, OutputAtom) :-
    with_output_to(string(OutputAtom), write_clauses(Clauses)).

write_clauses([]).
write_clauses([Clause]) :-
    write_term(Clause, [numbervars(true)]),
    write('.\n').
write_clauses([Clause|Rest]) :-
    write_term(Clause, [numbervars(true)]),
    write('.\n'),
    write_clauses(Rest).

unsupported_output(Reason, OutputAtom) :-
    format(string(OutputAtom), '%% unsupported(reason(~w)).\n', [Reason]).
