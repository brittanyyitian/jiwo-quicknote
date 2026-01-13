/**
 * 即我快记 - 数据结构定义
 *
 * 核心实体：
 * - Topic: 主题
 * - Note: 快记
 * - AIResponse: AI 回答
 * - AskConversation: 问一问会话
 * - NoteRelation: 快记相关性关系
 */

// ==================== 常量定义 ====================

// 默认主题 ID
export const DEFAULT_TOPIC_ID = 'default'

// 问一问虚拟主题 ID
export const ASK_TOPIC_ID = '__ask__'

// AI 回答状态
export const AI_STATUS = {
  NONE: 'none',           // 无需 AI 回答
  PENDING: 'pending',     // 等待 AI 回答
  PROCESSING: 'processing', // AI 正在处理
  DONE: 'done',           // AI 回答完成
  ERROR: 'error'          // AI 回答出错
}

// 快记来源
export const NOTE_SOURCE = {
  NORMAL: 'normal',           // 普通快记（未触发 AI）
  ASK_CONVERSATION: 'ask_conversation',  // 问一问内原生对话
  EXTERNAL_TRIGGER: 'external_trigger'   // 外部主题触发的 AI 问答
}

// localStorage 键名
export const STORAGE_KEYS = {
  TOPICS: 'jiwo-topics',
  NOTES: 'jiwo-notes',
  AI_RESPONSES: 'jiwo-ai-responses',
  ASK_CONVERSATIONS: 'jiwo-ask-conversations',
  NOTE_RELATIONS: 'jiwo-note-relations',
  REFERENCES: 'jiwo-references',  // 引用关系
  VERSION: 'jiwo-data-version'
}

// 当前数据版本（用于未来数据迁移）
export const DATA_VERSION = '2.0.0'

// ==================== 数据结构定义 ====================

/**
 * 主题 Topic
 * @typedef {Object} Topic
 * @property {string} id - 唯一标识
 * @property {string} title - 主题标题
 * @property {string} createdAt - 创建时间 (ISO 8601)
 * @property {string} updatedAt - 更新时间 (ISO 8601)
 */
