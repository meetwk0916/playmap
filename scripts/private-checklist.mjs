import { mkdir, realpath, open, lstat, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

async function rejectSymlink(target) {
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Private output must not be a symlink');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export async function validatePrivateOutput(outputPath, repoRoot) {
  const target = resolve(outputPath);
  const root = await realpath(repoRoot);
  const outside = path => {
    const within = relative(root, path);
    if (!within.startsWith(`..${sep}`) && within !== '..' && !within.startsWith(sep)) throw new Error('Private checklist must be outside the repository');
  };
  outside(target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const actualTarget = resolve(await realpath(dirname(target)), basename(target));
  outside(actualTarget);
  for (let ancestor = dirname(actualTarget); ; ancestor = dirname(ancestor)) {
    try {
      await lstat(resolve(ancestor, '.git'));
      throw new Error('Private checklist must be outside every Git checkout');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(ancestor) === ancestor) break;
  }
  await rejectSymlink(actualTarget);
  return actualTarget;
}

export async function readPrivateJson(target) {
  let file;
  try {
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const result = JSON.parse(await file.readFile('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected a private progress object');
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read existing private progress: ${error.message}`, { cause: error });
  } finally { await file?.close(); }
}

export async function writePrivateJson(target, value) {
  const temporary = resolve(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
    await file.close();
    file = null;
    await rejectSymlink(target);
    await rename(temporary, target);
  } finally {
    await file?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
