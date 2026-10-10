import { keyframes } from 'styled-components'

/** 旋转加载动画单源 keyframes：各组件自定时长消费（如 spin 1.2s / 0.9s），不再各写一份 */
export const spinKeyframes = keyframes`
  to {
    transform: rotate(360deg);
  }
`
