/**
 * 分类任务管理服务
 *
 * 异步后台任务 + 分批处理
 * - 前端不等待结果
 * - 每批 20-50 条
 * - 结果缓存到 localStorage
 * - 支持进度追踪和重试
 */

import { DASHSCOPE_API_KEY } from './ai.js'

const DASHSCOPE_API_URL = '/api/dashscope/api/v1/services/aigc/text-generation/generation'

// 任务状态常量
export const TASK_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error'
}

// 存储键
const STORAGE_KEYS = {
  TASK_STATE: 'jiwo-classification-task',
  BATCH_CACHE: 'jiwo-classification-cache'
}

// 配置
const CONFIG = {
  BATCH_SIZE: 30,  // 每批处理数量
  MAX_RETRIES: 3,  // 最大重试次数
  RETRY_DELAY: 2000  // 重试延迟(ms)
}

/**
 * 获取当前任务状态
 */
export function getTaskState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.TASK_STATE)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('读取任务状态失败:', e)
  }
  return createInitialState()
}

/**
 * 创建初始状态
 */
function createInitialState() {
  return {
    status: TASK_STATUS.IDLE,
    totalNotes: 0,
    processedNotes: 0,
    currentBatch: 0,
    totalBatches: 0,
    batchResults: [],  // 每批的分类结果
    error: null,
    startedAt: null,
    completedAt: null,
    retryCount: 0
  }
}

/**
 * 保存任务状态
 */
function saveTaskState(state) {
  try {
    localStorage.setItem(STORAGE_KEYS.TASK_STATE, JSON.stringify(state))
  } catch (e) {
    console.error('保存任务状态失败:', e)
  }
}

/**
 * 获取缓存的批次结果
 */
export function getCachedBatchResults() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.BATCH_CACHE)
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.error('读取缓存失败:', e)
  }
  return []
}

/**
 * 保存批次结果到缓存
 */
function saveBatchCache(results) {
  try {
    localStorage.setItem(STORAGE_KEYS.BATCH_CACHE, JSON.stringify(results))
  } catch (e) {
    console.error('保存缓存失败:', e)
  }
}

/**
 * 清除任务和缓存
 */
export function clearTask() {
  localStorage.removeItem(STORAGE_KEYS.TASK_STATE)
  localStorage.removeItem(STORAGE_KEYS.BATCH_CACHE)
}

// 当前运行的任务引用
let currentTaskController = null

/**
 * 启动分类任务
 * @param {Array} notes - 要分类的快记
 * @param {Function} onProgress - 进度回调 (state) => void
 * @returns {Promise} 任务完成的 Promise
 */
export async function startClassificationTask(notes, onProgress) {
  // 过滤有效快记
  const validNotes = notes.filter(n => n.content && n.content.trim().length > 0)

  if (validNotes.length === 0) {
    throw new Error('没有可分类的快记')
  }

  // 检查是否有未完成的任务可以继续
  const existingState = getTaskState()
  if (existingState.status === TASK_STATUS.RUNNING) {
    throw new Error('已有任务正在运行')
  }

  // 创建新任务或继续之前的任务
  const batches = createBatches(validNotes, CONFIG.BATCH_SIZE)

  let state
  if (existingState.status === TASK_STATUS.PAUSED && existingState.totalNotes === validNotes.length) {
    // 继续之前的任务
    state = { ...existingState, status: TASK_STATUS.RUNNING, error: null }
  } else {
    // 创建新任务
    state = {
      ...createInitialState(),
      status: TASK_STATUS.RUNNING,
      totalNotes: validNotes.length,
      totalBatches: batches.length,
      startedAt: new Date().toISOString()
    }
    saveBatchCache([])  // 清除旧缓存
  }

  saveTaskState(state)
  onProgress?.(state)

  // 创建取消控制器
  currentTaskController = new AbortController()

  try {
    // 从上次停止的批次开始处理
    const startBatch = state.currentBatch
    const cachedResults = getCachedBatchResults()

    for (let i = startBatch; i < batches.length; i++) {
      // 检查是否被取消
      if (currentTaskController.signal.aborted) {
        state.status = TASK_STATUS.PAUSED
        saveTaskState(state)
        onProgress?.(state)
        return state
      }

      const batch = batches[i]
      state.currentBatch = i
      saveTaskState(state)
      onProgress?.(state)

      // 处理当前批次（带重试）
      let batchResult = null
      let retries = 0

      while (retries < CONFIG.MAX_RETRIES) {
        try {
          batchResult = await processBatch(batch, i)
          break
        } catch (error) {
          retries++
          state.retryCount++
          console.error(`批次 ${i + 1} 处理失败，重试 ${retries}/${CONFIG.MAX_RETRIES}:`, error)

          if (retries >= CONFIG.MAX_RETRIES) {
            throw error
          }

          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY))
        }
      }

      // 保存批次结果
      cachedResults[i] = batchResult
      saveBatchCache(cachedResults)

      // 更新进度
      state.processedNotes += batch.length
      state.batchResults = cachedResults
      saveTaskState(state)
      onProgress?.(state)
    }

    // 任务完成，合并所有批次结果
    state.status = TASK_STATUS.COMPLETED
    state.completedAt = new Date().toISOString()
    state.batchResults = cachedResults
    saveTaskState(state)
    onProgress?.(state)

    return state

  } catch (error) {
    state.status = TASK_STATUS.ERROR
    state.error = error.message
    saveTaskState(state)
    onProgress?.(state)
    throw error
  }
}

/**
 * 暂停当前任务
 */
