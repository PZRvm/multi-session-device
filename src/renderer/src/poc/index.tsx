import '../styles/global.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PocApp from './PocApp'

// PoC dev 页：不走主题与设计规范（dev 工具页，非用户界面）
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PocApp />
  </StrictMode>
)
