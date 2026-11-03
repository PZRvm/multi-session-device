import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import { DeviceThemeProvider } from '../theme'
import ReportApp from './ReportApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceThemeProvider>
      <ReportApp />
    </DeviceThemeProvider>
  </StrictMode>
)
