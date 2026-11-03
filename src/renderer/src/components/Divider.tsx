import styled from 'styled-components'

type DividerProps = {
  /** horizontal = 区块间水平发丝线；vertical = 分栏垂直发丝线 */
  orientation?: 'horizontal' | 'vertical'
}

/** 分组分隔的唯一手段：1px 发丝线（DESIGN.md Hairline Rule），不用间距不用阴影 */
const Divider = ({ orientation = 'horizontal' }: DividerProps): React.JSX.Element => (
  <Wrapper $orientation={orientation} />
)

const Wrapper = styled.hr<{ $orientation: 'horizontal' | 'vertical' }>`
  border: none;
  margin: 8px 0;
  flex: none;

  ${({ $orientation }) =>
    $orientation === 'horizontal'
      ? `
        width: 100%;
        border-top: 1px solid var(--board-hairline);
      `
      : `
        align-self: stretch;
        border-left: 1px solid var(--board-hairline);
      `}
`

export default Divider
