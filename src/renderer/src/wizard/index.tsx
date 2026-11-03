import '../styles/global.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import WizardApp from './WizardApp'
import { DeviceThemeProvider } from '../theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceThemeProvider>
      <WizardApp />
    </DeviceThemeProvider>
  </StrictMode>
)
