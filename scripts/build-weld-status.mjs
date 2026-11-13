import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWeldStatus } from './weld-status.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = process.env.WELD_DB_PATH || resolve(root, 'data', '动力站焊接数据库-云端同步.xlsx');
const output = resolve(root, 'public', 'models', 'weld-status.json');
const status = await loadWeldStatus(source);
await writeFile(output, `${JSON.stringify(status)}\n`);
console.log(`焊接状态索引已生成：${Object.keys(status.records).length} 条记录。`);
