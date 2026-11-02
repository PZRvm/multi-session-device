import styled from 'styled-components'

/**
 * 截图编辑窗外壳（plan 2026-11-02-screenshot-editor T4）：源 app.css 的
 * .chrome-capture-editor-* 完整段（3013—3421）迁入 styled Wrapper——类名原样
 * 保留（组件 markup 与源逐行同构），规则以 & 嵌套收进组件作用域。
 *
 * token 接缝（源 --chrome-* 族昼夜双值 ← 本项目 board 系 token，主题链路
 * themeCssVariables 全量覆盖自动跟随）：toolbar=bg-raised、line=hairline、
 * ink/ink-dim/error=board-ink/-dim/danger、hover-veil=board-hover-veil；
 * 本项目无同名 pressed-veil（退化同 hover-veil，键盘焦点与悬停同视觉无功能
 * 损失）、select-veil 取 accent-veil（主色薄纱选中语义）、disabled 取
 * scrollbar-thumb（「弱化灰」语义位，昼夜双值齐备）。cropbtn 主色钮
 * --accent-strong/--accent-ink 本项目同名 token 直用。
 *
 * 与源的两处段内差异：body[data-role] 背景并入根规则（height:100vh + 窗底
 * 色，本项目入口无 data-role 链）；.chrome-capture-editor-glyph-circle 段不迁
 * （源是 antd 图集无 Circle 的兜底字形，本项目 lucide 有 Circle 图标——图标
 * 单源回正，差异记录见 plan T4 diff 清单）。
 *
 * 窄窗反馈修复（2026-11-02 用户反馈，源同款缺陷、源未修）：竖屏截图窗宽可低
 * 至 360px，源单行工具条溢出堆叠、马赛克双模式等文字钮被压缩后中文折行破版。
 * 本仓新增三处局部规则（详见各段注）：topbar/toolbar 允许 wrap、toolgroup 与
 * sect 按组原子换行（结构配合见 EditorToolbar 头注）、文字钮 flex:none +
 * nowrap 禁压字。单行宽窗下视觉与源一致。
 */
