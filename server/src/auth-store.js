import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const directory = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../data'));
const dataFile = path.join(directory, 'auth.json');
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;

async function readAuthData() {
  await mkdir(directory, { recursive: true });
  try {
    return JSON.parse(await readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { users: [], sessions: [] };
  }
}

async function saveAuthData(data) {
  await mkdir(directory, { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temporaryFile, dataFile);
}

export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

export async function passwordMatches(password, storedHash) {
  const [, salt, hash] = storedHash.split('$');
  if (!salt || !hash) return false;
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

export async function initializeAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password) throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD to provision the initial admin account.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 6 || password.length > 128) {
    throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must be 6–128 characters.');
  }

  const data = await readAuthData();
  if (data.users.some((user) => user.email === email)) return;
  data.users.push({
    id: randomUUID(),
    name: 'Campus administrator',
    email,
    role: 'admin',
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  });
  await saveAuthData(data);
}

export async function registerStudent({ name, email, password }) {
  const data = await readAuthData();
  if (data.users.some((user) => user.email === email)) return null;
  const user = {
    id: randomUUID(),
    name,
    email,
    role: 'student',
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString()
  };
  data.users.push(user);
  await saveAuthData(data);
  return user;
}

export async function authenticateUser(email, password, role) {
  const data = await readAuthData();
  const user = data.users.find((entry) => entry.email === email && entry.role === role);
  if (!user) {
    await hashPassword(password);
    return null;
  }
  return await passwordMatches(password, user.passwordHash) ? user : null;
}

export async function createSession(userId) {
  const data = await readAuthData();
  const now = Date.now();
  data.sessions = data.sessions.filter((session) => session.expiresAt > now);
  const token = randomBytes(32).toString('base64url');
  data.sessions.push({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    userId,
    expiresAt: now + sessionLifetime
  });
  await saveAuthData(data);
  return { token, maxAge: sessionLifetime };
}

export async function userForSession(token) {
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const data = await readAuthData();
  const session = data.sessions.find((entry) => entry.tokenHash === tokenHash && entry.expiresAt > Date.now());
  return session ? data.users.find((user) => user.id === session.userId) ?? null : null;
}

export async function deleteSession(token) {
  if (!token) return;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const data = await readAuthData();
  data.sessions = data.sessions.filter((session) => session.tokenHash !== tokenHash);
  await saveAuthData(data);
}
