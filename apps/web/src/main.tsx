import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WebDesignSystemProvider } from "./designSystem"
import { TransientNoticeHost } from "./platform/TransientNoticeHost"

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WebDesignSystemProvider>
      <App />
      <TransientNoticeHost />
    </WebDesignSystemProvider>
  </StrictMode>,
)
