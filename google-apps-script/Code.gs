const CONFIG = Object.freeze({
  SHEET_NAME: 'Cálculos de Carbono',
  MODEL_VERSION: '1.2.0',
  TIMEZONE: 'America/Boa_Vista',
  MAX_PRODUCTS: 50,
  MAX_TEXT_LENGTH: 1000,

  // Normalmente deve permanecer vazio quando o Apps Script foi criado por
  // Extensões > Apps Script dentro da própria Planilha Google.
  // Em um projeto independente, cole aqui o ID da planilha ou configure a
  // propriedade de script SPREADSHEET_ID.
  SPREADSHEET_ID: '',

  HEADERS: [
    'Data e hora',
    'ID da operação',
    'Versão do modelo',
    'Nome',
    'E-mail',
    'Enviar resultado por e-mail',
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
    'Status da planilha',
    'Status do e-mail',
    'Data de envio do e-mail'
  ]
});

const COL = Object.freeze({
  DATE: 1,
  OPERATION_ID: 2,
  NAME: 4,
  EMAIL: 5,
  SEND_EMAIL: 6,
  EMAIL_STATUS: 27,
  EMAIL_DATE: 28
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

  try {
    if (action === 'setup') {
      return jsonResponse_({
        success: true,
        message: prepararPlanilha(),
        setupCompleted: true
      });
    }

    if (action === 'health') {
      const status = getSpreadsheetStatus_();
      return jsonResponse_({
        success: true,
        service: 'AmazonBioEco Carbon Calculator API',
        modelVersion: CONFIG.MODEL_VERSION,
        spreadsheetReady: status.ready,
        spreadsheetName: status.spreadsheetName,
        sheetName: status.sheetName,
        message: status.message,
        timestamp: new Date().toISOString()
      });
    }

    return jsonResponse_({ success: false, message: 'Ação não reconhecida.' });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ success: false, message: safeErrorMessage_(error) });
  }
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

/**
 * Prepara a planilha manualmente. O mesmo preparo também é executado
 * automaticamente no primeiro cálculo recebido pelo Web App.
 */
function prepararPlanilha() {
  const spreadsheet = resolveSpreadsheetAndPersistId_();
  const sheet = getOrCreateSheet_(spreadsheet);
  formatSheet_(sheet);
  return `Planilha preparada: ${sheet.getName()} | ID configurado: ${spreadsheet.getId()}`;
}

function salvarCalculoTeste(payload) {
  return saveCalculation_(payload);
}

function saveCalculation_(rawPayload) {
  const payload = validateAndNormalizePayload_(rawPayload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    // Inicialização automática: cria a aba, migra cabeçalhos antigos e aplica
    // toda a formatação, mesmo que prepararPlanilha() não tenha sido executada.
    const spreadsheet = resolveSpreadsheetAndPersistId_();
    const sheet = getOrCreateSheet_(spreadsheet);
    const calculated = calculateServerSide_(payload.input);
    const existingRow = findOperationRow_(sheet, payload.operationId);

    if (existingRow) {
      const emailResult = retryEmailForExistingRow_(sheet, existingRow, payload, calculated);
      return {
        success: true,
        duplicate: true,
        operationId: payload.operationId,
        row: existingRow,
        modelVersion: CONFIG.MODEL_VERSION,
        calculated,
        email: emailResult,
        message: emailResult.sent
          ? 'Operação já registrada; o resultado também foi enviado por e-mail.'
          : 'Operação já registrada.'
      };
    }

    const initialEmailStatus = payload.input.enviarEmail ? 'Pendente' : 'Não solicitado';
    const row = [
      new Date(),
      payload.operationId,
      CONFIG.MODEL_VERSION,
      payload.input.nome,
      payload.input.email,
      payload.input.enviarEmail ? 'Sim' : 'Não',
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
      'Sincronizado',
      initialEmailStatus,
      ''
    ];

    sheet.appendRow(row);
    const rowNumber = sheet.getLastRow();
    formatDataRow_(sheet, rowNumber);

    const emailResult = payload.input.enviarEmail
      ? sendAndRegisterEmail_(sheet, rowNumber, payload, calculated)
      : { requested: false, sent: false, status: 'Não solicitado' };

    return {
      success: true,
      duplicate: false,
      operationId: payload.operationId,
      row: rowNumber,
      modelVersion: CONFIG.MODEL_VERSION,
      calculated,
      email: emailResult,
      message: emailResult.requested && !emailResult.sent
        ? 'Cálculo salvo na planilha, mas o e-mail não pôde ser enviado.'
        : 'Cálculo salvo com sucesso.'
    };
  } finally {
    lock.releaseLock();
  }
}

