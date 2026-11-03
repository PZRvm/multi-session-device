import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import { DeviceThemeProvider } from '../theme'
import SettingsApp from './SettingsApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceThemeProvider>
      <SettingsApp />
    </DeviceThemeProvider>
  </StrictMode>
)
