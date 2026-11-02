import { nativeImage } from 'electron'
import icon from '../../../resources/icon.png?asset'
import windowsIcon from '../../../resources/icon-windows.png?asset'

export const appIcon = nativeImage.createFromPath(process.platform === 'win32' ? windowsIcon : icon)
