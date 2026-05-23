:- module(loop2,
    [ loop2_translate/2,
      loop2_file/2,
      loop2_analyse/2,
      loop2_emit/2
    ]).

:- use_module(library(readutil)).

loop2_translate(InputAtom, OutputAtom) :-
    parse_input(InputAtom, Clauses),
    (   loop2_analyse(Clauses, Plan)
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
    phrase(base_lists(Facts), BaseLists),
    member((Head :- Body), Clauses),
    Body = findall(Template, Goal, Result),
    supported_generator(Goal, Facts, BaseName, ItemVar, Transform),
    MainPredicate = main(Head, BaseName, Result),
    Loops = [loop(1, xs, ys, transform(ItemVar, Template, Transform))].

loop2_emit(plan(BaseLists, [loop(1, _, _, transform(ItemVar, Template, Transform))], main(Head, BaseName, Result)), OutputAtom) :-
    loop_name(1, LoopName),
    main_clause(Head, BaseName, Result, LoopName, MainClause),
    loop_clauses(LoopName, ItemVar, Template, Transform, LoopClauses),
    append([BaseLists, [MainClause], LoopClauses], Clauses),
    clauses_atom(Clauses, OutputAtom).

parse_input(Input, Clauses) :-
    (   string(Input)
    ->  read_clauses_from_string(Input, Clauses)
    ;   atom(Input)
    ->  atom_string(Input, Text),
        read_clauses_from_string(Text, Clauses)
    ;   normalise_clauses(Input, Clauses)
    ).

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

base_lists(Facts) -->
    { group_unary_facts(Facts, Grouped) },
    emit_base_lists(Grouped).

emit_base_lists([]) --> [].
emit_base_lists([group(Name, Values)|Rest]) -->
    { Values \= [],
      base_list_name(Name, BaseName),
      Clause =.. [BaseName, Values]
    },
    [Clause],
    emit_base_lists(Rest).

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

supported_generator((Generator, Transform), Facts, BaseName, ItemVar, Transform) :-
    !,
    supported_generator(Generator, Facts, BaseName, ItemVar, true).
supported_generator(Generator, Facts, BaseName, ItemVar, true) :-
    Generator =.. [Pred, ItemVar],
    member(Fact, Facts),
    Fact =.. [Pred, _],
    base_list_name(Pred, BaseName).

base_list_name(Pred, BaseName) :-
    atom_concat(Pred, s, BaseName).

main_clause(Head, BaseName, Result, LoopName, (Head :- (BaseCall, LoopCall))) :-
    BaseCall =.. [BaseName, Xs],
    LoopCall =.. [LoopName, Xs, Result].

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
