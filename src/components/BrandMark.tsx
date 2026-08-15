import { LOGO_FACES, LOGO_OPACITY } from '../lib/logo'

/**
 * 侧栏品牌标志。几何来自 lib/logo.ts，这里只负责上色：
 * 渐变底片留在 CSS（`.brand .mark`）里，因为它要跟着主题走 —— 深色是蓝→紫，
 * 浅色是砖红；柱体一律白色，两套底色上都立得住。
 */
export function BrandMark() {
  return (
    <div className="mark" aria-hidden="true">
      <svg viewBox="0 0 100 100" focusable="false">
        {LOGO_FACES.map((f, i) => (
          <polygon key={i} points={f.points} fill="#fff" fillOpacity={LOGO_OPACITY[f.shade]} />
        ))}
      </svg>
    </div>
  )
}
