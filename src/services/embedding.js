/**
 * Embedding 服务模块
 *
 * 使用阿里云 DashScope text-embedding-v3 模型
 * 统一走云端 API，无需本地服务
 *
 * API 文档：https://help.aliyun.com/zh/dashscope/developer-reference/text-embedding-api-details
 */

// DashScope API 配置（与 ai.js 保持一致）
const DASHSCOPE_API_KEY = 'sk-3914c2f7b03d472ab8becc4e09310f35'
const EMBEDDING_API_URL = '/api/dashscope/api/v1/services/embeddings/text-embedding/text-embedding'
const EMBEDDING_MODEL = 'text-embedding-v3'  // 1024 维向量

/**
 * 生成文本的 embedding 向量
 *
 * @param {string} text - 要嵌入的文本
 * @returns {Promise<{success: boolean, embedding?: number[], error?: string, latencyMs?: number}>}
 */
export async function generateEmbedding(text) {
  const startTime = Date.now()

  // 预处理文本：去除多余空白，限制长度
  const processedText = text.trim().slice(0, 2048)

  if (!processedText) {
    return {
      success: false,
      error: '文本内容为空',
      latencyMs: Date.now() - startTime
    }
  }

  try {
    const response = await fetch(EMBEDDING_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: {
          texts: [processedText]
        },
        parameters: {
          text_type: 'document'
        }
      }),
      signal: AbortSignal.timeout(30000)
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Embedding API 错误:', response.status, errorText)
      return {
        success: false,
        error: `API 请求失败: ${response.status}`,
        latencyMs: Date.now() - startTime
      }
    }

    const data = await response.json()

    // 检查 API 返回的错误
    if (data.code) {
      return {
        success: false,
        error: `API 错误: ${data.code}`,
        latencyMs: Date.now() - startTime
      }
    }

    // 提取 embedding 向量
    const embedding = data.output?.embeddings?.[0]?.embedding

    if (!embedding || !Array.isArray(embedding)) {
      return {
        success: false,
        error: '无效的 embedding 响应',
        latencyMs: Date.now() - startTime
      }
    }

    return {
      success: true,
      embedding: embedding,
      model: EMBEDDING_MODEL,
      dimensions: embedding.length,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error('Embedding 生成失败:', error)
    return {
      success: false,
      error: error.name === 'TimeoutError' ? '请求超时' : error.message,
      latencyMs: Date.now() - startTime
    }
  }
}

/**
 * 真正的批量生成 embedding（单次 API 调用处理多条文本）
 *
 * DashScope text-embedding-v3 支持单次最多 25 条文本
 *
 * @param {string[]} texts - 文本数组
 * @returns {Promise<{success: boolean, embeddings?: number[][], error?: string}>}
 */
async function generateEmbeddingsBatchAPI(texts) {
  const startTime = Date.now()

  // 预处理文本
  const processedTexts = texts.map(t => t.trim().slice(0, 2048)).filter(t => t.length > 0)

  if (processedTexts.length === 0) {
    return { success: false, error: '没有有效文本' }
  }

  try {
    const response = await fetch(EMBEDDING_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: {
          texts: processedTexts
        },
        parameters: {
          text_type: 'document'
        }
      }),
      signal: AbortSignal.timeout(60000)  // 批量请求给更长超时
    })

    if (!response.ok) {
      return { success: false, error: `API 请求失败: ${response.status}` }
    }

    const data = await response.json()

    if (data.code) {
      return { success: false, error: `API 错误: ${data.code}` }
    }

    const embeddings = data.output?.embeddings?.map(e => e.embedding)

    if (!embeddings || embeddings.length !== processedTexts.length) {
      return { success: false, error: '响应数量不匹配' }
    }

    return {
      success: true,
      embeddings: embeddings,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    return {
      success: false,
      error: error.name === 'TimeoutError' ? '请求超时' : error.message
    }
  }
}

/**
 * 批量生成 embedding（分批处理）
 *
 * @param {string[]} texts - 文本数组
 * @param {Function} onProgress - 进度回调 (completed, total)
 * @returns {Promise<Array<{text: string, embedding?: number[], error?: string}>>}
 */
export async function generateEmbeddingsBatch(texts, onProgress = null) {
  const BATCH_SIZE = 20  // DashScope 支持最多 25，我们用 20 留余量
  const results = []
  const total = texts.length

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, Math.min(i + BATCH_SIZE, texts.length))

    const batchResult = await generateEmbeddingsBatchAPI(batch)

    if (batchResult.success) {
      for (let j = 0; j < batch.length; j++) {
        results.push({
          text: batch[j].slice(0, 50),
          success: true,
          embedding: batchResult.embeddings[j],
          model: EMBEDDING_MODEL
        })
      }
    } else {
      // 批量失败时，逐个重试
      for (const text of batch) {
        const result = await generateEmbedding(text)
        results.push({
          text: text.slice(0, 50),
          ...result
        })
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, texts.length), total)
    }

    // 批次之间的延迟
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }

  return results
}

/**
 * 计算两个向量的余弦相似度
 *
 * @param {number[]} a - 向量 A
 * @param {number[]} b - 向量 B
 * @returns {number} 相似度 (0-1)
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  normA = Math.sqrt(normA)
  normB = Math.sqrt(normB)

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (normA * normB)
}

/**
 * 计算向量的平均值（聚类中心）
 *
 * @param {number[][]} vectors - 向量数组
 * @returns {number[]} 平均向量
 */
export function computeCentroid(vectors) {
  if (!vectors || vectors.length === 0) {
    return []
  }

  const dimensions = vectors[0].length
  const centroid = new Array(dimensions).fill(0)

  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += vector[i]
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= vectors.length
  }

  return centroid
}

/**
 * 找到与给定向量最近的聚类
 *
 * @param {number[]} embedding - 待查找的向量
 * @param {Array} clusters - 聚类数组，每个聚类有 centroid 属性
 * @returns {{cluster: Object|null, similarity: number, index: number}}
 */
export function findNearestCluster(embedding, clusters) {
  if (!embedding || !clusters || clusters.length === 0) {
    return { cluster: null, similarity: 0, index: -1 }
  }

  let maxSimilarity = -1
  let nearestCluster = null
  let nearestIndex = -1

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]
    if (!cluster.centroid || cluster.centroid.length === 0) {
      continue
    }

    const similarity = cosineSimilarity(embedding, cluster.centroid)

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      nearestCluster = cluster
      nearestIndex = i
    }
  }

  return {
    cluster: nearestCluster,
    similarity: maxSimilarity,
    index: nearestIndex
  }
}

/**
 * 找到与给定向量最相似的 N 个向量
 *
 * @param {number[]} embedding - 目标向量
 * @param {Array} embeddings - embedding 数组，每个元素有 embedding 和 noteId 属性
 * @param {number} topN - 返回数量
 * @returns {Array<{noteId: string, similarity: number}>}
 */
export function findSimilarNotes(embedding, embeddings, topN = 5) {
  if (!embedding || !embeddings || embeddings.length === 0) {
    return []
  }

  const similarities = embeddings
    .filter(e => e.embedding && e.embedding.length > 0)
    .map(e => ({
      noteId: e.noteId,
      similarity: cosineSimilarity(embedding, e.embedding)
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN)

  return similarities
}