export function pauseTask() {
  if (currentTaskController) {
    currentTaskController.abort()
  }
}

/**
 * 重试失败的任务
 */
export async function retryTask(notes, onProgress) {
  const state = getTaskState()
  if (state.status !== TASK_STATUS.ERROR && state.status !== TASK_STATUS.PAUSED) {
    throw new Error('没有可重试的任务')
  }

  // 重置错误状态
  state.error = null
  state.retryCount = 0
  saveTaskState(state)

  return startClassificationTask(notes, onProgress)
}

/**
 * 将快记分批
 */
function createBatches(notes, batchSize) {
  const batches = []
  for (let i = 0; i < notes.length; i += batchSize) {
    batches.push(notes.slice(i, i + batchSize))
  }
  return batches
}

/**
 * 处理单个批次
 */
async function processBatch(notes, batchIndex) {
  // 准备快记摘要
  const noteSummaries = notes.map((note, index) => ({
    id: note.id,
    index: index + 1,
    content: note.content.slice(0, 100) + (note.content.length > 100 ? '...' : ''),
    fullContent: note.content,
    createdAt: note.createdAt
  }))

  // 构建提示
  const prompt = buildBatchPrompt(noteSummaries, batchIndex)

  // 调用 AI
  const response = await fetch(DASHSCOPE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
    },
    body: JSON.stringify({
      model: 'qwen-plus',
      input: {
        messages: [
          { role: 'system', content: getBatchSystemPrompt() },
          { role: 'user', content: prompt }
        ]
      },
      parameters: {
        result_format: 'message',
        temperature: 0.3,
        max_tokens: 2000
      }
    })
  })

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status}`)
  }

  const data = await response.json()
  if (data.code) {
    throw new Error(`API 错误: ${data.code} - ${data.message}`)
  }

  const content = data.output?.choices?.[0]?.message?.content || ''

  // 解析结果
  return parseBatchResult(content, noteSummaries)
}

/**
 * 批次分类的系统提示
 */
function getBatchSystemPrompt() {
  return `你是一个快记分类专家。分析给定的快记，为每条快记打上 1-3 个主题标签。

要求：
1. 主题标签要简短（2-4个字），如：工作、学习、情绪、健康、关系、创作、生活、计划、想法等
2. 每条快记可以有多个标签
3. 标签要有代表性，便于后续聚合

输出格式（必须是有效的 JSON）：
{
  "classifications": [
    { "noteIndex": 1, "tags": ["工作", "计划"] },
    { "noteIndex": 2, "tags": ["情绪", "关系"] }
  ]
}

只输出 JSON，不要其他内容。`
}

/**
 * 构建批次提示
 */
function buildBatchPrompt(noteSummaries, batchIndex) {
  const noteList = noteSummaries
    .map(n => `[${n.index}] ${n.content}`)
    .join('\n\n')

  return `请为以下第 ${batchIndex + 1} 批快记打上主题标签：

${noteList}

为每条快记生成 1-3 个主题标签，输出 JSON 格式。`
}

/**
 * 解析批次结果
 */
function parseBatchResult(aiResponse, noteSummaries) {
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI 返回格式错误')
  }

  const parsed = JSON.parse(jsonMatch[0])

  if (!parsed.classifications || !Array.isArray(parsed.classifications)) {
    throw new Error('AI 返回格式错误，缺少 classifications')
  }

  // 关联回原始快记
  return noteSummaries.map((note, idx) => {
    const classification = parsed.classifications.find(c => c.noteIndex === idx + 1)
    return {
      id: note.id,
      content: note.fullContent,
      preview: note.content,
      createdAt: note.createdAt,
      tags: classification?.tags || ['其他']
    }
  })
}

/**
 * 合并所有批次结果，按标签聚合成主题
 */
export function mergeAndGroupResults(batchResults) {
  // 扁平化所有分类结果
  const allClassified = batchResults.flat()

  // 按标签聚合
  const tagGroups = new Map()

  for (const item of allClassified) {
    for (const tag of item.tags) {
      if (!tagGroups.has(tag)) {
        tagGroups.set(tag, [])
      }
      tagGroups.get(tag).push(item)
    }
  }

  // 转换为主题格式
  const topics = []
  for (const [tag, notes] of tagGroups) {
    // 去重（一条快记可能有多个标签）
    const uniqueNotes = [...new Map(notes.map(n => [n.id, n])).values()]

    topics.push({
      title: tag,
      description: `包含 "${tag}" 标签的快记`,
      notes: uniqueNotes.map(n => ({
        id: n.id,
        content: n.content,
        preview: n.preview,
        createdAt: n.createdAt
      })),
      count: uniqueNotes.length
    })
  }

  // 按数量排序
  topics.sort((a, b) => b.count - a.count)

  // 合并小主题到"其他"
  const MIN_TOPIC_SIZE = 2
  const mainTopics = topics.filter(t => t.count >= MIN_TOPIC_SIZE && t.title !== '其他')
  const smallTopics = topics.filter(t => t.count < MIN_TOPIC_SIZE || t.title === '其他')

  if (smallTopics.length > 0) {
    const otherNotes = new Map()
    for (const topic of smallTopics) {
      for (const note of topic.notes) {
        otherNotes.set(note.id, note)
      }
    }

    if (otherNotes.size > 0) {
      mainTopics.push({
        title: '其他',
        description: '未能明确归类的快记',
        notes: [...otherNotes.values()],
        count: otherNotes.size
      })
    }
  }

  return { topics: mainTopics }
}
