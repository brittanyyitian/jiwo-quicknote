/**
 * 增量分类引擎
 *
 * 基于云端 embedding 向量的增量聚类算法
 * 使用 DashScope text-embedding-v3 模型
 *
 * 核心流程：
 * 1. 新快记 → 生成 embedding（云端）
 * 2. 计算与现有聚类中心的相似度
 * 3. 若相似度 > 阈值，加入最近聚类
 * 4. 否则创建新聚类
 * 5. 更新聚类中心
 */

import {
  createNoteEmbedding,
  createCluster,
  createClassificationTask,
  loadEmbeddings,
  loadClusters,
  loadNotes,
  upsertEmbedding,
  upsertCluster,
  saveClusters,
  enqueueClassificationTask,
  getNextPendingTask,
  updateTaskStatus,
  cleanupCompletedTasks,
  getQueueStats,
  removeNoteFromCluster,
  deleteEmbeddingByNoteId
} from '../data/index.js'

import {
  generateEmbedding,
  generateEmbeddingsBatch,
  cosineSimilarity,
  computeCentroid,
  findNearestCluster
} from './embedding.js'

// 分类阈值（硬编码，不暴露给用户）
const SIMILARITY_THRESHOLD = 0.7
const MERGE_THRESHOLD = 0.85
const MAX_CLUSTER_SIZE = 50

// 分类器状态
let isProcessing = false
let processingCallback = null

/**
 * 初始化分类服务
 *
 * @param {Function} onStatusChange - 状态变化回调
 */
export function initClassifier(onStatusChange = null) {
  processingCallback = onStatusChange
  // 启动时检查是否有待处理任务
  const stats = getQueueStats()
  if (stats.pending > 0) {
    console.log(`发现 ${stats.pending} 个待处理分类任务`)
  }
}

/**
 * 添加快记到分类队列
 *
 * @param {string} noteId - 快记 ID
 * @returns {boolean} 是否成功添加
 */
export function enqueueNote(noteId) {
  const task = createClassificationTask({ noteId })
  enqueueClassificationTask(task)

  // 触发处理
  processQueue()

  return true
}

/**
 * 处理分类队列（非阻塞）
 */
