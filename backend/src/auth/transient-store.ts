/**
 * Abstract transient key-value store interface for distributed ephemeral data.
 * Used for multi-instance successor-response retry caching.
 */
export interface ITransientStore {
  /**
   * Retrieves a string value by key. Returns null if not found or expired.
   */
  get(key: string): Promise<string | null>;

  /**
   * Sets a string value with a time-to-live in seconds.
   */
  set(key: string, value: string, ttlSeconds: number): Promise<void>;

  /**
   * Deletes a key from the store.
   */
  del(key: string): Promise<void>;

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

  public async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value;
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  public async del(key: string): Promise<void> {
    this.store.delete(key);
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
 * Fails closed if connection cannot be established when refresh sessions are active.
 */
export class RedisTransientStore implements ITransientStore {
  private client: any; // ioredis Redis instance
  private isConnected = false;

  constructor(redisClientOrUrl: any) {
    if (typeof redisClientOrUrl === "string") {
      // Lazy load ioredis
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const IORedis = require("ioredis");
        this.client = new IORedis(redisClientOrUrl, {
          maxRetriesPerRequest: 2,
          connectTimeout: 5000,
          lazyConnect: true,
        });
      } catch (err: unknown) {
        throw new Error(`Failed to initialize Redis client: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      this.client = redisClientOrUrl;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client && typeof this.client.connect === "function" && this.client.status === "wait") {
      await this.client.connect();
      this.isConnected = true;
    }
  }

  public async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return await this.client.get(key);
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.ensureConnected();
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  public async del(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(key);
  }

  public async close(): Promise<void> {
    if (this.client && typeof this.client.quit === "function") {
      await this.client.quit();
    }
  }
}