export function createTopic({ id, title }) {
  const now = new Date().toISOString()
  return {
    id: id || crypto.randomUUID(),
    title: title || '新主题',
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 快记 Note
 * @typedef {Object} Note
 * @property {string} id - 唯一标识
 * @property {string} topicId - 所属主题 ID
 * @property {string} content - 快记内容
 * @property {string[]} images - 图片列表（base64 或 URL）
 * @property {string} source - 来源类型 (NOTE_SOURCE)
 * @property {string} aiStatus - AI 状态 (AI_STATUS)
 * @property {string|null} aiResponseId - 关联的 AI 回答 ID
 * @property {string} createdAt - 创建时间 (ISO 8601)
 * @property {string} updatedAt - 更新时间 (ISO 8601)
 */
export function createNote({ topicId, content, images = [], source = NOTE_SOURCE.NORMAL }) {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    topicId: topicId || DEFAULT_TOPIC_ID,
    content: content || '',
    images: images || [],
    source: source,
    aiStatus: AI_STATUS.NONE,
    aiResponseId: null,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * AI 回答 AIResponse
 * @typedef {Object} AIResponse
 * @property {string} id - 唯一标识
 * @property {string} noteId - 关联的快记 ID
 * @property {string} content - AI 回答内容
 * @property {string} model - 使用的模型名称
 * @property {boolean} usedWebSearch - 是否使用了联网搜索
 * @property {string[]} sourceNoteIds - 参考的历史快记 ID 列表
 * @property {Object|null} webSearchResult - 联网搜索结果摘要
 * @property {Object} metadata - 元数据（token 用量、耗时等）
 * @property {string} createdAt - 创建时间 (ISO 8601)
 */
export function createAIResponse({ noteId, content, model, usedWebSearch = false, sourceNoteIds = [], webSearchResult = null, metadata = {} }) {
  return {
    id: crypto.randomUUID(),
    noteId: noteId,
    content: content || '',
    model: model || 'unknown',
    usedWebSearch: usedWebSearch,
    sourceNoteIds: sourceNoteIds,
    webSearchResult: webSearchResult,
    metadata: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      ...metadata
    },
    createdAt: new Date().toISOString()
  }
}

/**
 * 问一问会话 AskConversation
 * 用于记录问一问内的连续对话
 * @typedef {Object} AskConversation
 * @property {string} id - 唯一标识
 * @property {string[]} noteIds - 按时间顺序的快记 ID 列表
 * @property {string} createdAt - 创建时间 (ISO 8601)
 * @property {string} updatedAt - 更新时间 (ISO 8601)
 */
export function createAskConversation() {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    noteIds: [],
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 快记相关性关系 NoteRelation
 * 存储快记之间的语义相关性
 * @typedef {Object} NoteRelation
 * @property {string} id - 唯一标识
 * @property {string} noteId - 源快记 ID
 * @property {string} relatedNoteId - 相关快记 ID
 * @property {number} score - 相关性分数 (0-1)
 * @property {string} computedAt - 计算时间 (ISO 8601)
 */
export function createNoteRelation({ noteId, relatedNoteId, score }) {
  return {
    id: crypto.randomUUID(),
    noteId: noteId,
    relatedNoteId: relatedNoteId,
    score: score || 0,
    computedAt: new Date().toISOString()
  }
}

/**
 * 引用关系 Reference
 * 存储快记之间的引用（延展）关系
 * @typedef {Object} Reference
 * @property {string} id - 唯一标识
 * @property {string} sourceNoteId - 引用方快记 ID（新创建的快记）
 * @property {string} targetNoteId - 被引用快记 ID（原快记）
 * @property {string} createdAt - 创建时间 (ISO 8601)
 */
export function createReference({ sourceNoteId, targetNoteId }) {
  return {
    id: crypto.randomUUID(),
    sourceNoteId: sourceNoteId,
    targetNoteId: targetNoteId,
    createdAt: new Date().toISOString()
  }
}

/**
 * 验证 Reference 数据结构
 */
export function validateReference(ref) {
  return (
    ref &&
    typeof ref.id === 'string' &&
    typeof ref.sourceNoteId === 'string' &&
    typeof ref.targetNoteId === 'string' &&
    typeof ref.createdAt === 'string'
  )
}

// ==================== 数据验证 ====================

/**
 * 验证 Topic 数据结构
 */
export function validateTopic(topic) {
  return (
    topic &&
    typeof topic.id === 'string' &&
    typeof topic.title === 'string' &&
    typeof topic.createdAt === 'string' &&
    typeof topic.updatedAt === 'string'
  )
}

/**
 * 验证 Note 数据结构
 */
export function validateNote(note) {
  return (
    note &&
    typeof note.id === 'string' &&
    typeof note.topicId === 'string' &&
    typeof note.content === 'string' &&
    typeof note.createdAt === 'string' &&
    typeof note.updatedAt === 'string'
  )
}

/**
 * 验证 AIResponse 数据结构
 */
export function validateAIResponse(response) {
  return (
    response &&
    typeof response.id === 'string' &&
    typeof response.noteId === 'string' &&
    typeof response.content === 'string' &&
    typeof response.createdAt === 'string'
  )
}

/**
 * 验证完整的导出数据
 */
export function validateExportData(data) {
  if (!data || typeof data !== 'object') return false
  if (!Array.isArray(data.topics)) return false
  if (!Array.isArray(data.notes)) return false

  // aiResponses 是可选的
  if (data.aiResponses && !Array.isArray(data.aiResponses)) return false

  // 验证每个实体
  for (const topic of data.topics) {
    if (!validateTopic(topic)) return false
  }
  for (const note of data.notes) {
    if (!validateNote(note)) return false
  }
  if (data.aiResponses) {
    for (const response of data.aiResponses) {
      if (!validateAIResponse(response)) return false
    }
  }

  return true
}
