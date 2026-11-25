import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: MAX_MEMORY
  })) as Buffer;

  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    derived.toString("base64url")
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string
): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, hashValue] =
    encodedHash.split("$");

  if (
    algorithm !== "scrypt" ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const n = Number(cost);
  const r = Number(blockSize);
  const p = Number(parallelization);
  const expected = Buffer.from(hashValue, "base64url");
  const salt = Buffer.from(saltValue, "base64url");

  if (
    !Number.isSafeInteger(n) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p) ||
    n < 2 ||
    n > 65536 ||
    r < 1 ||
    r > 16 ||
    p < 1 ||
    p > 4 ||
    expected.length !== KEY_LENGTH ||
    salt.length !== 16
  ) {
    return false;
  }

  const actual = (await scrypt(password, salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: MAX_MEMORY
  })) as Buffer;

  return timingSafeEqual(actual, expected);
}
