import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import './App.css'

// 数据层
import {
  DEFAULT_TOPIC_ID,
  ASK_TOPIC_ID,
  AI_STATUS,
  AI_TRIGGER,
  AI_MENTION_PATTERNS,
  NOTE_SOURCE,
  createTopic,
  createNote,
  createAIResponse,
  createReference,
  initializeStorage,
  initializeStorageAsync,
  saveTopics,
  saveNotes,
  saveReferences,
  saveAIResponses,
  loadAIResponses
} from './data/index.js'

// AI 服务
import {
  generateAIResponse,
  judgeNeedsAIResponse
} from './services/ai.js'

// 分类服务
import {
  initClassifier,
  enqueueNote,
  cleanupNoteClassification,
  getClassificationStatus,
  reclassifyAll
} from './services/incrementalClassifier.js'

// Embedding 服务
import {
  findSimilarNotes
} from './services/embedding.js'

// 数据层 - embeddings
import {
  loadEmbeddings,
  getEmbeddingByNoteId
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

/**
 * 检测文本中是否包含 @AI 触发词
 * @param {string} text - 要检测的文本
 * @returns {boolean} 是否包含 @AI
 */
function detectAIMention(text) {
  if (!text) return false
  return AI_MENTION_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * 获取触发方式的显示文本
 * @param {string} trigger - 触发方式
 * @returns {string} 显示文本
 */
function getTriggerLabel(trigger) {
  switch (trigger) {
    case AI_TRIGGER.AUTO:
      return '自动判断'
    case AI_TRIGGER.ASK:
      return '问一问'
    case AI_TRIGGER.MENTION:
      return '@AI 触发'
    default:
      return '未知'
  }
}

// ==================== 主组件 ====================

function App() {
  // 核心数据状态
  const [topics, setTopics] = useState([])
  const [notes, setNotes] = useState([])
  const [references, setReferences] = useState([])
  const [aiResponses, setAIResponses] = useState([])

  // AI 回答状态
  const [aiProcessing, setAiProcessing] = useState(false)

  // UI 状态
  const [selectedTopicId, setSelectedTopicId] = useState(DEFAULT_TOPIC_ID)
  const [inputValue, setInputValue] = useState('')
  const [inputImages, setInputImages] = useState([])
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)

  // AI 分类状态（放在 App 级别，关闭设置面板也不会中断）
  const [isClassifying, setIsClassifying] = useState(false)
  const [classifyProgress, setClassifyProgress] = useState({ completed: 0, total: 0 })
  const [classifyResult, setClassifyResult] = useState(null)

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

  // 账户悬浮卡片
  const [showAccountCard, setShowAccountCard] = useState(false)

  // @ Mention 浮层
  const [showMentionPopover, setShowMentionPopover] = useState(false)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)

  // 智能体列表
  const agents = [
    { id: 'ai', name: 'AI 智能助手', desc: '通用问答，帮你解答问题', keyword: 'AI' },
    { id: 'asen', name: '阿森', desc: '私人知识助手', keyword: '阿森' },
    { id: 'assistant', name: '智能助手', desc: '智能对话与分析', keyword: '智能助手' },
    { id: 'helper', name: '小助手', desc: '快速帮你处理事务', keyword: '小助手' },
  ]

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

  // 计算使用统计
  const getUsageStats = () => {
    const totalNotes = notes.length
    const totalChars = notes.reduce((sum, n) => sum + (n.content?.length || 0), 0)
    const totalImages = notes.reduce((sum, n) => sum + (n.images?.length || 0), 0)

    // 计算使用天数
    let daysUsed = 1
    if (notes.length > 0) {
      const oldest = new Date(Math.min(...notes.map(n => new Date(n.createdAt))))
      const now = new Date()
      daysUsed = Math.max(1, Math.ceil((now - oldest) / (1000 * 60 * 60 * 24)))
    }

    return { totalNotes, totalChars, totalImages, daysUsed }
  }

  // 数据加载状态
  const [isLoading, setIsLoading] = useState(true)

  // ==================== 数据初始化与持久化 ====================

  useEffect(() => {
    // 异步初始化：先从服务器获取数据
    const init = async () => {
      setIsLoading(true)
      try {
        const data = await initializeStorageAsync()
        setTopics(data.topics)
        setNotes(data.notes)
        setReferences(data.references || [])
        setAIResponses(loadAIResponses())

        // 初始化分类服务
        initClassifier((status, classStatus) => {
          console.log('分类状态:', status, classStatus)
        })
      } catch (error) {
        console.error('初始化失败，使用本地数据:', error)
        const data = initializeStorage()
        setTopics(data.topics)
        setNotes(data.notes)
        setReferences(data.references || [])
        setAIResponses(loadAIResponses())
      } finally {
        setIsLoading(false)
      }
    }

    init()
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

  useEffect(() => {
    if (aiResponses.length > 0) saveAIResponses(aiResponses)
  }, [aiResponses])

  const handleDataChange = useCallback(() => {
    const data = initializeStorage()
    setTopics(data.topics)
    setNotes(data.notes)
    setReferences(data.references || [])
    setAIResponses(loadAIResponses())
  }, [])

  // AI 分类处理（在 App 级别，关闭设置面板也不会中断）
  const handleStartClassify = async () => {
    if (isClassifying) return

    setIsClassifying(true)
    setClassifyResult(null)
    setClassifyProgress({ completed: 0, total: 0 })

    try {
      const result = await reclassifyAll((completed, total) => {
        setClassifyProgress({ completed, total })
      })

      if (result.success) {
        setClassifyResult({
          success: true,
          message: `分类完成！共处理 ${result.stats.completed} 条快记，生成 ${result.stats.clusters} 个聚类`
        })
        handleDataChange()
      } else {
        setClassifyResult({
          success: false,
          message: '暂时无法完成分类，请稍后再试'
        })
      }
    } catch (error) {
      console.error('分类失败:', error)
      setClassifyResult({
        success: false,
        message: '暂时无法完成分类，请稍后再试'
      })
    } finally {
      setIsClassifying(false)
      setClassifyProgress({ completed: 0, total: 0 })
    }
  }

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

  // 问一问的快记（原生对话）
  const askNotes = notes
    .filter(n => n.topicId === ASK_TOPIC_ID)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

  // 外部主题触发的问答（收纳到问一问）
  const externalTriggeredNotes = notes
    .filter(n => n.topicId !== ASK_TOPIC_ID && n.source === 'external_trigger' && n.aiResponseId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) // 最新的在前

  // 有 embedding 的快记 ID 集合（用于快速判断是否可能有相关快记）
  const notesWithEmbedding = useMemo(() => {
    const embeddings = loadEmbeddings()
    return new Set(embeddings.map(e => e.noteId))
  }, [notes]) // notes 变化时重新计算

  // 判断快记是否可能有相关快记（有 embedding 且内容足够长）
  const hasRelatedNotes = (note) => {
    return note.content.length >= 10 && notesWithEmbedding.has(note.id)
  }

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

  // 判断是否在问一问模式
  const isAskMode = selectedTopicId === ASK_TOPIC_ID

  // 创建快记（支持延展模式）
  const canSend = inputValue.trim().length > 0 || inputImages.length > 0

  const handleSend = async () => {
    if (!canSend) return

    const content = inputValue.trim()
    setInputValue('')
    setInputImages([])

    // 检测是否包含 @AI 触发词（最高优先级）
    const hasMention = detectAIMention(content)

    // 在问一问模式下处理（强制触发 AI）
    if (isAskMode) {
      await handleAskSend(content)
      return
    }

    // 确定快记来源和初始 AI 状态
    const initialSource = hasMention ? NOTE_SOURCE.EXTERNAL_TRIGGER : NOTE_SOURCE.NORMAL
    const initialAiStatus = hasMention ? AI_STATUS.PENDING : AI_STATUS.NONE

    const newNote = createNote({
      topicId: selectedTopicId,
      content: content,
      images: inputImages,
      source: initialSource,
      aiStatus: initialAiStatus
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

    // 触发自动分类（异步，不阻塞 UI）
    setTimeout(() => {
      enqueueNote(newNote.id)
    }, 100)

    // 滚动到底部
    setTimeout(scrollToBottom, 50)

    // AI 触发逻辑
    if (hasMention) {
      // @AI 触发：强制生成 AI 回复
      handleAITrigger(newNote, AI_TRIGGER.MENTION)
    } else {
      // 自动语义判断：异步判断是否需要 AI 回答
      handleExternalAIJudge(newNote)
    }
  }

  // 统一的 AI 触发处理函数
  const handleAITrigger = async (note, trigger) => {
    try {
      // 更新快记状态为 processing
      setNotes(prev => prev.map(n =>
        n.id === note.id
          ? { ...n, aiStatus: AI_STATUS.PROCESSING, source: NOTE_SOURCE.EXTERNAL_TRIGGER }
          : n
      ))

      // 获取历史快记作为上下文
      const historyNotes = notes.filter(n => n.topicId !== ASK_TOPIC_ID && n.id !== note.id)

      // 调用 AI 生成回答
      const result = await generateAIResponse(note.content, historyNotes)

      if (result.success) {
        // 创建 AI 回答（包含触发方式）
        const aiResponse = createAIResponse({
          noteId: note.id,
          content: result.content,
          model: result.metadata?.model || 'qwen-turbo',
          trigger: trigger,  // 记录触发方式
          usedWebSearch: result.usedWebSearch,
          sourceNoteIds: result.sourceNoteIds,
          webSearchResult: result.webSearchResult,
          metadata: result.metadata
        })

        setAIResponses(prev => [...prev, aiResponse])

        // 更新快记状态
        setNotes(prev => prev.map(n =>
          n.id === note.id
            ? { ...n, aiStatus: AI_STATUS.DONE, aiResponseId: aiResponse.id, source: NOTE_SOURCE.EXTERNAL_TRIGGER }
            : n
        ))

        console.log(`[${getTriggerLabel(trigger)}] AI 回答完成:`, note.content.slice(0, 30))
      } else {
        // AI 回答失败
        setNotes(prev => prev.map(n =>
          n.id === note.id
            ? { ...n, aiStatus: AI_STATUS.ERROR }
            : n
        ))
      }
    } catch (error) {
      console.error(`[${getTriggerLabel(trigger)}] AI 触发出错:`, error)
      setNotes(prev => prev.map(n =>
        n.id === note.id
          ? { ...n, aiStatus: AI_STATUS.ERROR }
          : n
      ))
    }
  }

  // 外部主题快记的 AI 自动判断
  const handleExternalAIJudge = async (note) => {
    try {
      // 判断是否需要 AI 回答
      const judgeResult = await judgeNeedsAIResponse(note.content)
      console.log('AI 自动判断结果:', judgeResult)

      if (!judgeResult.needsResponse) {
        return // 不需要 AI 回答
      }

      // 更新快记状态为 pending
      setNotes(prev => prev.map(n =>
        n.id === note.id
          ? { ...n, aiStatus: AI_STATUS.PENDING, source: NOTE_SOURCE.EXTERNAL_TRIGGER }
          : n
      ))

      // 调用统一的 AI 触发处理（自动判断触发）
      await handleAITrigger(note, AI_TRIGGER.AUTO)
    } catch (error) {
      console.error('外部 AI 自动判断出错:', error)
    }
  }

  // 问一问模式发送处理
  const handleAskSend = async (content) => {
    // 检测是否包含 @AI（在问一问中，依然记录触发方式）
    const hasMention = detectAIMention(content)
    const trigger = hasMention ? AI_TRIGGER.MENTION : AI_TRIGGER.ASK

    // 创建用户问题快记
    const questionNote = createNote({
      topicId: ASK_TOPIC_ID,
      content: content,
      source: NOTE_SOURCE.ASK_CONVERSATION,
      aiStatus: AI_STATUS.PENDING
    })

    setNotes(prev => [...prev, questionNote])
    setTimeout(scrollToBottom, 50)

    // 设置 AI 处理状态
    setAiProcessing(true)

    try {
      // 获取历史快记作为上下文（不包含问一问的快记）
      const historyNotes = notes.filter(n => n.topicId !== ASK_TOPIC_ID)

      // 调用 AI 生成回答
      const result = await generateAIResponse(content, historyNotes)

      if (result.success) {
        // 创建 AI 回答（包含触发方式）
        const aiResponse = createAIResponse({
          noteId: questionNote.id,
          content: result.content,
          model: result.metadata?.model || 'qwen-turbo',
          trigger: trigger,  // 记录触发方式
          usedWebSearch: result.usedWebSearch,
          sourceNoteIds: result.sourceNoteIds,
          webSearchResult: result.webSearchResult,
          metadata: result.metadata
        })

        setAIResponses(prev => [...prev, aiResponse])

        // 更新快记状态
        setNotes(prev => prev.map(n =>
          n.id === questionNote.id
            ? { ...n, aiStatus: AI_STATUS.DONE, aiResponseId: aiResponse.id }
            : n
        ))

        console.log(`[${getTriggerLabel(trigger)}] 问一问 AI 回答完成`)
      } else {
        // AI 回答失败
        setNotes(prev => prev.map(n =>
          n.id === questionNote.id
            ? { ...n, aiStatus: AI_STATUS.ERROR }
            : n
        ))
      }
    } catch (error) {
      console.error('AI 回答出错:', error)
      setNotes(prev => prev.map(n =>
        n.id === questionNote.id
          ? { ...n, aiStatus: AI_STATUS.ERROR }
          : n
      ))
    } finally {
      setAiProcessing(false)
      setTimeout(scrollToBottom, 50)
    }
  }

  // 获取快记对应的 AI 回答
  const getAIResponseForNote = (noteId) => {
    return aiResponses.find(r => r.noteId === noteId)
  }

  // 获取相关快记（基于 embedding 相似度）
  // 相关快记 = 语义相似的快记，区别于延展（显式引用关系）
  const getRelatedNotes = (noteId, topN = 5) => {
    const noteEmbedding = getEmbeddingByNoteId(noteId)
    if (!noteEmbedding || !noteEmbedding.embedding) {
      return []
    }

    // 当前快记内容太短，不计算相关
    const currentNote = notes.find(n => n.id === noteId)
    if (!currentNote || currentNote.content.length < 10) {
      return []
    }

    // 使用 Map 加速查找
    const notesMap = new Map(notes.map(n => [n.id, n]))

    // 获取与当前快记有引用关系的快记 ID（排除这些）
    const referencedIds = new Set()
    for (const ref of references) {
      if (ref.sourceNoteId === noteId) referencedIds.add(ref.targetNoteId)
      if (ref.targetNoteId === noteId) referencedIds.add(ref.sourceNoteId)
    }

    const allEmbeddings = loadEmbeddings()
    // 排除：自己、问一问主题的快记、已有引用关系的快记、内容太短的快记
    const otherEmbeddings = allEmbeddings.filter(e => {
      if (e.noteId === noteId) return false
      if (referencedIds.has(e.noteId)) return false
      const note = notesMap.get(e.noteId)
      if (!note || note.topicId === ASK_TOPIC_ID) return false
      if (note.content.length < 10) return false  // 过滤短内容
      return true
    })

    const similarResults = findSimilarNotes(noteEmbedding.embedding, otherEmbeddings, topN)

    // 过滤掉相似度太低的结果，并关联完整的快记信息
    return similarResults
      .filter(r => r.similarity > 0.6) // 提高阈值到 0.6
      .map(r => ({
        ...r,
        note: notesMap.get(r.noteId)
      }))
      .filter(r => r.note) // 确保快记存在
  }

  // 输入框变化处理 - 检测 @
  const handleInputChange = (e) => {
    const value = e.target.value
    const prevValue = inputValue
    setInputValue(value)

    // 检测是否刚输入了 @
    if (value.length > prevValue.length) {
      const lastChar = value.slice(-1)
      if (lastChar === '@') {
        setShowMentionPopover(true)
        setMentionActiveIndex(0)
      }
    }

    // 如果浮层已打开，检测是否删除了 @ 或者有其他完整词
    if (showMentionPopover) {
      // 检测 @ 后面的内容
      const atIndex = value.lastIndexOf('@')
      if (atIndex === -1) {
        setShowMentionPopover(false)
      } else {
        const afterAt = value.slice(atIndex + 1)
        // 如果 @ 后面有空格或换行，关闭浮层
        if (afterAt.includes(' ') || afterAt.includes('\n')) {
          setShowMentionPopover(false)
        }
      }
    }
  }

  // 选择智能体
  const handleSelectAgent = (agent) => {
    // 替换 @ 及后面的字符为 @关键词
    const atIndex = inputValue.lastIndexOf('@')
    if (atIndex !== -1) {
      const newValue = inputValue.slice(0, atIndex) + '@' + agent.keyword + ' '
      setInputValue(newValue)
    }
    setShowMentionPopover(false)
    setMentionActiveIndex(0)
    inputFieldRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    // 如果 mention 浮层打开，处理键盘导航
    if (showMentionPopover) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionActiveIndex(prev => (prev + 1) % agents.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionActiveIndex(prev => (prev - 1 + agents.length) % agents.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        handleSelectAgent(agents[mentionActiveIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionPopover(false)
        return
      }
    }

    // 普通回车发送
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

    // 清理分类数据（embedding 和聚类关联）
    cleanupNoteClassification(deleteConfirmId)

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

  // ==================== 账户功能 ====================

  const handleOpenAccountCard = () => {
    setShowAccountCard(true)
  }

  const handleCloseAccountCard = () => {
    setShowAccountCard(false)
  }

  const handleOpenSettingsFromCard = () => {
    setShowAccountCard(false)
    setShowSettings(true)
  }

  const usageStats = getUsageStats()

  // ==================== 渲染 ====================

  // 加载中状态
  if (isLoading) {
    return (
      <div className="app-container loading-screen">
        <div className="loading-content">
          <div className="loading-icon">即</div>
          <div className="loading-text">正在加载数据...</div>
        </div>
      </div>
    )
  }

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
        </div>

        {/* 用户头像入口 - 在底部 */}
        <div className="nav-user">
          <div
            className={`nav-user-avatar ${showAccountCard ? 'active' : ''}`}
            onClick={handleOpenAccountCard}
            title="账户"
          >
            <span>我</span>
          </div>

          {/* 账户悬浮卡片 */}
          {showAccountCard && (
            <>
              <div className="account-card-overlay" onClick={handleCloseAccountCard} />
              <div className="account-card">
                {/* 用户信息区 */}
                <div className="account-user-info">
                  <div className="account-avatar">
                    <span>我</span>
                  </div>
                  <div className="account-user-details">
                    <div className="account-nickname">即我用户</div>
                    <div className="account-id">ID: jiwo_user_001</div>
                  </div>
                </div>

                {/* 使用统计卡片 */}
                <div className="account-stats-card">
                  <div className="stats-title">使用概览</div>
                  <div className="stats-items">
                    <div className="stats-item">
                      <span className="stats-value">{usageStats.daysUsed}</span>
                      <span className="stats-label">使用天数</span>
                    </div>
                    <div className="stats-item">
                      <span className="stats-value">{usageStats.totalNotes}</span>
                      <span className="stats-label">快记数量</span>
                    </div>
                    <div className="stats-item">
                      <span className="stats-value">{usageStats.totalChars}</span>
                      <span className="stats-label">总字数</span>
                    </div>
                  </div>
                </div>

                {/* 操作入口区 */}
                <div className="account-actions">
                  <div className="account-action-item" onClick={handleOpenSettingsFromCard}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                    </svg>
                    <span>设置</span>
                  </div>
                  <div className="account-action-item" onClick={handleCloseAccountCard}>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                      <path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z"/>
                    </svg>
                    <span>关于</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* 2. 主题列表 */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-title">快记</h1>
          <button className="new-btn" onClick={() => setShowNewTopic(true)} title="新建主题">+</button>
        </div>

        <div className="topic-list">
          {/* 问一问入口 */}
          <div
            className={`topic-item ask-topic ${selectedTopicId === ASK_TOPIC_ID ? 'selected' : ''}`}
            onClick={() => setSelectedTopicId(ASK_TOPIC_ID)}
          >
            <div className="topic-avatar ask-avatar">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
              </svg>
            </div>
            <div className="topic-info">
              <div className="topic-header">
                <span className="topic-title">问一问</span>
                {askNotes.length > 0 && (
                  <span className="topic-time">{getTopicTime(ASK_TOPIC_ID)}</span>
                )}
              </div>
              <div className="topic-preview ask-preview">AI 智能问答助手</div>
            </div>
          </div>

          <div className="topic-divider"></div>

          {/* 普通主题列表 */}
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
          <h2 className="content-title">{isAskMode ? '问一问' : (selectedTopic?.title || '快记')}</h2>
          {!isAskMode && <span className="content-count">{currentNotes.length} 条</span>}
          {isAskMode && <span className="content-count ask-badge">AI 助手</span>}
        </header>

        <div className="bubble-area" ref={bubbleAreaRef}>
          {/* 问一问模式 */}
          {isAskMode ? (
            askNotes.length === 0 && externalTriggeredNotes.length === 0 ? (
              <div className="empty-notes ask-empty">
                <div className="empty-icon ask-icon">
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
                  </svg>
                </div>
                <p>你好，我是即我 AI 助手</p>
                <p className="empty-hint">可以问我任何问题，我会基于你的快记内容和联网搜索来回答</p>
              </div>
            ) : (
              <div className="ask-content">
                {/* 外部主题触发的问答 - 卡片区 */}
                {externalTriggeredNotes.length > 0 && (
                  <div className="external-qa-section">
                    <div className="external-qa-header">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                      </svg>
                      <span>其他主题的问答</span>
                      <span className="external-qa-count">{externalTriggeredNotes.length}</span>
                    </div>
                    <div className="external-qa-list">
                      {externalTriggeredNotes.map(note => {
                        const aiResponse = getAIResponseForNote(note.id)
                        const noteTopic = topics.find(t => t.id === note.topicId)
                        const trigger = aiResponse?.trigger
                        return (
                          <div
                            key={note.id}
                            className="external-qa-card"
                            onClick={() => handleGoToNote(note.id)}
                          >
                            <div className="external-qa-topic">
                              <span className="topic-badge">{noteTopic?.title || '未知主题'}</span>
                              {/* 触发方式标识 */}
                              <span className={`external-qa-trigger trigger-${trigger || 'auto'}`}>
                                {trigger === AI_TRIGGER.MENTION ? '@AI' : '自动'}
                              </span>
                              <span className="external-qa-time">{formatTime(note.createdAt)}</span>
                            </div>
                            <div className="external-qa-question">
                              <span className="qa-label">问</span>
                              <span className="qa-text">{truncateText(note.content, 50)}</span>
                            </div>
                            {aiResponse && (
                              <div className="external-qa-answer">
                                <span className="qa-label answer">答</span>
                                <span className="qa-text">{truncateText(aiResponse.content, 80)}</span>
                              </div>
                            )}
                            <div className="external-qa-arrow">
                              <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                              </svg>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 原生问一问对话流 */}
                {askNotes.length > 0 && (
                  <>
                    {externalTriggeredNotes.length > 0 && (
                      <div className="ask-section-divider">
                        <span>实时对话</span>
                      </div>
                    )}
                    <div className="ask-chat-list">
                      {askNotes.map(note => {
                        const aiResponse = getAIResponseForNote(note.id)
                        return (
                          <div key={note.id} className="ask-chat-item">
                            {/* 用户问题 - 右侧 */}
                            <div className="ask-message user-message">
                              <div className="ask-message-content">{note.content}</div>
                              <div className="ask-message-time">{formatTime(note.createdAt)}</div>
                            </div>

                            {/* AI 回答 - 左侧 */}
                            {note.aiStatus === AI_STATUS.PENDING && !aiResponse && (
                              <div className="ask-message ai-message loading">
                                <div className="ask-ai-avatar">
                                  <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
                                  </svg>
                                </div>
                                <div className="ask-message-content">
                                  <div className="ask-typing">
                                    <span></span><span></span><span></span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {note.aiStatus === AI_STATUS.ERROR && !aiResponse && (
                              <div className="ask-message ai-message error">
                                <div className="ask-ai-avatar">
                                  <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
                                  </svg>
                                </div>
                                <div className="ask-message-content error-content">
                                  抱歉，AI 服务暂时不可用，请稍后再试
                                </div>
                              </div>
                            )}

                            {aiResponse && (
                              <div className="ask-message ai-message">
                                <div className="ask-ai-avatar">
                                  <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
                                  </svg>
                                </div>
                                <div className="ask-message-body">
                                  <div className="ask-message-content">{aiResponse.content}</div>
                                  <div className="ask-message-meta">
                                    <span className="ask-message-time">{formatTime(aiResponse.createdAt)}</span>
                                    {aiResponse.usedWebSearch && (
                                      <span className="ask-web-search-badge">
                                        <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                                          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                                        </svg>
                                        联网搜索
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          ) : currentNotes.length === 0 ? (
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
                  >
                    <div
                      className="bubble-body"
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

                      {/* 相关快记指示 - 只显示图标，不计算数量 */}
                      {hasRelatedNotes(note) && (
                        <div className="bubble-related-hint">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                          </svg>
                          <span>有相关</span>
                        </div>
                      )}

                      {/* 元信息 */}
                      <div className="bubble-meta">
                        <span className="bubble-time">{formatTime(note.updatedAt || note.createdAt)}</span>
                        {note.updatedAt && note.updatedAt !== note.createdAt && (
                          <span className="bubble-edited">已编辑</span>
                        )}
                        {/* AI 回复状态标识 */}
                        {note.aiStatus === AI_STATUS.DONE && (() => {
                          const aiResponse = getAIResponseForNote(note.id)
                          const trigger = aiResponse?.trigger
                          return (
                            <span className={`bubble-ai-badge trigger-${trigger || 'auto'}`}>
                              {trigger === AI_TRIGGER.MENTION ? '@AI' : 'AI'}
                            </span>
                          )
                        })()}
                        {note.aiStatus === AI_STATUS.PENDING && (
                          <span className="bubble-ai-badge pending">AI...</span>
                        )}
                        {note.aiStatus === AI_STATUS.PROCESSING && (
                          <span className="bubble-ai-badge processing">AI 处理中</span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className={`input-bar ${extendingNote && !isAskMode ? 'extending-mode' : ''} ${isAskMode ? 'ask-mode' : ''}`}>
          {/* 延展提示条 - 问一问模式下不显示 */}
          {extendingNote && !isAskMode && (
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
            {/* 图片上传 - 问一问模式下隐藏 */}
            {!isAskMode && (
              <>
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
              </>
            )}
            <div className="input-wrapper">
              {inputImages.length > 0 && !isAskMode && (
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
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isAskMode ? "问我任何问题..." : (extendingNote ? "写下延展的想法…" : "记录此刻想法，输入 @ 呼唤 AI…")}
                rows={isAskMode ? 1 : 2}
                disabled={aiProcessing}
              />
            </div>

            {/* @ Mention 浮层 */}
            {showMentionPopover && (
              <div className="mention-popover">
                <div className="mention-header">
                  <span className="mention-header-title">选择智能体</span>
                </div>
                <div className="mention-list">
                  {agents.map((agent, index) => (
                    <div
                      key={agent.id}
                      className={`mention-item ${index === mentionActiveIndex ? 'active' : ''}`}
                      onClick={() => handleSelectAgent(agent)}
                      onMouseEnter={() => setMentionActiveIndex(index)}
                    >
                      <div className="mention-item-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
                        </svg>
                      </div>
                      <div className="mention-item-content">
                        <div className="mention-item-name">@{agent.keyword}</div>
                        <div className="mention-item-desc">{agent.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mention-hint">
                  <span className="mention-hint-text">
                    <kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>Enter</kbd> 确认 <kbd>Esc</kbd> 关闭
                  </span>
                </div>
              </div>
            )}
            <button
              className={`send-btn ${canSend ? 'active' : ''} ${extendingNote && !isAskMode ? 'extending' : ''} ${isAskMode ? 'ask-send' : ''}`}
              disabled={!canSend || aiProcessing}
              onClick={handleSend}
              title={aiProcessing ? '思考中...' : (isAskMode ? '发送' : (extendingNote ? '延展' : '发送'))}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
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

            {/* AI 回答展示 */}
            {editingNoteId !== selectedNote.id && selectedNote.aiResponseId && (() => {
              const aiResponse = getAIResponseForNote(selectedNote.id)
              const trigger = aiResponse?.trigger
              return (
                <div className="detail-ai-response-section">
                  <div className="detail-ai-response-header">
                    <div className="detail-ai-response-icon">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/>
                      </svg>
                    </div>
                    <span className="detail-ai-response-title">AI 回答</span>
                    {/* 触发方式标识 */}
                    <span className={`detail-ai-trigger-badge trigger-${trigger || 'auto'}`}>
                      {getTriggerLabel(trigger)}
                    </span>
                    {aiResponse?.usedWebSearch && (
                      <span className="detail-ai-web-badge">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        </svg>
                        联网搜索
                      </span>
                    )}
                  </div>
                  <div className="detail-ai-response-content">
                    {aiResponse?.content || '加载中...'}
                  </div>
                  <div className="detail-ai-response-meta">
                    <span className="detail-ai-response-time">
                      {aiResponse?.createdAt && formatFullTime(aiResponse.createdAt)}
                    </span>
                    <span className="detail-ai-response-model">
                      {aiResponse?.model}
                    </span>
                  </div>
                </div>
              )
            })()}

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

                {/* 区块三：相关快记 - 基于语义相似度 */}
                {getRelatedNotes(selectedNote.id).length > 0 && (
                  <div className="detail-references-section related-section">
                    <div className="detail-references-header">
                      <div className="detail-references-icon related-icon">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                        </svg>
                      </div>
                      <span className="detail-references-title">相关快记</span>
                      <span className="detail-references-subtitle">语义相似的内容</span>
                    </div>
                    <div className="detail-references-list">
                      {getRelatedNotes(selectedNote.id).map(({ note, similarity }) => (
                        <div
                          key={note.id}
                          className="detail-reference-card related-card"
                          onClick={() => handleGoToNote(note.id)}
                        >
                          <div className="reference-card-content">{truncateText(note.content, 80)}</div>
                          <div className="reference-card-footer">
                            <span className="reference-card-topic">
                              {topics.find(t => t.id === note.topicId)?.title || ''}
                            </span>
                            <span className="reference-card-similarity">
                              {Math.round(similarity * 100)}% 相似
                            </span>
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
        isClassifying={isClassifying}
        classifyProgress={classifyProgress}
        classifyResult={classifyResult}
        onStartClassify={handleStartClassify}
      />

      {/* 10. 分类进度浮层（设置面板关闭时显示） */}
      {isClassifying && !showSettings && (
        <div className="classify-floating-indicator">
          <div className="classify-floating-content">
            <div className="classify-floating-spinner"></div>
            <span>分类中 {classifyProgress.total > 0 ? `${classifyProgress.completed}/${classifyProgress.total}` : '...'}</span>
          </div>
          <div className="classify-floating-progress">
            <div
              className="classify-floating-bar"
              style={{ width: classifyProgress.total > 0 ? `${(classifyProgress.completed / classifyProgress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