function retryEmailForExistingRow_(sheet, rowNumber, payload, calculated) {
  sheet.getRange(rowNumber, COL.NAME, 1, 3).setValues([[
    payload.input.nome,
    payload.input.email,
    payload.input.enviarEmail ? 'Sim' : 'Não'
  ]]);

  if (!payload.input.enviarEmail) {
    return { requested: false, sent: false, status: 'Não solicitado' };
  }

  const currentStatus = String(sheet.getRange(rowNumber, COL.EMAIL_STATUS).getDisplayValue() || '');
  if (currentStatus === 'Enviado') {
    return { requested: true, sent: true, status: 'Enviado', alreadySent: true };
  }

  return sendAndRegisterEmail_(sheet, rowNumber, payload, calculated);
}

function sendAndRegisterEmail_(sheet, rowNumber, payload, calculated) {
  try {
    sendCalculationEmail_(payload.input, calculated, payload.operationId);
    const sentAt = new Date();
    sheet.getRange(rowNumber, COL.EMAIL_STATUS).setValue('Enviado');
    sheet.getRange(rowNumber, COL.EMAIL_DATE).setValue(sentAt).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    return {
      requested: true,
      sent: true,
      status: 'Enviado',
      sentAt: sentAt.toISOString()
    };
  } catch (error) {
    const message = safeErrorMessage_(error);
    sheet.getRange(rowNumber, COL.EMAIL_STATUS).setValue(`Falha: ${message}`.slice(0, 500));
    return {
      requested: true,
      sent: false,
      status: 'Falha',
      message
    };
  }
}

