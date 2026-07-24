import { APP_CONFIG } from './config.js';
import { isEndpointConfigured, sendCalculation } from './api.js';
import {
  clearDraft,
  enqueueOperation,
  listPendingOperations,
  loadDraft,
  removeOperation,
  saveDraft,
  updateOperation
} from './storage.js';

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
const CHART_COLORS = ['#146b3a', '#9dcc50', '#f2c94c'];

const form = document.querySelector('#carbon-form');
const productsContainer = document.querySelector('#products-container');
const productTemplate = document.querySelector('#product-template');
const compostagem = document.querySelector('#compostagem');
const compostagemOutput = document.querySelector('#compostagem-output');
const calculateButton = document.querySelector('#calculate-button');
const saveButton = document.querySelector('#save-button');
const clearButton = document.querySelector('#clear-button');
const addProductButton = document.querySelector('#add-product-button');
const formAlert = document.querySelector('#form-alert');
const emptyResult = document.querySelector('#empty-result');
const resultContent = document.querySelector('#result-content');
const resultStatus = document.querySelector('#result-status');
const saveStatus = document.querySelector('#save-status');
const connectionBar = document.querySelector('#connection-bar');
const connectionText = document.querySelector('#connection-text');
const syncButton = document.querySelector('#sync-button');
const installButton = document.querySelector('#install-button');

let currentCalculation = null;
let isSyncing = false;
let installPrompt = null;
let draftTimer = null;

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits }).format(Number(value) || 0);
}

function numberValue(id) {
  const value = Number.parseFloat(document.querySelector(`#${id}`).value);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function uniqueId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `calc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function track(name, parameters = {}) {
  try {
    window.firebaseLogEvent?.(name, parameters);
  } catch (error) {
    console.debug('Analytics indisponível.', error);
  }
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

function collectProducts() {
  return [...productsContainer.querySelectorAll('.product-row')].map((row) => {
    const type = row.querySelector('.product-type').value;
    const area = Math.max(0, Number.parseFloat(row.querySelector('.product-area').value) || 0);
    return { type, area };
  }).filter((item) => item.area > 0 && PRODUCT_TYPES[item.type]);
}

function collectFormData() {
  return {
    estado: document.querySelector('#estado').value,
    municipio: sanitizeText(document.querySelector('#municipio').value, 120),
    papel: numberValue('papel'),
    plastico: numberValue('plastico'),
    vidro: numberValue('vidro'),
    metal: numberValue('metal'),
    compostagem: numberValue('compostagem'),
    praticas: sanitizeText(document.querySelector('#praticas').value, 1000),
    produtos: collectProducts()
  };
}

function validateData(data) {
  const totalInputs = data.papel + data.plastico + data.vidro + data.metal + data.compostagem +
    data.produtos.reduce((sum, item) => sum + item.area, 0);
  if (totalInputs <= 0) {
    throw new Error('Informe ao menos uma quantidade de reciclagem, compostagem ou área produtiva.');
  }
  if (!CARBON_FOOTPRINTS[data.estado]) {
    throw new Error('Selecione um estado válido.');
  }
}

function calculate(data) {
  validateData(data);

  const recyclingMonthly =
    data.papel * REDUCTION_FACTORS.papel +
    data.plastico * REDUCTION_FACTORS.plastico +
    data.vidro * REDUCTION_FACTORS.vidro +
    data.metal * REDUCTION_FACTORS.metal;
  const recyclingAnnual = recyclingMonthly * 12;
  const compostingAnnual = data.compostagem * REDUCTION_FACTORS.compostagem * 12;

  const agricultureItems = data.produtos.map((product) => {
    const definition = PRODUCT_TYPES[product.type];
    return {
      ...product,
      name: definition.name,
      factor: definition.factor,
      reductionAnnual: product.area * definition.factor
    };
  });
  const agricultureAnnual = agricultureItems.reduce((sum, item) => sum + item.reductionAnnual, 0);
  const totalAnnual = recyclingAnnual + compostingAnnual + agricultureAnnual;
  const regionalFootprintKg = CARBON_FOOTPRINTS[data.estado] * 1000;

  return {
    operationId: uniqueId(),
    modelVersion: APP_CONFIG.modelVersion,
    calculatedAt: new Date().toISOString(),
    input: data,
    results: {
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
    },
    source: 'cloud-run-pwa',
    userAgent: navigator.userAgent.slice(0, 500)
  };
}

function addProduct(product = {}) {
  const fragment = productTemplate.content.cloneNode(true);
  const row = fragment.querySelector('.product-row');
  row.querySelector('.product-type').value = PRODUCT_TYPES[product.type] ? product.type : 'hortalicas';
  row.querySelector('.product-area').value = product.area || '';
  row.querySelector('.remove-product').addEventListener('click', () => {
    row.remove();
    if (!productsContainer.children.length) addProduct();
    scheduleDraftSave();
  });
  row.querySelectorAll('input, select').forEach((element) => element.addEventListener('input', scheduleDraftSave));
  productsContainer.appendChild(fragment);
}

function updateDonut(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  const donut = document.querySelector('#carbon-donut');
  const legend = document.querySelector('#chart-legend');
  const labels = ['Reciclagem', 'Compostagem', 'Agricultura'];

  if (total <= 0) {
    donut.style.background = '#e4f3e9';
  } else {
    let cursor = 0;
    const stops = values.map((value, index) => {
      const start = cursor;
      cursor += (value / total) * 100;
      return `${CHART_COLORS[index]} ${start}% ${cursor}%`;
    });
    donut.style.background = `conic-gradient(${stops.join(', ')})`;
  }

  legend.replaceChildren();
  values.forEach((value, index) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <span class="legend-swatch" style="background:${CHART_COLORS[index]}"></span>
      <span>${labels[index]}</span>
      <strong>${formatNumber(value)} kg</strong>`;
    legend.appendChild(item);
  });
}

function renderResult(calculation) {
  const { input, results } = calculation;
  emptyResult.hidden = true;
  resultContent.hidden = false;
  saveButton.disabled = false;
  resultStatus.textContent = `Cálculo realizado em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(calculation.calculatedAt))}.`;

  document.querySelector('#total-reduction').textContent = `${formatNumber(results.totalAnnual)} kg CO₂e/ano`;
  document.querySelector('#regional-comparison').textContent =
    `${formatNumber(results.regionalPercentage, 1)}% da pegada anual média de uma pessoa na referência selecionada.`;
  document.querySelector('#donut-total').textContent = formatNumber(results.totalAnnual, 0);
  document.querySelector('#trees-equivalent').textContent = formatNumber(results.treesEquivalent, 1);
  document.querySelector('#cars-equivalent').textContent = formatNumber(results.carsEquivalent, 2);
  document.querySelector('#homes-equivalent').textContent = formatNumber(results.homesEquivalent, 2);

  updateDonut([results.recyclingAnnual, results.compostingAnnual, results.agricultureAnnual]);

  const breakdown = document.querySelector('#breakdown-list');
  breakdown.replaceChildren();
  [
    ['Reciclagem', results.recyclingAnnual],
    ['Compostagem', results.compostingAnnual],
    ['Agricultura sustentável', results.agricultureAnnual]
  ].forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'breakdown-row';
    row.innerHTML = `<span>${label}</span><strong>${formatNumber(value)} kg CO₂e/ano</strong>`;
    breakdown.appendChild(row);
  });

  const details = document.querySelector('#agriculture-details');
  if (results.agricultureItems.length) {
    const list = document.createElement('ul');
    results.agricultureItems.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = `${item.name}: ${formatNumber(item.area)} m² → ${formatNumber(item.reductionAnnual)} kg CO₂e/ano`;
      list.appendChild(li);
    });
    details.replaceChildren(document.createTextNode('Áreas produtivas consideradas:'), list);
  } else {
    details.textContent = 'Nenhuma área produtiva foi informada.';
  }

  saveStatus.textContent = '';
  saveStatus.className = 'save-status';
  track('carbon_calculation', {
    state: input.estado,
    model_version: calculation.modelVersion,
    total_kg_co2e: Math.round(results.totalAnnual)
  });
}

function showFormError(message) {
  formAlert.textContent = message;
  formAlert.hidden = false;
  formAlert.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearFormError() {
  formAlert.hidden = true;
  formAlert.textContent = '';
}

function serializeDraft() {
  return collectFormData();
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try { await saveDraft(serializeDraft()); } catch (error) { console.warn(error); }
  }, 350);
}

async function restoreDraft() {
  try {
    const draft = await loadDraft();
    if (!draft) {
      addProduct();
      return;
    }
    document.querySelector('#estado').value = CARBON_FOOTPRINTS[draft.estado] ? draft.estado : 'RR';
    document.querySelector('#municipio').value = draft.municipio || '';
    ['papel', 'plastico', 'vidro', 'metal'].forEach((key) => {
      document.querySelector(`#${key}`).value = draft[key] || '';
    });
    compostagem.value = draft.compostagem || 0;
    compostagemOutput.value = `${formatNumber(compostagem.value, 0)} kg`;
    document.querySelector('#praticas').value = draft.praticas || '';
    productsContainer.replaceChildren();
    (draft.produtos?.length ? draft.produtos : [{}]).forEach(addProduct);
  } catch (error) {
    console.warn('Não foi possível restaurar o rascunho.', error);
    addProduct();
  }
}

async function queueCalculation(calculation, reason = '') {
  const operation = {
    id: calculation.operationId,
    type: 'create',
    payload: calculation,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    lastError: reason
  };
  await enqueueOperation(operation);
  await updateConnectionStatus();
  return operation;
}

