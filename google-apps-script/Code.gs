const CONFIG = Object.freeze({
  SHEET_NAME: 'Cálculos de Carbono',
  MODEL_VERSION: '1.1.0',
  TIMEZONE: 'America/Boa_Vista',
  MAX_PRODUCTS: 50,
  MAX_TEXT_LENGTH: 1000,
  HEADERS: [
    'Data e hora',
    'ID da operação',
    'Versão do modelo',
    'Estado',
    'Município',
    'Papel (kg/mês)',
    'Plástico (kg/mês)',
    'Vidro (kg/mês)',
    'Metal (kg/mês)',
    'Compostagem (kg/mês)',
    'Produtos agrícolas (JSON)',
    'Práticas sustentáveis',
    'Reciclagem (kg CO₂e/ano)',
    'Compostagem (kg CO₂e/ano)',
    'Agricultura (kg CO₂e/ano)',
    'Redução total (kg CO₂e/ano)',
    'Percentual da pegada regional',
    'Árvores equivalentes',
    'Carros equivalentes',
    'Residências equivalentes',
    'Origem',
    'Navegador',
    'Status'
  ]
});

const CARBON_FOOTPRINTS = Object.freeze({ RR: 5.1, AM: 6.2, SP: 7.8, MG: 7.1, BR: 6.9 });
const REDUCTION_FACTORS = Object.freeze({ papel: 1.8, plastico: 1.5, vidro: 0.3, metal: 9.0, compostagem: 0.25 });
const PRODUCT_TYPES = Object.freeze({
  hortalicas: { name: 'Hortaliças', factor: 0.7 },
  frutiferas: { name: 'Frutíferas', factor: 0.8 },
  criacoes: { name: 'Criação animal', factor: 0.6 },
  agrofloresta: { name: 'Agrofloresta', factor: 0.9 },
  graos: { name: 'Grãos', factor: 0.65 },
  raizes: { name: 'Raízes e tubérculos', factor: 0.75 }
});

function doGet(e) {
  const action = String(e?.parameter?.action || 'health');
  if (action === 'health') {
    return jsonResponse_({
      success: true,
      service: 'AmazonBioEco Carbon Calculator API',
      modelVersion: CONFIG.MODEL_VERSION,
      timestamp: new Date().toISOString()
    });
  }
  return jsonResponse_({ success: false, message: 'Ação não reconhecida.' });
}

function doPost(e) {
  try {
    const body = parseRequestBody_(e);
    if (body.action !== 'saveCalculation') {
      throw new Error('Ação não reconhecida.');
    }
    return jsonResponse_(saveCalculation_(body.payload));
  } catch (error) {
    console.error(error);
    return jsonResponse_({ success: false, message: safeErrorMessage_(error) });
  }
}

function prepararPlanilha() {
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) {
    PropertiesService.getScriptProperties()
      .setProperty('SPREADSHEET_ID', activeSpreadsheet.getId());
  }

  const sheet = getOrCreateSheet_();
  formatSheet_(sheet);
  return `Planilha preparada: ${sheet.getName()} | ID configurado: ${sheet.getParent().getId()}`;
}

function salvarCalculoTeste(payload) {
  return saveCalculation_(payload);
}

