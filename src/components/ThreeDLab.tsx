export function ThreeDLab() {
  return (
    <div className="lab fade-in">
      <div className="orb" />
      <h3>3D Visualization Lab</h3>
      <p style={{ color: 'var(--muted)', maxWidth: 420, fontSize: 14 }}>
        即将推出：Token 消耗的三维可视化，包含实时动画和交互式探索。
      </p>
      <ul>
        <li>模型消耗地形图（Token Landscape）</li>
        <li>时间线粒子流（Sessions as particles）</li>
        <li>适配器拓扑连接图（Adapter network）</li>
        <li>Stack: three.js + React-Three-Fiber / ECharts-GL</li>
      </ul>
    </div>
  )
}
