import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import config from '@/lib/config';

export interface CoreSigning {
  keyId: string;
  register(): Promise<void>;
  /** Sends a signed request; if Core does not know the key yet, registers it and tries once more. */
  fetch(method: string, url: URL, body?: Buffer, headers?: Record<string, string>, timeoutMs?: number): Promise<Response>;
}

type ClientSigningModule = { openCoreClientSigning(input: { keyFile: string; coreUrl: string; applicationKey: string; secret: string }): Promise<CoreSigning> };

// One opening per process: Next.js may load this file once per route, and every copy must use the same key.
const shared = globalThis as { semaCoreSigning?: Promise<CoreSigning | undefined> };

/**
 * VectorForge signs its requests to Core with its own key (RFC 9421, D-123), using Core's shared client code from Core's
 * folder: SEMA_CORE_DIRECTORY, or SEMA-Core three folders up. Its key file (SEMA_VECTORFORGE_KEY_FILE, else keys/ here)
 * is made on the first start and must never be committed or copied. It proves who it is with its key and secret only
 * to register the key; without a secret, or without Core's code, it sends its key and secret as before.
 */
export function coreSigning() {
  shared.semaCoreSigning ??= open();
  return shared.semaCoreSigning;
}

async function open(): Promise<CoreSigning | undefined> {
  if (!config.sema.applicationSecret) return undefined;
  const coreDirectory = resolve(process.env.SEMA_CORE_DIRECTORY ?? join(process.cwd(), '..', '..', '..', 'SEMA-Core'));
  try {
    const { openCoreClientSigning } = await import(/* webpackIgnore: true */ pathToFileURL(join(coreDirectory, 'dist', 'keys', 'client-signing.js')).href) as ClientSigningModule;
    if (typeof openCoreClientSigning !== 'function') throw new Error(`Core at ${coreDirectory} has no shared client code: build Core first`);
    const signing = await openCoreClientSigning({ keyFile: process.env.SEMA_VECTORFORGE_KEY_FILE ?? join(process.cwd(), 'keys', process.platform === 'win32' ? 'vectorforge-key.dpapi' : 'vectorforge-key.pem'), coreUrl: config.sema.hostUrl, applicationKey: config.sema.applicationKey, secret: config.sema.applicationSecret });
    console.log(`VectorForge signs its requests to Core with key ${signing.keyId}.`);
    await signing.register().catch((error: unknown) => console.warn(`${error instanceof Error ? error.message : error} It will try again on the first request.`));
    return signing;
  } catch (error) {
    console.warn(`VectorForge cannot sign its requests to Core, so it uses its key and secret: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}