function saveCalculation_(rawPayload) {
  const payload = validateAndNormalizePayload_(rawPayload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getOrCreateSheet_();
    const existingRow = findOperationRow_(sheet, payload.operationId);
    if (existingRow) {
      return {
        success: true,
        duplicate: true,
        operationId: payload.operationId,
        row: existingRow,
        message: 'Operação já registrada.'
      };
    }

    const calculated = calculateServerSide_(payload.input);
    const row = [
      new Date(),
      payload.operationId,
      CONFIG.MODEL_VERSION,
      payload.input.estado,
      payload.input.municipio,
      payload.input.papel,
      payload.input.plastico,
      payload.input.vidro,
      payload.input.metal,
      payload.input.compostagem,
      JSON.stringify(calculated.agricultureItems),
      payload.input.praticas,
      calculated.recyclingAnnual,
      calculated.compostingAnnual,
      calculated.agricultureAnnual,
      calculated.totalAnnual,
      calculated.regionalPercentage,
      calculated.treesEquivalent,
      calculated.carsEquivalent,
      calculated.homesEquivalent,
      payload.source,
      payload.userAgent,
      'Sincronizado'
    ];

    sheet.appendRow(row);
    const rowNumber = sheet.getLastRow();
    sheet.getRange(rowNumber, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(rowNumber, 6, 1, 15).setNumberFormat('0.00');

    return {
      success: true,
      duplicate: false,
      operationId: payload.operationId,
      row: rowNumber,
      modelVersion: CONFIG.MODEL_VERSION,
      calculated,
      message: 'Cálculo salvo com sucesso.'
    };
  } finally {
    lock.releaseLock();
  }
}

function validateAndNormalizePayload_(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') throw new Error('Dados do cálculo não informados.');
  const input = rawPayload.input || {};
  const operationId = sanitizeText_(rawPayload.operationId, 120);
  if (!operationId) throw new Error('ID da operação ausente.');

  const estado = sanitizeText_(input.estado, 2).toUpperCase();
  if (!CARBON_FOOTPRINTS[estado]) throw new Error('Estado inválido.');

  const produtos = Array.isArray(input.produtos) ? input.produtos.slice(0, CONFIG.MAX_PRODUCTS) : [];
  const normalizedProducts = produtos.map((item) => ({
    type: sanitizeText_(item?.type, 30),
    area: safeNumber_(item?.area, 0, 10000000)
  })).filter((item) => PRODUCT_TYPES[item.type] && item.area > 0);

  const normalizedInput = {
    estado,
    municipio: sanitizeText_(input.municipio, 120),
    papel: safeNumber_(input.papel, 0, 100000),
    plastico: safeNumber_(input.plastico, 0, 100000),
    vidro: safeNumber_(input.vidro, 0, 100000),
    metal: safeNumber_(input.metal, 0, 100000),
    compostagem: safeNumber_(input.compostagem, 0, 100000),
    praticas: sanitizeText_(input.praticas, CONFIG.MAX_TEXT_LENGTH),
    produtos: normalizedProducts
  };

  const totalInput = normalizedInput.papel + normalizedInput.plastico + normalizedInput.vidro +
    normalizedInput.metal + normalizedInput.compostagem +
    normalizedProducts.reduce((sum, product) => sum + product.area, 0);
  if (totalInput <= 0) throw new Error('Nenhum valor válido foi informado.');

  return {
    operationId,
    input: normalizedInput,
    source: sanitizeText_(rawPayload.source, 80) || 'web',
    userAgent: sanitizeText_(rawPayload.userAgent, 500)
  };
}

function calculateServerSide_(input) {
  const recyclingAnnual = (
    input.papel * REDUCTION_FACTORS.papel +
    input.plastico * REDUCTION_FACTORS.plastico +
    input.vidro * REDUCTION_FACTORS.vidro +
    input.metal * REDUCTION_FACTORS.metal
  ) * 12;
  const compostingAnnual = input.compostagem * REDUCTION_FACTORS.compostagem * 12;
  const agricultureItems = input.produtos.map((product) => {
    const definition = PRODUCT_TYPES[product.type];
    return {
      type: product.type,
      name: definition.name,
      area: product.area,
      factor: definition.factor,
      reductionAnnual: product.area * definition.factor
    };
  });
  const agricultureAnnual = agricultureItems.reduce((sum, item) => sum + item.reductionAnnual, 0);
  const totalAnnual = recyclingAnnual + compostingAnnual + agricultureAnnual;
  const regionalFootprintKg = CARBON_FOOTPRINTS[input.estado] * 1000;

  return {
    recyclingAnnual,
    compostingAnnual,
    agricultureAnnual,
    totalAnnual,
    regionalFootprintKg,
    regionalPercentage: regionalFootprintKg ? (totalAnnual / regionalFootprintKg) * 100 : 0,
    treesEquivalent: totalAnnual / 22,
    carsEquivalent: totalAnnual / 4600,
    homesEquivalent: totalAnnual / 7000,
    agricultureItems
  };
}

function getSpreadsheet_() {
  const configuredId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (configuredId) return SpreadsheetApp.openById(configuredId);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('Configure a propriedade de script SPREADSHEET_ID ou vincule o projeto a uma Planilha Google.');
  }
  return active;
}

function getOrCreateSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);

  const currentHeaders = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).getValues()[0];
  const needsHeaders = CONFIG.HEADERS.some((header, index) => currentHeaders[index] !== header);
  if (needsHeaders) {
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    formatSheet_(sheet);
  }
  return sheet;
}

function formatSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CONFIG.HEADERS.length)
    .setBackground('#146b3a')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sheet.setRowHeight(1, 42);
  sheet.autoResizeColumns(1, CONFIG.HEADERS.length);
  sheet.setColumnWidth(11, 300);
  sheet.setColumnWidth(12, 300);
  sheet.setColumnWidth(22, 320);
  sheet.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('Q:Q').setNumberFormat('0.00"%"');
  const filter = sheet.getFilter();
  if (!filter && sheet.getLastRow() >= 1) {
    sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), CONFIG.HEADERS.length).createFilter();
  }
}

function findOperationRow_(sheet, operationId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet.getRange(2, 2, lastRow - 1, 1)
    .createTextFinder(operationId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function parseRequestBody_(e) {
  const raw = e?.postData?.contents;
  if (!raw) throw new Error('Corpo da requisição vazio.');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error('JSON inválido.');
  }
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeNumber_(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(min, number));
}

function sanitizeText_(value, maxLength) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeErrorMessage_(error) {
  const message = String(error?.message || 'Erro interno.');
  return message.slice(0, 300);
}
