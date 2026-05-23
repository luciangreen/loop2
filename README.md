# loop2

loop2 is a minimal Prolog-to-Prolog translator that converts simple nondeterministic Prolog patterns into deterministic recursive loop predicates. It combines `findall/3` elimination, loop flattening, and simple nested predicate splicing to produce clearer deterministic Prolog for education, optimisation, and later pl2c/pl2js compilation.
