// 🔥 firebase-init.js — Firebase do painel (Analytics).
// Módulo ES: carregado com <script type="module">, por isso não bloqueia o painel.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';

// Configuração pública do Firebase (identificadores do projeto, não são segredos).
// A proteção real dos dados está nas regras do Firestore e nas restrições da API key.
const firebaseConfig = {
  apiKey: 'AIzaSyDdFQEgcHsLq8l61dEGMjY-34NbMY7zdlg',
  authDomain: 'miku-7415f.firebaseapp.com',
  projectId: 'miku-7415f',
  storageBucket: 'miku-7415f.firebasestorage.app',
  messagingSenderId: '760250524992',
  appId: '1:760250524992:web:bd47acb8658d57a32cc6a5',
  measurementId: 'G-6LDNFWG3Q8',
};

export const app = initializeApp(firebaseConfig);

// Analytics não funciona em localhost nem em browsers sem suporte: só ativa quando faz sentido.
const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (!local) {
  isSupported()
    .then((ok) => { if (ok) getAnalytics(app); })
    .catch(() => { /* sem analytics — o painel funciona na mesma */ });
}
