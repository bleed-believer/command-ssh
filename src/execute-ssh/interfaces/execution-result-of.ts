import type { EncodedExecutionResult } from './encoded-execution-result.js';
import type { ExecuteSSHOptions } from './execute-ssh.options.js';
import type { ExecutionResult } from './execution-result.js';

/**
 * What a call resolves to, decided by the `encoding` of the options it was
 * built with: a `string` when there is one, the raw `Buffer` when there is not.
 *
 * The last branch is the honest one, and the reason this type exists. Options
 * annotated as `ExecuteSSHOptions` — rather than inferred from a literal —
 * carry `encoding` as `BufferEncoding | undefined`, and that is a value no
 * type can decide on: at runtime it may perfectly well be `'utf-8'`. Answering
 * `ExecutionResult` there promises a `Buffer` that arrives as a `string`. The
 * union says only what is actually known, and the consumer narrows it.
 *
 * The `keyof` check has to come first. An indexed access resolves through the
 * constraint when the key is missing, so options that never mentioned
 * `encoding` report the same `BufferEncoding | undefined` as options that
 * declared it optional — and without this branch the common case would drag
 * the whole union along for nothing.
 *
 * The comparisons are wrapped in tuples on purpose: a bare `extends` over a
 * naked type parameter distributes across the union, which would take
 * `BufferEncoding | undefined` apart and reach the wrong branch by a different
 * road.
 */
export type ExecutionResultOf<O extends ExecuteSSHOptions> =
    'encoding' extends keyof O
    ?   [ O['encoding'] ] extends [ BufferEncoding ]
        ?   EncodedExecutionResult
        :   [ O['encoding'] ] extends [ undefined ]
            ?   ExecutionResult
            :   EncodedExecutionResult | ExecutionResult
    :   ExecutionResult;
