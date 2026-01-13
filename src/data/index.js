/**
 * 即我快记 - 数据层入口
 *
 * 统一导出所有数据相关的功能
 */

// Schema - 数据结构定义
export {
  // 常量
  DEFAULT_TOPIC_ID,
  ASK_TOPIC_ID,
  AI_STATUS,
  NOTE_SOURCE,
  STORAGE_KEYS,
  DATA_VERSION,

  // 创建函数
  createTopic,
  createNote,
  createAIResponse,
  createAskConversation,
  createNoteRelation,

  // 验证函数
  validateTopic,
  validateNote,
  validateAIResponse,
  validateExportData
} from './schema.js'

// Storage - 存储操作
export {
  // 初始化
  initializeStorage,

  // Topics CRUD
  saveTopics,
  loadTopics,

  // Notes CRUD
  saveNotes,
  loadNotes,

  // AI Responses CRUD
  saveAIResponses,
  loadAIResponses,

  // Ask Conversations CRUD
  saveAskConversations,
  loadAskConversations,

  // Note Relations CRUD
  saveNoteRelations,
  loadNoteRelations,

  // 导入导出
  exportAllData,
  downloadExport,
  importData,
  importFromFile,

  // 工具函数
  clearAllData,
  getStorageStats
} from './storage.js'
