/**
 * AI 服务模块
 *
 * 使用阿里云 DashScope (通义千问) API
 *
 * API 文档：https://help.aliyun.com/zh/dashscope/developer-reference/api-details
 *
 * 功能：
 * 1. 语义判断 - 判断内容是否需要 AI 回答
 * 2. 回答生成 - 基于用户问题和历史快记生成回答
 * 3. 联网搜索 - 在需要时搜索网络获取最新信息
 * 4. 相关性计算 - 使用embedding相似度选择最相关的快记
 */

import { generateEmbedding, cosineSimilarity } from './embedding.js'
import { loadEmbeddings } from '../data/index.js'

// DashScope API 配置
const DASHSCOPE_API_KEY = 'sk-3914c2f7b03d472ab8becc4e09310f35'
const DASHSCOPE_API_URL = '/api/dashscope/api/v1/services/aigc/text-generation/generation'

// 模型选择
const MODEL = 'qwen-turbo'  // 可选: qwen-turbo, qwen-plus, qwen-max

/**
 * 调用 DashScope API
 */
async function callDashScope(messages, options = {}) {
  const startTime = Date.now()

  try {
    const response = await fetch(DASHSCOPE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DASHSCOPE_API_KEY}`
      },
      body: JSON.stringify({
        model: options.model || MODEL,
        input: {
          messages: messages
        },
        parameters: {
          result_format: 'message',
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 1500
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('DashScope API 错误:', response.status, errorText)
      throw new Error(`API 请求失败: ${response.status}`)
    }

    const data = await response.json()
    const latencyMs = Date.now() - startTime

    // 检查 API 返回的错误
    if (data.code) {
      throw new Error(`DashScope 错误: ${data.code} - ${data.message}`)
    }

    // 提取回答内容
    const choice = data.output?.choices?.[0]
    const content = choice?.message?.content || ''
    const usage = data.usage || {}

    return {
      success: true,
      content: content,
      metadata: {
        model: options.model || MODEL,
        promptTokens: usage.input_tokens || 0,
        completionTokens: usage.output_tokens || 0,
        totalTokens: usage.total_tokens || 0,
        latencyMs: latencyMs
      }
    }
  } catch (error) {
    console.error('调用 DashScope 失败:', error)
    return {
      success: false,
      error: error.message,
      metadata: {
        model: options.model || MODEL,
        latencyMs: Date.now() - startTime
      }
    }
  }
}

/**
 * 判断内容是否需要 AI 回答
 *
 * 使用 AI 进行语义判断，而不是简单的规则匹配
 */
export async function judgeNeedsAIResponse(content) {
  const messages = [
    {
      role: 'system',
      content: `你是一个语义分析助手。你的任务是判断用户输入的内容是否是一个需要AI回答的问题或请求。

判断标准：
- 询问类：用户在询问信息、寻求解释、请求建议
- 求助类：用户需要帮助解决问题、完成任务
- 讨论类：用户想要讨论某个话题、获取观点

不需要回答的情况：
- 纯记录类：用户只是记录想法、日程、备忘
- 陈述类：用户只是陈述事实或表达感受，没有期待回应
- 简短感叹：如"今天真累"、"好开心"

请只回答 JSON 格式：{"needsResponse": true/false, "reason": "简短理由"}`
    },
    {
      role: 'user',
      content: content
    }
  ]

  const result = await callDashScope(messages, { temperature: 0.3, maxTokens: 200 })

  if (!result.success) {
    // 如果 API 调用失败，回退到规则判断
    return {
      needsResponse: fallbackJudge(content),
      reason: 'API 调用失败，使用规则判断',
      usedFallback: true
    }
  }

  try {
    // 尝试解析 JSON 响应
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        needsResponse: parsed.needsResponse === true,
        reason: parsed.reason || '',
        usedFallback: false
      }
    }
  } catch (e) {
    console.error('解析判断结果失败:', e)
  }

  // 解析失败，回退到规则判断
  return {
    needsResponse: fallbackJudge(content),
    reason: '解析失败，使用规则判断',
    usedFallback: true
  }
}

/**
 * 规则判断（回退方案）
 */
function fallbackJudge(content) {
  const text = content.trim()

  if (text.includes('?') || text.includes('？')) return true

  const questionWords = [
    '什么', '怎么', '如何', '为什么', '为啥', '哪个', '哪些', '哪里',
    '谁', '多少', '是否', '能不能', '可不可以', '会不会', '有没有',
    '请问', '想知道', '想了解', '求', '帮我', '告诉我', '解释',
    '建议', '推荐', '应该', '该怎么', '怎样', '何时', '何地'
  ]

  for (const word of questionWords) {
    if (text.includes(word)) return true
  }

  const questionEndings = ['吗', '呢', '吧', '呀', '啊', '么']
  for (const ending of questionEndings) {
    if (text.endsWith(ending) && text.length > 5) return true
  }

  return false
}

/**
 * 判断是否需要联网搜索
 *
 * @param {string} question - 用户问题
 * @param {Array} historyNotes - 用户历史快记
 * @returns {Promise<{needsSearch: boolean, searchQuery: string, reason: string}>}
 */
export async function judgeNeedsWebSearch(question, historyNotes = []) {
  const messages = [
    {
      role: 'system',
      content: `你是一个智能判断助手。判断用户的问题是否需要联网搜索才能回答。

需要联网搜索的情况：
- 询问最新新闻、时事、实时信息
- 询问具体的事实数据（如股价、天气、比赛结果）
- 询问最新的产品、技术、政策信息
- 用户明确要求搜索或查询网络

不需要联网搜索的情况：
- 问题可以基于用户的历史快记回答
- 通用知识问答（常识、概念解释）
- 个人建议、观点讨论
- 创意写作、头脑风暴

请只回答 JSON 格式：
{
  "needsSearch": true/false,
  "searchQuery": "如果需要搜索，给出最佳搜索词（简洁精准）",
  "reason": "简短理由"
}`
    },
    {
      role: 'user',
      content: `用户问题：${question}\n\n用户有 ${historyNotes.length} 条历史快记。`
    }
  ]

  const result = await callDashScope(messages, { temperature: 0.3, maxTokens: 200 })

  if (!result.success) {
    // 默认不搜索
    return { needsSearch: false, searchQuery: '', reason: 'API 调用失败' }
  }

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        needsSearch: parsed.needsSearch === true,
        searchQuery: parsed.searchQuery || question,
        reason: parsed.reason || ''
      }
    }
  } catch (e) {
    console.error('解析搜索判断失败:', e)
  }

  return { needsSearch: false, searchQuery: '', reason: '解析失败' }
}

/**
 * 执行网络搜索
 *
 * 使用 DuckDuckGo HTML 搜索（通过代理）
 *
 * @param {string} query - 搜索关键词
 * @returns {Promise<{success: boolean, results: Array, error?: string}>}
 */
export async function webSearch(query) {
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`)

    if (!response.ok) {
      throw new Error(`搜索请求失败: ${response.status}`)
    }

    const data = await response.json()

    return {
      success: true,
      results: data.results || [],
      query: query
    }
  } catch (error) {
    console.error('网络搜索失败:', error)
    return {
      success: false,
      results: [],
      error: error.message,
      query: query
    }
  }
}

