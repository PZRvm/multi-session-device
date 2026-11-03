import '../styles/global.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import WirelessApp from './WirelessApp'
import { DeviceThemeProvider } from '../theme'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceThemeProvider>
      <WirelessApp />
    </DeviceThemeProvider>
  </StrictMode>
)
