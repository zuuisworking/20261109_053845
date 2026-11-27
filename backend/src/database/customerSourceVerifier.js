const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const ExcelJS = require('exceljs');
const iconv = require('iconv-lite');

const MAX_REPORTED_MISMATCHES = 100;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeCustomerCsv(buffer) {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer).replace(/^\uFEFF/, '');
  } catch (_error) {
    return iconv.decode(buffer, 'cp1252');
  }
}

function normalizedHeader(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'text')) return String(value.text);
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => String(part.text || '')).join('');
    }
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return String(value.result);
  }
  return String(value).trim();
}

function normalizeNullable(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizePower(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const text = String(value).trim().replace(/\s*(?:VA|Volt.?)\s*$/i, '').trim();
  let numericText;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    numericText = text.replace(/\./g, '');
  } else if (/^\d+$/.test(text)) {
    numericText = text;
  } else if (/^\d+,\d+$/.test(text)) {
    numericText = text.replace(',', '.');
  } else if (/^\d+(?:\.\d+)?$/.test(text)) {
    numericText = text;
  } else {
    return null;
  }
  const number = Number(numericText);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function parseCsvRecords(sourcePath) {
  const buffer = fs.readFileSync(sourcePath);
  const matrix = parse(decodeCustomerCsv(buffer), {
    bom: true,
    delimiter: ';',
    skip_empty_lines: true,
    relax_column_count: false,
  });
  if (!matrix.length) throw new Error('Customer CSV is empty.');

  const header = matrix[0].map((value) => String(value).trim());
  const expected = ['id_pelanggan', 'nama', 'tarif', 'daya', 'alamat'];
  if (header.length !== expected.length || header.some((value, index) => value !== expected[index])) {
    throw new Error(`Unexpected customer CSV schema: ${header.join(';')}`);
  }

  const records = matrix.slice(1).map((row, index) => ({
    rowNumber: index + 2,
    customerId: String(row[0] ?? '').trim(),
    name: normalizeNullable(row[1]),
    tariff: normalizeNullable(row[2]),
    powerRaw: normalizeNullable(row[3]),
    powerVa: normalizePower(row[3]),
    address: normalizeNullable(row[4]),
  }));
  return { records, hash: sha256(buffer) };
}

async function parseXlsxRecords(sourcePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('Customer XLSX has no worksheet.');

  let headerRowNumber = null;
  let headerMap = null;
  const searchLimit = Math.min(worksheet.rowCount, 50);
  for (let rowNumber = 1; rowNumber <= searchLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const normalized = new Map();
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      normalized.set(normalizedHeader(cellText(cell)), columnNumber);
    });
    if (normalized.has('IDPEL') && normalized.has('NAMA')) {
      headerRowNumber = rowNumber;
      headerMap = normalized;
      break;
    }
  }
  if (!headerRowNumber || !headerMap) {
    throw new Error('Customer XLSX header row containing IDPEL and NAMA was not found.');
  }

  const records = [];
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const valueFor = (header) => {
      const column = headerMap.get(header);
      return column ? cellText(row.getCell(column)) : '';
    };
    const customerId = valueFor('IDPEL').trim();
    const name = normalizeNullable(valueFor('NAMA'));
    const tariff = normalizeNullable(valueFor('TARIF'));
    const powerRaw = normalizeNullable(valueFor('DAYA'));
    const address = normalizeNullable(valueFor('ALAMAT'));
    if (!customerId && !name && !tariff && !powerRaw && !address) continue;
    records.push({
      rowNumber,
      customerId,
      name,
      tariff,
      powerRaw,
      powerVa: normalizePower(valueFor('DAYA')),
      address,
    });
  }

  return {
    records,
    hash: sha256(fs.readFileSync(sourcePath)),
    worksheet: worksheet.name,
    headerRow: headerRowNumber,
  };
}

async function verifyCustomerSources(csvPath, xlsxPath) {
  const csv = parseCsvRecords(csvPath);
  const xlsx = await parseXlsxRecords(xlsxPath);
  const csvById = new Map(csv.records.map((record) => [record.customerId, record]));
  const xlsxById = new Map(xlsx.records.map((record) => [record.customerId, record]));
  const mismatches = [];
  let mismatchCount = 0;

  const addMismatch = (mismatch) => {
    mismatchCount += 1;
    if (mismatches.length < MAX_REPORTED_MISMATCHES) mismatches.push(mismatch);
  };

  if (csv.records.length !== xlsx.records.length) {
    addMismatch({
      type: 'row_count',
      csvRows: csv.records.length,
      xlsxRows: xlsx.records.length,
    });
  }

  const ids = new Set([...csvById.keys(), ...xlsxById.keys()]);
  for (const customerId of ids) {
    const csvRecord = csvById.get(customerId);
    const xlsxRecord = xlsxById.get(customerId);
    if (!csvRecord || !xlsxRecord) {
      addMismatch({
        type: 'missing_customer_id',
        customerId,
        presentIn: csvRecord ? 'csv' : 'xlsx',
      });
      continue;
    }

    const fields = ['name', 'tariff', 'address'];
    for (const field of fields) {
      if (csvRecord[field] !== xlsxRecord[field]) {
        addMismatch({
          type: 'field_value',
          customerId,
          field,
          csv: csvRecord[field],
          xlsx: xlsxRecord[field],
        });
      }
    }
    if (csvRecord.powerVa !== xlsxRecord.powerVa) {
      addMismatch({
        type: 'field_value',
        customerId,
        field: 'power',
        csv: csvRecord.powerVa,
        xlsx: xlsxRecord.powerVa,
      });
    }
  }

  return {
    valid: mismatchCount === 0,
    csv: {
      path: path.resolve(csvPath),
      hash: csv.hash,
      total: csv.records.length,
    },
    xlsx: {
      path: path.resolve(xlsxPath),
      hash: xlsx.hash,
      total: xlsx.records.length,
      worksheet: xlsx.worksheet,
      headerRow: xlsx.headerRow,
    },
    mismatchCount,
    mismatchesTruncated: mismatchCount > mismatches.length,
    mismatches,
  };
}

module.exports = {
  normalizePower,
  parseCsvRecords,
  parseXlsxRecords,
  verifyCustomerSources,
};