/**
 * 生成 AI 回答
 *
 * @param {string} question - 用户问题
 * @param {Array} historyNotes - 用户历史快记（用作上下文）
 * @param {Object} options - 选项
 * @param {boolean} options.enableWebSearch - 是否启用联网搜索（默认 true）
 */
export async function generateAIResponse(question, historyNotes = [], options = {}) {
  const { enableWebSearch = true } = options

  // 使用embedding相似度选择最相关的快记
  let relevantNotes = []
  const MAX_CONTEXT_NOTES = 15  // 最多使用15条相关快记

  try {
    // 生成问题的embedding
    const questionEmbedding = await generateEmbedding(question)

    if (questionEmbedding.success && questionEmbedding.embedding) {
      // 加载所有快记的embedding
      const allEmbeddings = loadEmbeddings()
      const embeddingMap = new Map(allEmbeddings.map(e => [e.noteId, e.embedding]))

      // 计算相似度并排序
      const notesWithSimilarity = historyNotes
        .filter(n => n.content && n.content.length > 0)
        .map(note => {
          const noteEmbedding = embeddingMap.get(note.id)
          const similarity = noteEmbedding
            ? cosineSimilarity(questionEmbedding.embedding, noteEmbedding)
            : 0
          return { note, similarity }
        })
        .filter(item => item.similarity > 0.3)  // 只选择相似度>0.3的
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_CONTEXT_NOTES)

      relevantNotes = notesWithSimilarity.map(item => item.note)
      console.log(`[AI] 使用embedding选择了${relevantNotes.length}条相关快记`)
    }
  } catch (error) {
    console.error('[AI] embedding相似度计算失败，回退到简单选择:', error)
  }

  // 如果embedding失败，回退到简单的前N条
  if (relevantNotes.length === 0) {
    relevantNotes = historyNotes
      .filter(n => n.content && n.content.length > 0)
      .slice(0, MAX_CONTEXT_NOTES)
  }

  // 构建历史快记上下文
  let contextText = ''
  if (relevantNotes.length > 0) {
    contextText = relevantNotes
      .map((n, i) => `[快记${i + 1}] ${n.content}`)
      .join('\n')
  }

  // 判断是否需要联网搜索
  let webSearchResult = null
  let usedWebSearch = false

  if (enableWebSearch) {
    const searchJudge = await judgeNeedsWebSearch(question, relevantNotes)
    console.log('搜索判断:', searchJudge)

    if (searchJudge.needsSearch) {
      console.log('执行联网搜索:', searchJudge.searchQuery)
      webSearchResult = await webSearch(searchJudge.searchQuery)
      usedWebSearch = webSearchResult.success && webSearchResult.results.length > 0
      console.log('搜索结果:', webSearchResult)
    }
  }

  // 构建搜索结果上下文
  let searchContext = ''
  if (usedWebSearch && webSearchResult.results.length > 0) {
    searchContext = '\n\n【联网搜索结果】\n' + webSearchResult.results
      .slice(0, 5)  // 最多使用 5 条搜索结果
      .map((r, i) => `[搜索${i + 1}] ${r.title}\n${r.snippet}\n来源: ${r.url}`)
      .join('\n\n')
  }

  const systemPrompt = `你是「即我快记」的 AI 助手。你的任务是基于用户的历史快记${usedWebSearch ? '和联网搜索结果' : ''}来回答问题。

核心原则：
1. 优先使用用户的快记内容来回答
2. ${usedWebSearch ? '如果快记中没有相关信息，参考联网搜索结果来回答' : '如果快记中没有相关信息，可以提供通用建议'}
3. 不要编造用户没有记录过的个人信息
4. 回答要简洁、有帮助
${usedWebSearch ? '5. 引用搜索结果时，注明信息来源' : ''}

${contextText ? `【用户的历史快记】\n${contextText}` : '用户目前没有相关的历史快记。'}
${searchContext}

请基于以上信息回答用户的问题。`

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: question }
  ]

  const result = await callDashScope(messages, {
    temperature: 0.7,
    maxTokens: 1500
  })

  if (!result.success) {
    return {
      success: false,
      content: `抱歉，AI 服务暂时不可用：${result.error}`,
      sourceNoteIds: [],
      usedWebSearch: false,
      webSearchResult: null,
      metadata: result.metadata
    }
  }

  return {
    success: true,
    content: result.content,
    sourceNoteIds: relevantNotes.map(n => n.id),
    usedWebSearch: usedWebSearch,
    webSearchResult: usedWebSearch ? webSearchResult : null,
    metadata: result.metadata
  }
}

/**
 * 测试 AI 服务连接
 */
export async function testConnection() {
  const messages = [
    { role: 'user', content: '你好，请回复"连接成功"' }
  ]

  const result = await callDashScope(messages, { maxTokens: 50 })
  return result
}

// 导出常量
export { MODEL, DASHSCOPE_API_KEY }
