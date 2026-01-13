/**
 * 设置面板组件
 * 提供数据导入导出、存储统计、AI设置等功能
 */

import { useState, useRef, useEffect } from 'react'
import {
  downloadExport,
  importFromFile,
  getStorageStats,
  clearAllData,
  createSnapshot,
  getSnapshotMeta,
  hasSnapshot,
  rollbackFromSnapshot
} from '../data/index.js'

function SettingsPanel({
  isOpen,
  onClose,
  onDataChange,
  // AI 分类相关 props（从 App 传入，关闭面板也不会中断）
  isClassifying,
  classifyProgress,
  classifyResult,
  onStartClassify
}) {
  const [stats, setStats] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [importMode, setImportMode] = useState('merge') // 'replace' | 'merge'，默认为合并
  const fileInputRef = useRef(null)

  // 快照相关状态
  const [snapshotMeta, setSnapshotMeta] = useState(null)
  const [isRollingBack, setIsRollingBack] = useState(false)

  // 加载统计信息
  const loadStats = () => {
    setStats(getStorageStats())
  }

  // 加载快照信息
  const loadSnapshotInfo = () => {
    setSnapshotMeta(getSnapshotMeta())
  }

  // 面板打开时加载统计和快照信息
  useEffect(() => {
    if (isOpen) {
      loadStats()
      loadSnapshotInfo()
    }
  }, [isOpen])

  // 导出数据
  const handleExport = () => {
    downloadExport()
  }

  // 触发文件选择
  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  // 处理文件选择
  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImporting(true)
    setImportResult(null)

    try {
      // 导入前创建快照
      const snapshotResult = createSnapshot()
      if (!snapshotResult.success) {
        setImportResult({
          success: false,
          error: '创建备份失败，导入已取消'
        })
        return
      }

      // 执行导入
      const result = await importFromFile(file, { merge: importMode === 'merge' })
      setImportResult(result)

      if (result.success) {
        loadStats()
        loadSnapshotInfo()  // 刷新快照信息
        onDataChange?.()
      }
    } catch (error) {
      setImportResult({
        success: false,
        error: error.message
      })
    } finally {
      setImporting(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // 从快照回滚
  const handleRollback = () => {
    if (isRollingBack) return

    setIsRollingBack(true)
    try {
      const result = rollbackFromSnapshot()
      if (result.success) {
        loadStats()
        loadSnapshotInfo()
        onDataChange?.()
        setImportResult({
          success: true,
          message: '数据已成功回滚'
        })
      } else {
        setImportResult({
          success: false,
          error: result.error
        })
      }
    } finally {
      setIsRollingBack(false)
    }
  }

  // 清除所有数据
  const handleClearData = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }

    clearAllData()
    setConfirmClear(false)
    loadStats()
    onDataChange?.()
    onClose()
    window.location.reload()
  }

  if (!isOpen) return null

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <header className="settings-header">
          <h2>设置</h2>
          <button className="settings-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </header>

        <div className="settings-content">
          {/* 数据统计 */}
          <section className="settings-section">
            <h3>数据统计</h3>
            {stats ? (
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">数据版本</span>
                  <span className="stat-value">{stats.version}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">主题数量</span>
                  <span className="stat-value">{stats.counts.topics}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">快记数量</span>
                  <span className="stat-value">{stats.counts.notes}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">存储占用</span>
                  <span className="stat-value">{stats.storageUsedFormatted}</span>
                </div>
              </div>
            ) : (
              <p>加载中...</p>
            )}
          </section>

          {/* 数据导出 */}
          <section className="settings-section">
            <h3>数据导出</h3>
            <p className="settings-desc">
              将所有快记、主题导出为 JSON 文件，可用于备份或迁移。
            </p>
            <button className="settings-btn primary" onClick={handleExport}>
              导出数据
            </button>
          </section>

          {/* 数据导入 */}
          <section className="settings-section">
            <h3>数据导入</h3>
            <p className="settings-desc">
              支持导入 JSON 或 Markdown 文件。导入前会自动保存当前数据，可随时回滚。
            </p>

            {/* 导入模式选择 */}
            <div className="import-mode-selector">
              <label className={`import-mode-option ${importMode === 'merge' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={(e) => setImportMode(e.target.value)}
                />
                <span className="option-title">追加导入</span>
                <span className="option-desc">保留现有数据，追加新内容</span>
              </label>
              <label className={`import-mode-option ${importMode === 'replace' ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={(e) => setImportMode(e.target.value)}
                />
                <span className="option-title">替换导入</span>
                <span className="option-desc">清除现有数据，完全替换</span>
              </label>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md,.markdown"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <button
              className="settings-btn primary"
              onClick={handleImportClick}
              disabled={importing}
            >
              {importing ? '导入中...' : '选择文件导入'}
            </button>

            {importResult && (
              <div className={`import-result ${importResult.success ? 'success' : 'error'}`}>
                {importResult.success ? importResult.message : importResult.error}
              </div>
            )}

            {/* 快照回滚区域 */}
            {snapshotMeta && (
              <div className="snapshot-info">
                <div className="snapshot-header">
                  <span className="snapshot-label">可回滚的备份</span>
                  <span className="snapshot-time">
                    {new Date(snapshotMeta.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                <div className="snapshot-stats">
                  {snapshotMeta.topicsCount} 个主题，{snapshotMeta.notesCount} 条快记
                </div>
                <button
                  className="settings-btn rollback-btn"
                  onClick={handleRollback}
                  disabled={isRollingBack}
                >
                  {isRollingBack ? '回滚中...' : '回滚到此备份'}
                </button>
              </div>
            )}
          </section>

          {/* AI 自动分类 */}
          <section className="settings-section ai-section">
            <h3>AI 自动分类</h3>
            <p className="settings-desc">
              基于语义自动整理你的快记，将相似内容归类到同一主题。
              {isClassifying && ' 分类过程中可关闭此面板继续使用。'}
            </p>

            <button
              className="settings-btn primary ai-classify-btn"
              onClick={onStartClassify}
              disabled={isClassifying}
            >
              {isClassifying
                ? classifyProgress?.total > 0
                  ? `正在分类 ${classifyProgress.completed}/${classifyProgress.total}...`
                  : '准备中...'
                : '开始分类'}
            </button>

            {isClassifying && classifyProgress?.total > 0 && (
              <div className="classify-progress">
                <div
                  className="classify-progress-bar"
                  style={{ width: `${(classifyProgress.completed / classifyProgress.total) * 100}%` }}
                />
              </div>
            )}

            {classifyResult && (
              <div className={`import-result ${classifyResult.success ? 'success' : 'error'}`}>
                {classifyResult.message}
              </div>
            )}
          </section>

          {/* 危险区域 */}
          <section className="settings-section danger-zone">
            <h3>危险区域</h3>
            <p className="settings-desc">
              清除所有数据后无法恢复，请先导出备份。
            </p>
            <button
              className={`settings-btn danger ${confirmClear ? 'confirm' : ''}`}
              onClick={handleClearData}
            >
              {confirmClear ? '确认清除？再点一次' : '清除所有数据'}
            </button>
            {confirmClear && (
              <button
                className="settings-btn"
                onClick={() => setConfirmClear(false)}
                style={{ marginLeft: 8 }}
              >
                取消
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel
