import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

// 数据层
import {
  DEFAULT_TOPIC_ID,
  createTopic,
  createNote,
  createReference,
  initializeStorage,
  saveTopics,
  saveNotes,
  saveReferences
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

// 压缩图片
async function compressImage(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let width = img.width
        let height = img.height

        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }

        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)

        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

// ==================== 主组件 ====================

function App() {
  // 核心数据状态
  const [topics, setTopics] = useState([])
  const [notes, setNotes] = useState([])
  const [references, setReferences] = useState([])

  // UI 状态
  const [selectedTopicId, setSelectedTopicId] = useState(DEFAULT_TOPIC_ID)
  const [inputValue, setInputValue] = useState('')
  const [inputImages, setInputImages] = useState([])
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // 编辑状态
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingContent, setEditingContent] = useState('')
  const [editingImages, setEditingImages] = useState([])

  // 删除确认状态
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)

  // 新建主题弹窗
  const [showNewTopic, setShowNewTopic] = useState(false)
  const [newTopicTitle, setNewTopicTitle] = useState('')

  // 移动快记弹窗
  const [showMoveTopic, setShowMoveTopic] = useState(false)

  // 延展模式（取代弹窗，使用底部输入框）
  const [extendingNoteId, setExtendingNoteId] = useState(null)

  // 右键菜单
  const [contextMenu, setContextMenu] = useState(null) // { x, y, noteId }

  // Refs
  const bubbleAreaRef = useRef(null)
  const editTextareaRef = useRef(null)
  const imageInputRef = useRef(null)
  const editImageInputRef = useRef(null)
  const inputFieldRef = useRef(null)

  // 获取选中的快记
  const selectedNote = notes.find(n => n.id === selectedNoteId)

  // 获取正在延展的快记
  const extendingNote = extendingNoteId ? notes.find(n => n.id === extendingNoteId) : null

  // 获取引用关系
  const getReferencesFrom = (noteId) => {
    // 当前快记引用了哪些快记
    return references
      .filter(r => r.sourceNoteId === noteId)
      .map(r => notes.find(n => n.id === r.targetNoteId))
      .filter(Boolean)
  }

  const getReferencesTo = (noteId) => {
    // 哪些快记引用了当前快记
    return references
      .filter(r => r.targetNoteId === noteId)
      .map(r => notes.find(n => n.id === r.sourceNoteId))
      .filter(Boolean)
  }

  const hasReferences = (noteId) => {
    return references.some(r => r.sourceNoteId === noteId || r.targetNoteId === noteId)
  }

  // 获取当前快记引用的原快记（只取第一个）
  const getSourceNote = (noteId) => {
    const ref = references.find(r => r.sourceNoteId === noteId)
    if (ref) {
      return notes.find(n => n.id === ref.targetNoteId)
    }
    return null
  }

  // 获取引用当前快记的数量
  const getExtendedCount = (noteId) => {
    return references.filter(r => r.targetNoteId === noteId).length
  }

  // ==================== 数据初始化与持久化 ====================

  useEffect(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
    setReferences(data.references || [])
  }, [])

  useEffect(() => {
    if (topics.length > 0) saveTopics(topics)
  }, [topics])

  useEffect(() => {
    if (notes.length > 0) saveNotes(notes)
  }, [notes])

  useEffect(() => {
    saveReferences(references)
  }, [references])

  const handleDataChange = useCallback(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
    setReferences(data.references || [])
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

  // 当前主题的快记（按创建时间正序，最新在最下面靠近输入框）
  const currentNotes = notes
    .filter(n => n.topicId === selectedTopicId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  // ==================== 图片处理 ====================

  const handleImageUpload = async (files, setImages, currentImages) => {
    const newImages = []
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const compressed = await compressImage(file)
        newImages.push(compressed)
      }
    }
    setImages([...currentImages, ...newImages])
  }

  const handleRemoveImage = (index, setImages, currentImages) => {
    setImages(currentImages.filter((_, i) => i !== index))
  }

  // ==================== 快记 CRUD ====================

  // 创建快记（支持延展模式）
  const canSend = inputValue.trim().length > 0 || inputImages.length > 0

  const handleSend = () => {
    if (!canSend) return

    const content = inputValue.trim()
    setInputValue('')
    setInputImages([])

    const newNote = createNote({
      topicId: selectedTopicId,
      content: content,
      images: inputImages
    })

    setNotes(prev => [...prev, newNote])

    // 如果是延展模式，创建引用关系
    if (extendingNoteId) {
      const newReference = createReference({
        sourceNoteId: newNote.id,
        targetNoteId: extendingNoteId
      })
      setReferences(prev => [...prev, newReference])
      setExtendingNoteId(null)
    }

    // 滚动到底部
    setTimeout(scrollToBottom, 50)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 打开快记详情
  const handleNoteClick = (noteId) => {
    if (editingNoteId && editingNoteId !== noteId) {
      setEditingNoteId(null)
      setEditingContent('')
      setEditingImages([])
    }
    setSelectedNoteId(noteId)
  }

  // 关闭详情面板
  const handleCloseDetail = () => {
    setSelectedNoteId(null)
    setEditingNoteId(null)
    setEditingContent('')
    setEditingImages([])
    setShowMoveTopic(false)
  }

  // 开始编辑快记
  const handleStartEdit = () => {
    if (!selectedNote) return
    setEditingNoteId(selectedNote.id)
    setEditingContent(selectedNote.content)
    setEditingImages(selectedNote.images || [])
  }

  // 保存编辑
  const handleSaveEdit = () => {
    if (!editingNoteId || (!editingContent.trim() && editingImages.length === 0)) return

    setNotes(prev => prev.map(n =>
      n.id === editingNoteId
        ? {
            ...n,
            content: editingContent.trim(),
            images: editingImages,
            updatedAt: new Date().toISOString()
          }
        : n
    ))

    setEditingNoteId(null)
    setEditingContent('')
    setEditingImages([])
  }

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingNoteId(null)
    setEditingContent('')
    setEditingImages([])
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

    // 删除快记
    setNotes(prev => prev.filter(n => n.id !== deleteConfirmId))

    // 删除相关引用关系
    setReferences(prev => prev.filter(r =>
      r.sourceNoteId !== deleteConfirmId && r.targetNoteId !== deleteConfirmId
    ))

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

  // ==================== 延展功能 ====================

  // 开始延展（激活延展模式，聚焦输入框）
  const handleStartExtend = (noteId) => {
    const targetNote = noteId ? notes.find(n => n.id === noteId) : selectedNote
    if (!targetNote) return

    setExtendingNoteId(targetNote.id)
    // 聚焦输入框
    setTimeout(() => {
      if (inputFieldRef.current) {
        inputFieldRef.current.focus()
      }
    }, 100)
  }

  // 取消延展模式
  const handleCancelExtend = () => {
    setExtendingNoteId(null)
  }

  // 跳转到引用的快记
  const handleGoToNote = (noteId) => {
    const note = notes.find(n => n.id === noteId)
    if (note) {
      setSelectedTopicId(note.topicId)
      setSelectedNoteId(noteId)
    }
  }

  // ==================== 右键菜单 ====================

  // 打开右键菜单
  const handleContextMenu = (e, noteId) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      noteId
    })
  }

  // 关闭右键菜单
  const closeContextMenu = () => {
    setContextMenu(null)
  }

  // 右键菜单操作
  const handleContextAction = (action) => {
    if (!contextMenu) return
    const noteId = contextMenu.noteId
    const note = notes.find(n => n.id === noteId)

    closeContextMenu()

    switch (action) {
      case 'copy':
        if (note) {
          navigator.clipboard.writeText(note.content)
        }
        break
      case 'edit':
        setSelectedNoteId(noteId)
        setTimeout(() => handleStartEdit(), 100)
        break
      case 'extend':
        handleStartExtend(noteId)
        break
      case 'move':
        setSelectedNoteId(noteId)
        setTimeout(() => setShowMoveTopic(true), 100)
        break
      case 'delete':
        setSelectedNoteId(noteId)
        setTimeout(() => setDeleteConfirmId(noteId), 100)
        break
      default:
        break
    }
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
              {currentNotes.map(note => {
                const sourceNote = getSourceNote(note.id)
                const extendedCount = getExtendedCount(note.id)
                const imageCount = note.images?.length || 0

                return (
                  <div
                    key={note.id}
                    className={`bubble-item ${selectedNoteId === note.id ? 'selected' : ''}`}
                    onClick={() => handleNoteClick(note.id)}
                    onContextMenu={(e) => handleContextMenu(e, note.id)}
                  >
                    {/* 引用来源提示 - 在气泡顶部 */}
                    {sourceNote && (
                      <div className="bubble-reference-hint">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
                        </svg>
                        <span className="hint-text">延展自</span>
                        <span
                          className="hint-source"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleGoToNote(sourceNote.id)
                          }}
                        >
                          {truncateText(sourceNote.content, 20)}
                        </span>
                      </div>
                    )}

                    {/* 快记内容 */}
                    <div className="bubble-content">{truncateText(note.content, 100)}</div>

                    {/* 图片网格展示 */}
                    {imageCount > 0 && (
                      <div className={`bubble-images count-${Math.min(imageCount, 3)}${imageCount > 3 ? ' count-many' : ''}`}>
                        {note.images.slice(0, 4).map((img, idx) => (
                          <div key={idx} className="bubble-image-item">
                            <img src={img} alt="" />
                            {idx === 3 && imageCount > 4 && (
                              <div className="bubble-images-more-overlay">+{imageCount - 4}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 被延展提示 - 在内容下方 */}
                    {extendedCount > 0 && (
                      <div className="bubble-extended-hint">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"/>
                        </svg>
                        <span>有 {extendedCount} 条延展</span>
                      </div>
                    )}

                    {/* 元信息 */}
                    <div className="bubble-meta">
                      <span className="bubble-time">{formatTime(note.updatedAt || note.createdAt)}</span>
                      {note.updatedAt && note.updatedAt !== note.createdAt && (
                        <span className="bubble-edited">已编辑</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className={`input-bar ${extendingNote ? 'extending-mode' : ''}`}>
          {/* 延展提示条 */}
          {extendingNote && (
            <div className="input-extending-hint">
              <div className="extending-hint-content">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"/>
                </svg>
                <span className="extending-label">延展自：</span>
                <span className="extending-source">{truncateText(extendingNote.content, 30)}</span>
              </div>
              <button className="extending-cancel" onClick={handleCancelExtend}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          )}

          <div className="input-main">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleImageUpload(e.target.files, setInputImages, inputImages)}
            />
            <button
              className="input-icon-btn"
              onClick={() => imageInputRef.current?.click()}
              title="上传图片"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
            </button>
            <div className="input-wrapper">
              {inputImages.length > 0 && (
                <div className="input-images-preview">
                  {inputImages.map((img, idx) => (
                    <div key={idx} className="input-image-item">
                      <img src={img} alt="" />
                      <button
                        className="input-image-remove"
                        onClick={() => handleRemoveImage(idx, setInputImages, inputImages)}
                      >×</button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={inputFieldRef}
                className="input-field"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={extendingNote ? "写下延展的想法…" : "记录此刻想法…"}
                rows={2}
              />
            </div>
            <button
              className={`send-btn ${canSend ? 'active' : ''} ${extendingNote ? 'extending' : ''}`}
              disabled={!canSend}
              onClick={handleSend}
            >
              {extendingNote ? '延展' : '发送'}
            </button>
          </div>
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

                  {/* 编辑图片 */}
                  <input
                    ref={editImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={(e) => handleImageUpload(e.target.files, setEditingImages, editingImages)}
                  />

                  {editingImages.length > 0 && (
                    <div className="detail-edit-images">
                      {editingImages.map((img, idx) => (
                        <div key={idx} className="detail-edit-image-item">
                          <img src={img} alt="" />
                          <button
                            className="detail-edit-image-remove"
                            onClick={() => handleRemoveImage(idx, setEditingImages, editingImages)}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    className="detail-add-image-btn"
                    onClick={() => editImageInputRef.current?.click()}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                    </svg>
                    添加图片
                  </button>

                  <div className="detail-edit-hint">Ctrl/Cmd + Enter 保存，Esc 取消</div>
                  <div className="detail-edit-actions">
                    <button className="detail-btn secondary" onClick={handleCancelEdit}>取消</button>
                    <button
                      className="detail-btn primary"
                      onClick={handleSaveEdit}
                      disabled={!editingContent.trim() && editingImages.length === 0}
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                /* 查看模式 */
                <div className="detail-view">
                  <div className="detail-note-content">{selectedNote.content}</div>

                  {/* 图片展示 */}
                  {selectedNote.images && selectedNote.images.length > 0 && (
                    <div className="detail-images">
                      {selectedNote.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt=""
                          className="detail-image"
                          onClick={() => window.open(img, '_blank')}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 引用关系展示 */}
            {editingNoteId !== selectedNote.id && (
              <>
                {/* 区块一：引用来源 - 当前快记延展自哪条 */}
                {getReferencesFrom(selectedNote.id).length > 0 && (
                  <div className="detail-references-section source-section">
                    <div className="detail-references-header">
                      <div className="detail-references-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
                        </svg>
                      </div>
                      <span className="detail-references-title">引用来源</span>
                      <span className="detail-references-subtitle">这条快记延展自</span>
                    </div>
                    <div className="detail-references-list">
                      {getReferencesFrom(selectedNote.id).map(note => (
                        <div
                          key={note.id}
                          className="detail-reference-card"
                          onClick={() => handleGoToNote(note.id)}
                        >
                          <div className="reference-card-content">{truncateText(note.content, 80)}</div>
                          <div className="reference-card-footer">
                            <span className="reference-card-time">{formatFullTime(note.createdAt)}</span>
                            <svg className="reference-card-arrow" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                            </svg>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 区块二：后续延展 - 哪些快记延展了当前快记 */}
                {getReferencesTo(selectedNote.id).length > 0 && (
                  <div className="detail-references-section extended-section">
                    <div className="detail-references-header">
                      <div className="detail-references-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"/>
                        </svg>
                      </div>
                      <span className="detail-references-title">后续延展</span>
                      <span className="detail-references-subtitle">{getReferencesTo(selectedNote.id).length} 条思路延展</span>
                    </div>
                    <div className="detail-references-list">
                      {getReferencesTo(selectedNote.id).map(note => (
                        <div
                          key={note.id}
                          className="detail-reference-card"
                          onClick={() => handleGoToNote(note.id)}
                        >
                          <div className="reference-card-content">{truncateText(note.content, 80)}</div>
                          <div className="reference-card-footer">
                            <span className="reference-card-time">{formatFullTime(note.createdAt)}</span>
                            <svg className="reference-card-arrow" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                            </svg>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 操作按钮 */}
            {editingNoteId !== selectedNote.id && (
              <div className="detail-actions">
                <button className="detail-btn" onClick={() => handleStartExtend()}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"/>
                  </svg>
                  延展
                </button>
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

      {/* 8. 右键菜单 */}
      {contextMenu && (
        <>
          <div className="context-menu-overlay" onClick={closeContextMenu} />
          <div
            className="context-menu"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 180),
              top: Math.min(contextMenu.y, window.innerHeight - 320)
            }}
          >
            <div className="context-menu-item" onClick={() => handleContextAction('copy')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
              </svg>
              复制
            </div>
            <div className="context-menu-item" onClick={() => handleContextAction('edit')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              重新编辑
            </div>
            <div className="context-menu-item" onClick={() => handleContextAction('extend')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 15l-6 6-1.42-1.42L15.17 16H4V4h2v10h9.17l-3.59-3.58L13 9l6 6z"/>
              </svg>
              延展
            </div>
            <div className="context-menu-divider" />
            <div className="context-menu-item" onClick={() => handleContextAction('move')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/>
              </svg>
              变更主题
            </div>
            <div className="context-menu-divider" />
            <div className="context-menu-item danger" onClick={() => handleContextAction('delete')}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
              </svg>
              删除
            </div>
          </div>
        </>
      )}

      {/* 9. 设置面板 */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onDataChange={handleDataChange}
      />
    </div>
  )
}

export default App
