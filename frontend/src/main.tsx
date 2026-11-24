import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/global.css';
import './styles/letter.css';

const root = document.getElementById('root')!;

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
