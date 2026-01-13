import { useState, useEffect, useCallback, useRef } from 'react'
import './App.css'

// 数据层
import {
  DEFAULT_TOPIC_ID,
  ASK_TOPIC_ID,
  AI_STATUS,
  NOTE_SOURCE,
  createTopic,
  createNote,
  createAIResponse,
  initializeStorage,
  saveTopics,
  saveNotes,
  saveAIResponses,
  loadAIResponses
} from './data/index.js'

// AI 服务
import { judgeNeedsAIResponse, generateAIResponse } from './services/ai.js'

// 组件
import SettingsPanel from './components/SettingsPanel.jsx'
import ClassificationPanel from './components/ClassificationPanel.jsx'

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

// 简单的文本相似度计算（临时，后续用向量）
function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0
  const words1 = new Set(text1.split(/\s+|[，。！？、；：""''（）]/))
  const words2 = new Set(text2.split(/\s+|[，。！？、；：""''（）]/))
  let commonCount = 0
  words1.forEach(word => {
    if (word.length > 1 && words2.has(word)) commonCount++
  })
  const totalWords = Math.max(words1.size, words2.size)
  return totalWords > 0 ? commonCount / totalWords : 0
}

function getRelatedNotes(currentNote, allNotes, limit = 5) {
  if (!currentNote || allNotes.length <= 1) return []
  const otherNotes = allNotes.filter(n => n.id !== currentNote.id && n.content)
  const scored = otherNotes.map(note => ({
    note,
    score: calculateSimilarity(currentNote.content, note.content)
  }))
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.note)
}

// ==================== 主组件 ====================

