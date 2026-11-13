import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const modelDir = join(root, 'public', 'models');

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted && ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}
function readBatchTable(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'b3dm') return null;
  const featureJsonLength = buffer.readUInt32LE(12); const featureBinaryLength = buffer.readUInt32LE(16); const batchJsonLength = buffer.readUInt32LE(20);
  const start = 28 + featureJsonLength + featureBinaryLength;
  return JSON.parse(buffer.toString('utf8', start, start + batchJsonLength).replace(/\0/g, '').trim());
}
function vectorAt(value, index) { return Array.isArray(value?.[index]) ? value[index] : value?.slice(index * 3, index * 3 + 3); }
function unionBounds(left, right) { if (!right) return left; if (!left) return [...right]; left[0] = Math.min(left[0], right[0]); left[1] = Math.min(left[1], right[1]); left[2] = Math.min(left[2], right[2]); left[3] = Math.max(left[3], right[3]); left[4] = Math.max(left[4], right[4]); left[5] = Math.max(left[5], right[5]); return left; }

const [structure, csvText, filenames] = await Promise.all([
  readFile(join(modelDir, 'structure.json'), 'utf8').then((text) => JSON.parse(text.replace(/^\uFEFF/, ''))),
  readFile(join(modelDir, '全部对象属性.csv'), 'utf8'),
  readdir(modelDir)
]);
const csvRows = parseCsv(csvText); const csvByTreeKey = new Map(csvRows.map((row) => [row.tree_key, row])); const boundsByComponent = new Map();
for (const filename of filenames.filter((name) => name.toLowerCase().endsWith('.b3dm')).sort((a, b) => a.includes('LOD0') ? -1 : b.includes('LOD0') ? 1 : a.localeCompare(b))) {
  const table = readBatchTable(await readFile(join(modelDir, filename))); if (!table?.componentId || !table.boundsMin || !table.boundsMax) continue;
  table.componentId.forEach((componentId, index) => { if (boundsByComponent.has(componentId)) return; const min = vectorAt(table.boundsMin, index); const max = vectorAt(table.boundsMax, index); if (min?.length === 3 && max?.length === 3) boundsByComponent.set(componentId, [...min, ...max]); });
}
const omitted = new Set(['root_name', 'project_name', 'unit_name', 'depth', 'node_seq', 'tree_key', 'parent_tree_key', 'display_path', 'has_children']);
const nodes = {}; const componentToNode = {}; const rootIds = []; let matchedPropertyRows = 0;
function compactAttributes(row) { return row ? Object.fromEntries(Object.entries(row).filter(([key, value]) => key.startsWith('EP3D_') && value && !omitted.has(key))) : {}; }
function visit(source, parentId, depth, path, occurrence) {
  const name = source.name || source.classDisplayName || '未命名构件'; const segment = depth >= 4 ? `${name}[${occurrence}]` : name; const treeKey = path ? `${path}/${segment}` : segment;
  if (depth > 5) { const componentId = source.componentId; return { componentIds: componentId ? [componentId] : [], bounds: componentId ? boundsByComponent.get(componentId) || null : null }; }
  const propertyRow = csvByTreeKey.get(treeKey); if (propertyRow) matchedPropertyRows += 1;
  const entry = { id: source.id, parentId, name, depth, className: source.classDisplayName || source.className || '', childIds: [], componentIds: [], bounds: null, attributes: compactAttributes(propertyRow), path: propertyRow?.display_path || treeKey }; nodes[entry.id] = entry;
  const nameCounts = new Map();
  for (const child of source.children || []) { const childOccurrence = (nameCounts.get(child.name) || 0) + 1; nameCounts.set(child.name, childOccurrence); const result = visit(child, source.id, depth + 1, treeKey, childOccurrence); if (depth + 1 <= 5) entry.childIds.push(child.id); else { entry.componentIds.push(...result.componentIds); result.componentIds.forEach((componentId) => { componentToNode[componentId] = entry.id; }); } entry.bounds = unionBounds(entry.bounds, result.bounds); }
  return { componentIds: entry.componentIds, bounds: entry.bounds };
}
const rootCounts = new Map(); for (const root of structure.roots || []) { const occurrence = (rootCounts.get(root.name) || 0) + 1; rootCounts.set(root.name, occurrence); rootIds.push(root.id); visit(root, null, 0, '', occurrence); }
const output = { version: 2, generatedFrom: ['tileset.json + b3dm', 'structure.json', '全部对象属性.csv'], rootIds, nodes, componentToNode, stats: { objectCount: Object.keys(nodes).length, componentCount: Object.keys(componentToNode).length, propertyRowCount: csvRows.length, matchedPropertyRows, boundedComponentCount: boundsByComponent.size } };
await writeFile(join(modelDir, 'model-index.json'), JSON.stringify(output)); console.log(JSON.stringify(output.stats, null, 2));
