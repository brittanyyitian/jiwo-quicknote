/**
 * 即我快记 - 数据存储管理
 *
 * 负责：
 * - localStorage 读写
 * - 数据导入/导出
 * - 数据迁移
 * - 数据完整性校验
 */

import {
  STORAGE_KEYS,
  DATA_VERSION,
  DEFAULT_TOPIC_ID,
  AI_STATUS,
  NOTE_SOURCE,
  createTopic,
  createNote,
  validateExportData
} from './schema.js'

// ==================== 基础读写操作 ====================

/**
 * 从 localStorage 读取数据
 */
function readFromStorage(key) {
  try {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  } catch (error) {
    console.error(`读取 ${key} 失败:`, error)
    return null
  }
}

/**
 * 写入数据到 localStorage
 */
function writeToStorage(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
    return true
  } catch (error) {
    console.error(`写入 ${key} 失败:`, error)
    return false
  }
}

// ==================== 数据迁移 ====================

/**
 * 迁移旧版本数据到新结构
 */
function migrateOldData() {
  const currentVersion = readFromStorage(STORAGE_KEYS.VERSION)

  // 如果已经是最新版本，无需迁移
  if (currentVersion === DATA_VERSION) {
    return false
  }

  console.log(`数据迁移: ${currentVersion || '1.0'} -> ${DATA_VERSION}`)

  // 读取旧数据
  let topics = readFromStorage(STORAGE_KEYS.TOPICS) || []
  let notes = readFromStorage(STORAGE_KEYS.NOTES) || []

  // 迁移 topics
  topics = topics.map(topic => ({
    id: topic.id,
    title: topic.title,
    createdAt: topic.createdAt ? new Date(topic.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: topic.updatedAt ? new Date(topic.updatedAt).toISOString() : new Date().toISOString()
  }))

  // 迁移 notes - 将旧的 AI 数据拆分到独立的 AIResponse
  const aiResponses = []

  notes = notes.map(note => {
    // 处理旧的时间格式（toLocaleString -> ISO 8601）
    let createdAt = note.createdAt
    let updatedAt = note.updatedAt || note.createdAt

    // 尝试解析旧格式时间
    if (createdAt && !createdAt.includes('T')) {
      try {
        createdAt = new Date(createdAt).toISOString()
      } catch {
        createdAt = new Date().toISOString()
      }
    }
    if (updatedAt && !updatedAt.includes('T')) {
      try {
        updatedAt = new Date(updatedAt).toISOString()
      } catch {
        updatedAt = new Date().toISOString()
      }
    }

    // 确定来源类型
    let source = NOTE_SOURCE.NORMAL
    if (note.source === 'ask_conversation') {
      source = NOTE_SOURCE.ASK_CONVERSATION
    } else if (note.source === 'external_topic' || (note.isQuestion && note.aiStatus === 'done')) {
      source = NOTE_SOURCE.EXTERNAL_TRIGGER
    }

    // 确定 AI 状态
    let aiStatus = AI_STATUS.NONE
    let aiResponseId = null

    if (note.isQuestion || note.aiStatus) {
      if (note.aiStatus === 'done' && note.aiResponse) {
        aiStatus = AI_STATUS.DONE

        // 创建独立的 AIResponse 记录
        const aiResponseRecord = {
          id: crypto.randomUUID(),
          noteId: note.id,
          content: note.aiResponse,
          model: 'mock-v1',  // 旧数据标记为 mock
          usedWebSearch: false,
          sourceNoteIds: note.relatedNoteIds || [],
          webSearchResult: null,
          metadata: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            latencyMs: 0,
            migratedFrom: 'v1'
          },
          createdAt: note.aiResponseTime
            ? new Date(note.aiResponseTime).toISOString()
            : createdAt
        }
        aiResponses.push(aiResponseRecord)
        aiResponseId = aiResponseRecord.id
      } else if (note.aiStatus === 'pending') {
        aiStatus = AI_STATUS.PENDING
      } else if (note.aiStatus === 'processing') {
        aiStatus = AI_STATUS.PROCESSING
      }
    }

    return {
      id: note.id,
      topicId: note.topicId || DEFAULT_TOPIC_ID,
      content: note.content,
      source: source,
      aiStatus: aiStatus,
      aiResponseId: aiResponseId,
      createdAt: createdAt,
      updatedAt: updatedAt
    }
  })

  // 保存迁移后的数据
  writeToStorage(STORAGE_KEYS.TOPICS, topics)
  writeToStorage(STORAGE_KEYS.NOTES, notes)
  writeToStorage(STORAGE_KEYS.AI_RESPONSES, aiResponses)
  writeToStorage(STORAGE_KEYS.ASK_CONVERSATIONS, [])
  writeToStorage(STORAGE_KEYS.NOTE_RELATIONS, [])
  writeToStorage(STORAGE_KEYS.VERSION, DATA_VERSION)

  console.log('数据迁移完成')
  return true
}