function sendCalculationEmail_(input, calculated, operationId) {
  if (MailApp.getRemainingDailyQuota() <= 0) {
    throw new Error('A cota diária de envio de e-mails do Google Apps Script foi atingida.');
  }

  const formattedDate = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm');
  const total = formatNumberPtBr_(calculated.totalAnnual, 2);
  const percentage = formatNumberPtBr_(calculated.regionalPercentage, 1);
  const recycling = formatNumberPtBr_(calculated.recyclingAnnual, 2);
  const composting = formatNumberPtBr_(calculated.compostingAnnual, 2);
  const agriculture = formatNumberPtBr_(calculated.agricultureAnnual, 2);

  const productsHtml = calculated.agricultureItems.length
    ? `<ul>${calculated.agricultureItems.map((item) =>
      `<li><strong>${escapeHtml_(item.name)}</strong>: ${formatNumberPtBr_(item.area, 2)} m² — ${formatNumberPtBr_(item.reductionAnnual, 2)} kg CO₂e/ano</li>`
    ).join('')}</ul>`
    : '<p>Nenhuma área agrícola foi informada.</p>';

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#17211b;line-height:1.55">
      <div style="padding:24px;border-radius:16px 16px 0 0;background:#146b3a;color:#fff">
        <h1 style="margin:0;font-size:25px">Resultado da Calculadora de Carbono</h1>
        <p style="margin:8px 0 0;color:#e4f3e9">AmazonBioEco</p>
      </div>
      <div style="padding:24px;border:1px solid #dce5df;border-top:0;border-radius:0 0 16px 16px">
        <p>Olá, <strong>${escapeHtml_(input.nome)}</strong>.</p>
        <p>Seu resultado foi calculado e registrado em ${formattedDate}.</p>
        <div style="margin:22px 0;padding:20px;border-radius:12px;background:#e4f3e9;text-align:center">
          <span style="display:block;color:#3c4a41">Redução total estimada</span>
          <strong style="display:block;margin-top:5px;color:#0b4728;font-size:28px">${total} kg CO₂e/ano</strong>
          <span style="display:block;margin-top:7px;color:#3c4a41">${percentage}% da pegada anual média da referência selecionada</span>
        </div>
        <h2 style="font-size:18px;color:#0b4728">Detalhamento</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border-bottom:1px solid #dce5df">Reciclagem</td><td style="padding:8px;border-bottom:1px solid #dce5df;text-align:right"><strong>${recycling} kg CO₂e/ano</strong></td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #dce5df">Compostagem</td><td style="padding:8px;border-bottom:1px solid #dce5df;text-align:right"><strong>${composting} kg CO₂e/ano</strong></td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #dce5df">Agricultura sustentável</td><td style="padding:8px;border-bottom:1px solid #dce5df;text-align:right"><strong>${agriculture} kg CO₂e/ano</strong></td></tr>
        </table>
        <h2 style="font-size:18px;color:#0b4728">Áreas produtivas</h2>
        ${productsHtml}
        <p style="margin-top:24px;padding:12px;border-left:4px solid #f2c94c;background:#fff8df;font-size:13px">
          Esta é uma estimativa educativa. Não substitui inventário de emissões, auditoria ambiental ou certificação de créditos de carbono.
        </p>
        <p style="margin-top:20px;color:#66736b;font-size:12px">Código do registro: ${escapeHtml_(operationId)}</p>
      </div>
    </div>`;

  const plainBody = [
    `Olá, ${input.nome}.`,
    '',
    `Redução total estimada: ${total} kg CO₂e/ano`,
    `Comparação regional: ${percentage}%`,
    `Reciclagem: ${recycling} kg CO₂e/ano`,
    `Compostagem: ${composting} kg CO₂e/ano`,
    `Agricultura sustentável: ${agriculture} kg CO₂e/ano`,
    '',
    'Esta é uma estimativa educativa e não substitui inventário de emissões ou certificação.',
    `Código do registro: ${operationId}`
  ].join('\n');

  MailApp.sendEmail({
    to: input.email,
    subject: 'Seu resultado da Calculadora de Carbono AmazonBioEco',
    body: plainBody,
    htmlBody,
    name: 'AmazonBioEco'
  });
}

function validateAndNormalizePayload_(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('Dados do cálculo não informados.');
  }

  const input = rawPayload.input || {};
  const operationId = sanitizeText_(rawPayload.operationId, 120);
  if (!operationId) throw new Error('ID da operação ausente.');

  const nome = sanitizeText_(input.nome, 160);
  if (nome.length < 2) throw new Error('Informe o nome da pessoa.');

  const email = sanitizeText_(input.email, 200).toLowerCase();
  if (!isValidEmail_(email)) throw new Error('Informe um endereço de e-mail válido.');

  const estado = sanitizeText_(input.estado, 2).toUpperCase();
  if (!CARBON_FOOTPRINTS[estado]) throw new Error('Estado inválido.');

  const produtos = Array.isArray(input.produtos) ? input.produtos.slice(0, CONFIG.MAX_PRODUCTS) : [];
  const normalizedProducts = produtos.map((item) => ({
    type: sanitizeText_(item?.type, 30),
    area: safeNumber_(item?.area, 0, 10000000)
  })).filter((item) => PRODUCT_TYPES[item.type] && item.area > 0);

  const normalizedInput = {
    nome,
    email,
    enviarEmail: Boolean(input.enviarEmail),
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

function resolveSpreadsheetAndPersistId_() {
  const properties = PropertiesService.getScriptProperties();
  const configuredId = String(properties.getProperty('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID || '').trim();

  if (configuredId) {
    try {
      return SpreadsheetApp.openById(configuredId);
    } catch (error) {
      throw new Error('O SPREADSHEET_ID configurado não pôde ser aberto. Verifique o ID e as permissões.');
    }
  }

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.getActive();
  if (activeSpreadsheet) {
    properties.setProperty('SPREADSHEET_ID', activeSpreadsheet.getId());
    return activeSpreadsheet;
  }

  throw new Error(
    'Planilha não vinculada. Abra a Planilha Google, acesse Extensões > Apps Script e cole o código ali; ' +
    'ou informe o ID em CONFIG.SPREADSHEET_ID.'
  );
}

function getSpreadsheetStatus_() {
  try {
    const spreadsheet = resolveSpreadsheetAndPersistId_();
    const sheet = getOrCreateSheet_(spreadsheet);
    return {
      ready: true,
      spreadsheetName: spreadsheet.getName(),
      sheetName: sheet.getName(),
      message: 'Planilha pronta para receber cálculos.'
    };
  } catch (error) {
    return {
      ready: false,
      spreadsheetName: '',
      sheetName: CONFIG.SHEET_NAME,
      message: safeErrorMessage_(error)
    };
  }
}

function getOrCreateSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  const wasCreated = !sheet;
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  ensureSheetCapacity_(sheet);

  const schemaChanged = ensureHeadersAndMigrate_(sheet);
  if (wasCreated || schemaChanged) formatSheet_(sheet);
  return sheet;
}

function ensureSheetCapacity_(sheet) {
  const missingColumns = CONFIG.HEADERS.length - sheet.getMaxColumns();
  if (missingColumns > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), missingColumns);
  }
}

function ensureHeadersAndMigrate_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.max(sheet.getLastColumn(), CONFIG.HEADERS.length);
  const existingHeaders = lastRow > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    : [];

  const exactMatch = CONFIG.HEADERS.every((header, index) => existingHeaders[index] === header)
    && existingHeaders.slice(CONFIG.HEADERS.length).every((header) => !header);
  if (exactMatch) return false;

  if (lastRow <= 1 || existingHeaders.every((header) => !header)) {
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
    return true;
  }

  const oldData = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const oldIndex = new Map(existingHeaders.map((header, index) => [String(header), index]));
  const migratedData = oldData.map((oldRow) => CONFIG.HEADERS.map((header) => {
    const index = oldIndex.get(header);
    return index === undefined ? '' : oldRow[index];
  }));

  const currentFilter = sheet.getFilter();
  if (currentFilter) currentFilter.remove();
  sheet.clearContents();
  sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
  if (migratedData.length) {
    sheet.getRange(2, 1, migratedData.length, CONFIG.HEADERS.length).setValues(migratedData);
  }
  return true;
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
  sheet.setColumnWidth(4, 210);
  sheet.setColumnWidth(5, 230);
  sheet.setColumnWidth(14, 320);
  sheet.setColumnWidth(15, 320);
  sheet.setColumnWidth(25, 320);
  sheet.setColumnWidth(27, 230);
  sheet.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('T:T').setNumberFormat('0.00"%"');
  sheet.getRange('AB:AB').setNumberFormat('dd/MM/yyyy HH:mm:ss');

  const currentFilter = sheet.getFilter();
  if (!currentFilter && sheet.getLastRow() >= 1) {
    sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), CONFIG.HEADERS.length).createFilter();
  }
}

function formatDataRow_(sheet, rowNumber) {
  sheet.getRange(rowNumber, COL.DATE).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange(rowNumber, 9, 1, 5).setNumberFormat('0.00');
  sheet.getRange(rowNumber, 16, 1, 8).setNumberFormat('0.00');
}

function findOperationRow_(sheet, operationId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet.getRange(2, COL.OPERATION_ID, lastRow - 1, 1)
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

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || ''));
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatNumberPtBr_(value, decimals) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function safeErrorMessage_(error) {
  const message = String(error?.message || 'Erro interno.');
  return message.slice(0, 500);
}
