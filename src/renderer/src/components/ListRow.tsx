import styled from 'styled-components'

type ListRowProps = {
  title: string
  subtitle?: string
  /** 选中 = 整行强调色反白（DESIGN.md Inversion Rule），非描边非色条 */
  selected?: boolean
  onSelect?: () => void
}

/** 世界的原子：直角两行行式栅格，行间发丝线，可点选可键盘聚焦 */
const ListRow = ({
  title,
  subtitle,
  selected = false,
  onSelect
}: ListRowProps): React.JSX.Element => (
  <Wrapper type="button" aria-current={selected || undefined} onClick={onSelect}>
    <Title>{title}</Title>
    {subtitle ? <Subtitle $selected={selected}>{subtitle}</Subtitle> : null}
  </Wrapper>
)

const Wrapper = styled.button`
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 10px 12px;
  text-align: left;
  background: var(--board-bg);
  color: var(--board-ink);
  border: none;
  border-top: 1px solid var(--board-hairline);
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-bg-raised);
  }

  &[aria-current] {
    background: var(--accent);
    color: var(--accent-ink);
  }

  &[aria-current]:hover {
    background: var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`

const Title = styled.span`
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
`

const Subtitle = styled.span<{ $selected: boolean }>`
  font-size: 12px;
  line-height: 1.5;
  color: var(--board-ink-dim);

  ${({ $selected }) =>
    $selected &&
    `
      color: inherit;
      opacity: 0.72;
    `}
`

export default ListRow