// ==================== 初始化 ====================

/**
 * 初始化数据存储
 * 返回所有数据
 */
export function initializeStorage() {
  // 执行数据迁移
  migrateOldData()

  // 读取所有数据
  let topics = readFromStorage(STORAGE_KEYS.TOPICS) || []
  let notes = readFromStorage(STORAGE_KEYS.NOTES) || []
  let aiResponses = readFromStorage(STORAGE_KEYS.AI_RESPONSES) || []
  let askConversations = readFromStorage(STORAGE_KEYS.ASK_CONVERSATIONS) || []
  let noteRelations = readFromStorage(STORAGE_KEYS.NOTE_RELATIONS) || []
  let references = readFromStorage(STORAGE_KEYS.REFERENCES) || []

  // 确保默认主题存在
  const hasDefaultTopic = topics.some(t => t.id === DEFAULT_TOPIC_ID)
  if (!hasDefaultTopic) {
    const defaultTopic = createTopic({ id: DEFAULT_TOPIC_ID, title: '我的快记' })
    topics = [defaultTopic, ...topics]
    writeToStorage(STORAGE_KEYS.TOPICS, topics)
  }

  // 确保版本号已设置
  if (!readFromStorage(STORAGE_KEYS.VERSION)) {
    writeToStorage(STORAGE_KEYS.VERSION, DATA_VERSION)
  }

  return {
    topics,
    notes,
    aiResponses,
    askConversations,
    noteRelations,
    references
  }
}

// ==================== CRUD 操作 ====================

// Topics
export function saveTopics(topics) {
  return writeToStorage(STORAGE_KEYS.TOPICS, topics)
}

export function loadTopics() {
  return readFromStorage(STORAGE_KEYS.TOPICS) || []
}

// Notes
export function saveNotes(notes) {
  return writeToStorage(STORAGE_KEYS.NOTES, notes)
}

export function loadNotes() {
  return readFromStorage(STORAGE_KEYS.NOTES) || []
}

// AI Responses
export function saveAIResponses(responses) {
  return writeToStorage(STORAGE_KEYS.AI_RESPONSES, responses)
}

export function loadAIResponses() {
  return readFromStorage(STORAGE_KEYS.AI_RESPONSES) || []
}

// Ask Conversations
export function saveAskConversations(conversations) {
  return writeToStorage(STORAGE_KEYS.ASK_CONVERSATIONS, conversations)
}

export function loadAskConversations() {
  return readFromStorage(STORAGE_KEYS.ASK_CONVERSATIONS) || []
}

// Note Relations
export function saveNoteRelations(relations) {
  return writeToStorage(STORAGE_KEYS.NOTE_RELATIONS, relations)
}

export function loadNoteRelations() {
  return readFromStorage(STORAGE_KEYS.NOTE_RELATIONS) || []
}

// References (引用关系)
export function saveReferences(references) {
  return writeToStorage(STORAGE_KEYS.REFERENCES, references)
}

export function loadReferences() {
  return readFromStorage(STORAGE_KEYS.REFERENCES) || []
}

// ==================== 导入导出 ====================

/**
 * 导出所有数据为 JSON
 */
