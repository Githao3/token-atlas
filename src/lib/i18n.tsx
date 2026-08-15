import { createContext, useContext, useEffect, useMemo, useState } from 'react'

/**
 * Minimal i18n: a flat key -> string dictionary per language with `{name}`
 * interpolation. No library — the app has well under 200 strings and the only
 * runtime need is "swap the table and re-render".
 *
 * Charts must be told to re-init on a language change, so every chart passes
 * `themeKey + lang` to <EChart> and lists `t` in its option memo deps (`t`'s
 * identity changes with the language).
 */
export type Lang = 'zh' | 'en'
type Vars = Record<string, string | number>

const LANG_KEY = 'tk.lang'

const zh: Record<string, string> = {
  // rail + topbar
  'nav.analysis': '分析',
  'nav.overview': '总览',
  'nav.trends': '趋势',
  'nav.lab': '3D 实验室',
  'rail.sources': '数据源',
  'brand.tagline': '本地洞察',
  'top.title': 'Token 用量',
  'top.sources': '{n} 个数据源',
  'range.aria': '时间范围',
  'range.7d': '7 天',
  'range.30d': '30 天',
  'range.90d': '90 天',
  'range.all': '全部',
  'range.past.7d': '过去 7 天',
  'range.past.30d': '过去 30 天',
  'range.past.90d': '过去 90 天',
  'range.past.all': '全部时间',
  'btn.refresh': '刷新',
  'btn.theme': '切换主题',
  'btn.lang': '切换语言',
  'state.scanning': '正在扫描本地 AI agent 数据…',
  'state.scanFailed': '扫描失败',
  'err.unknown': '未知错误',
  // stat cards
  'card.tokenUsage': 'Token 用量',
  'card.estCost': '预估成本',
  'card.cacheHit': '缓存命中',
  'card.sessions': '会话数',
  'card.messages': '消息数',
  'card.activeDays': '活跃天数',
  'card.streak': '连续天数',
  'card.favModel': '常用模型',
  'card.estSub': '估算值 · 可自定义单价',
  'card.estHint': '点击编辑单价表',
  'card.saved': '省下约 {v}',
  'card.msgSub': '模型请求次数',
  'card.activeSub': '共 {n} 天中活跃',
  'card.streakSub': '连续活跃天数',
  'card.share': '{v}% 占比',
  // heatmap
  'heat.title': '活跃度热力图',
  'heat.less': '少',
  'heat.more': '多',
  'heat.tip': '{day} · {tokens} tokens · {n} 次请求',
  // cache + cost
  'cache.title': '缓存效率',
  'cache.note': '提示词复用',
  'cache.gauge': '{hit} 命中 / {total} 提示词',
  'cache.readTokens': '缓存命中 token',
  'cache.fresh': '未命中（新提示词）',
  'cache.writeTokens': '写入缓存 token',
  'cache.withoutCache': '不用缓存需花费',
  'cache.actual': '实际花费',
  'cache.saved': '节省',
  'cost.title': '成本拆解',
  'cost.editRates': '编辑单价 ↗',
  'cost.totalSub': '估算总花费 · {mode}',
  'cost.custom': '使用自定义单价',
  'cost.builtin': '使用内置默认单价',
  'cost.freshInput': '新输入',
  'cost.cacheRead': '缓存读取',
  'cost.cacheWrite': '缓存写入',
  'cost.output': '输出',
  'cost.disclaimer': '单价为估算默认值，未必与你的实际账单一致。点「编辑单价」可改写',
  'cost.disclaimerEnd': '。',
  'cost.unmatched': '以下模型没有匹配规则，按兜底价计算：',
  // charts
  'tpd.title': '每日 Tokens',
  'tpd.total': '合计',
  'proj.title': '项目',
  'proj.note': '按工作目录',
  'proj.empty': '没有可归类的项目路径（数据源未记录工作目录）。',
  'mu.title': '模型用量',
  'mu.models': '{n} 个模型',
  'ab.title': '编程工具',
  'ab.note': '数据源',
  'ab.noData': '未找到数据',
  'ct.title.cost': '成本趋势',
  'ct.title.tokens': 'Token 趋势',
  'ct.daily': '每日',
  'ct.ma': '{n} 日均',
  'ct.rangeTotal': '区间合计',
  'ct.peak': '峰值',
  'ct.maNote': '粗线为 {n} 日移动平均',
  'ct.calls': '轮次',
  'mt.title': '模型趋势',
  'mt.note': '前 {n} 名 + 其他',
  'mt.callsUnit': '{n} 次',
  'seg.tokens': 'Tokens',
  'seg.cost': '成本',
  'seg.calls': '调用次数',
  'seg.metricAria': '排序指标',
  // shared
  'common.others': '其他 {n} 个',
  'common.othersShort': '其他',
  'common.open': '打开 {path}',
  'common.sessions': '会话',
  'common.messages': '消息',
  'common.days': '{n} 天',
  'common.weeks': '{n} 周',
  // 3D lab
  'lab.title': 'Token 地形',
  'lab.span': '最近一年 · {span}',
  'lab.empty': '最近一年没有可用数据。',
  'lab.annualTotal': '年度总 TOKENS',
  'lab.peakDay': '峰值日',
  'lab.activeRate': '活跃率',
  'lab.longestStreak': '最长连续',
  'lab.ramp': '每日用量',
  'lab.noRecord': '无记录',
  'lab.reset': '复位视角',
  'lab.full': '全屏',
  'lab.exitFull': '退出全屏',
  'lab.tokens': 'TOKENS',
  'lab.usd': 'USD'
}

