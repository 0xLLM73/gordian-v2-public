/**
 * Type declarations for redlock v5.0.0-beta.2.
 * The package's exports field doesn't include a types condition,
 * so moduleResolution:"bundler" can't resolve the .d.ts file.
 */
declare module 'redlock' {
	import { EventEmitter } from 'events';
	import type { Redis, Cluster } from 'ioredis';

	type Client = Redis | Cluster;

	export interface Settings {
		readonly driftFactor: number;
		readonly retryCount: number;
		readonly retryDelay: number;
		readonly retryJitter: number;
		readonly automaticExtensionThreshold: number;
	}

	export class ResourceLockedError extends Error {}
	export class ExecutionError extends Error {}

	export class Lock {
		readonly redlock: Redlock;
		readonly resources: string[];
		readonly value: string;
		expiration: number;
		release(): Promise<unknown>;
		extend(duration: number): Promise<Lock>;
	}

	export type RedlockAbortSignal = AbortSignal & { error?: Error };

	export default class Redlock extends EventEmitter {
		constructor(
			clients: Iterable<Client>,
			settings?: Partial<Settings>,
		);
		quit(): Promise<void>;
		acquire(
			resources: string[],
			duration: number,
			settings?: Partial<Settings>,
		): Promise<Lock>;
		release(lock: Lock): Promise<unknown>;
		extend(existing: Lock, duration: number): Promise<Lock>;
		using<T>(
			resources: string[],
			duration: number,
			settings: Partial<Settings>,
			routine?: (signal: RedlockAbortSignal) => Promise<T>,
		): Promise<T>;
		using<T>(
			resources: string[],
			duration: number,
			routine: (signal: RedlockAbortSignal) => Promise<T>,
		): Promise<T>;
	}

	export { Lock, Redlock };
}