export async function processQueue() {
  if (isProcessing) {
    return
  }

  isProcessing = true
  notifyStatus('processing')

  try {
    while (true) {
      const task = getNextPendingTask()
      if (!task) {
        break
      }

      // 标记为处理中
      updateTaskStatus(task.id, 'processing')

      try {
        await classifyNote(task.noteId)
        updateTaskStatus(task.id, 'done')
      } catch (error) {
        console.error(`分类任务失败 [${task.noteId}]:`, error)
        updateTaskStatus(task.id, 'error', error.message)
      }

      // 小延迟避免过快处理
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // 清理旧任务
    cleanupCompletedTasks()

  } finally {
    isProcessing = false
    notifyStatus('idle')
  }
}

/**
 * 对单个快记进行分类
 *
 * @param {string} noteId - 快记 ID
 */
async function classifyNote(noteId) {
  const notes = loadNotes()
  const note = notes.find(n => n.id === noteId)

  if (!note || !note.content || note.content.trim().length === 0) {
    throw new Error('快记不存在或内容为空')
  }

  // 生成 embedding（云端 API）
  const embeddingResult = await generateEmbedding(note.content)
  if (!embeddingResult.success) {
    throw new Error(`生成 embedding 失败: ${embeddingResult.error}`)
  }

  const embedding = embeddingResult.embedding

  // 保存 embedding
  const noteEmbedding = createNoteEmbedding({
    noteId: noteId,
    embedding: embedding,
    model: embeddingResult.model
  })
  upsertEmbedding(noteEmbedding)

  // 获取现有聚类
  const clusters = loadClusters()

  if (clusters.length === 0) {
    // 没有聚类，创建第一个
    const newCluster = createCluster({
      name: generateClusterName([note.content]),
      centroid: embedding,
      noteIds: [noteId]
    })
    upsertCluster(newCluster)
    console.log(`创建新聚类: ${newCluster.name}`)
    return
  }

  // 找到最近的聚类
  const { cluster: nearestCluster, similarity } = findNearestCluster(embedding, clusters)

  if (similarity >= SIMILARITY_THRESHOLD) {
    // 加入现有聚类
    nearestCluster.noteIds.push(noteId)
    nearestCluster.updatedAt = new Date().toISOString()

    // 重新计算聚类中心
    const clusterEmbeddings = loadEmbeddings()
      .filter(e => nearestCluster.noteIds.includes(e.noteId))
      .map(e => e.embedding)

    if (clusterEmbeddings.length > 0) {
      nearestCluster.centroid = computeCentroid(clusterEmbeddings)
    }

    upsertCluster(nearestCluster)
    console.log(`快记加入聚类 "${nearestCluster.name}" (相似度: ${similarity.toFixed(3)})`)

    // 检查是否需要分裂
    if (nearestCluster.noteIds.length > MAX_CLUSTER_SIZE) {
      await splitCluster(nearestCluster)
    }
  } else {
    // 创建新聚类
    const newCluster = createCluster({
      name: generateClusterName([note.content]),
      centroid: embedding,
      noteIds: [noteId]
    })
    upsertCluster(newCluster)
    console.log(`创建新聚类: ${newCluster.name} (最大相似度: ${similarity.toFixed(3)})`)
  }

  // 检查是否需要合并聚类
  await checkAndMergeClusters()
}

/**
 * 生成聚类名称（简单版本）
 *
 * @param {string[]} contents - 快记内容数组
 * @returns {string} 聚类名称
 */
function generateClusterName(contents) {
  if (!contents || contents.length === 0) {
    return '未命名'
  }

  // 简单策略：取第一条内容的前几个关键词
  const firstContent = contents[0]
  const cleaned = firstContent
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .slice(0, 3)
    .join('')

  return cleaned.slice(0, 10) || '新主题'
}

/**
 * 分裂过大的聚类
 *
 * @param {Object} cluster - 要分裂的聚类
 */
async function splitCluster(cluster) {
  console.log(`聚类 "${cluster.name}" 过大 (${cluster.noteIds.length})，尝试分裂...`)

  const embeddings = loadEmbeddings()
  const clusterEmbeddings = embeddings.filter(e => cluster.noteIds.includes(e.noteId))

  if (clusterEmbeddings.length < 4) {
    return
  }

  // 简单的二分法：找到最远的两个点作为新中心
  let maxDist = 0
  let point1 = null
  let point2 = null

  for (let i = 0; i < clusterEmbeddings.length; i++) {
    for (let j = i + 1; j < clusterEmbeddings.length; j++) {
      const dist = 1 - cosineSimilarity(
        clusterEmbeddings[i].embedding,
        clusterEmbeddings[j].embedding
      )
      if (dist > maxDist) {
        maxDist = dist
        point1 = clusterEmbeddings[i]
        point2 = clusterEmbeddings[j]
      }
    }
  }

  if (!point1 || !point2) {
    return
  }

  // 将快记分配到两个新聚类
  const group1 = []
  const group2 = []

  for (const e of clusterEmbeddings) {
    const sim1 = cosineSimilarity(e.embedding, point1.embedding)
    const sim2 = cosineSimilarity(e.embedding, point2.embedding)

    if (sim1 >= sim2) {
      group1.push(e)
    } else {
      group2.push(e)
    }
  }

  // 更新原聚类
  const notes = loadNotes()
  cluster.noteIds = group1.map(e => e.noteId)
  cluster.centroid = computeCentroid(group1.map(e => e.embedding))
  cluster.name = generateClusterName(
    group1.map(e => notes.find(n => n.id === e.noteId)?.content || '')
  )
  cluster.updatedAt = new Date().toISOString()
  upsertCluster(cluster)

  // 创建新聚类
  const newCluster = createCluster({
    name: generateClusterName(
      group2.map(e => notes.find(n => n.id === e.noteId)?.content || '')
    ),
    centroid: computeCentroid(group2.map(e => e.embedding)),
    noteIds: group2.map(e => e.noteId)
  })
  upsertCluster(newCluster)

  console.log(`分裂完成: "${cluster.name}" (${group1.length}) + "${newCluster.name}" (${group2.length})`)
}

/**
 * 检查并合并相似的聚类
 */
async function checkAndMergeClusters() {
  const clusters = loadClusters()

  if (clusters.length < 2) {
    return
  }

  // 找到最相似的两个聚类
  let maxSim = 0
  let mergeI = -1
  let mergeJ = -1

  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      if (!clusters[i].centroid?.length || !clusters[j].centroid?.length) {
        continue
      }
      const sim = cosineSimilarity(clusters[i].centroid, clusters[j].centroid)
      if (sim > maxSim) {
        maxSim = sim
        mergeI = i
        mergeJ = j
      }
    }
  }

  // 如果相似度超过合并阈值，合并聚类
  if (maxSim >= MERGE_THRESHOLD && mergeI >= 0 && mergeJ >= 0) {
    const clusterA = clusters[mergeI]
    const clusterB = clusters[mergeJ]

    console.log(`合并聚类: "${clusterA.name}" + "${clusterB.name}" (相似度: ${maxSim.toFixed(3)})`)

    // 合并到 A
    clusterA.noteIds = [...clusterA.noteIds, ...clusterB.noteIds]

    // 重新计算中心
    const embeddings = loadEmbeddings()
    const mergedEmbeddings = embeddings
      .filter(e => clusterA.noteIds.includes(e.noteId))
      .map(e => e.embedding)

    clusterA.centroid = computeCentroid(mergedEmbeddings)
    clusterA.updatedAt = new Date().toISOString()

    // 更新 A，删除 B
    const newClusters = clusters.filter(c => c.id !== clusterB.id)
    newClusters[mergeI] = clusterA
    saveClusters(newClusters)
  }
}

