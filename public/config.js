export const APP_CONFIG = Object.freeze({
  appName: 'Calculadora de Carbono AmazonBioEco',
  modelVersion: '1.3.0',
  apiEndpoint: '/api/calculations',
  healthEndpoint: '/healthz',
  backendHealthEndpoint: '/api/backend-health',
  appUrl: globalThis.location?.origin || '',
  databaseName: 'amazonbioeco-carbono',
  queueStore: 'syncQueue',
  draftStore: 'drafts',
  maxSyncAttempts: 8,
  syncBaseDelayMs: 2500
});

// Configuração pública do Firebase usada somente para Firebase App e Analytics.
// Não contém senha nem credencial administrativa.
export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyANWRt-xe1qq7rEbKzv36qWoSge0o2fmN8',
  authDomain: 'paul-singer-formulario.firebaseapp.com',
  projectId: 'paul-singer-formulario',
  storageBucket: 'paul-singer-formulario.firebasestorage.app',
  messagingSenderId: '219583700876',
  appId: '1:219583700876:web:66c92b4ee30a38abe8c0a9',
  measurementId: 'G-M2JGPBZ7MC'
});
