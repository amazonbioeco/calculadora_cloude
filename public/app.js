import { APP_CONFIG } from './config.js';
import { getBackendHealth, isEndpointConfigured, sendCalculation } from './api.js';
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
let backendStatus = {
  checked: false,
  ready: null,
  message: ''
};

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

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || ''));
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
    nome: sanitizeText(document.querySelector('#nome').value, 160),
    email: sanitizeText(document.querySelector('#email').value, 200).toLowerCase(),
    enviarEmail: document.querySelector('#enviar-email').checked,
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
  if (data.nome.length < 2) {
    throw new Error('Informe seu nome completo.');
  }
  if (!isValidEmail(data.email)) {
    throw new Error('Informe um endereço de e-mail válido.');
  }
  if (!CARBON_FOOTPRINTS[data.estado]) {
    throw new Error('Selecione um estado válido.');
  }

  const totalInputs = data.papel + data.plastico + data.vidro + data.metal + data.compostagem +
    data.produtos.reduce((sum, item) => sum + item.area, 0);
  if (totalInputs <= 0) {
    throw new Error('Informe ao menos uma quantidade de reciclagem, compostagem ou área produtiva.');
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
  resultStatus.textContent = `Cálculo realizado em ${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(calculation.calculatedAt))}. Salvamento automático ativado.`;

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

function setSaveStatus(message, state = '') {
  saveStatus.textContent = message;
  saveStatus.className = 'save-status';
  if (state) saveStatus.classList.add(`is-${state}`);
}

function serializeDraft() {
  return collectFormData();
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      await saveDraft(serializeDraft());
    } catch (error) {
      console.warn(error);
    }
  }, 350);
}

async function restoreDraft() {
  try {
    const draft = await loadDraft();
    if (!draft) {
      addProduct();
      return;
    }

    document.querySelector('#nome').value = draft.nome || '';
    document.querySelector('#email').value = draft.email || '';
    document.querySelector('#enviar-email').checked = draft.enviarEmail !== false;
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

function applyServerCalculation(response) {
  if (!currentCalculation || !response?.calculated) return;
  currentCalculation = {
    ...currentCalculation,
    modelVersion: response.modelVersion || currentCalculation.modelVersion,
    results: response.calculated
  };
  renderResult(currentCalculation);
}

function successMessageForResponse(response, calculation) {
  const duplicateText = response.duplicate
    ? 'O resultado já estava registrado na planilha.'
    : 'Resultado salvo automaticamente na planilha.';

  if (!calculation.input.enviarEmail) {
    return duplicateText;
  }
  if (response.email?.sent) {
    return `${duplicateText} Uma cópia foi enviada para ${calculation.input.email}.`;
  }
  return `${duplicateText} O e-mail não foi enviado: ${response.email?.message || 'falha não identificada'}.`;
}

async function saveCalculationAutomatically(calculation) {
  await queueCalculation(calculation);
  setSaveStatus('Resultado salvo neste dispositivo. Sincronizando com o Google Sheets…');

  if (!navigator.onLine) {
    setSaveStatus('Sem internet. O resultado ficou salvo neste dispositivo e será enviado automaticamente quando a conexão voltar.', 'warning');
    return;
  }

  if (!isEndpointConfigured()) {
    setSaveStatus('O endpoint de sincronização não está configurado. O resultado permanece salvo neste dispositivo.', 'warning');
    return;
  }

  try {
    const response = await sendCalculation(calculation);
    applyServerCalculation(response);

    const emailFailed = calculation.input.enviarEmail && !response.email?.sent;
    if (emailFailed) {
      await updateOperation({
        id: calculation.operationId,
        type: 'create',
        payload: calculation,
        createdAt: calculation.calculatedAt,
        updatedAt: new Date().toISOString(),
        attempts: 1,
        status: 'pending',
        lastError: response.email?.message || 'O e-mail ainda não foi enviado.',
        nextAttemptAt: new Date(Date.now() + retryDelay(1)).toISOString()
      });
    } else {
      await removeOperation(calculation.operationId);
    }
    setSaveStatus(successMessageForResponse(response, calculation), emailFailed ? 'warning' : 'success');
    backendStatus = {
      checked: true,
      ready: true,
      message: 'Google Sheets conectado.'
    };
    track('carbon_calculation_saved', { state: calculation.input.estado });
  } catch (error) {
    const pending = {
      id: calculation.operationId,
      type: 'create',
      payload: calculation,
      createdAt: calculation.calculatedAt,
      updatedAt: new Date().toISOString(),
      attempts: 1,
      status: 'pending',
      lastError: error.message,
      nextAttemptAt: new Date(Date.now() + retryDelay(1)).toISOString()
    };
    await updateOperation(pending);
    backendStatus = {
      checked: true,
      ready: false,
      message: error.message
    };
    setSaveStatus(
      `Não foi possível sincronizar: ${error.message} O resultado continua salvo neste dispositivo.`,
      'warning'
    );
  } finally {
    await updateConnectionStatus();
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
        const response = await sendCalculation(operation.payload);
        const emailFailed = operation.payload.input.enviarEmail && !response.email?.sent;
        if (emailFailed) {
          const attempts = operation.attempts + 1;
          await updateOperation({
            ...operation,
            attempts,
            status: attempts >= APP_CONFIG.maxSyncAttempts ? 'error' : 'pending',
            lastError: response.email?.message || 'O e-mail ainda não foi enviado.',
            updatedAt: new Date().toISOString(),
            nextAttemptAt: new Date(Date.now() + retryDelay(attempts)).toISOString()
          });
        } else {
          await removeOperation(operation.id);
        }
        backendStatus = { checked: true, ready: true, message: 'Google Sheets conectado.' };

        if (currentCalculation?.operationId === operation.id) {
          applyServerCalculation(response);
          setSaveStatus(successMessageForResponse(response, operation.payload), emailFailed ? 'warning' : 'success');
        }
      } catch (error) {
        const attempts = force ? operation.attempts + 1 : operation.attempts + 1;
        await updateOperation({
          ...operation,
          attempts,
          status: attempts >= APP_CONFIG.maxSyncAttempts ? 'error' : 'pending',
          lastError: error.message,
          updatedAt: new Date().toISOString(),
          nextAttemptAt: new Date(Date.now() + retryDelay(attempts)).toISOString()
        });
        backendStatus = { checked: true, ready: false, message: error.message };
      }
    }
  } finally {
    isSyncing = false;
    syncButton.disabled = false;
    await updateConnectionStatus();
  }
}