function App() {
  // 核心数据状态
  const [topics, setTopics] = useState([])
  const [notes, setNotes] = useState([])
  const [aiResponses, setAIResponses] = useState([])

  // UI 状态
  const [selectedTopicId, setSelectedTopicId] = useState(DEFAULT_TOPIC_ID)
  const [inputValue, setInputValue] = useState('')
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [showRelatedModal, setShowRelatedModal] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showClassification, setShowClassification] = useState(false)
  const [isSending, setIsSending] = useState(false)

  // Refs
  const bubbleAreaRef = useRef(null)

  // 获取选中的快记
  const selectedNote = notes.find(n => n.id === selectedNoteId)

  // 获取选中快记的 AI 回答
  const selectedNoteAIResponse = selectedNote?.aiResponseId
    ? aiResponses.find(r => r.id === selectedNote.aiResponseId)
    : null

  // 获取相关快记
  const relatedNotes = selectedNote ? getRelatedNotes(selectedNote, notes, 5) : []

  // ==================== 数据初始化与持久化 ====================

  useEffect(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
    setAIResponses(data.aiResponses)
  }, [])

  useEffect(() => {
    if (topics.length > 0) saveTopics(topics)
  }, [topics])

  useEffect(() => {
    if (notes.length > 0) saveNotes(notes)
  }, [notes])

  useEffect(() => {
    if (aiResponses.length > 0) saveAIResponses(aiResponses)
  }, [aiResponses])

  const handleDataChange = useCallback(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
    setAIResponses(data.aiResponses)
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

  // ==================== 主题相关 ====================

  const selectedTopic = selectedTopicId === ASK_TOPIC_ID
    ? { id: ASK_TOPIC_ID, title: '问一问' }
    : topics.find(t => t.id === selectedTopicId)

  const getTopicPreview = (topicId) => {
    if (topicId === ASK_TOPIC_ID) {
      const askNotes = notes.filter(n => n.source === NOTE_SOURCE.ASK_CONVERSATION && n.aiStatus === AI_STATUS.DONE)
      return askNotes[0]?.content || '向 AI 提问，基于你的快记回答'
    }
    const topicNotes = notes
      .filter(n => n.topicId === topicId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    return topicNotes[0]?.content || '暂无快记'
  }

  const getTopicTime = (topicId) => {
    let topicNotes
    if (topicId === ASK_TOPIC_ID) {
      topicNotes = notes.filter(n =>
        (n.source === NOTE_SOURCE.ASK_CONVERSATION || n.source === NOTE_SOURCE.EXTERNAL_TRIGGER) &&
        n.aiStatus === AI_STATUS.DONE
      )
    } else {
      topicNotes = notes.filter(n => n.topicId === topicId)
    }
    topicNotes = topicNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    if (topicNotes.length === 0) return ''
    const date = new Date(topicNotes[0].createdAt)
    const today = new Date()
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }

  const askNotesCount = notes.filter(n =>
    (n.source === NOTE_SOURCE.ASK_CONVERSATION || n.source === NOTE_SOURCE.EXTERNAL_TRIGGER) &&
    n.aiStatus === AI_STATUS.DONE
  ).length

  // 当前主题的快记（按时间正序，最新在最下面）
  const currentNotes = selectedTopicId === ASK_TOPIC_ID
    ? []
    : notes
        .filter(n => n.topicId === selectedTopicId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  // 问一问的对话记录（来自问一问主题的提问）
  const askConversations = notes
    .filter(n => n.source === NOTE_SOURCE.ASK_CONVERSATION)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))  // 按时间正序，像聊天一样

  // ==================== 发送快记（异步 AI 调用）====================

  const canSend = inputValue.trim().length > 0 && !isSending

  const handleSend = async () => {
    if (!canSend) return

    const content = inputValue.trim()
    setInputValue('')
    setIsSending(true)

    try {
      const isInAskTopic = selectedTopicId === ASK_TOPIC_ID

      // 1. 判断是否需要 AI 回答
      let needsAI = isInAskTopic  // 问一问中强制触发
      if (!isInAskTopic) {
        // 其他主题用 AI 判断
        const judgment = await judgeNeedsAIResponse(content)
        needsAI = judgment.needsResponse
        console.log('AI 判断结果:', judgment)
      }

      // 2. 创建快记
      const newNote = createNote({
        topicId: isInAskTopic ? DEFAULT_TOPIC_ID : selectedTopicId,
        content: content,
        source: needsAI
          ? (isInAskTopic ? NOTE_SOURCE.ASK_CONVERSATION : NOTE_SOURCE.EXTERNAL_TRIGGER)
          : NOTE_SOURCE.NORMAL
      })

      if (needsAI) {
        // 先设置为处理中状态
        newNote.aiStatus = AI_STATUS.PROCESSING
      }

      // 3. 先添加快记到列表（显示处理中状态）
      setNotes(prev => [newNote, ...prev])

      // 4. 如果需要 AI 回答，异步获取
      if (needsAI) {
        try {
          const response = await generateAIResponse(content, notes)
          console.log('AI 回答:', response)

          const aiResponse = createAIResponse({
            noteId: newNote.id,
            content: response.content,
            model: response.metadata?.model || 'qwen-turbo',
            usedWebSearch: response.usedWebSearch || false,
            sourceNoteIds: response.sourceNoteIds || [],
            metadata: response.metadata || {}
          })

          // 更新快记状态
          setNotes(prev => prev.map(n =>
            n.id === newNote.id
              ? { ...n, aiStatus: AI_STATUS.DONE, aiResponseId: aiResponse.id, updatedAt: new Date().toISOString() }
              : n
          ))

          // 添加 AI 回答
          setAIResponses(prev => [aiResponse, ...prev])

        } catch (error) {
          console.error('AI 回答失败:', error)
          // 更新为错误状态
          setNotes(prev => prev.map(n =>
            n.id === newNote.id
              ? { ...n, aiStatus: AI_STATUS.ERROR, updatedAt: new Date().toISOString() }
              : n
          ))
        }
      }

    } catch (error) {
      console.error('发送失败:', error)
    } finally {
      setIsSending(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ==================== 快记详情 ====================

  const handleNoteClick = (noteId) => {
    setSelectedNoteId(noteId)
  }

  const handleCloseDetail = () => {
    setSelectedNoteId(null)
    setShowRelatedModal(false)
  }

  const handleRelatedNoteClick = (noteId) => {
    setSelectedNoteId(noteId)
    setShowRelatedModal(false)
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
          <button className="new-btn">+</button>
        </div>

        <div className="topic-list">
          {/* 问一问 */}
          <div
            className={`topic-item topic-item-ask ${selectedTopicId === ASK_TOPIC_ID ? 'selected' : ''}`}
            onClick={() => setSelectedTopicId(ASK_TOPIC_ID)}
          >
            <div className="topic-avatar topic-avatar-ask">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
              </svg>
            </div>
            <div className="topic-info">
              <div className="topic-header">
                <span className="topic-title">问一问</span>
                <span className="topic-time">{getTopicTime(ASK_TOPIC_ID)}</span>
              </div>
              <div className="topic-preview">{truncateText(getTopicPreview(ASK_TOPIC_ID), 20)}</div>
            </div>
            {askNotesCount > 0 && (
              <div className="topic-badge">{askNotesCount}</div>
            )}
          </div>

          <div className="topic-divider"></div>

          {/* 普通主题 */}
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
            </div>
          ))}
        </div>
      </aside>

      {/* 3. 主内容区 */}
      <main className="main-content">
        <header className="content-header">
          <h2 className="content-title">{selectedTopic?.title || '快记'}</h2>
          <button className="more-btn">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2"/>
              <circle cx="12" cy="12" r="2"/>
              <circle cx="12" cy="19" r="2"/>
            </svg>
          </button>
        </header>

        <div className="bubble-area" ref={bubbleAreaRef}>
          {selectedTopicId === ASK_TOPIC_ID ? (
            /* 问一问：对话气泡形式 */
            <div className="ask-conversation-area">
              {askConversations.length === 0 ? (
                <div className="empty-notes">
                  <div className="empty-ask-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                    </svg>
                  </div>
                  <p>向 AI 提问</p>
                  <p className="empty-hint">基于你的快记来回答问题，支持联网搜索</p>
                </div>
              ) : (
                <div className="conversation-list">
                  {askConversations.map(note => {
                    const noteAIResponse = note.aiResponseId
                      ? aiResponses.find(r => r.id === note.aiResponseId)
                      : null

                    return (
                      <div key={note.id} className="conversation-item">
                        {/* 用户问题 - 右侧 */}
                        <div className="conversation-user">
                          <div className="conversation-bubble user-bubble">
                            <div className="conversation-content">{note.content}</div>
                          </div>
                          <div className="conversation-avatar user-avatar">我</div>
                        </div>
                        <div className="conversation-time user-time">{formatTime(note.createdAt)}</div>

                        {/* AI 回答 - 左侧 */}
                        {note.aiStatus === AI_STATUS.PROCESSING && (
                          <div className="conversation-ai">
                            <div className="conversation-avatar ai-avatar">
                              <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                              </svg>
                            </div>
                            <div className="conversation-bubble ai-bubble thinking">
                              <div className="thinking-dots">
                                <span></span><span></span><span></span>
                              </div>
                            </div>
                          </div>
                        )}

                        {note.aiStatus === AI_STATUS.DONE && noteAIResponse && (
                          <>
                            <div className="conversation-ai">
                              <div className="conversation-avatar ai-avatar">
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                                </svg>
                              </div>
                              <div className="conversation-bubble ai-bubble">
                                <div className="conversation-content">{noteAIResponse.content}</div>
                                {noteAIResponse.usedWebSearch && (
                                  <div className="ai-search-badge">
                                    <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                                      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                                    </svg>
                                    <span>已联网搜索</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="conversation-time ai-time">
                              {formatTime(noteAIResponse.createdAt)}
                              {noteAIResponse.metadata?.model && ` · ${noteAIResponse.metadata.model}`}
                            </div>
                          </>
                        )}

                        {note.aiStatus === AI_STATUS.ERROR && (
                          <div className="conversation-ai">
                            <div className="conversation-avatar ai-avatar error">
                              <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                              </svg>
                            </div>
                            <div className="conversation-bubble ai-bubble error">
                              <div className="conversation-content">抱歉，AI 回答失败，请重试</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bubble-list">
              {currentNotes.length === 0 ? (
                <div className="empty-notes">
                  <p>还没有快记</p>
                  <p className="empty-hint">在下方输入框写下第一条吧</p>
                </div>
              ) : (
                currentNotes.map(note => {
                  const noteAIResponse = note.aiResponseId
                    ? aiResponses.find(r => r.id === note.aiResponseId)
                    : null

                  return (
                    <div key={note.id} className="bubble-wrapper">
                      <div className="bubble-row">
                        <div
                          className={`bubble ${note.aiStatus === AI_STATUS.DONE ? 'has-ai' : ''}`}
                          onClick={() => handleNoteClick(note.id)}
                        >
                          <div className="bubble-content">{note.content}</div>

                          {/* AI 处理中 */}
                          {note.aiStatus === AI_STATUS.PROCESSING && (
                            <div className="ai-badge thinking">
                              <div className="thinking-dots-inline">
                                <span></span><span></span><span></span>
                              </div>
                              <span>AI 思考中</span>
                            </div>
                          )}

                          {/* AI 已回应 */}
                          {note.aiStatus === AI_STATUS.DONE && noteAIResponse && (
                            <div className="ai-badge">
                              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                              </svg>
                              <span>AI 已回应</span>
                            </div>
                          )}

                          {/* AI 错误 */}
                          {note.aiStatus === AI_STATUS.ERROR && (
                            <div className="ai-badge error">
                              <span>AI 回应失败</span>
                            </div>
                          )}
                        </div>
                        <div className="bubble-avatar">我</div>
                      </div>
                      <div className="bubble-time">{formatTime(note.createdAt)}</div>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="input-bar">
          <button className="input-icon-btn">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
            </svg>
          </button>
          <div className="input-wrapper">
            <textarea
              className="input-field"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedTopicId === ASK_TOPIC_ID ? "向 AI 提问…" : "记录此刻想法…"}
              rows={1}
              disabled={isSending}
            />
          </div>
          <button
            className={`send-btn ${canSend ? 'active' : ''}`}
            disabled={!canSend}
            onClick={handleSend}
          >
            {isSending ? '发送中...' : '发送'}
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

          <div className="detail-content">
            <div className="detail-meta">
              <div className="detail-avatar">我</div>
              <div className="detail-info">
                <span className="detail-nickname">我</span>
                <span className="detail-time">{formatFullTime(selectedNote.createdAt)}</span>
              </div>
            </div>

            <div className="detail-note-content">{selectedNote.content}</div>

            {/* AI 处理中 */}
            {selectedNote.aiStatus === AI_STATUS.PROCESSING && (
              <div className="detail-ai-section">
                <div className="detail-ai-header">
                  <div className="detail-ai-avatar">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                    </svg>
                  </div>
                  <div className="detail-ai-info">
                    <span className="detail-ai-label">AI 回答</span>
                    <span className="detail-ai-time">思考中...</span>
                  </div>
                </div>
                <div className="detail-ai-content thinking">
                  <div className="thinking-dots">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}

            {/* AI 已回应 */}
            {selectedNote.aiStatus === AI_STATUS.DONE && selectedNoteAIResponse && (
              <div className="detail-ai-section">
                <div className="detail-ai-header">
                  <div className="detail-ai-avatar">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
                    </svg>
                  </div>
                  <div className="detail-ai-info">
                    <span className="detail-ai-label">AI 回答</span>
                    <span className="detail-ai-time">
                      {formatFullTime(selectedNoteAIResponse.createdAt)}
                      {selectedNoteAIResponse.metadata?.model && ` · ${selectedNoteAIResponse.metadata.model}`}
                    </span>
                  </div>
                </div>
                <div className="detail-ai-content">{selectedNoteAIResponse.content}</div>

                {/* 联网搜索标记 */}
                {selectedNoteAIResponse.usedWebSearch && (
                  <div className="detail-ai-search-badge">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                      <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                    <span>已联网搜索</span>
                  </div>
                )}

                {/* 参考快记 */}
                {selectedNoteAIResponse.sourceNoteIds?.length > 0 && (
                  <div className="detail-ai-sources">
                    <div className="detail-ai-sources-title">参考了以下快记：</div>
                    <div className="detail-ai-sources-list">
                      {selectedNoteAIResponse.sourceNoteIds.slice(0, 5).map(noteId => {
                        const sourceNote = notes.find(n => n.id === noteId)
                        if (!sourceNote) return null
                        return (
                          <div
                            key={noteId}
                            className="detail-ai-source-item"
                            onClick={() => handleRelatedNoteClick(noteId)}
                          >
                            <span className="source-item-content">{truncateText(sourceNote.content, 30)}</span>
                            <span className="source-item-time">{formatTime(sourceNote.createdAt)}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 相关快记 */}
            {relatedNotes.length > 0 && (
              <div className="detail-related-section">
                <div className="detail-related-header">
                  <span className="detail-related-title">相关快记</span>
                  <button
                    className="detail-related-more"
                    onClick={() => setShowRelatedModal(true)}
                  >
                    查看全部
                  </button>
                </div>
                <div className="related-cards">
                  {relatedNotes.slice(0, 3).map(note => (
                    <div
                      key={note.id}
                      className="related-card"
                      onClick={() => handleRelatedNoteClick(note.id)}
                    >
                      <div className="related-card-content">{truncateText(note.content)}</div>
                      <div className="related-card-time">{formatTime(note.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* 5. 相关快记弹窗 */}
      {showRelatedModal && selectedNote && (
        <div className="modal-overlay" onClick={() => setShowRelatedModal(false)}>
          <div className="related-modal" onClick={e => e.stopPropagation()}>
            <div className="related-modal-header">
              <h3 className="related-modal-title">相关快记</h3>
              <button
                className="related-modal-close"
                onClick={() => setShowRelatedModal(false)}
              >
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
            <div className="related-modal-content">
              {relatedNotes.map(note => (
                <div
                  key={note.id}
                  className="related-modal-card"
                  onClick={() => handleRelatedNoteClick(note.id)}
                >
                  <div className="related-modal-card-content">{note.content}</div>
                  <div className="related-modal-card-meta">
                    <span className="related-modal-card-time">{formatFullTime(note.createdAt)}</span>
                    {note.aiStatus === AI_STATUS.DONE && (
                      <span className="related-modal-card-ai">AI 已回应</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. 设置面板 */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onDataChange={handleDataChange}
        onOpenClassification={() => setShowClassification(true)}
      />

      {/* 7. AI 自动分类面板 */}
      <ClassificationPanel
        isOpen={showClassification}
        onClose={() => setShowClassification(false)}
        notes={notes}
        topics={topics}
        onDataChange={handleDataChange}
        saveTopics={setTopics}
        saveNotes={setNotes}
      />
    </div>
  )
}

export default App
