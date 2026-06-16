import { workerData, parentPort } from 'node:worker_threads';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ivm from 'isolated-vm';

/**
 * Execute user-supplied JavaScript in a true V8 isolate.
 *
 * The earlier implementations of this worker — first `Function()` in the
 * host context, then `vm.runInContext` with a hardened sandbox — both
 * shared their heap with the host policy-service process. The hardened
 * `node:vm` sandbox still leaked the outer realm via prototype-chain
 * escapes through passed-in objects (`JSON.constructor.constructor`,
 * `Math.constructor.constructor`, …), because any value assigned across
 * the `vm.createContext` boundary carries its outer-realm constructor.
 *
 * Mitigation M-005 of the Guardian threat model (TM-006, TM-029)
 * requires a true sandbox. `isolated-vm` provides one: every Isolate is
 * a separate V8 heap with its own intrinsics, no shared object identity
 * with the host, and a hard memory cap. Communication is restricted to
 * explicit Reference / ExternalCopy primitives, which we use to expose
 * the documented sandbox API (done, debug, user, documents, mathjs,
 * formulajs, artifacts, sources, table).
 *
 * Resources loaded once per worker process (module top-level):
 *   - mathjs and formulajs are loaded from their browser/UMD bundles
 *     and evaluated INSIDE the isolate, so the `math` and `formulajs`
 *     globals exposed to user code are isolate-native — their
 *     constructors lead back into the isolate, not the host.
 *   - buildTableHelper source is inlined for the same reason.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localRequire = createRequire(import.meta.url);

// `@formulajs/formulajs` does not expose its UMD bundle through `exports`,
// so we resolve via the package.json subpath (always exported) and walk to
// the bundle from the package root.
const formulajsPackageRoot = path.dirname(
    localRequire.resolve('@formulajs/formulajs/package.json'),
);

const MATHJS_BUNDLE = fs.readFileSync(
    localRequire.resolve('mathjs/lib/browser/math.js'),
    'utf8',
);
const FORMULAJS_BUNDLE = fs.readFileSync(
    path.join(formulajsPackageRoot, 'lib/browser/formula.min.js'),
    'utf8',
);

// `table-field-core.js` is a plain ES module on disk; the isolate cannot
// resolve `export` declarations (no module loader), so we strip them and
// run the body as a top-level script that publishes its functions on the
// isolate's globalThis.
const TABLE_HELPER_BUNDLE = fs
    .readFileSync(path.join(__dirname, '..', 'table-field-core.js'), 'utf8')
    .replace(/^export\s+/gm, '');

const EXECUTION_TIMEOUT_MS = 30_000;
const MEMORY_LIMIT_MB = 128;

function postDone(result: unknown, final = true): void {
    parentPort.postMessage({ type: 'done', result, final });
}

function postDebug(message: unknown): void {
    parentPort.postMessage({ type: 'debug', message });
}

function execute(): void {
    const { execFunc, user, documents, artifacts, sources, tablesPack } = workerData;

    const isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
    try {
        const context = isolate.createContextSync();
        const jail = context.global;

        // Host callbacks — wrapped as references so the isolate can invoke
        // them via applySync; arguments are deep-copied across the boundary.
        const doneRef = new ivm.Reference((result: unknown, final: boolean) => {
            postDone(result, final);
        });
        const debugRef = new ivm.Reference((message: unknown) => {
            postDebug(message);
        });

        // Data — deep-copied into the isolate. The isolate sees plain JS
        // objects with isolate-native prototypes; no reference points back
        // to the host realm.
        jail.setSync('__hostDone', doneRef);
        jail.setSync('__hostDebug', debugRef);
        jail.setSync('__user', new ivm.ExternalCopy(user ?? null).copyInto());
        jail.setSync('__documents', new ivm.ExternalCopy(documents ?? []).copyInto());
        jail.setSync('__artifacts', new ivm.ExternalCopy(artifacts ?? []).copyInto());
        jail.setSync('__sources', new ivm.ExternalCopy(sources ?? []).copyInto());
        jail.setSync('__tablesPack', new ivm.ExternalCopy(tablesPack ?? {}).copyInto());

        // Load mathjs (UMD) and formulajs (IIFE) inside the isolate.
        context.evalSync(MATHJS_BUNDLE);
        context.evalSync(FORMULAJS_BUNDLE);
        context.evalSync(TABLE_HELPER_BUNDLE);

        // Bootstrap: build the documented sandbox API surface and erase
        // the host-reference globals before user code runs. The `done` and
        // `debug` wrappers capture `__hostDone` / `__hostDebug` in a
        // closure, so deleting the globals does not unwire them.
        // Disable code-generation-from-strings inside the isolate. The
        // isolate is already a separate V8 heap, so even if user code
        // built a new function via `eval` / `Function('...')` the result
        // could only ever access the isolate's own globals (no host
        // reach). Shadowing these globals preserves the prior worker's
        // API: policies that rely on `eval()` / `new Function()` throwing
        // continue to throw, which catches drift early.
        context.evalSync(`
            (function disableCodeGen() {
                const blocker = function blocked() {
                    throw new EvalError('Code generation from strings disallowed for this context');
                };
                blocker.prototype = Function.prototype;
                globalThis.eval = blocker;
                Object.defineProperty(globalThis, 'Function', {
                    value: blocker,
                    writable: true,
                    configurable: true,
                });
                // (()=>{}).constructor still resolves through the prototype
                // chain to the original Function — override there too so
                // arrow / async / regular function constructor paths all
                // hit the blocker.
                Object.defineProperty(Function.prototype, 'constructor', {
                    value: blocker,
                    writable: true,
                    configurable: true,
                });
            })();
        `);

        context.evalSync(`
            (function bootstrap() {
                const hostDone = globalThis.__hostDone;
                const hostDebug = globalThis.__hostDebug;
                const userValue = globalThis.__user;
                const documentsValue = globalThis.__documents;
                const artifactsValue = globalThis.__artifacts;
                const sourcesValue = globalThis.__sources;
                const tablesPackValue = globalThis.__tablesPack;

                globalThis.mathjs = globalThis.math;
                delete globalThis.math;

                globalThis.user = userValue;
                globalThis.documents = documentsValue;
                globalThis.artifacts = artifactsValue;
                globalThis.sources = sourcesValue;
                globalThis.table = buildTableHelper(tablesPackValue);

                globalThis.done = function done(result, final) {
                    if (final === undefined) { final = true; }
                    hostDone.applySync(undefined, [result, final], {
                        arguments: { copy: true },
                    });
                };
                globalThis.debug = function debug(message) {
                    hostDebug.applySync(undefined, [message], {
                        arguments: { copy: true },
                    });
                };
                globalThis.console = {
                    log: globalThis.debug,
                    warn: globalThis.debug,
                    error: globalThis.debug,
                };

                // Hide bootstrap-only globals from user code so sandbox
                // escapes (if any future regression appears) cannot reach
                // the raw host references.
                delete globalThis.__hostDone;
                delete globalThis.__hostDebug;
                delete globalThis.__user;
                delete globalThis.__documents;
                delete globalThis.__artifacts;
                delete globalThis.__sources;
                delete globalThis.__tablesPack;
                delete globalThis.buildTableHelper;
                delete globalThis.isPlainObject;
                delete globalThis.isTableValue;
            })();
        `);

        try {
            const script = isolate.compileScriptSync(execFunc);
            script.runSync(context, { timeout: EXECUTION_TIMEOUT_MS });
        } catch (error) {
            postDebug(`Sandbox error: ${(error as Error)?.message ?? String(error)}`);
            postDone(null, true);
        }
    } finally {
        try { isolate.dispose(); } catch { /* already disposed */ }
    }
}

execute();
