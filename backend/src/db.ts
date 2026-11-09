import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  createdAt: string;
}

const DATA_DIR = path.resolve(__dirname, "../data");
const DB_FILE = path.join(DATA_DIR, "users.json");

let memoryCache: Map<string, UserRecord> | null = null;

async function ensureDb(): Promise<Map<string, UserRecord>> {
  if (memoryCache) return memoryCache;

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const content = await fs.readFile(DB_FILE, "utf-8");
    const list: UserRecord[] = JSON.parse(content);
    memoryCache = new Map(list.map(u => [u.email.toLowerCase(), u]));
  } catch (err: any) {
    if (err.code === "ENOENT") {
      memoryCache = new Map();
      await persist();
    } else {
      console.error("Failed to read database file, initializing empty:", err);
      memoryCache = new Map();
    }
  }

  return memoryCache;
}

async function persist() {
  if (!memoryCache) return;
  const list = Array.from(memoryCache.values());
  const tempFile = `${DB_FILE}.${Date.now()}.tmp`;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(tempFile, JSON.stringify(list, null, 2), "utf-8");
  await fs.rename(tempFile, DB_FILE);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const cache = await ensureDb();
  return cache.get(email.trim().toLowerCase()) || null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const cache = await ensureDb();
  for (const user of cache.values()) {
    if (user.id === id) return user;
  }
  return null;
}

export async function createUser(email: string, password: string, fullName: string): Promise<UserRecord> {
  const cache = await ensureDb();
  const normalized = email.trim().toLowerCase();

  if (cache.has(normalized)) {
    throw new Error("A user with this email address already exists.");
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user: UserRecord = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash,
    fullName: fullName.trim() || normalized.split("@")[0],
    createdAt: new Date().toISOString()
  };

  cache.set(normalized, user);
  await persist();

  return user;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