const en: Record<string, string> = {
  'nav.analysis': 'Analysis',
  'nav.overview': 'Overview',
  'nav.trends': 'Trends',
  'nav.lab': '3D Lab',
  'rail.sources': 'Sources',
  'brand.tagline': 'local insight',
  'top.title': 'Token usage',
  'top.sources': '{n} sources',
  'range.aria': 'Time range',
  'range.7d': '7d',
  'range.30d': '30d',
  'range.90d': '90d',
  'range.all': 'All',
  'range.past.7d': 'Past 7 days',
  'range.past.30d': 'Past 30 days',
  'range.past.90d': 'Past 90 days',
  'range.past.all': 'All time',
  'btn.refresh': 'Refresh',
  'btn.theme': 'Toggle theme',
  'btn.lang': 'Switch language',
  'state.scanning': 'Scanning local AI agent data…',
  'state.scanFailed': 'Scan failed',
  'err.unknown': 'Unknown error',
  'card.tokenUsage': 'Token usage',
  'card.estCost': 'Est. cost',
  'card.cacheHit': 'Cache hit',
  'card.sessions': 'Sessions',
  'card.messages': 'Messages',
  'card.activeDays': 'Active days',
  'card.streak': 'Current streak',
  'card.favModel': 'Favorite model',
  'card.estSub': 'Estimate · editable rates',
  'card.estHint': 'Click to edit the price list',
  'card.saved': 'Saved about {v}',
  'card.msgSub': 'Model responses',
  'card.activeSub': 'of {n} days',
  'card.streakSub': 'Consecutive active days',
  'card.share': '{v}% share',
  'heat.title': 'Activity heatmap',
  'heat.less': 'Less',
  'heat.more': 'More',
  'heat.tip': '{day} · {tokens} tokens · {n} requests',
  'cache.title': 'Cache efficiency',
  'cache.note': 'PROMPT REUSE',
  'cache.gauge': '{hit} hit / {total} prompt',
  'cache.readTokens': 'Cache-hit tokens',
  'cache.fresh': 'Missed (fresh prompt)',
  'cache.writeTokens': 'Cache-write tokens',
  'cache.withoutCache': 'Cost without cache',
  'cache.actual': 'Actual cost',
  'cache.saved': 'Saved',
  'cost.title': 'Cost breakdown',
  'cost.editRates': 'Edit rates ↗',
  'cost.totalSub': 'Estimated total · {mode}',
  'cost.custom': 'custom rates',
  'cost.builtin': 'built-in default rates',
  'cost.freshInput': 'Fresh input',
  'cost.cacheRead': 'Cache read',
  'cost.cacheWrite': 'Cache write',
  'cost.output': 'Output',
  'cost.disclaimer':
    'Rates are estimated defaults and may not match your actual bill. “Edit rates” opens',
  'cost.disclaimerEnd': '.',
  'cost.unmatched': 'No rule matched these models, so a fallback rate was used:',
  'tpd.title': 'Tokens per day',
  'tpd.total': 'Total',
  'proj.title': 'Projects',
  'proj.note': 'BY WORKING DIR',
  'proj.empty': 'No project paths to group by (the sources did not record a working directory).',
  'mu.title': 'Model usage',
  'mu.models': '{n} models',
  'ab.title': 'Coding tools',
  'ab.note': 'DATA SOURCES',
  'ab.noData': 'No data found',
  'ct.title.cost': 'Cost trend',
  'ct.title.tokens': 'Token trend',
  'ct.daily': 'Daily',
  'ct.ma': '{n}-day avg',
  'ct.rangeTotal': 'Range total',
  'ct.peak': 'Peak',
  'ct.maNote': 'Thick line is the {n}-day moving average',
  'ct.calls': 'Calls',
  'mt.title': 'Model trend',
  'mt.note': 'TOP {n} + OTHERS',
  'mt.callsUnit': '{n} calls',
  'seg.tokens': 'Tokens',
  'seg.cost': 'Cost',
  'seg.calls': 'Calls',
  'seg.metricAria': 'Sort metric',
  'common.others': '{n} others',
  'common.othersShort': 'Others',
  'common.open': 'Open {path}',
  'common.sessions': 'sessions',
  'common.messages': 'messages',
  'common.days': '{n} d',
  'common.weeks': '{n} w',
  'lab.title': 'Token Landscape',
  'lab.span': 'Last year · {span}',
  'lab.empty': 'No data in the last year.',
  'lab.annualTotal': 'ANNUAL TOTAL TOKENS',
  'lab.peakDay': 'PEAK DAY',
  'lab.activeRate': 'ACTIVE RATE',
  'lab.longestStreak': 'LONGEST STREAK',
  'lab.ramp': 'DAILY USAGE',
  'lab.noRecord': 'No activity',
  'lab.reset': 'Reset view',
  'lab.full': 'Fullscreen',
  'lab.exitFull': 'Exit fullscreen',
  'lab.tokens': 'TOKENS',
  'lab.usd': 'USD'
}

const DICT: Record<Lang, Record<string, string>> = { zh, en }

/** Monday-first, matching the heatmap and landscape row order. */
export const WEEKDAYS: Record<Lang, string[]> = {
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
}

export const MONTHS: Record<Lang, string[]> = {
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
}

interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Vars) => string
}

const LangCtx = createContext<Ctx | null>(null)

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem(LANG_KEY) as Lang | null) ?? 'zh'
  )

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang)
    // Keeps `:lang()` selectors and font fallbacks honest.
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      /* Falls back to Chinese then the key itself, so a missing translation
         degrades to something readable instead of blanking the UI. */
      t: (key, vars) => {
        let s = DICT[lang][key] ?? zh[key] ?? key
        if (vars) {
          for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
        }
        return s
      }
    }),
    [lang]
  )

  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>
}

export function useI18n(): Ctx {
  const c = useContext(LangCtx)
  if (!c) throw new Error('useI18n must be used inside <LangProvider>')
  return c
}

