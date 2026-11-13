import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const target = join(root, 'public', 'cesium');

try {
  await stat(source);
} catch {
  console.error('未找到 Cesium 运行时。请先执行 pnpm install。');
  process.exit(1);
}

await mkdir(join(root, 'public'), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log('Cesium 运行时资源已准备到 public/cesium');
