import styled from 'styled-components'
import { Search } from 'lucide-react'
import type { DeviceFormFactor, DeviceProfile } from '@shared/types'
import { FORM_FACTOR_LABELS, apiRangeDisplay } from './shared'

/**
 * 画像页主体：左类别导航（含「显示弃用画像」）+ 右搜索与单选表格。
 * 交互契约（plan 设计 3）：搜索只过滤不选中；更改类别清除不属于该类的选择；
 * 行是 role=button 的 grid 行——Tab/Enter 可选，↑↓ 在表格内移动焦点。
 */

const CATEGORY_ORDER: DeviceFormFactor[] = [
  'phone',
  'tablet',
  'wear',
  'desktop',
  'tv',
  'automotive',
  'unknown'
]

/** grid 列：名称弹性 + Play/API/宽/高/密度定宽（tabular-nums 对齐） */
const GRID_COLUMNS = 'minmax(200px, 1fr) 52px 64px 64px 64px 64px'

export interface ProfilePageProps {
  profiles: DeviceProfile[]
  category: DeviceFormFactor
  onCategoryChange: (category: DeviceFormFactor) => void
  search: string
  onSearchChange: (value: string) => void
  showDeprecated: boolean
  onShowDeprecatedChange: (value: boolean) => void
  selectedId: string | null
  onSelect: (profile: DeviceProfile) => void
}

const ProfilePage = ({
  profiles,
  category,
  onCategoryChange,
  search,
  onSearchChange,
  showDeprecated,
  onShowDeprecatedChange,
  selectedId,
  onSelect
}: ProfilePageProps): React.JSX.Element => {
  const counts = new Map<DeviceFormFactor, number>()
  for (const profile of profiles) {
    counts.set(profile.formFactor, (counts.get(profile.formFactor) ?? 0) + 1)
  }
  const keyword = search.trim().toLowerCase()
  const rows = profiles.filter((profile) => {
    if (profile.formFactor !== category) return false
    if (!showDeprecated && profile.deprecated) return false
    if (keyword.length > 0 && !profile.name.toLowerCase().includes(keyword)) return false
    return true
  })

  const moveFocus = (delta: number): void => {
    const focusedId = document.activeElement?.getAttribute('data-profile-id')
    const index = rows.findIndex((row) => row.id === focusedId)
    if (index === -1) return
    const next = rows[index + delta]
    if (next === undefined) return
    document.querySelector<HTMLDivElement>(`[data-profile-id="${CSS.escape(next.id)}"]`)?.focus()
  }

  return (
    <Layout>
      <Nav aria-label="画像类别">
        {CATEGORY_ORDER.map((formFactor) => (
          <NavButton
            key={formFactor}
            type="button"
            aria-pressed={formFactor === category}
            onClick={() => onCategoryChange(formFactor)}
          >
            <NavLabel>{FORM_FACTOR_LABELS[formFactor]}</NavLabel>
            <NavCount>{counts.get(formFactor) ?? 0}</NavCount>
          </NavButton>
        ))}
        <DeprecatedToggle>
          <input
            id="wizard-show-deprecated"
            type="checkbox"
            checked={showDeprecated}
            onChange={(event) => onShowDeprecatedChange(event.target.checked)}
          />
          <label htmlFor="wizard-show-deprecated">显示弃用画像</label>
        </DeprecatedToggle>
      </Nav>

      <ListArea>
        <SearchRow>
          <SearchIcon size={14} aria-hidden="true" />
          <SearchInput
            type="search"
            value={search}
            placeholder="搜索画像名称"
            aria-label="搜索画像名称"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </SearchRow>

        <Scroller>
          <HeadRow role="row">
            <HeadCell>名称</HeadCell>
            <HeadCell className="num">Play</HeadCell>
            <HeadCell className="num">API</HeadCell>
            <HeadCell className="num">宽</HeadCell>
            <HeadCell className="num">高</HeadCell>
            <HeadCell className="num">密度</HeadCell>
          </HeadRow>
          <div
            role="group"
            aria-label={`${FORM_FACTOR_LABELS[category]}画像`}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveFocus(1)
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveFocus(-1)
              }
            }}
          >
            {rows.map((profile) => (
              <Row
                key={profile.id}
                role="button"
                tabIndex={0}
                data-profile-id={profile.id}
                aria-pressed={profile.id === selectedId}
                onClick={() => onSelect(profile)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(profile)
                  }
                }}
              >
                <RowName>
                  {profile.name}
                  {profile.creatable ? null : <RowTag>不可创建</RowTag>}
                  {profile.deprecated ? <RowTag>已弃用</RowTag> : null}
                </RowName>
                <RowCell className="num">
                  {profile.playSupported === null ? '—' : profile.playSupported ? '✓' : '—'}
                </RowCell>
                <RowCell className="num">{apiRangeDisplay(profile)}</RowCell>
                <RowCell className="num">
                  {profile.screen.widthPx === null ? '—' : profile.screen.widthPx}
                </RowCell>
                <RowCell className="num">
                  {profile.screen.heightPx === null ? '—' : profile.screen.heightPx}
                </RowCell>
                <RowCell className="num">
                  {profile.screen.logicalDpi === null ? '—' : profile.screen.logicalDpi}
                </RowCell>
              </Row>
            ))}
          </div>
          {rows.length === 0 ? <EmptyHint>该类别下没有匹配的画像</EmptyHint> : null}
        </Scroller>
      </ListArea>
    </Layout>
  )
}

const Layout = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
`

const Nav = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 180px;
  flex: none;
  padding: 12px 8px;
  border-right: 1px solid var(--board-hairline);
`

const NavButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--board-ink);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
  }

  &[aria-pressed='true'] {
    background: var(--board-segment-selected-bg);
    color: var(--board-ink);
    font-weight: 600;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`

const NavLabel = styled.span`
  flex: 1;
  text-align: left;
`

const NavCount = styled.span`
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--board-ink-dim);
`

const DeprecatedToggle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--board-ink-dim);

  label {
    cursor: pointer;
  }

  input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const ListArea = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  padding: 12px 16px;
`

const SearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding-bottom: 10px;
`

const SearchIcon = styled(Search)`
  color: var(--board-ink-dim);
`

const SearchInput = styled.input`
  width: 260px;
  max-width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
  color: var(--board-ink);
  font-size: 12px;

  &::placeholder {
    color: var(--board-ink-dim);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
`

const Scroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border: 1px solid var(--board-hairline);
  border-radius: 4px;
  background: var(--board-bg);
`

const HeadRow = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: ${GRID_COLUMNS};
  background: var(--board-bg-raised);
  border-bottom: 1px solid var(--board-hairline);
`

const HeadCell = styled.div`
  padding: 7px 10px;
  color: var(--board-ink-dim);
  font-size: 11px;
  font-weight: 500;

  &.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
`

const Row = styled.div`
  display: grid;
  grid-template-columns: ${GRID_COLUMNS};
  align-items: center;
  cursor: pointer;
  transition: background-color 0.12s;

  &:hover {
    background: var(--board-hover-veil);
  }

  &[aria-pressed='true'] {
    background: var(--board-segment-selected-bg);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
`

const RowName = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const RowTag = styled.span`
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--board-hairline);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 400;
  color: var(--board-ink-dim);
`

const RowCell = styled.div`
  padding: 7px 10px;
  font-size: 12px;
  color: var(--board-ink);
  font-variant-numeric: tabular-nums;

  &.num {
    text-align: right;
  }
`

const EmptyHint = styled.p`
  margin: 0;
  padding: 16px 12px;
  font-size: 12px;
  color: var(--board-ink-dim);
`

export default ProfilePage
