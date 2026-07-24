import { APP_CONFIG } from './config.js';

export function isEndpointConfigured() {
  return Boolean(APP_CONFIG.apiEndpoint);
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

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('O servidor retornou uma resposta inválida.');
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message || `O servidor respondeu com o código ${response.status}.`);
  }

  return data;
}
