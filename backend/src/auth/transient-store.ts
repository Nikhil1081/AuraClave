/**
 * Explicit outcomes for transient-store operations.
 * Distinguishes between cache hits, misses, expirations, infrastructure outages, and tampering.
 */
export const TransientStoreOutcome = {
  FOUND: "FOUND",
  NOT_FOUND: "NOT_FOUND",
  EXPIRED: "EXPIRED",
  UNAVAILABLE: "UNAVAILABLE",
  INVALID: "INVALID",
} as const;

export type TransientStoreOutcome =
  (typeof TransientStoreOutcome)[keyof typeof TransientStoreOutcome];

export interface TransientStoreResult<T = string> {
  outcome: TransientStoreOutcome;
  value?: T;
  error?: string;
}

/**
 * Abstract transient key-value store interface for distributed ephemeral data.
 * Used for multi-instance successor-response retry caching.
 */
export interface ITransientStore {
  /**
   * Retrieves a string value by key with typed outcome.
   */
  get(key: string): Promise<TransientStoreResult<string>>;

  /**
   * Sets a string value with a time-to-live in seconds.
   */
  set(key: string, value: string, ttlSeconds: number): Promise<TransientStoreResult<void>>;

  /**
   * Deletes a key from the store.
   */
  del(key: string): Promise<TransientStoreResult<void>>;

  /**
   * Closes or disconnects the store client (if applicable).
   */
  close?(): Promise<void>;
}

/**
 * In-memory transient store implementation.
 * Suitable for local development and unit tests where Redis is not provisioned.
 * Supports explicit shared state between multiple simulated API instances.
 */
export class InMemoryTransientStore implements ITransientStore {
  private store: Map<string, { value: string; expiresAt: number }>;

  constructor(sharedMap?: Map<string, { value: string; expiresAt: number }>) {
    this.store = sharedMap || new Map();
  }

  public async get(key: string): Promise<TransientStoreResult<string>> {
    const entry = this.store.get(key);
    if (!entry) {
      return { outcome: TransientStoreOutcome.NOT_FOUND };
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return { outcome: TransientStoreOutcome.EXPIRED };
    }

    return { outcome: TransientStoreOutcome.FOUND, value: entry.value };
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<TransientStoreResult<void>> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return { outcome: TransientStoreOutcome.FOUND };
  }

  public async del(key: string): Promise<TransientStoreResult<void>> {
    this.store.delete(key);
    return { outcome: TransientStoreOutcome.FOUND };
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }

  /**
   * Exposes internal map for sharing between mock instances in tests.
   */
  public getRawMap(): Map<string, { value: string; expiresAt: number }> {
    return this.store;
  }
}

/**
 * Production Redis adapter using ioredis.
 * Fails closed if connection cannot be established or times out.
 */
export class RedisTransientStore implements ITransientStore {
  private client: any; // ioredis Redis instance

  constructor(redisClientOrUrl: any) {
    if (typeof redisClientOrUrl === "string") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const IORedis = require("ioredis");
        this.client = new IORedis(redisClientOrUrl, {
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          commandTimeout: 2000,
          enableOfflineQueue: false,
          lazyConnect: true,
        });
      } catch (err: unknown) {
        throw new Error(
          `Failed to initialize Redis client: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else {
      this.client = redisClientOrUrl;
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (!this.client) return false;
    if (typeof this.client.connect === "function" && this.client.status === "wait") {
      try {
        await this.client.connect();
        return true;
      } catch {
        return false;
      }
    }
    return this.client.status === "ready" || this.client.status === "connecting";
  }

  public async get(key: string): Promise<TransientStoreResult<string>> {
    try {
      const connected = await this.ensureConnected();
      if (!connected && this.client?.status !== "ready") {
        return { outcome: TransientStoreOutcome.UNAVAILABLE, error: "Redis not connected" };
      }
      const val = await this.client.get(key);
      if (val === null || val === undefined) {
        return { outcome: TransientStoreOutcome.NOT_FOUND };
      }
      return { outcome: TransientStoreOutcome.FOUND, value: val };
    } catch (err: unknown) {
      return {
        outcome: TransientStoreOutcome.UNAVAILABLE,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<TransientStoreResult<void>> {
    try {
      const connected = await this.ensureConnected();
      if (!connected && this.client?.status !== "ready") {
        return { outcome: TransientStoreOutcome.UNAVAILABLE, error: "Redis not connected" };
      }
      await this.client.set(key, value, "EX", ttlSeconds);
      return { outcome: TransientStoreOutcome.FOUND };
    } catch (err: unknown) {
      return {
        outcome: TransientStoreOutcome.UNAVAILABLE,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async del(key: string): Promise<TransientStoreResult<void>> {
    try {
      const connected = await this.ensureConnected();
      if (!connected && this.client?.status !== "ready") {
        return { outcome: TransientStoreOutcome.UNAVAILABLE, error: "Redis not connected" };
      }
      await this.client.del(key);
      return { outcome: TransientStoreOutcome.FOUND };
    } catch (err: unknown) {
      return {
        outcome: TransientStoreOutcome.UNAVAILABLE,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async close(): Promise<void> {
    if (this.client && typeof this.client.quit === "function") {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
    }
  }
}
