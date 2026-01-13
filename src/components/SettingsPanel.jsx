/**
 * 设置面板组件
 * 提供数据导入导出、存储统计等功能
 */

import { useState, useRef } from 'react'
import {
  downloadExport,
  importFromFile,
  getStorageStats,
  clearAllData
} from '../data/index.js'

function SettingsPanel({ isOpen, onClose, onDataChange, onOpenClassification }) {
  const [stats, setStats] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const fileInputRef = useRef(null)

  // 加载统计信息
  const loadStats = () => {
    setStats(getStorageStats())
  }

  // 面板打开时加载统计
  if (isOpen && !stats) {
    loadStats()
  }

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
      const result = await importFromFile(file, { merge: false })
      setImportResult(result)

      if (result.success) {
        loadStats()
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
                  <span className="stat-label">AI 回答</span>
                  <span className="stat-value">{stats.counts.aiResponses}</span>
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
              将所有快记、主题、AI 回答导出为 JSON 文件，可用于备份或迁移。
            </p>
            <button className="settings-btn primary" onClick={handleExport}>
              导出数据
            </button>
          </section>

          {/* 数据导入 */}
          <section className="settings-section">
            <h3>数据导入</h3>
            <p className="settings-desc">
              支持 JSON 和 Markdown 格式导入。
              <br />
              <span className="settings-hint">
                · JSON：完整备份数据
                <br />
                · Markdown：按段落或标题分割为快记
              </span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md,.markdown"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <button
              className="settings-btn"
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
          </section>

          {/* AI 自动分类 */}
          <section className="settings-section">
            <h3>AI 自动分类</h3>
            <p className="settings-desc">
              使用 AI 分析你的快记内容，自动按语义相似性归类到不同主题。
            </p>
            <button
              className="settings-btn primary"
              onClick={() => {
                onClose()
                onOpenClassification?.()
              }}
            >
              开始智能分类
            </button>
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