async function refreshBackendHealth() {
  if (!navigator.onLine || !isEndpointConfigured()) return;
  try {
    const health = await getBackendHealth();
    backendStatus = {
      checked: true,
      ready: Boolean(health.httpOk && health.success && health.spreadsheetReady !== false),
      message: health.message || (health.spreadsheetReady === false
        ? 'A planilha ainda não está pronta.'
        : 'Google Sheets conectado.')
    };
  } catch (error) {
    backendStatus = {
      checked: true,
      ready: false,
      message: error.message
    };
  }
}

async function updateConnectionStatus() {
  let pending = [];
  try {
    pending = await listPendingOperations();
  } catch {
    // O armazenamento local é opcional em navegadores incompatíveis.
  }
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
      : 'Integração com o Google Sheets indisponível.';
    return;
  }

  if (backendStatus.checked && backendStatus.ready === false) {
    connectionBar.classList.add('has-error');
    connectionText.textContent = pendingCount
      ? `${backendStatus.message} ${pendingCount} resultado(s) permanecem no dispositivo.`
      : backendStatus.message;
    return;
  }

  connectionText.textContent = pendingCount
    ? `${pendingCount} resultado(s) aguardando sincronização.`
    : 'Online e pronto para salvar automaticamente no Google Sheets.';
}

async function resetForm() {
  const confirmed = window.confirm('Limpar todos os dados preenchidos e o resultado atual?');
  if (!confirmed) return;

  form.reset();
  document.querySelector('#enviar-email').checked = true;
  compostagem.value = 0;
  compostagemOutput.value = '0 kg';
  productsContainer.replaceChildren();
  addProduct();
  currentCalculation = null;
  emptyResult.hidden = false;
  resultContent.hidden = true;
  resultStatus.textContent = 'Preencha os dados para calcular.';
  clearFormError();
  await clearDraft();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFormError();

  if (!form.reportValidity()) {
    showFormError('Preencha corretamente o nome, o e-mail e os demais campos obrigatórios.');
    return;
  }

  const originalButtonText = calculateButton.textContent;
  calculateButton.disabled = true;
  calculateButton.textContent = 'Calculando e salvando…';

  try {
    const data = collectFormData();
    currentCalculation = calculate(data);
    renderResult(currentCalculation);
    await saveDraft(data);
    await saveCalculationAutomatically(currentCalculation);
  } catch (error) {
    showFormError(error.message || 'Revise os valores informados.');
  } finally {
    calculateButton.disabled = false;
    calculateButton.textContent = originalButtonText;
  }
});

form.addEventListener('input', scheduleDraftSave);
form.addEventListener('change', scheduleDraftSave);
compostagem.addEventListener('input', () => {
  compostagemOutput.value = `${formatNumber(compostagem.value, 0)} kg`;
});
addProductButton.addEventListener('click', () => {
  addProduct();
  scheduleDraftSave();
});
clearButton.addEventListener('click', resetForm);
syncButton.addEventListener('click', async () => {
  await refreshBackendHealth();
  await flushQueue(true);
});
window.addEventListener('online', async () => {
  await refreshBackendHealth();
  await updateConnectionStatus();
  await flushQueue();
});
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
await refreshBackendHealth();
await updateConnectionStatus();
if (navigator.onLine) await flushQueue();