export function exportAllData() {
  const data = {
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    topics: loadTopics(),
    notes: loadNotes(),
    aiResponses: loadAIResponses(),
    askConversations: loadAskConversations(),
    noteRelations: loadNoteRelations()
  }

  return JSON.stringify(data, null, 2)
}

/**
 * 导出数据并触发下载
 */
export function downloadExport() {
  const data = exportAllData()
  const blob = new Blob([data], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `jiwo-quicknote-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * 从 JSON 导入数据
 * @param {string} jsonString - JSON 字符串
 * @param {Object} options - 导入选项
 * @param {boolean} options.merge - 是否合并（true）或覆盖（false）
 * @returns {Object} 导入结果
 */
export function importData(jsonString, options = { merge: false }) {
  try {
    const data = JSON.parse(jsonString)

    // 验证数据格式
    if (!validateExportData(data)) {
      return {
        success: false,
        error: '数据格式无效，请检查导入文件'
      }
    }

    if (options.merge) {
      // 合并模式：保留现有数据，添加新数据
      const existingTopics = loadTopics()
      const existingNotes = loadNotes()
      const existingAIResponses = loadAIResponses()
      const existingAskConversations = loadAskConversations()
      const existingNoteRelations = loadNoteRelations()

      // 使用 ID 去重
      const topicIds = new Set(existingTopics.map(t => t.id))
      const noteIds = new Set(existingNotes.map(n => n.id))
      const aiResponseIds = new Set(existingAIResponses.map(r => r.id))
      const conversationIds = new Set(existingAskConversations.map(c => c.id))
      const relationIds = new Set(existingNoteRelations.map(r => r.id))

      const newTopics = data.topics.filter(t => !topicIds.has(t.id))
      const newNotes = data.notes.filter(n => !noteIds.has(n.id))
      const newAIResponses = (data.aiResponses || []).filter(r => !aiResponseIds.has(r.id))
      const newConversations = (data.askConversations || []).filter(c => !conversationIds.has(c.id))
      const newRelations = (data.noteRelations || []).filter(r => !relationIds.has(r.id))

      saveTopics([...existingTopics, ...newTopics])
      saveNotes([...existingNotes, ...newNotes])
      saveAIResponses([...existingAIResponses, ...newAIResponses])
      saveAskConversations([...existingAskConversations, ...newConversations])
      saveNoteRelations([...existingNoteRelations, ...newRelations])

      return {
        success: true,
        message: `合并完成：新增 ${newTopics.length} 个主题，${newNotes.length} 条快记`,
        stats: {
          newTopics: newTopics.length,
          newNotes: newNotes.length,
          newAIResponses: newAIResponses.length
        }
      }
    } else {
      // 覆盖模式：替换所有数据
      saveTopics(data.topics)
      saveNotes(data.notes)
      saveAIResponses(data.aiResponses || [])
      saveAskConversations(data.askConversations || [])
      saveNoteRelations(data.noteRelations || [])
      writeToStorage(STORAGE_KEYS.VERSION, data.version || DATA_VERSION)

      return {
        success: true,
        message: `导入完成：${data.topics.length} 个主题，${data.notes.length} 条快记`,
        stats: {
          topics: data.topics.length,
          notes: data.notes.length,
          aiResponses: (data.aiResponses || []).length
        }
      }
    }
  } catch (error) {
    console.error('导入数据失败:', error)
    return {
      success: false,
      error: `导入失败: ${error.message}`
    }
  }
}

/**
 * 从文件导入数据
 * @param {File} file - 文件对象
 * @param {Object} options - 导入选项
 * @returns {Promise<Object>} 导入结果
 */
export function importFromFile(file, options = { merge: false }) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target.result
      const fileName = file.name.toLowerCase()

      // 根据文件类型选择导入方式
      if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
        const result = importMarkdown(content, options)
        resolve(result)
      } else if (fileName.endsWith('.json')) {
        const result = importData(content, options)
        resolve(result)
      } else {
        resolve({
          success: false,
          error: '不支持的文件格式，请使用 .json 或 .md 文件'
        })
      }
    }
    reader.onerror = () => {
      resolve({
        success: false,
        error: '文件读取失败'
      })
    }
    reader.readAsText(file)
  })
}

/**
 * 解析时间戳字符串
 * 支持多种格式：
 * - 2024-01-13 10:30:00
 * - 2024/01/13 10:30
 * - 2024年1月13日 10:30
 * - [2024-01-13 10:30]
 * - 10:30 (当天)
 */
function parseTimestamp(text) {
  // 完整日期时间格式
  const patterns = [
    // 2024-01-13 10:30:00 或 2024-01-13 10:30
    /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
    // 2024/01/13 10:30
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/,
    // 2024年1月13日 10:30
    /(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/,
    // [2024-01-13 10:30]
    /\[(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\]/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const [, year, month, day, hour, minute, second = '0'] = match
      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      )
      if (!isNaN(date.getTime())) {
        return date.toISOString()
      }
    }
  }

  // 只有时间的格式 (HH:MM)
  const timeOnlyMatch = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (timeOnlyMatch) {
    const [, hour, minute, second = '0'] = timeOnlyMatch
    const date = new Date()
    date.setHours(parseInt(hour), parseInt(minute), parseInt(second), 0)
    return date.toISOString()
  }

  return null
}

/**
 * 检查一行是否是时间戳行
 */
function isTimestampLine(line) {
  const trimmed = line.trim()
  // 检查是否整行都是时间戳
  const fullPatterns = [
    /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s+\d{1,2}:\d{2}(:\d{2})?$/,
    /^\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}$/,
    /^\[\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}\]$/,
    /^\d{1,2}:\d{2}(:\d{2})?$/,
  ]
  return fullPatterns.some(p => p.test(trimmed))
}

/**
 * 从 Markdown 导入数据
 *
 * 支持的格式：
 * 1. 按段落分割（空行分隔）- 每段作为一条快记
 * 2. 按标题分割（# 或 ##）- 标题作为主题名，内容作为快记
 * 3. 识别时间戳行，用于设置快记的创建时间
 *
 * @param {string} markdownContent - Markdown 内容
 * @param {Object} options - 导入选项
 * @returns {Object} 导入结果
 */
export function importMarkdown(markdownContent, options = { merge: false }) {
  try {
    const lines = markdownContent.split('\n')
    const notes = []
    const topics = []

    let currentTopic = null
    let currentContent = []
    let currentTimestamp = null
    let hasHeaders = false

    // 检查是否有标题结构
    for (const line of lines) {
      if (/^#{1,2}\s+/.test(line)) {
        hasHeaders = true
        break
      }
    }

    // 保存当前段落为快记的辅助函数
    const saveCurrentParagraph = () => {
      if (currentContent.length > 0) {
        const content = currentContent.join('\n').trim()
        if (content && content.length > 1) {
          const note = createNote({
            topicId: currentTopic?.id || DEFAULT_TOPIC_ID,
            content: content,
            source: NOTE_SOURCE.NORMAL
          })
          // 如果有时间戳，使用它
          if (currentTimestamp) {
            note.createdAt = currentTimestamp
            note.updatedAt = currentTimestamp
          }
          notes.push(note)
        }
        currentContent = []
        currentTimestamp = null
      }
    }

    if (hasHeaders) {
      // 按标题分割模式
      for (const line of lines) {
        const h1Match = line.match(/^#\s+(.+)$/)
        const h2Match = line.match(/^##\s+(.+)$/)

        if (h1Match || h2Match) {
          // 保存之前的内容
          saveCurrentParagraph()

          // 创建新主题（仅 h1 创建主题）
          if (h1Match) {
            const topicTitle = h1Match[1].trim()
            currentTopic = createTopic({ title: topicTitle })
            topics.push(currentTopic)
          }
        } else if (isTimestampLine(line)) {
          // 时间戳行：保存之前的段落，记录新时间戳
          saveCurrentParagraph()
          currentTimestamp = parseTimestamp(line.trim())
        } else if (line.trim()) {
          // 非空行：检查行首是否有时间戳
          const lineTimestamp = parseTimestamp(line)
          if (lineTimestamp && line.trim().match(/^[\d\-\/年月日\s:\[\]]+\s+.+/)) {
            // 行首有时间戳，提取时间和内容
            saveCurrentParagraph()
            currentTimestamp = lineTimestamp
            // 移除时间戳部分，保留内容
            const contentPart = line.replace(/^[\d\-\/年月日\s:\[\]]+\s+/, '').trim()
            if (contentPart) {
              currentContent.push(contentPart)
            }
          } else {
            // 普通内容行
            currentContent.push(line)
          }
        } else if (currentContent.length > 0) {
          // 空行分隔，保存当前段落
          saveCurrentParagraph()
        }
      }

      // 保存最后的内容
      saveCurrentParagraph()
    } else {
      // 按段落分割模式（无标题结构）
      for (const line of lines) {
        if (isTimestampLine(line)) {
          // 时间戳行：保存之前的段落，记录新时间戳
          saveCurrentParagraph()
          currentTimestamp = parseTimestamp(line.trim())
        } else if (line.trim()) {
          // 非空行：检查行首是否有时间戳
          const lineTimestamp = parseTimestamp(line)
          if (lineTimestamp && line.trim().match(/^[\d\-\/年月日\s:\[\]]+\s+.+/)) {
            // 行首有时间戳
            saveCurrentParagraph()
            currentTimestamp = lineTimestamp
            const contentPart = line.replace(/^[\d\-\/年月日\s:\[\]]+\s+/, '').trim()
            if (contentPart) {
              currentContent.push(contentPart)
            }
          } else {
            currentContent.push(line)
          }
        } else if (currentContent.length > 0) {
          // 空行分隔
          saveCurrentParagraph()
        }
      }

      // 保存最后一个段落
      saveCurrentParagraph()
    }

    // 如果没有解析到任何内容
    if (notes.length === 0) {
      return {
        success: false,
        error: 'Markdown 文件中没有找到可导入的内容'
      }
    }

    // 按时间排序（最早的在前，最新的在后）
    notes.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))

    // 保存数据
    if (options.merge) {
      const existingTopics = loadTopics()
      const existingNotes = loadNotes()

      saveTopics([...existingTopics, ...topics])
      saveNotes([...existingNotes, ...notes])

      return {
        success: true,
        message: `Markdown 导入完成：新增 ${topics.length} 个主题，${notes.length} 条快记`,
        stats: {
          newTopics: topics.length,
          newNotes: notes.length
        }
      }
    } else {
      // 覆盖模式：保留默认主题
      const defaultTopic = createTopic({ id: DEFAULT_TOPIC_ID, title: '我的快记' })
      const allTopics = [defaultTopic, ...topics.filter(t => t.id !== DEFAULT_TOPIC_ID)]

      saveTopics(allTopics)
      saveNotes(notes)
      saveAIResponses([])
      saveAskConversations([])
      saveNoteRelations([])

      return {
        success: true,
        message: `Markdown 导入完成：${topics.length} 个主题，${notes.length} 条快记`,
        stats: {
          topics: topics.length,
          notes: notes.length
        }
      }
    }
  } catch (error) {
    console.error('Markdown 导入失败:', error)
    return {
      success: false,
      error: `Markdown 导入失败: ${error.message}`
    }
  }
}

// ==================== 数据清理 ====================

/**
 * 清除所有数据（危险操作）
 */
export function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => {
    localStorage.removeItem(key)
  })
}

/**
 * 获取存储统计信息
 */
export function getStorageStats() {
  const topics = loadTopics()
  const notes = loadNotes()
  const aiResponses = loadAIResponses()
  const noteRelations = loadNoteRelations()

  // 计算 localStorage 使用量
  let totalSize = 0
  Object.values(STORAGE_KEYS).forEach(key => {
    const data = localStorage.getItem(key)
    if (data) {
      totalSize += data.length * 2 // UTF-16 每个字符 2 字节
    }
  })

  return {
    version: readFromStorage(STORAGE_KEYS.VERSION) || 'unknown',
    counts: {
      topics: topics.length,
      notes: notes.length,
      aiResponses: aiResponses.length,
      noteRelations: noteRelations.length
    },
    storageUsed: totalSize,
    storageUsedFormatted: formatBytes(totalSize)
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