export const EditorShell = styled.div`
  --chrome-toolbar: var(--board-bg-raised);
  --chrome-line: var(--board-hairline);
  --chrome-ink: var(--board-ink);
  --chrome-ink-dim: var(--board-ink-dim);
  --chrome-error: var(--danger);
  --chrome-hover-veil: var(--board-hover-veil);
  --chrome-pressed-veil: var(--board-hover-veil);
  --chrome-select-veil: var(--accent-veil);
  --chrome-disabled: var(--board-scrollbar-thumb);

  /* 源 body[data-role='capture-editor'] 背景并入：窗根即窗底（#root 无高度链，100vh 铺满） */
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--chrome-toolbar);
  color: var(--chrome-ink);

  /* 取图空态/失败态：居中单行（loading 或如实错误文案） */
  &.chrome-capture-editor-boot {
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--chrome-ink-dim);
  }

  & .chrome-capture-editor-boot-error {
    color: var(--chrome-error);
  }

  /* 顶部工具条行：左侧工具/档位/色板/撤销重做，右端产出钮组（margin-left auto
     吸收余宽——产出钮保持窗右上角，与工具条同一组视觉带）。
     窄窗反馈修复：wrap + row-gap——空间不足时产出钮组整体落到下一行右贴，
     不与工具条互压堆叠；padding 上下 4px 给换行后的两行留呼吸（单行时
     min-height 48 兜住，视觉不变） */
  & .chrome-capture-editor-topbar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    row-gap: 4px;
    min-height: 48px;
    padding: 4px 8px;
    box-sizing: border-box;
    background: var(--chrome-toolbar);
    border-bottom: 1px solid var(--chrome-line);
  }

  /* 窄窗反馈修复：wrap + row-gap——组放不下时整组下移换行，不再溢出窗宽；
     单行时 row-gap 不参与，视觉与源一致 */
  & .chrome-capture-editor-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    row-gap: 4px;
    min-width: 0;
  }

  /* 窄窗反馈修复：换行的原子单位——七工具钮（toolgroup）与各设置组连前置
     分隔线（sect，结构见 EditorToolbar）各自 flex:none 成段。换行只发生在
     段与段之间，组内钮不被拆散、分隔线不悬空在行尾 */
  & .chrome-capture-editor-toolgroup,
  & .chrome-capture-editor-sect {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: none;
  }

  /* 图标钮基配方：28px 圆形、灰阶蒙版阶梯、focus 灰阶化（强调色不进右侧）；
     选中态（.is-active）select-veil 底 + 正墨 */
  & .chrome-capture-editor-iconbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--chrome-ink-dim);
    font-size: 16px;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  & .chrome-capture-editor-iconbtn:disabled {
    color: var(--chrome-disabled);
    cursor: not-allowed;
  }

  & .chrome-capture-editor-iconbtn:not(:disabled):hover {
    background: var(--chrome-hover-veil);
    color: var(--chrome-ink);
  }

  & .chrome-capture-editor-iconbtn:focus-visible {
    outline: none;
  }

  & .chrome-capture-editor-iconbtn:not(:disabled):focus-visible {
    background: var(--chrome-pressed-veil);
    color: var(--chrome-ink);
  }

  & .chrome-capture-editor-iconbtn.is-active,
  & .chrome-capture-editor-iconbtn.is-active:not(:disabled):hover,
  & .chrome-capture-editor-iconbtn.is-active:not(:disabled):focus-visible {
    background: var(--chrome-select-veil);
    color: var(--chrome-ink);
  }

  /* 工具组间竖分隔线 */
  & .chrome-capture-editor-sep {
    flex: none;
    width: 1px;
    height: 20px;
    margin: 0 6px;
    background: var(--chrome-line);
  }

  /* 档位选择器（细/中/粗）：共用图标钮配方，内容为递增圆点（显示像素 6/8/10） */
  & .chrome-capture-editor-weight {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  & .chrome-capture-editor-weightdot {
    display: block;
    border-radius: 50%;
    background: currentColor;
  }

  /* 色板：六色圆点 16px；白/黑点靠 line 描边立界，选中态双环（toolbar 底空隙 +
     ink 外环） */
  & .chrome-capture-editor-palette {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px;
  }

  & .chrome-capture-editor-colorbtn {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--chrome-line);
    border-radius: 50%;
    cursor: pointer;
  }

  & .chrome-capture-editor-colorbtn.is-active {
    box-shadow:
      0 0 0 2px var(--chrome-toolbar),
      0 0 0 3px var(--chrome-ink);
  }

  & .chrome-capture-editor-colorbtn:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--chrome-toolbar),
      0 0 0 3px var(--chrome-ink-dim);
  }

  /* 文字字号档（仅文字工具激活时显示）：文字型小钮，tabular-nums 对位 */
  & .chrome-capture-editor-fontsizes {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  & .chrome-capture-editor-fontbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    height: 28px;
    min-width: 28px;
    padding: 0 6px;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: var(--chrome-ink-dim);
    font-family: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  & .chrome-capture-editor-fontbtn:not(:disabled):hover {
    background: var(--chrome-hover-veil);
    color: var(--chrome-ink);
  }

  & .chrome-capture-editor-fontbtn:focus-visible {
    outline: none;
  }

  & .chrome-capture-editor-fontbtn.is-active,
  & .chrome-capture-editor-fontbtn.is-active:hover,
  & .chrome-capture-editor-fontbtn.is-active:focus-visible {
    background: var(--chrome-select-veil);
    color: var(--chrome-ink);
  }

  /* 右端产出钮组 + inline 成功反馈短文案（2.5s 淡出，不弹浮层不自动关窗） */
  & .chrome-capture-editor-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  & .chrome-capture-editor-flash {
    margin-right: 6px;
    font-size: 12px;
    color: var(--chrome-ink-dim);
    white-space: nowrap;
    /* 窄窗反馈修复：下载文件名可达两百余像素——窄窗下限宽 + 省略号，不把工具条
       挤成三行、不与产出钮互压 */
    min-width: 0;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: opacity 0.45s ease;
  }

  & .chrome-capture-editor-flash.is-fading {
    opacity: 0;
  }

  /* 窗内错误条（取图失败/产出失败/对账过期如实呈现，留在编辑态） */
  & .chrome-capture-editor-errorbar {
    flex: none;
    padding: 4px 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--chrome-error);
    background: var(--chrome-toolbar);
    border-bottom: 1px solid var(--chrome-line);
  }

  /* 中部画布区：居中 + checker 底（图像边界可辨；hover-veil 两次 45° 铺贴出隐
     格），窗比画布小时滚动承接 */
  & .chrome-capture-editor-canvas {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    background-color: var(--chrome-toolbar);
    background-image:
      linear-gradient(
        45deg,
        var(--chrome-hover-veil) 25%,
        transparent 25%,
        transparent 75%,
        var(--chrome-hover-veil) 75%
      ),
      linear-gradient(
        45deg,
        var(--chrome-hover-veil) 25%,
        transparent 25%,
        transparent 75%,
        var(--chrome-hover-veil) 75%
      );
    background-size: 16px 16px;
    background-position:
      0 0,
      8px 8px;
  }

  /* Stage 容器：相对定位承载文本 textarea 与裁剪确认浮层的绝对定位 */
  & .chrome-capture-editor-stage {
    position: relative;
    flex: none;
  }

  & .chrome-capture-editor-stage canvas {
    display: block;
  }

  /* 文本输入浮层（Konva 官方可编辑文本模式：canvas 上叠 DOM textarea 承接 IME）：
     透明底、虚线描边随当前色、行高 1 对齐 Konva Text 度量；尺寸/位置/字号/颜色
     由组件 inline style 注入（随显示缩放换算） */
  & .chrome-capture-editor-textinput {
    position: absolute;
    z-index: 5;
    margin: 0;
    padding: 0 1px;
    min-width: 40px;
    border: 1px dashed currentColor;
    border-radius: 0;
    background: transparent;
    outline: none;
    resize: none;
    overflow: hidden;
    white-space: pre;
    line-height: 1;
    user-select: text;
  }

  /* 裁剪确认/取消浮层（DOM 绝对定位在选区下方，画布放不下时移到选区上方） */
  & .chrome-capture-editor-cropbar {
    position: absolute;
    z-index: 6;
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 4px;
    background: var(--chrome-toolbar);
    border: 1px solid var(--chrome-line);
  }

  & .chrome-capture-editor-cropbtn {
    height: 22px;
    padding: 0 10px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--chrome-ink-dim);
    font-family: inherit;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color 0.12s ease,
      color 0.12s ease;
  }

  & .chrome-capture-editor-cropbtn:hover,
  & .chrome-capture-editor-cropbtn:focus-visible {
    background: var(--chrome-hover-veil);
    color: var(--chrome-ink);
  }

  & .chrome-capture-editor-cropbtn:focus-visible {
    outline: none;
  }

  /* 确认/取消配色：确认 = 主题主色实底 + 深主题字（板面主钮同款供色）；取消 =
     红色（error 同源红字透明底，与确认实底成主次） */
  & .chrome-capture-editor-cropbtn.is-primary {
    background: var(--accent-strong);
    color: var(--accent-ink);
    font-weight: 600;
  }

  & .chrome-capture-editor-cropbtn.is-primary:hover,
  & .chrome-capture-editor-cropbtn.is-primary:focus-visible {
    background: var(--accent-strong);
    color: var(--accent-ink);
    opacity: 0.88;
  }

  & .chrome-capture-editor-cropbtn.is-danger {
    color: var(--chrome-error);
  }

  & .chrome-capture-editor-cropbtn.is-danger:hover,
  & .chrome-capture-editor-cropbtn.is-danger:focus-visible {
    background: var(--chrome-hover-veil);
    color: var(--chrome-error);
  }

  /* darwin 无标题条形态（本项目 hiddenInset 同样无标题条——对齐 WirelessConnector
     先例）：顶部工具条整条承担窗口拖动（app-region drag），工具条与产出钮组
     no-drag；左让原生三灯位（本项目三灯 {x:14,y:12}，灯组右缘约 x=66，让位
     80px 同 LogcatApp/WirelessConnector 口径）。win/linux 有系统框不启用 */
  &.chrome-capture-editor-chrome-custom .chrome-capture-editor-topbar {
    -webkit-app-region: drag;
    padding-left: 80px;
  }

  &.chrome-capture-editor-chrome-custom .chrome-capture-editor-toolbar,
  &.chrome-capture-editor-chrome-custom .chrome-capture-editor-actions {
    -webkit-app-region: no-drag;
  }

  /* 马赛克双模式切换（画笔涂抹/选区框选）：文字型小切换钮（同字号档按钮语系），
     仅马赛克工具激活时呈现 */
  & .chrome-capture-editor-mosaicmodes {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  & .chrome-capture-editor-modebtn {
    border: none;
    background: transparent;
    padding: 0 8px;
    height: 24px;
    /* 窄窗反馈修复：flex:none + nowrap——被压缩时中文不再按字折行破版
       （「画笔涂抹/选区框选」挤成两行），空间不足交给整组换行 */
    flex: none;
    white-space: nowrap;
    border-radius: 4px;
    font-family: inherit;
    font-size: 12px;
    color: var(--chrome-ink-dim);
    cursor: pointer;
    transition: color 0.12s ease;
  }

  & .chrome-capture-editor-modebtn:hover {
    color: var(--chrome-ink);
  }

  & .chrome-capture-editor-modebtn.is-active {
    background: var(--chrome-hover-veil);
    color: var(--chrome-ink);
    font-weight: 600;
  }
`
