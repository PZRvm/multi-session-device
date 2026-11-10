import { useEffect, useMemo, useRef, useState } from 'react'
import { Eraser, ExternalLink, Pause, Play } from 'lucide-react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import { useCopy } from '../hooks/useCopy'
import { useLogcatFeed } from '../hooks/useLogcatFeed'
import { PopoverIconButton } from './PopoverIconButton'

type LogcatPanelProps = {
  deviceId: string | null
  runId?: string | null
  /** dock 模式提供（弹出独立日志窗）；日志窗内不显示弹出入口 */
  onPopOut?: () => void
}

/** 日志面板：关键字过滤 + 暂停/继续 + 清空视图；dock 与独立日志窗共用 */
const LogcatPanel = ({ deviceId, runId, onPopOut }: LogcatPanelProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const [filter, setFilter] = useState('')
  const feed = useLogcatFeed(deviceId, runId)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)

  const keyword = filter.trim().toLowerCase()
  const visible = useMemo(() => {
    if (keyword.length === 0) return feed.entries
    return feed.entries.filter(
      (entry) => entry.kind === 'gap' || entry.text.toLowerCase().includes(keyword)
    )
  }, [feed.entries, keyword])

  // 贴底跟随：用户上滚即停更，回到底部恢复（暂停/清空后重置为贴底）
  useEffect(() => {
    if (atBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visible])

  const handleScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    atBottomRef.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 8
  }

  const handleClear = (): void => {
    feed.clear()
    atBottomRef.current = true
  }

  return (
    <Wrapper>
      <div className="panel-bar">
        <input
          className="filter"
          type="text"
          value={filter}
          placeholder={copy.logcatFilterPlaceholder}
          aria-label={copy.logcatFilterPlaceholder}
          onChange={(event) => setFilter(event.target.value)}
        />
        <PopoverIconButton
          className="bar-btn"
          icon={feed.paused ? <Play size={14} /> : <Pause size={14} />}
          label={feed.paused ? copy.logcatResume : copy.logcatPause}
          pressed={feed.paused}
          onClick={feed.togglePaused}
        />
        <PopoverIconButton
          className="bar-btn"
          icon={<Eraser size={14} />}
          label={copy.logcatClear}
          onClick={handleClear}
        />
        {onPopOut ? (
          <PopoverIconButton
            className="bar-btn"
            icon={<ExternalLink size={14} />}
            label={copy.logcatPopOut}
            onClick={onPopOut}
          />
        ) : null}
      </div>
      {feed.error ? (
        <p className="feed-error" role="alert">
          {feed.error}
        </p>
      ) : null}
      <div
        className="lines"
        role="log"
        aria-label={copy.logcatTitle}
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {visible.length === 0 && feed.error === null ? (
          <p className="empty">{deviceId ? copy.logcatEmpty : copy.logcatNoDevice}</p>
        ) : (
          visible.map((entry, index) =>
            entry.kind === 'gap' ? (
              <p key={`gap-${index}`} className="gap">
                {entry.count === null
                  ? copy.logcatResumed
                  : format(copy.logcatDroppedLines, { count: entry.count })}
              </p>
            ) : (
              <div key={entry.seq} className="line">
                {entry.text}
              </div>
            )
          )
        )}
      </div>
    </Wrapper>
  )
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--board-bg-raised);

  .panel-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    padding: 8px 10px;
    border-bottom: 1px solid var(--board-hairline);

    .filter {
      flex: 1;
      min-width: 0;
      height: 26px;
      padding: 0 8px;
      border: 1px solid var(--board-hairline);
      border-radius: 6px;
      background: var(--board-bg);
      color: var(--board-ink);
      font-size: 12px;

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }

    .bar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      flex: none;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--board-ink);
      cursor: pointer;
      transition: background-color 0.12s;

      &:hover {
        background: var(--board-hover-veil);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
  }

  .feed-error {
    flex: none;
    margin: 0;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--board-ink-dim);
    border-bottom: 1px solid var(--board-hairline);
  }

  .lines {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 0;

    .line {
      padding: 0 10px;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
      font-size: 11px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--board-ink);
      /* 日志是可复制的数据文本——全局禁选下局部回开 */
      user-select: text;
    }

    .gap {
      margin: 2px 0;
      padding: 0 10px;
      font-size: 11px;
      color: var(--board-ink-dim);
    }

    .empty {
      padding: 24px 10px;
      font-size: 12px;
      color: var(--board-ink-dim);
      text-align: center;
    }
  }
`

export default LogcatPanel
