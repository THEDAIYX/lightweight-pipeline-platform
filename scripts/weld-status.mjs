import { readFile, stat } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const decoder = new TextDecoder('utf-8');
let cachedSource = '';
let cachedMtime = -1;
let cachedStatus = null;

function decodeXml(value = '') {
  return value.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function zipEntries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('焊接数据库不是有效的 xlsx 文件');
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  while (buffer.readUInt32LE(cursor) === 0x02014b50) {
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = decoder.decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, compression === 8 ? inflateRawSync(compressed) : compressed);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function columnName(cellRef) { return cellRef.replace(/[0-9]/g, ''); }

function spreadsheetRows(sheetText, sharedStrings) {
  const rows = [];
  for (const rowMatch of sheetText.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1]; const body = cellMatch[2];
      const reference = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      if (!reference) continue;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '';
      row[columnName(reference)] = type === 's' ? (sharedStrings[Number(raw)] ?? '') : decodeXml(raw);
    }
    rows.push(row);
  }
  return rows;
}

function virtualDate(index) {
  const date = new Date(Date.UTC(2026, 9, 1 + (index % 45)));
  return date.toISOString().slice(0, 10);
}

function weldKey(pipe, weld) {
  return `${String(pipe || '').replace(/\s+/g, '').toUpperCase()}#${String(weld || '').replace(/\s+/g, '').toUpperCase()}`;
}

// Excel/WPS 将日期保存为从 1899-12-30 起计的序列号；接口统一输出可读日期。
function normalizedDate(value) {
  const text = String(value || '').trim();
  const serial = Number(text);
  if (text && Number.isFinite(serial) && serial >= 20000 && serial <= 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);
  }
  return text;
}

export async function loadWeldStatus(sourcePath) {
  const sourceInfo = await stat(sourcePath);
  if (cachedStatus && cachedSource === sourcePath && cachedMtime === sourceInfo.mtimeMs) return cachedStatus;
  const entries = zipEntries(await readFile(sourcePath));
  const sharedText = decoder.decode(entries.get('xl/sharedStrings.xml') || Buffer.alloc(0));
  const sharedStrings = [...sharedText.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => decodeXml(match[1]));
  const sheetText = decoder.decode(entries.get('xl/worksheets/sheet1.xml') || Buffer.alloc(0));
  const rows = spreadsheetRows(sheetText, sharedStrings);
  const headers = rows.shift() || {};
  const headerColumn = Object.fromEntries(Object.entries(headers).map(([column, value]) => [value, column]));
  const pipeColumn = headerColumn['管线号']; const weldColumn = headerColumn['焊点编号']; const dateColumn = headerColumn['焊接日期'];
  if (!pipeColumn || !weldColumn || !dateColumn) throw new Error('焊接数据库缺少“管线号、焊点编号或焊接日期”字段');
  const records = {};
  rows.forEach((row, index) => {
    const pipe = String(row[pipeColumn] || '').trim(); const weld = String(row[weldColumn] || '').trim();
    if (!pipe || !weld) return;
    const originalDate = normalizedDate(row[dateColumn]);
    records[weldKey(pipe, weld)] = { date: originalDate, isVirtual: false, welded: Boolean(originalDate) };
  });
  cachedSource = sourcePath; cachedMtime = sourceInfo.mtimeMs;
  cachedStatus = { source: sourcePath, updatedAt: new Date(sourceInfo.mtimeMs).toISOString(), records };
  return cachedStatus;
}
