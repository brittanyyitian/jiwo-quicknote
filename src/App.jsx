import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

// 数据层
import {
  DEFAULT_TOPIC_ID,
  createTopic,
  createNote,
  initializeStorage,
  saveTopics,
  saveNotes
} from './data/index.js'

// 组件
import SettingsPanel from './components/SettingsPanel.jsx'

// ==================== 工具函数 ====================

function formatTime(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function formatFullTime(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function truncateText(text, maxLength = 50) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

// ==================== 主组件 ====================

function App() {
  // 核心数据状态
  const [topics, setTopics] = useState([])
  const [notes, setNotes] = useState([])

  // UI 状态
  const [selectedTopicId, setSelectedTopicId] = useState(DEFAULT_TOPIC_ID)
  const [inputValue, setInputValue] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // 编辑状态
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingContent, setEditingContent] = useState('')

  // 删除确认状态
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  // 新建主题弹窗
  const [showNewTopic, setShowNewTopic] = useState(false)
  const [newTopicTitle, setNewTopicTitle] = useState('')

  // 移动快记弹窗
  const [showMoveTopic, setShowMoveTopic] = useState(false)

  // Refs
  const bubbleAreaRef = useRef(null)
  const editTextareaRef = useRef(null)

  // 获取选中的快记
  const selectedNote = notes.find(n => n.id === selectedNoteId)

  // ==================== 数据初始化与持久化 ====================

  useEffect(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
  }, [])

  useEffect(() => {
    if (topics.length > 0) saveTopics(topics)
  }, [topics])

  useEffect(() => {
    if (notes.length > 0) saveNotes(notes)
  }, [notes])

  const handleDataChange = useCallback(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
  }, [])

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    if (bubbleAreaRef.current) {
      bubbleAreaRef.current.scrollTop = bubbleAreaRef.current.scrollHeight
    }
  }, [])

  // 当快记列表变化或切换主题时滚动到底部
  useEffect(() => {
    scrollToBottom()
  }, [notes.length, selectedTopicId, scrollToBottom])

  // 编辑时自动聚焦 textarea
  useEffect(() => {
    if (editingNoteId && editTextareaRef.current) {
      editTextareaRef.current.focus()
      editTextareaRef.current.setSelectionRange(
        editTextareaRef.current.value.length,
        editTextareaRef.current.value.length
      )
    }
  }, [editingNoteId])

  // ==================== 主题相关 ====================

  const selectedTopic = topics.find(t => t.id === selectedTopicId)

  const getTopicPreview = (topicId) => {
    const topicNotes = notes
      .filter(n => n.topicId === topicId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    return topicNotes[0]?.content || '暂无快记'
  }

  const getTopicTime = (topicId) => {
    const topicNotes = notes
      .filter(n => n.topicId === topicId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    if (topicNotes.length === 0) return ''
    const date = new Date(topicNotes[0].updatedAt || topicNotes[0].createdAt)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }

  const getTopicNoteCount = (topicId) => {
    return notes.filter(n => n.topicId === topicId).length
  }

  // 当前主题的快记（按更新/创建时间倒序，最新在最上面）
  const currentNotes = notes
    .filter(n => n.topicId === selectedTopicId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))

  // ==================== 快记 CRUD ====================

  // 创建快记
  const canSend = inputValue.trim().length > 0

  const handleSend = () => {
    if (!canSend) return

    const content = inputValue.trim()
    setInputValue('')

    const newNote = createNote({
      topicId: selectedTopicId,
      content: content
    })

    setNotes(prev => [newNote, ...prev])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 打开快记详情
  const handleNoteClick = (noteId) => {
    // 如果正在编辑其他快记，先取消编辑
    if (editingNoteId && editingNoteId !== noteId) {
      setEditingNoteId(null)
      setEditingContent('')
    }
    setSelectedNoteId(noteId)
  }

  // 关闭详情面板
  const handleCloseDetail = () => {
    setSelectedNoteId(null)
    setEditingNoteId(null)
    setEditingContent('')
    setShowMoveTopic(false)
  }

  // 开始编辑快记
  const handleStartEdit = () => {
    if (!selectedNote) return
    setEditingNoteId(selectedNote.id)
    setEditingContent(selectedNote.content)
  }

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingNoteId || !editingContent.trim()) return

    setNotes(prev => prev.map(n =>
      n.id === editingNoteId
        ? {
            ...n,
            content: editingContent.trim(),
            updatedAt: new Date().toISOString()
          }
        : n
    ))

    setEditingNoteId(null)
    setEditingContent('')
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingNoteId(null)
    setEditingContent('')
  }

  // 编辑时按键处理
  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSaveEdit()
    }
    if (e.key === 'Escape') {
      handleCancelEdit()
    }
  }

  // 请求删除确认
  const handleRequestDelete = () => {
    if (!selectedNote) return
    setDeleteConfirmId(selectedNote.id)
  }

  // 确认删除
  const handleConfirmDelete = () => {
    if (!deleteConfirmId) return

    setNotes(prev => prev.filter(n => n.id !== deleteConfirmId))

    // 如果删除的是当前选中的快记，关闭详情面板
    if (selectedNoteId === deleteConfirmId) {
      setSelectedNoteId(null)
    }

    setDeleteConfirmId(null)
  }

  // 取消删除
  const handleCancelDelete = () => {
    setDeleteConfirmId(null)
  }

  // ==================== 主题管理 ====================

  // 创建新主题
  const handleCreateTopic = () => {
    if (!newTopicTitle.trim()) return

    const newTopic = createTopic({
      title: newTopicTitle.trim()
    })

    setTopics(prev => [...prev, newTopic])
    setNewTopicTitle('')
    setShowNewTopic(false)
    setSelectedTopicId(newTopic.id)
  }

  // 移动快记到其他主题
  const handleMoveTopic = (targetTopicId) => {
    if (!selectedNote || targetTopicId === selectedNote.topicId) {
      setShowMoveTopic(false)
      return
    }

    setNotes(prev => prev.map(n =>
      n.id === selectedNote.id
        ? {
            ...n,
            topicId: targetTopicId,
            updatedAt: new Date().toISOString()
          }
        : n
    ))

    setShowMoveTopic(false)
  }

  // ==================== 渲染 ====================

  return (
    <div className="app-container">
      {/* 1. 功能栏 */}
      <nav className="nav-rail">
        <div className="nav-logo">
          <div className="logo-icon">即</div>
        </div>
        <div className="nav-items">
          <div className="nav-item active" title="快记">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
            </svg>
          </div>
          <div className="nav-item" title="设置" onClick={() => setShowSettings(true)}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </div>
        </div>
      </nav>

      {/* 2. 主题列表 */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">快记</h1>
          <button className="new-btn" onClick={() => setShowNewTopic(true)} title="新建主题">+</button>
        </div>

        <div className="topic-list">
          {topics.map(topic => (
            <div
              key={topic.id}
              className={`topic-item ${selectedTopicId === topic.id ? 'selected' : ''}`}
              onClick={() => setSelectedTopicId(topic.id)}
            >
              <div className="topic-avatar">{topic.title.charAt(0)}</div>
              <div className="topic-info">
                <div className="topic-header">
                  <span className="topic-title">{topic.title}</span>
                  <span className="topic-time">{getTopicTime(topic.id)}</span>
                </div>
                <div className="topic-preview">{truncateText(getTopicPreview(topic.id), 20)}</div>
              </div>
              <span className="topic-count">{getTopicNoteCount(topic.id)}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* 3. 主内容区 */}
      <main className="main-content">
        <header className="content-header">
          <h2 className="content-title">{selectedTopic?.title || '快记'}</h2>
          <span className="content-count">{currentNotes.length} 条</span>
        </header>

        <div className="bubble-area" ref={bubbleAreaRef}>
          {currentNotes.length === 0 ? (
            <div className="empty-notes">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                </svg>
              </div>
              <p>还没有快记</p>
              <p className="empty-hint">在下方输入框写下第一条吧</p>
            </div>
          ) : (
            <div className="bubble-list">
              {currentNotes.map(note => (
                <div
                  key={note.id}
                  className={`bubble-item ${selectedNoteId === note.id ? 'selected' : ''}`}
                  onClick={() => handleNoteClick(note.id)}
                >
                  <div className="bubble-content">{truncateText(note.content, 100)}</div>
                  <div className="bubble-meta">
                    <span className="bubble-time">{formatTime(note.updatedAt || note.createdAt)}</span>
                    {note.updatedAt && note.updatedAt !== note.createdAt && (
                      <span className="bubble-edited">已编辑</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="input-bar">
          <div className="input-wrapper">
            <textarea
              className="input-field"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="记录此刻想法…"
              rows={1}
            />
          </div>
          <button
            className={`send-btn ${canSend ? 'active' : ''}`}
            disabled={!canSend}
            onClick={handleSend}
          >
            发送
          </button>
        </div>
      </main>

      {/* 4. 快记详情侧边栏 */}
      {selectedNote && (
        <aside className="detail-panel">
          <header className="detail-header">
            <h3 className="detail-title">快记详情</h3>
            <button className="detail-close-btn" onClick={handleCloseDetail}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
              </svg>
            </button>
          </header>

          <div className="detail-body">
            {/* 元信息 */}
            <div className="detail-meta">
              <div className="detail-meta-item">
                <span className="detail-meta-label">创建时间</span>
                <span className="detail-meta-value">{formatFullTime(selectedNote.createdAt)}</span>
              </div>
              {selectedNote.updatedAt && selectedNote.updatedAt !== selectedNote.createdAt && (
                <div className="detail-meta-item">
                  <span className="detail-meta-label">更新时间</span>
                  <span className="detail-meta-value">{formatFullTime(selectedNote.updatedAt)}</span>
                </div>
              )}
              <div className="detail-meta-item">
                <span className="detail-meta-label">所属主题</span>
                <button
                  className="detail-meta-topic"
                  onClick={() => setShowMoveTopic(true)}
                >
                  {topics.find(t => t.id === selectedNote.topicId)?.title || '未知主题'}
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="detail-content-section">
              {editingNoteId === selectedNote.id ? (
                /* 编辑模式 */
                <div className="detail-edit">
                  <textarea
                    ref={editTextareaRef}
                    className="detail-edit-textarea"
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    placeholder="快记内容不能为空"
                  />
                  <div className="detail-edit-hint">Ctrl/Cmd + Enter 保存，Esc 取消</div>
                  <div className="detail-edit-actions">
                    <button className="detail-btn secondary" onClick={handleCancelEdit}>取消</button>
                    <button
                      className="detail-btn primary"
                      onClick={handleSaveEdit}
                      disabled={!editingContent.trim()}
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                /* 查看模式 */
                <div className="detail-view">
                  <div className="detail-note-content">{selectedNote.content}</div>
                </div>
              )}
            </div>

            {/* 操作按钮 */}
            {editingNoteId !== selectedNote.id && (
              <div className="detail-actions">
                <button className="detail-btn" onClick={handleStartEdit}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                  编辑
                </button>
                <button className="detail-btn danger" onClick={handleRequestDelete}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                  删除
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 5. 删除确认弹窗 */}
      {deleteConfirmId && (
        <div className="modal-overlay" onClick={handleCancelDelete}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">确认删除</h3>
            </div>
            <div className="modal-body">
              <p>确定要删除这条快记吗？此操作不可撤销。</p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn" onClick={handleCancelDelete}>取消</button>
              <button className="modal-btn danger" onClick={handleConfirmDelete}>删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 6. 新建主题弹窗 */}
      {showNewTopic && (
        <div className="modal-overlay" onClick={() => setShowNewTopic(false)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">新建主题</h3>
            </div>
            <div className="modal-body">
              <input
                type="text"
                className="modal-input"
                value={newTopicTitle}
                onChange={(e) => setNewTopicTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTopicTitle.trim()) {
                    handleCreateTopic()
                  }
                }}
                placeholder="输入主题名称"
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="modal-btn" onClick={() => setShowNewTopic(false)}>取消</button>
              <button
                className="modal-btn primary"
                onClick={handleCreateTopic}
                disabled={!newTopicTitle.trim()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. 移动主题弹窗 */}
      {showMoveTopic && selectedNote && (
        <div className="modal-overlay" onClick={() => setShowMoveTopic(false)}>
          <div className="modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">移动到主题</h3>
            </div>
            <div className="modal-body">
              <div className="topic-select-list">
                {topics.map(topic => (
                  <div
                    key={topic.id}
                    className={`topic-select-item ${topic.id === selectedNote.topicId ? 'current' : ''}`}
                    onClick={() => handleMoveTopic(topic.id)}
                  >
                    <div className="topic-select-avatar">{topic.title.charAt(0)}</div>
                    <span className="topic-select-title">{topic.title}</span>
                    {topic.id === selectedNote.topicId && (
                      <span className="topic-select-badge">当前</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn" onClick={() => setShowMoveTopic(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 8. 设置面板 */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onDataChange={handleDataChange}
      />
    </div>
  )
}

export default App
