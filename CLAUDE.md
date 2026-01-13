# 即我快记网页版

## 项目描述
微信桌面客户端风格的快记应用，采用三栏布局 + 气泡式快记展示。

## 技术栈
- React 18 + Vite
- 纯 CSS（无 Tailwind）
- localStorage 本地存储（支持导入/导出）

## 当前进度

### 已完成
- [x] 三栏布局（功能栏 + 主题列表 + 快记内容区）
- [x] 微信桌面端风格 UI
- [x] 气泡式快记展示（白底 + 细边框 + 圆形头像）
- [x] 数据持久化到 localStorage
- [x] 新建快记功能
- [x] **数据层重构（v2.0）**
  - 独立的数据结构定义 (schema.js)
  - 存储管理模块 (storage.js)
  - 数据导入/导出功能
  - 自动数据迁移
  - 设置面板 UI

### AI 自动分类功能
- [x] 数据结构扩展（NoteEmbedding, Cluster, ClassificationTask）
- [x] Ollama Embedding 服务集成
- [x] 增量分类引擎（相似度聚类）
- [x] 自动分类触发（新建快记时）
- [x] 手动重新分类功能
- [x] 设置面板 AI 区域（状态、开关、统计）

### 问一问重构进度
- [x] 第1步：数据持久化与导入导出
- [ ] 第2步：接入真实 AI API
- [ ] 第3步：加入联网搜索能力
- [ ] 第4步：接入自动触发逻辑
- [ ] 第5步：实现问一问的两种 UI 形态
- [ ] 第6步：实现相关快记与详情页联动

## 文件结构
```
jiwo-quicknote/
├── index.html
├── package.json
├── vite.config.js
├── CLAUDE.md
├── src/
│   ├── main.jsx               # 入口文件
│   ├── App.jsx                # 主组件
│   ├── App.css                # 主样式
│   ├── index.css              # 全局样式
│   ├── data/                  # 数据层
│   │   ├── index.js           # 统一导出
│   │   ├── schema.js          # 数据结构定义
│   │   └── storage.js         # 存储管理
│   ├── services/              # 服务层
│   │   ├── embedding.js       # Ollama Embedding 服务
│   │   ├── incrementalClassifier.js  # 增量分类引擎
│   │   ├── ai.js              # AI 服务（DashScope）
│   │   └── classifier.js      # 分类服务（旧版）
│   └── components/            # 组件
│       └── SettingsPanel.jsx  # 设置面板
```

## 数据结构 v2.0

### localStorage 键名
- `jiwo-topics` - 主题列表
- `jiwo-notes` - 快记列表
- `jiwo-ai-responses` - AI 回答列表（独立存储）
- `jiwo-ask-conversations` - 问一问会话
- `jiwo-note-relations` - 快记相关性关系
- `jiwo-references` - 快记引用关系
- `jiwo-embeddings` - 快记嵌入向量
- `jiwo-clusters` - AI聚类数据
- `jiwo-classification-queue` - 分类任务队列
- `jiwo-ai-settings` - AI设置
- `jiwo-data-version` - 数据版本号

### Topic 主题
```json
{
  "id": "default",
  "title": "我的快记",
  "createdAt": "2026-01-13T06:00:00.000Z",
  "updatedAt": "2026-01-13T06:00:00.000Z"
}
```

### Note 快记
```json
{
  "id": "uuid",
  "topicId": "default",
  "content": "快记内容",
  "source": "normal | ask_conversation | external_trigger",
  "aiStatus": "none | pending | processing | done | error",
  "aiResponseId": "uuid | null",
  "createdAt": "2026-01-13T06:00:00.000Z",
  "updatedAt": "2026-01-13T06:00:00.000Z"
}
```

### AIResponse AI回答
```json
{
  "id": "uuid",
  "noteId": "关联的快记ID",
  "content": "AI回答内容",
  "model": "模型名称",
  "usedWebSearch": false,
  "sourceNoteIds": ["参考的快记ID列表"],
  "webSearchResult": null,
  "metadata": {
    "promptTokens": 0,
    "completionTokens": 0,
    "totalTokens": 0,
    "latencyMs": 0
  },
  "createdAt": "2026-01-13T06:00:00.000Z"
}
```

### NoteRelation 快记相关性
```json
{
  "id": "uuid",
  "noteId": "源快记ID",
  "relatedNoteId": "相关快记ID",
  "score": 0.85,
  "computedAt": "2026-01-13T06:00:00.000Z"
}
```

### NoteEmbedding 快记嵌入
```json
{
  "id": "uuid",
  "noteId": "关联的快记ID",
  "embedding": [0.1, 0.2, ...],
  "model": "qwen3-embedding",
  "createdAt": "2026-01-13T06:00:00.000Z"
}
```

### Cluster 聚类
```json
{
  "id": "uuid",
  "name": "聚类名称",
  "centroid": [0.1, 0.2, ...],
  "noteIds": ["快记ID列表"],
  "parentId": "父聚类ID | null",
  "createdAt": "2026-01-13T06:00:00.000Z",
  "updatedAt": "2026-01-13T06:00:00.000Z"
}
```

### ClassificationTask 分类任务
```json
{
  "id": "uuid",
  "noteId": "待分类快记ID",
  "status": "pending | processing | done | error",
  "error": "错误信息 | null",
  "createdAt": "2026-01-13T06:00:00.000Z",
  "completedAt": "2026-01-13T06:00:00.000Z | null"
}
```

## 常量定义
```javascript
// 默认主题 ID
DEFAULT_TOPIC_ID = 'default'

// 问一问虚拟主题 ID
ASK_TOPIC_ID = '__ask__'

// AI 回答状态
AI_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error'
}

// 快记来源
NOTE_SOURCE = {
  NORMAL: 'normal',
  ASK_CONVERSATION: 'ask_conversation',
  EXTERNAL_TRIGGER: 'external_trigger'
}
```

## UI 配色
- 主色：微信绿 #07c160
- 功能栏背景：#2e2e2e
- 主题列表背景：#e9e9e9
- 内容区背景：#fff
- 选中态：#c7e8d4

## 运行命令
```bash
cd ~/jiwo-quicknote
npm install
npm run dev
```
访问 http://localhost:5173

## 部署
- 使用 Cloudflare Tunnel 穿透
- 启动命令：`cloudflared tunnel --url http://localhost:5173`

---

## 开发日志

### 2026-01-13 AI 自动分类功能
- 实现基于 Ollama + Qwen3-Embedding 的向量嵌入
- 增量聚类算法：新快记自动分配到相似聚类或创建新聚类
- 分类任务队列：异步处理，不阻塞 UI
- 设置面板 AI 区域：Ollama 状态检测、自动分类开关、统计信息、手动重新分类
- 聚类合并与分裂：相似度超过阈值自动合并，过大自动分裂

新增文件：
- `src/services/embedding.js` - Ollama Embedding 服务
- `src/services/incrementalClassifier.js` - 增量分类引擎

### 2026-01-13 数据层重构
- 完成第1步：数据持久化与导入导出
- 创建独立的数据层模块 (src/data/)
- 实现完整的数据结构定义
- 实现导入/导出 JSON 功能
- 添加设置面板 UI（数据统计、导出、导入、清除）
- 自动迁移旧数据到新结构
- AI 回答独立存储，不再内嵌在 Note 中
