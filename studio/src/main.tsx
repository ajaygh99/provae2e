import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RouterProvider } from './router';
import { WorkspaceProvider } from './workspace/WorkspaceContext';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('PROVA Studio root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <WorkspaceProvider>
      <RouterProvider>
        <App />
      </RouterProvider>
    </WorkspaceProvider>
  </StrictMode>
);
