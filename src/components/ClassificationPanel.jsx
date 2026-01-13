/**
 * 快记自动分类面板
 *
 * 功能：
 * 1. 显示分类预览
 * 2. 确认后执行分类
 * 3. 支持回滚
 */

import { useState } from 'react'
import {
  generateClassificationPreview,
  executeClassification,
  createSnapshot,
  restoreFromSnapshot
} from '../services/classifier.js'
import { createTopic } from '../data/schema.js'

function ClassificationPanel({ isOpen, onClose, notes, topics, onDataChange, saveTopics, saveNotes }) {
  const [status, setStatus] = useState('idle')  // idle | loading | preview | executing | done | error
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [executionResult, setExecutionResult] = useState(null)

  // 开始分类预览
  const handleStartClassification = async () => {
    setStatus('loading')
    setError(null)
    setPreview(null)

    try {
      const result = await generateClassificationPreview(notes)

      if (result.success) {
        setPreview(result.preview)
        setStatus('preview')
      } else {
        setError(result.error)
        setStatus('error')
      }
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  // 确认执行分类
  const handleConfirmClassification = () => {
    if (!preview) return

    setStatus('executing')

    try {
      // 创建快照用于回滚
      const snap = createSnapshot(topics, notes)
      setSnapshot(snap)

      // 执行分类
      const newTopics = [...topics]
      const newNotes = [...notes]
      const createdTopicIds = []

      for (const topicPreview of preview.topics) {
        // 跳过"默认"主题，不重复创建
        if (topicPreview.title === '我的快记') continue

        // 创建新主题
        const newTopic = createTopic({
          title: topicPreview.title
        })
        // 标记为 AI 生成
        newTopic.source = 'ai_generated'
        newTopics.push(newTopic)
        createdTopicIds.push(newTopic.id)

        // 更新快记的主题归属
        for (const notePreview of topicPreview.notes) {
          const noteIndex = newNotes.findIndex(n => n.id === notePreview.id)
          if (noteIndex !== -1) {
            newNotes[noteIndex] = {
              ...newNotes[noteIndex],
              topicId: newTopic.id,
              updatedAt: new Date().toISOString()
            }
          }
        }
      }

      // 保存数据
      saveTopics(newTopics)
      saveNotes(newNotes)

      setExecutionResult({
        topicsCreated: createdTopicIds.length,
        notesUpdated: preview.topics.reduce((sum, t) => sum + t.count, 0)
      })
      setStatus('done')

      // 通知父组件数据已变化
      onDataChange?.()

    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  // 回滚到分类前
  const handleRollback = () => {
    if (!snapshot) return

    const restored = restoreFromSnapshot(snapshot)
    saveTopics(restored.topics)
    saveNotes(restored.notes)

    setStatus('idle')
    setPreview(null)
    setSnapshot(null)
    setExecutionResult(null)

    onDataChange?.()
  }

  // 关闭面板
  const handleClose = () => {
    setStatus('idle')
    setPreview(null)
    setError(null)
    setExecutionResult(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="classification-overlay" onClick={handleClose}>
      <div className="classification-panel" onClick={e => e.stopPropagation()}>
        <header className="classification-header">
          <h2>AI 自动分类</h2>
          <button className="classification-close" onClick={handleClose}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </header>

        <div className="classification-content">
          {/* 初始状态 */}
          {status === 'idle' && (
            <div className="classification-intro">
              <div className="intro-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
                </svg>
              </div>
              <h3>智能分类你的快记</h3>
              <p className="intro-desc">
                AI 将分析你的 <strong>{notes.length}</strong> 条快记，
                根据语义相似性自动归类到不同主题。
              </p>
              <ul className="intro-features">
                <li>自动识别内容主题</li>
                <li>生成合适的主题标题</li>
                <li>预览后再确认执行</li>
                <li>支持一键回滚</li>
              </ul>
              <button className="classification-btn primary" onClick={handleStartClassification}>
                开始分类预览
              </button>
            </div>
          )}

          {/* 加载中 */}
          {status === 'loading' && (
            <div className="classification-loading">
              <div className="loading-spinner"></div>
              <p>AI 正在分析你的快记...</p>
              <p className="loading-hint">这可能需要 10-30 秒</p>
            </div>
          )}

          {/* 预览结果 */}
          {status === 'preview' && preview && (
            <div className="classification-preview">
              <div className="preview-header">
                <h3>分类预览</h3>
                <p className="preview-summary">
                  共 {preview.topics.length} 个主题，{notes.length} 条快记
                </p>
              </div>

              <div className="preview-topics">
                {preview.topics.map((topic, index) => (
                  <div key={index} className="preview-topic">
                    <div className="topic-header">
                      <span className="topic-title">{topic.title}</span>
                      <span className="topic-count">{topic.count} 条</span>
                    </div>
                    {topic.description && (
                      <p className="topic-desc">{topic.description}</p>
                    )}
                    <div className="topic-samples">
                      {topic.notes.slice(0, 3).map((note, i) => (
                        <div key={i} className="sample-note">
                          <span className="sample-content">{note.preview}</span>
                        </div>
                      ))}
                      {topic.notes.length > 3 && (
                        <div className="sample-more">
                          还有 {topic.notes.length - 3} 条...
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="preview-actions">
                <button className="classification-btn" onClick={() => setStatus('idle')}>
                  重新分析
                </button>
                <button className="classification-btn primary" onClick={handleConfirmClassification}>
                  确认并执行分类
                </button>
              </div>

              <p className="preview-warning">
                确认后将创建新主题并移动快记，原数据会自动备份以支持回滚。
              </p>
            </div>
          )}

          {/* 执行中 */}
          {status === 'executing' && (
            <div className="classification-loading">
              <div className="loading-spinner"></div>
              <p>正在执行分类...</p>
            </div>
          )}

          {/* 完成 */}
          {status === 'done' && executionResult && (
            <div className="classification-done">
              <div className="done-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </div>
              <h3>分类完成</h3>
              <p className="done-summary">
                已创建 <strong>{executionResult.topicsCreated}</strong> 个新主题，
                归类 <strong>{executionResult.notesUpdated}</strong> 条快记
              </p>
              <div className="done-actions">
                <button className="classification-btn danger" onClick={handleRollback}>
                  撤销分类（回滚）
                </button>
                <button className="classification-btn primary" onClick={handleClose}>
                  完成
                </button>
              </div>
            </div>
          )}

          {/* 错误 */}
          {status === 'error' && (
            <div className="classification-error">
              <div className="error-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <h3>分类失败</h3>
              <p className="error-message">{error}</p>
              <button className="classification-btn" onClick={() => setStatus('idle')}>
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ClassificationPanel
