import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

/** Ancestors may be shared directories, but must never redirect through a symlink. */
async function checkPrivateDirectory(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split('/').filter(Boolean)) {
    current = join(current, part);
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe push directory ancestor');
    if (current === absolute && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) throw new Error('unsafe push private directory');
  }
}

export async function ensurePushPrivateDirectory(directory: string): Promise<void> {
  await checkPrivateDirectory(directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await checkPrivateDirectory(directory);
}

/** Shape validation remains with each caller; this helper only validates file safety. */
export async function readPushPrivateJson<T>(path: string, maxSize: number): Promise<T> {
  await checkPrivateDirectory(dirname(path));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > maxSize) throw new Error('unsafe push private file');
    return JSON.parse(await file.readFile('utf8')) as T;
  } finally { await file.close(); }
}
