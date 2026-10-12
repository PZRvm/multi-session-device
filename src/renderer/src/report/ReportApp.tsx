import { useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { MAIN_COPY, format } from '@shared/i18n'
import type { ReconcileReport } from '@shared/types'
import { toApiResult } from '../api'
import { useCopy } from '../hooks/useCopy'
import Button from '../components/Button'

type ReportPhase =
  | { phase: 'loading' }
  | { phase: 'ready'; report: ReconcileReport | null }
  | { phase: 'error'; message: string }

export interface ReportAppProps {
  /** 测试注入的报告通道（缺省走 preload 桥） */
  fetchReport?: () => Promise<ReconcileReport | null>
}

/**
 * 对账报告完整查看面板（plan 2026-10-12-reconcile-report-panel）：打开即拉一次
 * 完整报告、分组滚动渲染——超长明细不再受原生弹窗 40 行截断限制（截断防线
 * 仍服务其他弹窗）。只读（设计轴 2）：重新检查在汇总条，重开面板即新报告。
 */
const ReportApp = ({ fetchReport }: ReportAppProps): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const [state, setState] = useState<ReportPhase>({ phase: 'loading' })
  const generationRef = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    setState({ phase: 'loading' })
    try {
      const api = fetchReport ?? window.api.devices.reconciliationReport
      const report = await api()
      if (generationRef.current !== generation) return
      setState({ phase: 'ready', report })
    } catch (cause) {
      if (generationRef.current !== generation) return
      setState({
        phase: 'error',
        message: cause instanceof Error ? cause.message : String(cause)
      })
    }
  }, [fetchReport])

  useEffect(() => {
    // 打开即拉取的外部系统同步：load 首行同步置 loading 服务重试路径；初挂时
    // 状态本就是 loading，一次写入即停，不构成级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初态即 loading，同步置位仅重试需要
    void load()
  }, [load])

  return (
    <ReportLayout>
      {state.phase === 'loading' ? (
        <p className="report-line">{copy.reportLoading}</p>
      ) : state.phase === 'error' ? (
        <div role="alert">
          <p className="report-line report-error">
            {format(copy.reportLoadFailed, { message: state.message })}
          </p>
          <Button variant="ghost" onClick={() => void load()}>
            {copy.reportRetry}
          </Button>
        </div>
      ) : state.report === null || !hasAnyIssue(state.report) ? (
        <p className="report-line">{copy.noAbnormalRecords}</p>
      ) : (
        <ReportBody report={state.report} />
      )}
    </ReportLayout>
  )
}

const hasAnyIssue = (report: ReconcileReport): boolean =>
  report.storeHealth.state !== 'ok' ||
  report.storeHealth.issues.length > 0 ||
  report.deviceIssues.some((entry) => entry.availability.issues.length > 0) ||
  report.orphanEntries.length > 0 ||
  report.unrecognizedCount > 0 ||
  report.scanError !== null

const ReportBody = ({ report }: { report: ReconcileReport }): React.JSX.Element => {
  const copy = useCopy(MAIN_COPY)
  const [showError, setShowError] = useState<string | null>(null)
  return (
    <ReportLayout>
      {report.checkedAt !== null ? (
        <p className="report-line report-meta">
          {format(copy.lastChecked, {
            time: new Date(report.checkedAt).toLocaleString()
          })}
        </p>
      ) : null}

      {report.storeHealth.state !== 'ok' || report.storeHealth.issues.length > 0 ? (
        <section>
          <h3>{copy.reportGroupMetadata}</h3>
          {report.storeHealth.state !== 'ok' && report.storeHealth.issues.length === 0 ? (
            <p className="report-line">{copy.metadataReadFailed}</p>
          ) : (
            report.storeHealth.issues.map((issue, index) => (
              <p className="report-line" key={`${issue.code}-${index}`}>
                {format(copy.metadataIssue, { message: issue.message })}
              </p>
            ))
          )}
        </section>
      ) : null}

      {report.deviceIssues.some((entry) => entry.availability.issues.length > 0) ? (
        <section>
          <h3>{copy.reportGroupDevices}</h3>
          {report.deviceIssues.map((entry) =>
            entry.availability.issues.map((issue, index) => (
              <p className="report-line" key={`${entry.id}-${issue.component}-${index}`}>
                {format(copy.deviceIssueLine, {
                  name: entry.name,
                  component: issue.component === 'image' ? copy.componentImage : copy.componentAvd,
                  message: issue.message
                })}
              </p>
            ))
          )}
        </section>
      ) : null}

      {report.orphanEntries.length > 0 ? (
        <section>
          <h3>{copy.reportGroupOrphans}</h3>
          {showError !== null ? <p className="report-line report-error">{showError}</p> : null}
          {report.orphanEntries.map((orphan) => (
            <div className="orphan-row" key={orphan.id}>
              <p className="report-line">
                {format(copy.orphanGroup, { id: orphan.id, detail: orphan.detail })}
              </p>
              <div className="orphan-actions">
                <button
                  type="button"
                  className="finder-btn"
                  onClick={() => {
                    void toApiResult(window.api.dialog.showItemInFolder(orphan.path)).then(
                      (result) => {
                        if (!result.ok) setShowError(result.error)
                      }
                    )
                  }}
                >
                  {copy.showInFinder}
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {report.unrecognizedCount > 0 || report.scanError !== null ? (
        <section>
          <h3>{copy.reportGroupOther}</h3>
          {report.unrecognizedCount > 0 ? (
            <p className="report-line">
              {format(copy.unrecognizedFiles, { count: report.unrecognizedCount })}
            </p>
          ) : null}
          {report.scanError !== null ? (
            <p className="report-line">{format(copy.scanIssue, { message: report.scanError })}</p>
          ) : null}
        </section>
      ) : null}
    </ReportLayout>
  )
}

const ReportLayout = styled.div`
  /* 间距（用户反馈二轮）：上下加足、左右收窄 */
  padding: 20px 12px 28px;

  .orphan-row {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
  }

  .orphan-row .report-line {
    align-self: stretch;
  }

  /* 报告行是可复制的排查数据（含路径/详情原文）——全局禁选下局部回开 */
  .report-line {
    user-select: text;
  }

  .orphan-actions {
    display: flex;
    justify-content: flex-end;
  }

  .finder-btn {
    flex: none;
    min-height: 26px;
    padding: 2px 10px;
    border: 1px solid var(--board-control-line);
    border-radius: 4px;
    background: transparent;
    color: var(--board-ink);
    font-size: 12px;
    cursor: pointer;

    &:hover {
      background: var(--board-hover-veil);
    }
  }

  section {
    /* 分组之间与首组之上的呼吸（用户反馈三轮） */
    margin: 18px 0 0;
  }

  h3 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 700;
    color: var(--board-ink);
  }

  .report-line {
    margin: 3px 0;
    font-size: 12px;
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .report-meta {
    color: var(--board-ink-dim);
  }

  .report-error {
    color: var(--danger);
  }
`

export default ReportApp
