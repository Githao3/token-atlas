import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

interface Props {
  option: echarts.EChartsCoreOption
  className?: string
  /** Bump this to force a full re-init (e.g. on theme change). */
  themeKey?: string
}

/**
 * Minimal React wrapper around an ECharts instance. Keeps a single chart alive
 * across option updates and disposes it on unmount. `setOption` runs with
 * `notMerge` off so transitions stay smooth between range switches.
 */
export function EChart({ option, className, themeKey }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chartRef.current = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    const ro = new ResizeObserver(() => chartRef.current?.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      chartRef.current?.dispose()
      chartRef.current = null
    }
    // themeKey forces a fresh instance so CSS-var colors are re-read
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeKey])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={ref} className={className} />
}
