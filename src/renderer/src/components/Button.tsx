import styled from 'styled-components'

type ButtonVariant = 'primary' | 'ghost'

type ButtonProps = React.ComponentPropsWithoutRef<'button'> & {
  /** primary = 强调色实底（大面积信号，屏幕唯一）；ghost = 中性描边钮（DESIGN.md 按钮） */
  variant?: ButtonVariant
}

const stylesByVariant: Record<ButtonVariant, string> = {
  primary: `
    background: var(--accent);
    color: var(--accent-ink);
    border: none;

    &:hover {
      background: var(--accent-strong);
    }

    &:active {
      background: var(--accent-press);
    }
  `,
  ghost: `
    background: transparent;
    color: var(--board-ink);
    border: 1px solid var(--board-control-line);
    font-weight: 400;

    &:hover {
      background: var(--board-hover-veil);
      border-color: var(--board-ink-dim);
    }
  `
}

const Button = ({
  variant = 'ghost',
  type = 'button',
  children,
  ...rest
}: ButtonProps): React.JSX.Element => (
  <Wrapper $variant={variant} type={type} {...rest}>
    {children}
  </Wrapper>
)

const Wrapper = styled.button<{ $variant: ButtonVariant }>`
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  cursor: pointer;
  transition:
    background-color 0.12s,
    border-color 0.12s;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* 禁用态视觉（逻辑禁用由调用方负责，如向导未选列表项时）：降不透明度 + 不吃指针
     ——hover/active 变体样式随之失效，无需逐变体压制；口径同 BoardHead 设置钮 0.45 */
  &:disabled {
    opacity: 0.45;
    pointer-events: none;
  }

  ${({ $variant }) => stylesByVariant[$variant]}
`

export default Button