/**
 * 重新分类所有快记（使用批量 API 加速）
 *
 * @param {Function} onProgress - 进度回调 (completed, total)
 * @returns {Promise<{success: boolean, stats: Object}>}
 */
export async function reclassifyAll(onProgress = null) {
  const notes = loadNotes()
  const validNotes = notes.filter(n => n.content && n.content.trim().length > 0)

  if (validNotes.length === 0) {
    return { success: false, error: '没有可分类的快记' }
  }

  // 清空现有聚类
  saveClusters([])

  const total = validNotes.length
  let embeddingsGenerated = 0
  let errors = 0

  // 阶段1：批量生成 embeddings
  console.log(`开始批量生成 embeddings，共 ${total} 条快记`)

  const texts = validNotes.map(n => n.content)
  const batchResults = await generateEmbeddingsBatch(texts, (completed, batchTotal) => {
    embeddingsGenerated = completed
    if (onProgress) {
      // 前 80% 进度用于生成 embeddings
      onProgress(Math.floor(completed * 0.8), total)
    }
  })

  // 保存生成的 embeddings
  for (let i = 0; i < validNotes.length; i++) {
    const note = validNotes[i]
    const result = batchResults[i]

    if (result && result.success && result.embedding) {
      const noteEmbedding = createNoteEmbedding({
        noteId: note.id,
        embedding: result.embedding,
        model: result.model || 'text-embedding-v3'
      })
      upsertEmbedding(noteEmbedding)
    } else {
      errors++
    }
  }

  console.log(`Embeddings 生成完成，成功 ${validNotes.length - errors}，失败 ${errors}`)

  // 阶段2：聚类
  console.log('开始聚类...')

  const embeddings = loadEmbeddings()
  const embeddingsMap = new Map(embeddings.map(e => [e.noteId, e]))

  let clustered = 0
  for (const note of validNotes) {
    const noteEmbedding = embeddingsMap.get(note.id)
    if (!noteEmbedding || !noteEmbedding.embedding) {
      continue
    }

    // 获取现有聚类
    const clusters = loadClusters()

    if (clusters.length === 0) {
      // 创建第一个聚类
      const newCluster = createCluster({
        name: generateClusterName([note.content]),
        centroid: noteEmbedding.embedding,
        noteIds: [note.id]
      })
      upsertCluster(newCluster)
    } else {
      // 找到最近的聚类
      const { cluster: nearestCluster, similarity } = findNearestCluster(noteEmbedding.embedding, clusters)

      if (similarity >= SIMILARITY_THRESHOLD) {
        // 加入现有聚类
        nearestCluster.noteIds.push(note.id)
        nearestCluster.updatedAt = new Date().toISOString()

        // 重新计算聚类中心
        const clusterEmbeddings = nearestCluster.noteIds
          .map(id => embeddingsMap.get(id))
          .filter(e => e && e.embedding)
          .map(e => e.embedding)

        if (clusterEmbeddings.length > 0) {
          nearestCluster.centroid = computeCentroid(clusterEmbeddings)
        }

        upsertCluster(nearestCluster)
      } else {
        // 创建新聚类
        const newCluster = createCluster({
          name: generateClusterName([note.content]),
          centroid: noteEmbedding.embedding,
          noteIds: [note.id]
        })
        upsertCluster(newCluster)
      }
    }

    clustered++
    if (onProgress) {
      // 后 20% 进度用于聚类
      onProgress(Math.floor(total * 0.8 + clustered * 0.2), total)
    }
  }

  // 合并相似聚类
  await checkAndMergeClusters()

  console.log(`分类完成，共 ${loadClusters().length} 个聚类`)

  return {
    success: true,
    stats: {
      total: validNotes.length,
      completed: validNotes.length - errors,
      errors: errors,
      clusters: loadClusters().length
    }
  }
}

/**
 * 删除快记时清理分类数据
 *
 * @param {string} noteId - 快记 ID
 */
export function cleanupNoteClassification(noteId) {
  deleteEmbeddingByNoteId(noteId)
  removeNoteFromCluster(noteId)
}

/**
 * 获取分类状态
 *
 * @returns {Object} 状态信息
 */
export function getClassificationStatus() {
  const stats = getQueueStats()
  const clusters = loadClusters()
  const embeddings = loadEmbeddings()

  return {
    isProcessing,
    queue: stats,
    clusters: {
      count: clusters.length,
      totalNotes: clusters.reduce((sum, c) => sum + c.noteIds.length, 0)
    },
    embeddings: {
      count: embeddings.length
    }
  }
}

/**
 * 通知状态变化
 */
function notifyStatus(status) {
  if (processingCallback) {
    processingCallback(status, getClassificationStatus())
  }
}
