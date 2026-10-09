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
      <nav className="nav" aria-label="画像类别">
        {CATEGORY_ORDER.map((formFactor) => (
          <button
            key={formFactor}
            type="button"
            className="nav-button"
            aria-pressed={formFactor === category}
            onClick={() => onCategoryChange(formFactor)}
          >
            <span className="nav-label">{FORM_FACTOR_LABELS[formFactor]}</span>
            <span className="nav-count">{counts.get(formFactor) ?? 0}</span>
          </button>
        ))}
        {/* 官方源暂无弃用信号（types 注释在案）——开关随布局保留但禁用并说明，
            不冒充可用功能（review P3：死 UI 处置） */}
        <div className="deprecated-toggle" title="官方画像源暂无弃用标记，开关待信号源接入后开放">
          <input
            id="wizard-show-deprecated"
            type="checkbox"
            disabled
            checked={showDeprecated}
            readOnly
          />
          <label htmlFor="wizard-show-deprecated">显示弃用画像</label>
        </div>
      </nav>

      <div className="list-area">
        <div className="search-row">
          <Search size={14} aria-hidden="true" className="search-icon" />
          <input
            type="search"
            className="search-input"
            value={search}
            placeholder="搜索画像名称"
            aria-label="搜索画像名称"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>

        <div className="scroller">
          <div className="head-row" role="row">
            <div className="head-cell">名称</div>
            <div className="head-cell num">Play</div>
            <div className="head-cell num">API</div>
            <div className="head-cell num">宽</div>
            <div className="head-cell num">高</div>
            <div className="head-cell num">密度</div>
          </div>
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
              <div
                key={profile.id}
                className="row"
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
                <div className="row-name">
                  {profile.name}
                  {profile.creatable ? null : <span className="row-tag">不可创建</span>}
                  {profile.deprecated ? <span className="row-tag">已弃用</span> : null}
                </div>
                <div className="row-cell num">
                  {profile.playSupported === null ? '—' : profile.playSupported ? '✓' : '—'}
                </div>
                <div className="row-cell num">{apiRangeDisplay(profile)}</div>
                <div className="row-cell num">
                  {profile.screen.widthPx === null ? '—' : profile.screen.widthPx}
                </div>
                <div className="row-cell num">
                  {profile.screen.heightPx === null ? '—' : profile.screen.heightPx}
                </div>
                <div className="row-cell num">
                  {profile.screen.logicalDpi === null ? '—' : profile.screen.logicalDpi}
                </div>
              </div>
            ))}
          </div>
          {rows.length === 0 ? <p className="empty-hint">该类别下没有匹配的画像</p> : null}
        </div>
      </div>
    </Layout>
  )
}

const Layout = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;

  .nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 180px;
    flex: none;
    padding: 12px 8px;
    border-right: 1px solid var(--board-hairline);
  }

  .nav-button {
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
  }

  .nav-label {
    flex: 1;
    text-align: left;
  }

  .nav-count {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--board-ink-dim);
  }

  .deprecated-toggle {
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
  }

  .list-area {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
    padding: 12px 16px;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding-bottom: 10px;
  }

  .search-icon {
    color: var(--board-ink-dim);
  }

  .search-input {
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
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    border: 1px solid var(--board-hairline);
    border-radius: 4px;
    background: var(--board-bg);
  }

  .head-row {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    grid-template-columns: ${GRID_COLUMNS};
    background: var(--board-bg-raised);
    border-bottom: 1px solid var(--board-hairline);
  }

  .head-cell {
    padding: 7px 10px;
    color: var(--board-ink-dim);
    font-size: 11px;
    font-weight: 500;

    &.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }

  .row {
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
  }

  .row-name {
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
  }

  .row-tag {
    margin-left: 6px;
    padding: 1px 6px;
    border: 1px solid var(--board-hairline);
    border-radius: 999px;
    font-size: 10px;
    font-weight: 400;
    color: var(--board-ink-dim);
  }

  .row-cell {
    padding: 7px 10px;
    font-size: 12px;
    color: var(--board-ink);
    font-variant-numeric: tabular-nums;

    &.num {
      text-align: right;
    }
  }

  .empty-hint {
    margin: 0;
    padding: 16px 12px;
    font-size: 12px;
    color: var(--board-ink-dim);
  }
`

export default ProfilePage
