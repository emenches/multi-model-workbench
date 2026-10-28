import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n/context';
import { AppErrorBoundary } from './ui/AppErrorBoundary';
import './styles.css';
import './workbench.css';
import './mac-glass.css';
import { enableMacGlass } from './ui/macGlass';

// Only the bundled control WebView gets this presentation flag.
enableMacGlass(document.documentElement, navigator.platform, navigator.userAgent);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider language="system">
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </I18nProvider>
  </React.StrictMode>,
);
