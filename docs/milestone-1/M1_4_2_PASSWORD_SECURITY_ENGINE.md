# M1.4.2 — Password Security Engine & Legacy Hash Compatibility

**Status:** Completed  
**Milestone:** M1.4 (Sub-stage M1.4.2)  
**Implementation Source:** `backend/src/auth/password.ts`, `backend/src/db.ts`  
**Test Suites:** `backend/tests/password-security.test.ts`, `backend/tests/password-upgrade-cas.test.ts`

---

## 1. Executive Summary

Sub-stage M1.4.2 establishes AuraClave's dual-algorithm password verification and safe upgrade engine.

Key deliverables:

1. **Argon2id Library Integration:** Selected `@node-rs/argon2` for modern password hashing using OWASP-recommended baseline parameters.
2. **Algorithm-Aware Dispatcher:** Automatically detects whether an encoded PHC hash string is legacy bcrypt (`$2a$`, `$2b$`, `$2y$`) or modern Argon2id (`$argon2id$`), verifying with the appropriate algorithm without blind fallbacks.
3. **Comprehensive 72-Byte Truncation & UTF-8 Matrix:** Documented and verified `bcryptjs` behavior across the Blowfish 72-byte boundary and multibyte UTF-8 characters (ASCII, 2-byte accented, 3-byte CJK ideographs, 4-byte SMP emojis).
4. **Safe Compare-and-Swap (CAS) Hash Upgrade:** Automatically migrates legacy bcrypt hashes to Argon2id upon successful user login without exposing hashes, logging credentials, or risking race conditions with concurrent password changes.

---

## 2. Library Selection: `@node-rs/argon2` vs `argon2`

A technical evaluation was conducted to determine the optimal Argon2id library for AuraClave:

| Evaluation Criteria         | `@node-rs/argon2` (Selected)                                                         | `argon2` (Alternative)                                                          |
| --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Underlying Architecture** | Precompiled N-API native bindings built with Rust / SIMD acceleration.               | Native C/C++ bindings via node-gyp.                                             |
| **Windows Support**         | Prebuilt binaries for `win32-x64-msvc`; installs cleanly without build tools.        | Requires Python and Visual C++ Build Tools on Windows; prone to build failures. |
| **Linux/CI Compatibility**  | Prebuilt binaries for `linux-x64-gnu` and `linux-x64-musl`. Zero compile step in CI. | Compiles via node-gyp; increases CI pipeline setup time and dependency surface. |
| **Maintenance & Security**  | Actively maintained by the Node-RS / SWC ecosystem; memory-safe Rust core.           | Maintained, but depends on node-gyp and native compiler toolchains.             |
| **TypeScript Support**      | Native first-party TypeScript type definitions.                                      | First-party type definitions.                                                   |
| **Performance**             | High throughput with SIMD optimizations (AVX2/NEON).                                 | High throughput.                                                                |

**Decision:** `@node-rs/argon2` was selected due to guaranteed zero-toolchain installation across Windows development machines, Linux Ubuntu CI, and production containers.

---

## 3. Argon2id Baseline Parameters & Local Benchmarking

The password service utilizes OWASP baseline parameters:

- **Type:** Argon2id (Version 19)
- **Memory Cost (`m`):** 19,456 KiB (19 MiB)
- **Time Cost (`t`):** 2 iterations
- **Parallelism (`p`):** 1 thread
- **Output Length:** 32 bytes
- **Salt:** Cryptographically random 16-byte salt generated per hash by the library.

### Local Hardware Benchmark (Windows 11 x64, Node.js v22.20.0):

- **Hash Duration:** ~31 ms
- **Verification Duration:** ~29 ms
- **Analysis:** Sub-35ms verification provides strong brute-force resistance while comfortably remaining within standard API request latency budgets (< 100 ms).

---

## 4. bcrypt Compatibility & 72-Byte Boundary Matrix

### 4.1 Blowfish Truncation Boundary

Standard bcrypt operates on an expanded 72-byte key matrix. Input strings exceeding 72 bytes are truncated at byte 72:

- Passwords differing only _after_ the 72nd byte (e.g., `prefix_72_bytes + "A"` vs `prefix_72_bytes + "B"`) produce matching verification results in `bcryptjs`.
- In contrast, Argon2id has no 72-byte limit and distinguishes passwords of arbitrary lengths.

### 4.2 Verified UTF-8 Test Vectors

The test suite in `backend/tests/password-security.test.ts` validates the following lengths and multibyte encodings:

| Label            | Character Representation | UTF-8 Byte Count | Truncation Behavior Verified                                        |
| ---------------- | ------------------------ | ---------------- | ------------------------------------------------------------------- |
| 10 bytes ASCII   | `"a".repeat(10)`         | 10 bytes         | Verified exact match.                                               |
| 32 bytes ASCII   | `"b".repeat(32)`         | 32 bytes         | Verified exact match.                                               |
| 71 bytes ASCII   | `"c".repeat(71)`         | 71 bytes         | Verified exact match.                                               |
| 72 bytes ASCII   | `"d".repeat(72)`         | 72 bytes         | Exact boundary. Verified match.                                     |
| 73 bytes ASCII   | `"e".repeat(73)`         | 73 bytes         | Truncated by bcrypt at byte 72. Suffix differences match in bcrypt. |
| 100 bytes ASCII  | `"f".repeat(100)`        | 100 bytes        | Truncated by bcrypt at byte 72.                                     |
| 256 bytes ASCII  | `"g".repeat(256)`        | 256 bytes        | Truncated by bcrypt at byte 72.                                     |
| 2-byte UTF-8     | `"é".repeat(36)`         | 72 bytes         | 36 characters = 72 UTF-8 bytes. Exact boundary.                     |
| 2-byte UTF-8     | `"é".repeat(37)`         | 74 bytes         | 37 characters = 74 UTF-8 bytes. Truncated at 72 bytes.              |
| 3-byte CJK       | `"語".repeat(24)`        | 72 bytes         | 24 characters = 72 UTF-8 bytes. Exact boundary.                     |
| 3-byte CJK       | `"語".repeat(25)`        | 75 bytes         | 25 characters = 75 UTF-8 bytes. Truncated at 72 bytes.              |
| 4-byte SMP Emoji | `"🔐".repeat(18)`        | 72 bytes         | 18 characters = 72 UTF-8 bytes. Exact boundary.                     |
| 4-byte SMP Emoji | `"🔐".repeat(19)`        | 76 bytes         | 19 characters = 76 UTF-8 bytes. Truncated at 72 bytes.              |

**Invariants Enforced:**

1. Passwords are never pre-hashed or pre-truncated before calling `bcrypt.compare`.
2. Existing production hashes remain 100% valid.

---

## 5. Compare-and-Swap (CAS) Hash Upgrade Lifecycle

When a user logs in with a legacy bcrypt hash:

1. `PasswordService.verifyPassword` detects `algorithm === "bcrypt"`.
2. `bcrypt.compare` verifies the credentials.
3. If valid, `needsUpgrade: true` is returned with `upgradedHash` pre-generated via Argon2id.
4. The persistence layer invokes `upgradeUserPasswordHash(userId, expectedPriorHash, newHash)`.
5. The upgrade executes a conditional match:
   - If `currentRecord.passwordHash === expectedPriorHash`, the hash is updated to Argon2id and persisted atomically.
   - If a concurrent password change occurred in the interim, `currentRecord.passwordHash !== expectedPriorHash`, and the CAS update fails safely without overwriting the user's new password.
