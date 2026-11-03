import EditorWindow from '../components/ScreenshotEditor/EditorWindow'

/**
 * 编辑窗应用根（plan 2026-11-02-screenshot-editor）：T4 起挂迁入的完整编辑器
 * （EditorWindow —— 工具条 + AnnotationStage 画布 + 产出链），取代 T3 的临时
 * 取图展示层。设备归属不经 renderer 自报：main 按 sender 登记表解析
 */
const ScreenshotEditorApp = (): React.JSX.Element => <EditorWindow />

export default ScreenshotEditorApp
