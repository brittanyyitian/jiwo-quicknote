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

  // 引用弹窗
  const [showReferenceModal, setShowReferenceModal] = useState(false)
  const [referenceContent, setReferenceContent] = useState('')
  const [referenceImages, setReferenceImages] = useState([])

  // Refs
  const bubbleAreaRef = useRef(null)
  const editTextareaRef = useRef(null)
  const imageInputRef = useRef(null)
  const editImageInputRef = useRef(null)
  const referenceImageInputRef = useRef(null)

  // 获取选中的快记
  const selectedNote = notes.find(n => n.id === selectedNoteId)

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

  // 当前主题的快记（按更新/创建时间倒序，最新在最上面）
  const currentNotes = notes
    .filter(n => n.topicId === selectedTopicId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))

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

  // 创建快记
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
    setShowReferenceModal(false)
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

  // ==================== 引用功能 ====================

  // 打开引用弹窗
  const handleOpenReference = () => {
    setShowReferenceModal(true)
    setReferenceContent('')
    setReferenceImages([])
  }

  // 创建引用
  const handleCreateReference = () => {
    if (!selectedNote || (!referenceContent.trim() && referenceImages.length === 0)) return

    // 创建新快记
    const newNote = createNote({
      topicId: selectedTopicId,
      content: referenceContent.trim(),
      images: referenceImages
    })

    // 创建引用关系
    const newReference = createReference({
      sourceNoteId: newNote.id,
      targetNoteId: selectedNote.id
    })

    setNotes(prev => [newNote, ...prev])
    setReferences(prev => [...prev, newReference])

    // 关闭弹窗
    setShowReferenceModal(false)
    setReferenceContent('')
    setReferenceImages([])

    // 选中新创建的快记
    setSelectedNoteId(newNote.id)
  }

  // 跳转到引用的快记
  const handleGoToNote = (noteId) => {
    const note = notes.find(n => n.id === noteId)
    if (note) {
      setSelectedTopicId(note.topicId)
      setSelectedNoteId(noteId)
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
              {currentNotes.map(note => (
                <div
                  key={note.id}
                  className={`bubble-item ${selectedNoteId === note.id ? 'selected' : ''}`}
                  onClick={() => handleNoteClick(note.id)}
                >
                  <div className="bubble-content">{truncateText(note.content, 100)}</div>

                  {/* 图片预览 */}
                  {note.images && note.images.length > 0 && (
                    <div className="bubble-images-preview">
                      {note.images.slice(0, 3).map((img, idx) => (
                        <img key={idx} src={img} alt="" className="bubble-image-thumb" />
                      ))}
                      {note.images.length > 3 && (
                        <span className="bubble-images-more">+{note.images.length - 3}</span>
                      )}
                    </div>
                  )}

                  <div className="bubble-meta">
                    <span className="bubble-time">{formatTime(note.updatedAt || note.createdAt)}</span>
                    {note.updatedAt && note.updatedAt !== note.createdAt && (
                      <span className="bubble-edited">已编辑</span>
                    )}
                    {hasReferences(note.id) && (
                      <span className="bubble-reference-badge" title="有引用关系">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                          <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                        </svg>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="input-bar">
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
                {/* 当前快记引用了哪些快记 */}
                {getReferencesFrom(selectedNote.id).length > 0 && (
                  <div className="detail-references-section">
                    <div className="detail-references-header">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                      </svg>
                      <span>引用了</span>
                    </div>
                    <div className="detail-references-list">
                      {getReferencesFrom(selectedNote.id).map(note => (
                        <div
                          key={note.id}
                          className="detail-reference-card"
                          onClick={() => handleGoToNote(note.id)}
                        >
                          <div className="reference-card-content">{truncateText(note.content, 60)}</div>
                          <div className="reference-card-time">{formatTime(note.createdAt)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 哪些快记引用了当前快记 */}
                {getReferencesTo(selectedNote.id).length > 0 && (
                  <div className="detail-references-section">
                    <div className="detail-references-header">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                      </svg>
                      <span>被引用</span>
                    </div>
                    <div className="detail-references-list">
                      {getReferencesTo(selectedNote.id).map(note => (
                        <div
                          key={note.id}
                          className="detail-reference-card"
                          onClick={() => handleGoToNote(note.id)}
                        >
                          <div className="reference-card-content">{truncateText(note.content, 60)}</div>
                          <div className="reference-card-time">{formatTime(note.createdAt)}</div>
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
                <button className="detail-btn" onClick={handleOpenReference}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
                  </svg>
                  引用
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

      {/* 8. 引用弹窗 */}
      {showReferenceModal && selectedNote && (
        <div className="modal-overlay" onClick={() => setShowReferenceModal(false)}>
          <div className="modal-dialog reference-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">引用这条快记</h3>
            </div>
            <div className="modal-body">
              {/* 被引用的快记预览 */}
              <div className="reference-target-preview">
                <div className="reference-target-label">引用内容</div>
                <div className="reference-target-content">
                  {truncateText(selectedNote.content, 100)}
                </div>
              </div>

              {/* 新快记输入 */}
              <div className="reference-input-section">
                <label className="reference-input-label">你的想法</label>
                <textarea
                  className="reference-textarea"
                  value={referenceContent}
                  onChange={(e) => setReferenceContent(e.target.value)}
                  placeholder="写下你的想法..."
                  autoFocus
                />

                {/* 图片上传 */}
                <input
                  ref={referenceImageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => handleImageUpload(e.target.files, setReferenceImages, referenceImages)}
                />

                {referenceImages.length > 0 && (
                  <div className="reference-images-preview">
                    {referenceImages.map((img, idx) => (
                      <div key={idx} className="reference-image-item">
                        <img src={img} alt="" />
                        <button
                          className="reference-image-remove"
                          onClick={() => handleRemoveImage(idx, setReferenceImages, referenceImages)}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  className="reference-add-image-btn"
                  onClick={() => referenceImageInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
                  </svg>
                  添加图片
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-btn" onClick={() => setShowReferenceModal(false)}>取消</button>
              <button
                className="modal-btn primary"
                onClick={handleCreateReference}
                disabled={!referenceContent.trim() && referenceImages.length === 0}
              >
                创建引用
              </button>
            </div>
          </div>
        </div>
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
