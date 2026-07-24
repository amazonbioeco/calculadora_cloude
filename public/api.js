import { APP_CONFIG } from './config.js';

export function isEndpointConfigured() {
  return Boolean(APP_CONFIG.apiEndpoint);
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O servidor retornou uma resposta inválida. Verifique a implantação do Cloud Run e do Apps Script.');
  }
  return data;
}

export async function sendCalculation(payload) {
  const response = await fetch(APP_CONFIG.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8'
    },
    body: JSON.stringify({ action: 'saveCalculation', payload }),
    cache: 'no-store',
    credentials: 'same-origin'
  });

  const data = await parseJsonResponse(response);
  if (!response.ok || !data?.success) {
    throw new Error(data?.message || `O servidor respondeu com o código ${response.status}.`);
  }
  return data;
}

export async function getBackendHealth() {
  const response = await fetch(APP_CONFIG.backendHealthEndpoint, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin'
  });
  const data = await parseJsonResponse(response);
  return {
    ...data,
    httpOk: response.ok
  };
}
