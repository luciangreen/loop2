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

loop2_analyse(Input, plan(BaseLists, Pipelines)) :-
    normalise_clauses(Input, Clauses),
    clause_facts(Clauses, Facts),
    collect_base_lists(Facts, BaseLists),
    findall(pipeline(Head, Source,
                     [loop(1, _InputVar, FinalOutput,
                           transform(ItemVar, Template, Transform))],
                     FinalOutput),
        ( member((Head :- Body), Clauses),
          Body = findall(Template, Goal, FinalOutput),
          once(supported_generator(Goal, Clauses, Facts, Source, ItemVar, Transform))
        ),
        Pipelines),
    Pipelines \= [].

loop2_emit(plan(BaseLists, Pipelines), OutputAtom) :-
    emit_base_list_clauses(BaseLists, BaseListClauses),
    emit_pipelines(Pipelines, PipelineClauses),
    append(BaseListClauses, PipelineClauses, AllClauses),
    clauses_atom(AllClauses, ClausesAtom),
    correctness_claim_header(Header),
    string_concat(Header, ClausesAtom, OutputAtom).

emit_pipelines([], []).
emit_pipelines([Pipeline|Rest], Clauses) :-
    emit_pipeline(Pipeline, PClauses),
    emit_pipelines(Rest, RestClauses),
    append(PClauses, RestClauses, Clauses).

emit_pipeline(pipeline(Head, Source,
                       [loop(Id, InputVar, FinalOutput,
                             transform(ItemVar, Template, Transform))],
                       FinalOutput),
              [MainClause|LoopClauses]) :-
    loop_name(Id, LoopName),
    pipeline_main_clause(Head, Source, InputVar, FinalOutput, LoopName, MainClause),
    loop_clauses(LoopName, ItemVar, Template, Transform, LoopClauses).

pipeline_main_clause(Head, base_list(BaseName), InputVar, FinalOutput, LoopName,
                     (Head :- (BaseCall, LoopCall))) :-
    BaseCall =.. [BaseName, InputVar],
    LoopCall =.. [LoopName, InputVar, FinalOutput].
pipeline_main_clause(Head, input_list(List), _InputVar, FinalOutput, LoopName,
                     (Head :- LoopCall)) :-
    LoopCall =.. [LoopName, List, FinalOutput].

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
    nonvar(SubTerm),
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

% Optimisation: findall_to_loop
% Converts a direct member/fact generator, with optional transform, to a loop source.
findall_to_loop(member(ItemVar, List), _Clauses, _Facts,
                input_list(List), ItemVar, true) :- !.
findall_to_loop(Generator, _Clauses, Facts, base_list(BaseName), ItemVar, true) :-
    Generator =.. [Pred, ItemVar],
    member(Fact, Facts),
    Fact =.. [Pred, _],
    !,
    base_list_name(Pred, BaseName).
findall_to_loop((Generator, Transform), Clauses, Facts, Source, ItemVar, Transform) :-
    supported_generator(Generator, Clauses, Facts, Source, ItemVar, true).

% Optimisation: flatten_loop_pipeline
% Flattens a nested findall+member pattern into a single-pass loop.
flatten_loop_pipeline((findall(Inner, InnerGoal, List), member(Item, List)),
                       Clauses, Facts, Source, Inner, true) :-
    Item = Inner,
    supported_generator(InnerGoal, Clauses, Facts, Source, Inner, true).

% Optimisation: splice_supported_nested_predicate
% Inlines the body of a supported single-clause predicate into the current pipeline.
splice_supported_nested_predicate(Goal, Clauses, Facts, Source, ItemVar, Transform) :-
    Goal =.. [Pred | _],
    Pred \= ',',
    \+ (member(Fact, Facts), functor(Fact, Pred, _)),
    member((Goal :- Body), Clauses),
    supported_generator(Body, Clauses, Facts, Source, ItemVar, Transform).

% Generator dispatcher: applies optimisations in priority order.
supported_generator(Goal, Clauses, Facts, Source, ItemVar, Transform) :-
    flatten_loop_pipeline(Goal, Clauses, Facts, Source, ItemVar, Transform),
    !.
supported_generator(Goal, Clauses, Facts, Source, ItemVar, Transform) :-
    findall_to_loop(Goal, Clauses, Facts, Source, ItemVar, Transform),
    !.
supported_generator(Goal, Clauses, Facts, Source, ItemVar, Transform) :-
    splice_supported_nested_predicate(Goal, Clauses, Facts, Source, ItemVar, Transform).

base_list_name(Pred, BaseName) :-
    atom_concat(Pred, s, BaseName).

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
    write_clause_with_letter_vars(Clause),
    write('.\n').
write_clauses([Clause|Rest]) :-
    write_clause_with_letter_vars(Clause),
    write('.\n'),
    write_clauses(Rest).

write_clause_with_letter_vars(Clause) :-
    copy_term(Clause, NumberedClause),
    numbervars(NumberedClause, 0, _),
    write_term(NumberedClause, [numbervars(true)]).

unsupported_output(Reason, OutputAtom) :-
    format(string(OutputAtom), '%% unsupported(reason(~w)).\n', [Reason]).

correctness_claim_header(Header) :-
    Header =
        '%% correctness(claimed_for(finite_pure_supported_generator_patterns)).\n\
%% preserves([finite_result_list, order, simple_transformations, deterministic_single_success]).\n\
%% not_preserved(full_prolog_backtracking_semantics).\n'.
