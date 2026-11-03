import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import { DeviceThemeProvider } from '../theme'
import LogcatApp from './LogcatApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceThemeProvider>
      <LogcatApp />
    </DeviceThemeProvider>
  </StrictMode>
)
