import crypto from "crypto";

export interface KeyPair {
  kid: string;
  publicKey: string;
  privateKey?: string;
  revoked?: boolean;
  createdAt: string;
}

export class KeyManager {
  private keys: Map<string, KeyPair> = new Map();
  private primaryKid: string | null = null;

  constructor() { }

  /**
   * Registers a key pair (or public verification key).
   */
  public registerKey(key: KeyPair, isPrimary = false): void {
    this.keys.set(key.kid, key);
    if (isPrimary || !this.primaryKid) {
      this.primaryKid = key.kid;
    }
  }

  /**
   * Returns the primary signing key pair.
   */
  public getPrimarySigningKey(): KeyPair | null {
    if (!this.primaryKid) return null;
    const key = this.keys.get(this.primaryKid);
    if (!key || key.revoked || !key.privateKey) return null;
    return key;
  }

  /**
   * Retrieves a verification key by kid.
   */
  public getVerificationKey(kid: string): KeyPair | null {
    const key = this.keys.get(kid);
    if (!key || key.revoked) return null;
    return key;
  }

  /**
   * Revokes a key by kid.
   */
  public revokeKey(kid: string): boolean {
    const key = this.keys.get(kid);
    if (!key) return false;
    key.revoked = true;
    if (this.primaryKid === kid) {
      this.primaryKid = null;
    }
    return true;
  }

  /**
   * Generates a development/test RSA key pair.
   * NEVER used automatically in production!
   */
  public static generateDevelopmentKeyPair(kid = "dev-key-" + Date.now()): KeyPair {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    return {
      kid,
      publicKey,
      privateKey,
      revoked: false,
      createdAt: new Date().toISOString(),
    };
  }
}

let defaultKeyManager: KeyManager | null = null;

export function getKeyManager(): KeyManager {
  if (!defaultKeyManager) {
    defaultKeyManager = new KeyManager();
  }
  return defaultKeyManager;
}
