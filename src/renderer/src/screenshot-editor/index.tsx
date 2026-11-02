import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/global.css'
import { DeviceThemeProvider } from '../theme'
import ScreenshotEditorApp from './ScreenshotEditorApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeviceThemeProvider>
      <ScreenshotEditorApp />
    </DeviceThemeProvider>
  </StrictMode>
)
