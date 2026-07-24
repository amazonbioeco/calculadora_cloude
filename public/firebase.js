import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import { getAnalytics, isSupported, logEvent } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-analytics.js';
import { FIREBASE_CONFIG } from './config.js';

async function initializeFirebase() {
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    window.firebaseApp = app;

    if (await isSupported()) {
      const analytics = getAnalytics(app);
      window.firebaseAnalytics = analytics;
      window.firebaseLogEvent = (name, parameters = {}) => logEvent(analytics, name, parameters);
    }

    window.dispatchEvent(new CustomEvent('firebase:ready', { detail: { app } }));
  } catch (error) {
    console.warn('Firebase não foi inicializado. A calculadora continuará funcionando.', error);
    window.dispatchEvent(new CustomEvent('firebase:error', { detail: { error } }));
  }
}

initializeFirebase();
