/**
 * 快记自动分类服务
 *
 * 使用 AI 对快记进行语义聚类，自动生成主题
 *
 * 核心流程：
 * 1. 读取所有快记
 * 2. 使用 AI 进行语义理解和聚类
 * 3. 为每个聚类生成主题标题
 * 4. 预览模式 → 确认 → 写入
 */

import { DASHSCOPE_API_KEY } from './ai.js'

const DASHSCOPE_API_URL = '/api/dashscope/api/v1/services/aigc/text-generation/generation'

/**
 * 调用 AI 进行分类
 */
async function callAI(messages, options = {}) {
  try {
    const response = await fetch(DASHSCOPE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
      },
      body: JSON.stringify({
        model: options.model || 'qwen-plus',  // 使用更强的模型进行分类
        input: { messages },
        parameters: {
          result_format: 'message',
          temperature: options.temperature ?? 0.3,
          max_tokens: options.maxTokens ?? 4000
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

    return {
      success: true,
      content: data.output?.choices?.[0]?.message?.content || ''
    }
  } catch (error) {
    console.error('AI 调用失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 生成分类预览（不写入数据）
 *
 * @param {Array} notes - 所有快记
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 分类预览结果
 */
export async function generateClassificationPreview(notes, options = {}) {
  // 过滤有内容的快记
  const validNotes = notes.filter(n => n.content && n.content.trim().length > 0)

  if (validNotes.length === 0) {
    return {
      success: false,
      error: '没有可分类的快记'
    }
  }

  // 准备快记摘要（每条最多100字）
  const noteSummaries = validNotes.map((note, index) => ({
    id: note.id,
    index: index + 1,
    content: note.content.slice(0, 100) + (note.content.length > 100 ? '...' : ''),
    fullContent: note.content,
    createdAt: note.createdAt
  }))

  // 构建 AI 提示
  const prompt = buildClassificationPrompt(noteSummaries)

  console.log('开始 AI 分类，快记数量:', validNotes.length)

  const result = await callAI([
    { role: 'system', content: getSystemPrompt() },
    { role: 'user', content: prompt }
  ], { maxTokens: 4000 })

  if (!result.success) {
    return {
      success: false,
      error: `AI 分类失败: ${result.error}`
    }
  }

  // 解析 AI 返回的分类结果
  try {
    const classification = parseClassificationResult(result.content, noteSummaries)
    return {
      success: true,
      preview: classification,
      originalNotes: validNotes
    }
  } catch (error) {
    console.error('解析分类结果失败:', error)
    return {
      success: false,
      error: `解析分类结果失败: ${error.message}`
    }
  }
}

/**
 * 获取系统提示词
 */
function getSystemPrompt() {
  return `你是一个快记分类专家。你的任务是根据用户的快记内容，将它们按照语义相似性进行聚类分组。

分类规则：
1. 主题应代表一类"稳定语义"，如：工作、学习、情绪、健康、关系、创作、生活等
2. 主题标题要求：
   - 中文
   - 简短（2-6个字）
   - 易于理解的概念词
3. 避免：
   - 一个主题只有1条快记（除非确实独立）
   - 所有快记塞进1个主题
   - 过多细碎的主题
4. 可以有一个"其他"主题作为兜底

输出格式（必须是有效的 JSON）：
{
  "topics": [
    {
      "title": "主题标题",
      "description": "简短描述这个主题包含什么类型的内容",
      "noteIndexes": [1, 2, 3]
    }
  ]
}

注意：
- noteIndexes 是快记的序号（从1开始），不是 ID
- 确保每条快记都被分到某个主题
- 不要遗漏任何快记`
}

/**
 * 构建分类提示
 */
function buildClassificationPrompt(noteSummaries) {
  const noteList = noteSummaries
    .map(n => `[${n.index}] ${n.content}`)
    .join('\n\n')

  return `请对以下 ${noteSummaries.length} 条快记进行语义分类：

${noteList}

请根据内容语义将这些快记分成合理的主题组，并为每个主题生成一个简短的标题。
输出 JSON 格式的分类结果。`
}

/**
 * 解析 AI 返回的分类结果
 */
function parseClassificationResult(aiResponse, noteSummaries) {
  // 提取 JSON
  const jsonMatch = aiResponse.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI 返回格式错误，未找到 JSON')
  }

  const parsed = JSON.parse(jsonMatch[0])

  if (!parsed.topics || !Array.isArray(parsed.topics)) {
    throw new Error('AI 返回格式错误，缺少 topics 数组')
  }

  // 验证并补充数据
  const assignedIndexes = new Set()
  const result = {
    topics: [],
    unassignedNotes: []
  }

  for (const topic of parsed.topics) {
    if (!topic.title || !Array.isArray(topic.noteIndexes)) {
      continue
    }

    const topicNotes = []
    for (const index of topic.noteIndexes) {
      if (index >= 1 && index <= noteSummaries.length) {
        assignedIndexes.add(index)
        const note = noteSummaries[index - 1]
        topicNotes.push({
          id: note.id,
          content: note.fullContent,
          preview: note.content,
          createdAt: note.createdAt
        })
      }
    }

    if (topicNotes.length > 0) {
      result.topics.push({
        title: topic.title.slice(0, 20),  // 限制标题长度
        description: topic.description || '',
        notes: topicNotes,
        count: topicNotes.length
      })
    }
  }

  // 检查未分配的快记
  for (let i = 1; i <= noteSummaries.length; i++) {
    if (!assignedIndexes.has(i)) {
      const note = noteSummaries[i - 1]
      result.unassignedNotes.push({
        id: note.id,
        content: note.fullContent,
        preview: note.content,
        createdAt: note.createdAt
      })
    }
  }

  // 如果有未分配的快记，添加到"其他"主题
  if (result.unassignedNotes.length > 0) {
    result.topics.push({
      title: '其他',
      description: '未能明确归类的快记',
      notes: result.unassignedNotes,
      count: result.unassignedNotes.length
    })
  }

  // 按快记数量排序（多的在前）
  result.topics.sort((a, b) => b.count - a.count)

  return result
}

/**
 * 执行分类（写入数据）
 *
 * @param {Object} preview - 分类预览结果
 * @param {Function} createTopic - 创建主题的函数
 * @param {Function} updateNotes - 更新快记的函数
 * @returns {Object} 执行结果
 */
export function executeClassification(preview, createTopic, updateNotes) {
  const createdTopics = []
  const updatedNotes = []

  for (const topicPreview of preview.topics) {
    // 创建主题（标记为 AI 生成）
    const topic = createTopic({
      title: topicPreview.title,
      source: 'ai_generated'
    })
    createdTopics.push(topic)

    // 记录需要更新的快记
    for (const note of topicPreview.notes) {
      updatedNotes.push({
        id: note.id,
        topicId: topic.id
      })
    }
  }

  return {
    success: true,
    createdTopics,
    updatedNotes,
    summary: {
      topicsCreated: createdTopics.length,
      notesUpdated: updatedNotes.length
    }
  }
}

/**
 * 创建数据快照（用于回滚）
 */
export function createSnapshot(topics, notes) {
  return {
    timestamp: new Date().toISOString(),
    topics: JSON.parse(JSON.stringify(topics)),
    notes: JSON.parse(JSON.stringify(notes))
  }
}

/**
 * 从快照恢复数据
 */
export function restoreFromSnapshot(snapshot) {
  return {
    topics: snapshot.topics,
    notes: snapshot.notes
  }
}