async function saveCurrentCalculation() {
  if (!currentCalculation) return;
  saveButton.disabled = true;
  saveStatus.className = 'save-status';
  saveStatus.textContent = 'Salvando resultado…';

  if (!navigator.onLine || !isEndpointConfigured()) {
    await queueCalculation(currentCalculation, navigator.onLine ? 'Endpoint não configurado.' : 'Sem conexão.');
    saveStatus.textContent = navigator.onLine
      ? 'Resultado salvo no dispositivo. Configure o endpoint para sincronizar.'
      : 'Resultado salvo no dispositivo e aguardando internet.';
    saveStatus.classList.add('is-warning');
    saveButton.disabled = false;
    return;
  }

  try {
    const response = await sendCalculation(currentCalculation);
    saveStatus.textContent = response.duplicate
      ? 'Este resultado já estava registrado na planilha.'
      : 'Resultado salvo com sucesso na planilha.';
    saveStatus.classList.add('is-success');
    track('carbon_calculation_saved', { state: currentCalculation.input.estado });
  } catch (error) {
    await queueCalculation(currentCalculation, error.message);
    saveStatus.textContent = 'Não foi possível enviar agora. O resultado ficou salvo neste dispositivo.';
    saveStatus.classList.add('is-warning');
  } finally {
    saveButton.disabled = false;
  }
}

function retryDelay(attempt) {
  return APP_CONFIG.syncBaseDelayMs * Math.min(64, 2 ** Math.max(0, attempt - 1));
}

async function flushQueue(force = false) {
  if (isSyncing || !navigator.onLine || !isEndpointConfigured()) return;
  isSyncing = true;
  syncButton.disabled = true;
  connectionText.textContent = 'Sincronizando resultados pendentes…';

  try {
    const operations = await listPendingOperations();
    for (const operation of operations) {
      if (!force && operation.attempts >= APP_CONFIG.maxSyncAttempts) continue;
      if (!force && operation.nextAttemptAt && Date.now() < new Date(operation.nextAttemptAt).getTime()) continue;

      try {
        await sendCalculation(operation.payload);
        await removeOperation(operation.id);
      } catch (error) {
        const attempts = force ? 1 : operation.attempts + 1;
        await updateOperation({
          ...operation,
          attempts,
          status: attempts >= APP_CONFIG.maxSyncAttempts ? 'error' : 'pending',
          lastError: error.message,
          updatedAt: new Date().toISOString(),
          nextAttemptAt: new Date(Date.now() + retryDelay(attempts)).toISOString()
        });
      }
    }
  } finally {
    isSyncing = false;
    syncButton.disabled = false;
    await updateConnectionStatus();
  }
}

async function updateConnectionStatus() {
  let pending = [];
  try { pending = await listPendingOperations(); } catch { /* armazenamento opcional */ }
  const pendingCount = pending.length;

  connectionBar.classList.toggle('is-offline', !navigator.onLine);
  connectionBar.classList.remove('has-error');
  syncButton.hidden = pendingCount === 0;

  if (!navigator.onLine) {
    connectionText.textContent = pendingCount
      ? `Sem internet. ${pendingCount} resultado(s) aguardando sincronização.`
      : 'Sem internet. A calculadora continua disponível.';
    return;
  }

  if (!isEndpointConfigured()) {
    connectionBar.classList.add('has-error');
    connectionText.textContent = pendingCount
      ? `Endpoint não configurado. ${pendingCount} resultado(s) permanecem no dispositivo.`
      : 'Integração com o Google Sheets indisponível. Os cálculos continuam funcionando.';
    return;
  }

  connectionText.textContent = pendingCount
    ? `${pendingCount} resultado(s) aguardando sincronização.`
    : 'Online e pronto para salvar no Google Sheets.';
}

async function resetForm() {
  const confirmed = window.confirm('Limpar todos os dados preenchidos e o resultado atual?');
  if (!confirmed) return;
  form.reset();
  compostagem.value = 0;
  compostagemOutput.value = '0 kg';
  productsContainer.replaceChildren();
  addProduct();
  currentCalculation = null;
  saveButton.disabled = true;
  emptyResult.hidden = false;
  resultContent.hidden = true;
  resultStatus.textContent = 'Preencha os dados para calcular.';
  clearFormError();
  await clearDraft();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearFormError();
  try {
    currentCalculation = calculate(collectFormData());
    renderResult(currentCalculation);
  } catch (error) {
    showFormError(error.message || 'Revise os valores informados.');
  }
});

form.addEventListener('input', scheduleDraftSave);
form.addEventListener('change', scheduleDraftSave);
compostagem.addEventListener('input', () => {
  compostagemOutput.value = `${formatNumber(compostagem.value, 0)} kg`;
});
addProductButton.addEventListener('click', () => { addProduct(); scheduleDraftSave(); });
saveButton.addEventListener('click', saveCurrentCalculation);
clearButton.addEventListener('click', resetForm);
syncButton.addEventListener('click', () => flushQueue(true));
window.addEventListener('online', async () => { await updateConnectionStatus(); await flushQueue(); });
window.addEventListener('offline', updateConnectionStatus);

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});
window.addEventListener('appinstalled', () => track('pwa_installed'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js')
    .catch((error) => console.warn('Service Worker não registrado.', error)));
}

await restoreDraft();
await updateConnectionStatus();
if (navigator.onLine) await flushQueue();
