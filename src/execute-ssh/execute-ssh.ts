import type { ExecuteSSHOptions, ExecuteSSHInject, ExecutionResult, EncodedExecutionResult } from './interfaces/index.js';

import { SpawnSSH } from '../spawn-ssh/index.js';

export class ExecuteSSH<O extends ExecuteSSHOptions> {
    #injected: Required<ExecuteSSHInject>;
    #options: O;

    constructor(options: O, inject?: ExecuteSSHInject) {
        this.#injected = {
            createSpawnSSH:  inject?.createSpawnSSH?.bind(inject)    ?? (o => new SpawnSSH(o))
        }
        
        this.#options = options;
    }

    #execute(program: string, ...args: string[]): Promise<ExecutionResult> {
        return new Promise<ExecutionResult>(async (resolve, reject) => {
            const spawnSSH = this.#injected.createSpawnSSH(this.#options);
            const child = await spawnSSH.spawn(program, args);
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];

            child.stdout.on('data', (c: Buffer) => stdout.push(c));
            child.stderr.on('data', (c: Buffer) => stderr.push(c));
            child.once('error', err => reject(err));
            child.once('close', code => {
                const out: ExecutionResult = { code };
                if (stdout.length > 0) {
                    out.stdout = Buffer.concat(stdout);
                }
                
                if (stderr.length > 0) {
                    out.stderr = Buffer.concat(stderr);
                }

                resolve(out);
            });
        });
    }

    async execute(
        program: string,
        ...args: string[]
    ): Promise<
        O['encoding'] extends BufferEncoding
        ?   EncodedExecutionResult
        :   ExecutionResult
    >;

    async execute(
        program: string,
        ...args: string[]
    ): Promise<EncodedExecutionResult | ExecutionResult> {
        const { code, stdout, stderr } = await this.#execute(program, ...args);
        const { encoding } = this.#options;
        if (typeof encoding === 'string') {
            const out: EncodedExecutionResult = { code };
            if (stdout) {
                out.stdout = stdout
                    .toString(encoding)
                    .trim();
            }
            
            if (stderr) {
                out.stderr = stderr
                    .toString(encoding)
                    .trim();
            }

            return out;
        }

        return { code, stdout, stderr };
    }
}