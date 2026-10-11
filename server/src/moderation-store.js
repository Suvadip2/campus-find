import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.resolve(process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '../data'));
const dataFile = path.join(directory, 'moderation.json');
let writeQueue = Promise.resolve();

async function readData() {
  await mkdir(directory, { recursive: true });
  try {
    const data = JSON.parse(await readFile(dataFile, 'utf8'));
    return {
      reports: Array.isArray(data.reports) ? data.reports : [],
      auditTrail: Array.isArray(data.auditTrail) ? data.auditTrail : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { reports: [], auditTrail: [] };
  }
}

async function saveData(data) {
  await mkdir(directory, { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temporaryFile, dataFile);
}

export async function readModerationData() {
  return readData();
}

export function updateModerationData(update) {
  const operation = writeQueue.then(async () => {
    const data = await readData();
    const result = await update(data);
    await saveData(data);
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}
