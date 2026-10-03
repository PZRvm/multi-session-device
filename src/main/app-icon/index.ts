import { nativeImage } from 'electron'
import icon from '../../../resources/icon.png?asset'

export const appIcon = nativeImage.createFromPath(icon)
