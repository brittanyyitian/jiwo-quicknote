/**
 * 快记自动分类面板
 *
 * 功能：
 * 1. 异步后台任务 + 分批处理
 * 2. 进度追踪与显示
 * 3. 支持暂停/继续/重试
 * 4. 确认后执行分类
 * 5. 支持回滚
 */

import { useState, useEffect, useCallback } from 'react'
import {
  TASK_STATUS,
  getTaskState,
  startClassificationTask,
  pauseTask,
  retryTask,
  clearTask,
  mergeAndGroupResults,
  getCachedBatchResults
} from '../services/classificationTask.js'
import { createSnapshot, restoreFromSnapshot } from '../services/classifier.js'
import { createTopic } from '../data/schema.js'

function ClassificationPanel({ isOpen, onClose, notes, topics, onDataChange, saveTopics, saveNotes }) {
  const [taskState, setTaskState] = useState(null)
  const [preview, setPreview] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [executionResult, setExecutionResult] = useState(null)
  const [panelStatus, setPanelStatus] = useState('idle')  // idle | running | preview | executing | done | error

  // 初始化时加载任务状态
  useEffect(() => {
    if (isOpen) {
      const state = getTaskState()
      setTaskState(state)

      // 如果有已完成的任务，显示预览
      if (state.status === TASK_STATUS.COMPLETED) {
        const cached = getCachedBatchResults()
        if (cached.length > 0) {
          const merged = mergeAndGroupResults(cached)
          setPreview(merged)
          setPanelStatus('preview')
        }
      } else if (state.status === TASK_STATUS.RUNNING || state.status === TASK_STATUS.PAUSED) {
        setPanelStatus('running')
      } else if (state.status === TASK_STATUS.ERROR) {
        setPanelStatus('error')
      }
    }
  }, [isOpen])

  // 进度回调
  const handleProgress = useCallback((state) => {
    setTaskState({ ...state })

    if (state.status === TASK_STATUS.COMPLETED) {
      // 任务完成，生成预览
      const merged = mergeAndGroupResults(state.batchResults)
      setPreview(merged)
      setPanelStatus('preview')
    } else if (state.status === TASK_STATUS.ERROR) {
      setPanelStatus('error')
    } else if (state.status === TASK_STATUS.PAUSED) {
      setPanelStatus('running')  // 保持在运行页面显示暂停状态
    }
  }, [])

  // 开始分类
  const handleStartClassification = async () => {
    setPanelStatus('running')
    setPreview(null)

    try {
      await startClassificationTask(notes, handleProgress)
    } catch (error) {
      console.error('分类任务失败:', error)
      // 错误状态已在 handleProgress 中处理
    }
  }

  // 暂停任务
  const handlePause = () => {
    pauseTask()
  }

  // 继续任务
  const handleResume = async () => {
    try {
      await startClassificationTask(notes, handleProgress)
    } catch (error) {
      console.error('继续任务失败:', error)
    }
  }

  // 重试任务
  const handleRetry = async () => {
    setPanelStatus('running')
    try {
      await retryTask(notes, handleProgress)
    } catch (error) {
      console.error('重试失败:', error)
    }
  }

  // 重新开始（清除缓存）
  const handleRestart = () => {
    clearTask()
    setTaskState(null)
    setPreview(null)
    setPanelStatus('idle')
  }

  // 确认执行分类
  const handleConfirmClassification = () => {
    if (!preview) return

    setPanelStatus('executing')

    try {
      // 创建快照用于回滚
      const snap = createSnapshot(topics, notes)
      setSnapshot(snap)

      // 执行分类
      const newTopics = [...topics]
      const newNotes = [...notes]
      const createdTopicIds = []

      for (const topicPreview of preview.topics) {
        // 跳过"默认"主题
        if (topicPreview.title === '我的快记') continue

        // 创建新主题
        const newTopic = createTopic({
          title: topicPreview.title
        })
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

      // 清除任务缓存
      clearTask()

      setExecutionResult({
        topicsCreated: createdTopicIds.length,
        notesUpdated: preview.topics.reduce((sum, t) => sum + t.count, 0)
      })
      setPanelStatus('done')

      onDataChange?.()

    } catch (err) {
      console.error('执行分类失败:', err)
      setPanelStatus('error')
      setTaskState(prev => ({ ...prev, error: err.message }))
    }
  }

  // 回滚
  const handleRollback = () => {
    if (!snapshot) return

    const restored = restoreFromSnapshot(snapshot)
    saveTopics(restored.topics)
    saveNotes(restored.notes)

    setPanelStatus('idle')
    setPreview(null)
    setSnapshot(null)
    setExecutionResult(null)
    clearTask()

    onDataChange?.()
  }

  // 关闭面板
  const handleClose = () => {
    // 如果任务正在运行，先暂停
    if (taskState?.status === TASK_STATUS.RUNNING) {
      pauseTask()
    }
    onClose()
  }

  if (!isOpen) return null

  // 计算进度百分比
  const progressPercent = taskState?.totalNotes > 0
    ? Math.round((taskState.processedNotes / taskState.totalNotes) * 100)
    : 0

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
          {panelStatus === 'idle' && (
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
                <li>分批处理，不会超时</li>
                <li>支持暂停/继续</li>
                <li>预览后再确认执行</li>
                <li>支持一键回滚</li>
              </ul>
              <button className="classification-btn primary" onClick={handleStartClassification}>
                开始分类
              </button>
            </div>
          )}

          {/* 运行中 / 暂停 */}
          {panelStatus === 'running' && taskState && (
            <div className="classification-progress">
              <div className="progress-icon">
                {taskState.status === TASK_STATUS.PAUSED ? (
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                  </svg>
                ) : (
                  <div className="loading-spinner"></div>
                )}
              </div>

              <h3>
                {taskState.status === TASK_STATUS.PAUSED ? '已暂停' : 'AI 正在分析...'}
              </h3>

              <div className="progress-bar-container">
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
                <div className="progress-text">
                  {progressPercent}% ({taskState.processedNotes}/{taskState.totalNotes} 条)
                </div>
              </div>

              <div className="progress-detail">
                <span>批次: {taskState.currentBatch + 1}/{taskState.totalBatches}</span>
                {taskState.retryCount > 0 && (
                  <span className="retry-count">重试: {taskState.retryCount} 次</span>
                )}
              </div>

              <div className="progress-actions">
                {taskState.status === TASK_STATUS.RUNNING ? (
                  <button className="classification-btn" onClick={handlePause}>
                    暂停
                  </button>
                ) : (
                  <>
                    <button className="classification-btn primary" onClick={handleResume}>
                      继续
                    </button>
                    <button className="classification-btn" onClick={handleRestart}>
                      重新开始
                    </button>
                  </>
                )}
              </div>

              <p className="progress-hint">
                {taskState.status === TASK_STATUS.PAUSED
                  ? '任务已暂停，进度已保存，可以随时继续'
                  : '可以关闭面板，任务会在后台继续运行'}
              </p>
            </div>
          )}

          {/* 预览结果 */}
          {panelStatus === 'preview' && preview && (
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
                <button className="classification-btn" onClick={handleRestart}>
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
          {panelStatus === 'executing' && (
            <div className="classification-loading">
              <div className="loading-spinner"></div>
              <p>正在执行分类...</p>
            </div>
          )}

          {/* 完成 */}
          {panelStatus === 'done' && executionResult && (
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
          {panelStatus === 'error' && (
            <div className="classification-error">
              <div className="error-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <h3>分类失败</h3>
              <p className="error-message">{taskState?.error || '未知错误'}</p>

              {taskState && taskState.processedNotes > 0 && (
                <p className="error-progress">
                  已处理 {taskState.processedNotes}/{taskState.totalNotes} 条
                </p>
              )}

              <div className="error-actions">
                <button className="classification-btn primary" onClick={handleRetry}>
                  从断点重试
                </button>
                <button className="classification-btn" onClick={handleRestart}>
                  重新开始
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ClassificationPanel
