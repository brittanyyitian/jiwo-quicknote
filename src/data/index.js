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
  AI_TRIGGER,
  AI_MENTION_PATTERNS,
  STORAGE_KEYS,
  DATA_VERSION,
  CLASSIFICATION_STATUS,
  DEFAULT_AI_SETTINGS,

  // 创建函数
  createTopic,
  createNote,
  createAIResponse,
  createAskConversation,
  createNoteRelation,
  createReference,
  createNoteEmbedding,
  createCluster,
  createClassificationTask,

  // 验证函数
  validateTopic,
  validateNote,
  validateAIResponse,
  validateReference,
  validateExportData,
  validateNoteEmbedding,
  validateCluster,
  validateClassificationTask
} from './schema.js'

// Storage - 存储操作
export {
  // 初始化
  initializeStorage,
  initializeStorageAsync,
  fetchFromServer,

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

  // References CRUD (引用关系)
  saveReferences,
  loadReferences,

  // Embeddings CRUD (快记嵌入向量)
  saveEmbeddings,
  loadEmbeddings,
  getEmbeddingByNoteId,
  upsertEmbedding,
  deleteEmbeddingByNoteId,

  // Clusters CRUD (AI聚类)
  saveClusters,
  loadClusters,
  getClusterById,
  upsertCluster,
  deleteCluster,
  removeNoteFromCluster,

  // Classification Queue (分类任务队列)
  saveClassificationQueue,
  loadClassificationQueue,
  enqueueClassificationTask,
  getNextPendingTask,
  updateTaskStatus,
  cleanupCompletedTasks,
  getQueueStats,

  // AI Settings (AI设置)
  saveAISettings,
  loadAISettings,
  updateAISettings,

  // 快照与回滚
  createSnapshot,
  getSnapshotMeta,
  hasSnapshot,
  rollbackFromSnapshot,
  clearSnapshot,

  // 导入导出
  exportAllData,
  downloadExport,
  importData,
  importFromFile,
  importMarkdown,

  // 工具函数
  clearAllData,
  getStorageStats
} from './storage.js'
