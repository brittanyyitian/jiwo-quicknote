import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 搜索代理插件
 * 处理 /api/search 请求，使用 DuckDuckGo 进行搜索
 */
function searchProxyPlugin() {
  return {
    name: 'search-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/api/search')) {
          const url = new URL(req.url, 'http://localhost')
          const query = url.searchParams.get('q')

          if (!query) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: '缺少搜索关键词', results: [] }))
            return
          }

          try {
            // 使用 DuckDuckGo HTML 搜索
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
            const response = await fetch(searchUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            })

            const html = await response.text()

            // 解析搜索结果
            const results = parseSearchResults(html)

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ results, query }))
          } catch (error) {
            console.error('搜索失败:', error)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: error.message, results: [] }))
          }
          return
        }
        next()
      })
    }
  }
}

/**
 * 解析 DuckDuckGo HTML 搜索结果
 */
function parseSearchResults(html) {
  const results = []

  // 匹配搜索结果块
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/g

  // 简化的正则匹配
  const titleLinkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g

  // 提取所有标题和链接
  const titleLinks = []
  let match
  while ((match = titleLinkPattern.exec(html)) !== null) {
    titleLinks.push({
      url: match[1],
      title: match[2].replace(/<[^>]*>/g, '').trim()
    })
  }

  // 提取所有摘要
  const snippets = []
  while ((match = snippetPattern.exec(html)) !== null) {
    snippets.push(match[1].replace(/<[^>]*>/g, '').trim())
  }

  // 合并结果
  for (let i = 0; i < Math.min(titleLinks.length, snippets.length, 10); i++) {
    if (titleLinks[i].url && titleLinks[i].title) {
      results.push({
        title: titleLinks[i].title,
        url: decodeURIComponent(titleLinks[i].url.replace(/.*uddg=/, '').split('&')[0] || titleLinks[i].url),
        snippet: snippets[i] || ''
      })
    }
  }

  return results
}

export default defineConfig({
  plugins: [
    react(),
    searchProxyPlugin()
  ],
  server: {
    host: true,
    allowedHosts: true,
    proxy: {
      // 代理 DashScope API 请求
      '/api/dashscope': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dashscope/, ''),
        headers: {
          'Origin': 'https://dashscope.aliyuncs.com'
        }
      }
    }
  }
})
