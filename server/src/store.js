import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../data'));
const dataFile = path.join(directory, 'items.json');
let writeQueue = Promise.resolve();

const seedItems = [
  { id: 'sample-1', title: 'Silver wireless earbuds', description: 'Small silver case, left near the charging outlets.', category: 'Electronics', type: 'lost', location: 'Main Library, second floor', contact: 'library@example.edu', status: 'open', createdAt: '2026-10-08T10:30:00.000Z' },
  { id: 'sample-2', title: 'Sketchbook with a green cover', description: 'A few pencil drawings inside. Picked up so it stays safe.', category: 'Books', type: 'found', location: 'Arts Building, studio lobby', contact: 'arts@example.edu', status: 'open', createdAt: '2026-10-07T14:10:00.000Z' },
  { id: 'sample-3', title: 'Set of two brass keys', description: 'One small key and one standard key on a blue ring.', category: 'Keys', type: 'found', location: 'Student Union, near the cafe', contact: 'union@example.edu', status: 'open', createdAt: '2026-10-06T09:15:00.000Z' },
  { id: 'sample-4', title: 'Canvas tote bag', description: 'Natural canvas with a little sunflower pin on the strap.', category: 'Bags', type: 'lost', location: 'Science Quad, outside Hall C', contact: 'quad@example.edu', status: 'open', createdAt: '2026-10-05T16:45:00.000Z' }
];

export const listingStatus = Object.freeze({
  ACTIVE: 'open',
  RESOLVED: 'resolved',
  REMOVED: 'removed'
});

export function normalizeListingStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (['', 'open', 'active', 'matched', 'pending_confirmation'].includes(normalized)) {
    return listingStatus.ACTIVE;
  }
  if (normalized === listingStatus.RESOLVED) return listingStatus.RESOLVED;
  if (normalized === listingStatus.REMOVED) return listingStatus.REMOVED;
  return listingStatus.REMOVED;
}

export function isActiveListing(item) {
  return normalizeListingStatus(item.status) === listingStatus.ACTIVE;
}

function normalizeItems(items) {
  return items.map((item) => ({ ...item, status: normalizeListingStatus(item.status) }));
}

export async function readItems() {
  await mkdir(directory, { recursive: true });
  try {
    const items = JSON.parse(await readFile(dataFile, 'utf8'));
    if (!Array.isArray(items)) throw new Error('The campus listings store must contain a JSON array.');
    return normalizeItems(items);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await saveItems(seedItems);
    return seedItems;
  }
}

export async function saveItems(items) {
  await mkdir(directory, { recursive: true });
  const temporaryFile = `${dataFile}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(normalizeItems(items), null, 2));
  try {
    await rename(temporaryFile, dataFile);
  } catch (error) {
    await rm(temporaryFile, { force: true });
    throw error;
  }
}

export async function normalizePersistedListingStatuses() {
  const items = await readItems();
  await saveItems(items);
}

export function updateItems(update) {
  const operation = writeQueue.then(async () => {
    const items = await readItems();
    const result = await update(items);
    await saveItems(items);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
