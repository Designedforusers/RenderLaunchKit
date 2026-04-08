import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { ToastProvider } from './components/ui/index.js';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error(
    'Dashboard root element #root not found. The dashboard build is broken — index.html should always contain it.'
  );
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
