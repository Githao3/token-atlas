/**
 * Token Atlas 标志的几何：三根等距投影（2:1 dimetric）的柱子，前高后低，
 * 是 3D Lab 里 Token Landscape 的缩影。
 *
 * 坐标系是 100×100，和 resources/icon.svg 用的是同一套数字 —— 那个文件是
 * 生成 .ico / .png 的源，改这里要同步改它（反之亦然）。
 *
 * 每根柱子三个面：顶面菱形最亮，右面次之，左面最暗。不打光靠明度差出体积，
 * 和 ThreeDLab 烘焙顶点色的约定一致。
 */
export type Face = { points: string; shade: 'top' | 'right' | 'left' }

/** 由后到前，前面的柱子要盖住后面的，所以顺序不能变。 */
export const LOGO_FACES: Face[] = [
  // 后：最矮
  { points: '59,34 72,40.5 72,60.5 59,54', shade: 'left' },
  { points: '85,34 72,40.5 72,60.5 85,54', shade: 'right' },
  { points: '72,27.5 85,34 72,40.5 59,34', shade: 'top' },
  // 中
  { points: '43,32 56,38.5 56,68.5 43,62', shade: 'left' },
  { points: '69,32 56,38.5 56,68.5 69,62', shade: 'right' },
  { points: '56,25.5 69,32 56,38.5 43,32', shade: 'top' },
  // 前：最高
  { points: '27,28 40,34.5 40,76.5 27,70', shade: 'left' },
  { points: '53,28 40,34.5 40,76.5 53,70', shade: 'right' },
  { points: '40,21.5 53,28 40,34.5 27,28', shade: 'top' }
]

export const LOGO_OPACITY: Record<Face['shade'], number> = {
  top: 1,
  right: 0.72,
  left: 0.42
}
