# OpenMovie 产品设计

> 状态：MVP Product Baseline v0  
> 更新日期：2026-08-26
> 上位文档：[产品定义](../PRODUCT.md)  
> 配套文档：[技术方案](./TECHNICAL_DESIGN.md) · [实施计划](./IMPLEMENTATION_PLAN.md)

## 1. 设计目标

OpenMovie Desktop 是面向 AI 原生电影创作的桌面工作台。它让不具备工程背景的创作者也能像使用 Codex 一样，通过自然语言把一个创作目标交给 Agent，持续观察执行过程，在关键节点做出审批，并获得可比较、可回滚的电影工程变更。

产品需要同时满足两个目标：

1. 对普通创作者足够简单：不要求理解 Git、终端、Movie IR、模型 API 或工作流编排。
2. 对高级用户足够透明：可以查看结构化工程、依赖、模型、参数、评测、成本和完整修改历史。

核心体验不是聊天生成一段视频，而是：

```text
表达目标
→ Agent 制定计划
→ OpenMovie 执行结构化工作流
→ 用户观察生成过程
→ 系统自动验证
→ Agent 提交可审查修改
→ 用户批准、反馈或回滚
```

## 2. 产品定位

### 2.1 产品声明

> OpenMovie 是一个 Windows 与 macOS 桌面端 AI 电影创作 Harness。创作者可以通过自然语言构建、测试和迭代电影工程，并自由选择 Codex、Claude Code 或其他兼容 Agent 驱动工作。

### 2.2 核心价值

- 低门槛：像与创作搭档对话一样使用复杂生成流程。
- 工程化：每个故事、场景、镜头、素材和反馈都可寻址、可验证。
- 可控制：Agent 的计划、费用、权限和修改均可观察与审批。
- 可恢复：任何生成和修改都有版本，可以比较和回滚。
- 可扩展：Agent、模型、生成工作流和评测器都可以替换。
- 本地优先：工程与媒体默认由用户掌控，可选择连接云端服务。

### 2.3 不应成为的产品

- 只有聊天窗口的 Prompt 包装器。
- 绑定单个模型厂商的视频生成客户端。
- 要求普通用户手写配置文件的开发者工具。
- 允许 Agent 静默覆盖镜头和成片的黑盒自动化。
- 试图在第一阶段完整替代专业 NLE 的剪辑软件。

## 3. 用户分层

### 3.1 创作者模式

面向导演、编剧、短片创作者和没有开发经验的用户。

默认只显示：

- 自然语言任务。
- 故事、角色、场景和镜头卡片。
- 预览和基础时间线。
- Agent 计划与进度。
- 修改前后对比。
- 必需审批、成本和问题提示。

默认隐藏：

- YAML、JSON 和 Git。
- MCP、CLI 和进程日志。
- 完整模型参数。
- 内部 DAG 与对象哈希。

### 3.2 专业模式

面向 AI 影视团队和高级创作者。

增加：

- 多模型和多 Take 对比。
- 构建依赖与缓存。
- 连续性、技术和创作评测。
- 分支、Revision 和冲突解决。
- 团队分工、锁定和审批。
- 模型参数、Seed 与生成来源。

### 3.3 开发者模式

面向插件、Agent、模型适配器和工作流开发者。

增加：

- Movie IR 源文件。
- OpenMovie CLI 和本地 MCP Server。
- Agent Gateway 调试信息。
- Tool 调用、事件、Trace 和原始日志。
- Adapter、Evaluator、Plugin 管理。

模式只影响界面复杂度，不影响底层工程格式。用户可以随时切换，不需要迁移项目。

## 4. 核心产品对象

### 4.1 Project

一部电影、短片、广告或视频作品的完整工程。Project 是所有聊天任务、Movie IR、素材、版本、构建与评测的共同边界。

### 4.2 Task

用户交给 Agent 的一个明确目标，例如：

- “根据这个创意写一个 90 秒短片。”
- “为 Scene 03 生成分镜。”
- “修复 Shot 12 的角色不一致。”
- “把整支预告片缩短到 30 秒。”

Task 类似 Codex 中的一次任务对话，但最终结果必须落到 Project 的结构化对象和 Revision 上。

### 4.3 Thread

围绕一个 Task 的连续对话、计划、工具调用、审批和结果。Thread 可以暂停、恢复或切换 Agent Harness。

### 4.4 Run

一次可执行过程。一个 Task 可以产生多次 Run，例如重新运行、换模型运行或基于新反馈继续运行。

### 4.5 Revision

对电影工程的一次可审查修改。Revision 记录修改内容、作者、影响范围、生成成本、评测和审批状态。

### 4.6 Scene、Shot 与 Take

- Scene：叙事单元。
- Shot：期待得到的镜头意图。
- Take：一次具体生成得到的候选结果。

用户反馈优先绑定 Shot 或 Take，而不是只留在聊天历史中。

### 4.7 Feedback

绑定明确对象和时间范围的意见。Feedback 可以成为 Agent 任务，也可以沉淀为约束和回归测试。

## 5. 信息架构

### 5.1 应用级导航

```text
Home
├── Recent Projects
├── Create Project
├── Import Project
├── Agent Harnesses
├── Model Providers
└── Settings
```

### 5.2 项目级导航

```text
Project
├── Tasks
├── Story
├── Characters
├── Scenes
├── Shots
├── Timeline
├── Assets
├── Tests
├── Versions
└── Project Settings
```

### 5.3 默认工作台布局

```text
┌──────────────┬──────────────────────────┬──────────────────────────────┐
│ Project      │ Creative Conversation    │ Project Resources            │
│ Explorer     │                          │                              │
│              │ 用户消息                 │ 选中对象检查器                 │
│ Story        │ Agent 回复与执行进度      │ 图片 / 视频 / Take            │
│ Characters   │ 审批与变更提案           │ Shot 与 Current Cut           │
│ Scenes       │                          │                              │
│ Shots        │ 简单对话输入框            │ Resources / Versions 切换      │
└──────────────┴──────────────────────────┴──────────────────────────────┘
```

默认且唯一的主入口是中央对话，不要求用户先理解工作流配置。左侧首先显示最近使用的全部电影工程；
只有当前正在编辑的工程展开 Story、Character、Scene、Shot、Timeline、Branch 与检查结果，其他工程
保持单行折叠状态，点击即可切换。右侧使用更大的可视区域展示媒体预览、Take、Shot、Current Cut 和
Revision。计划、运行进度、审批和错误都作为对话内容出现，不另设底部任务控制台。依赖图、日志、
参数等高级信息按需展开。

## 6. 核心交互模型

### 6.1 对话是入口，结构化对象是结果

用户可以自然表达目标：

> “把这个场景改得更压抑，但不要改对白。”

OpenMovie 将其解析为受约束的任务：

```yaml
target: scene_003
goal: increase_emotional_tension
locked:
  - dialogue
allowed_changes:
  - camera
  - lighting
  - performance
  - music
```

用户不必看到 YAML，但必须能在界面中确认：

- 修改目标是 Scene 03。
- 对白已锁定。
- 允许修改摄影、光线、表演和音乐。
- 预计影响 4 个镜头。
- 预计生成费用与时间。

### 6.2 计划优先

复杂任务默认先显示 Agent 计划：

```text
计划
1. 分析 Scene 03 当前情绪和失败评测
2. 调整 4 个 Shot 的摄影和表演意图
3. 重新生成其中 2 个 Take
4. 运行角色、对白和情绪评测
5. 提交前后对比

预计：8–15 分钟，最高费用 ¥24
```

用户可以：

- 执行。
- 修改计划。
- 限制费用。
- 锁定对象。
- 更换 Agent 或生成模型。
- 取消任务。

简单且低风险的任务可以按用户策略直接执行。

### 6.3 流式过程

运行过程中持续展示结构化事件：

- 正在读取的对象。
- 当前步骤和总体进度。
- 正在使用的生成工作流。
- 已消耗和预计剩余费用。
- 新生成的候选 Take。
- 评测结果。
- 需要用户处理的审批。

原始终端输出和调试日志只在开发者模式显示。

### 6.4 结果优先

任务完成后优先展示：

1. 可播放的结果。
2. 修改前后对比。
3. 变化摘要。
4. 评测改善与回归。
5. 实际费用和时间。
6. 接受、拒绝、继续修改或创建另一方案。

## 7. Task 状态模型

```text
draft
  ↓
planning
  ↓
ready
  ↓
running ↔ waiting_for_approval
  ↓
evaluating
  ↓
review_ready
  ├── accepted
  ├── rejected
  ├── needs_revision
  └── cancelled

任意执行阶段 → failed → retry / revise_plan / switch_harness
```

状态设计要求：

- 应用重启后可以恢复。
- 用户可以随时取消。
- 失败时保留已经成功的产物。
- 审批不阻塞其他无依赖任务。
- Harness 异常退出不等于 Project 损坏。

## 8. 关键用户旅程

### 8.1 首次启动

1. 用户安装并打开 OpenMovie。
2. 选择默认语言、工程存储位置和隐私偏好。
3. OpenMovie 检测可用 Agent Harness。
4. OpenMovie 检测生成模型或引导用户连接 Provider。
5. 用户运行一个不产生费用的环境检查。
6. 进入示例工程或创建新工程。

Agent 检测界面：

```text
Agent Harness

✓ Codex              已安装、已登录
○ Claude Code        未安装
✓ OpenMovie Agent    可用

默认：[Codex ▼]
```

OpenMovie 不读取或复制第三方 Harness 的凭据，只使用其公开认证与运行接口。

### 8.2 从创意创建短片

1. 用户输入一句创意，或导入故事、图片和参考视频。
2. Agent 询问少量高影响问题，例如目标时长、风格和受众。
3. Agent 生成 Creative Brief 与故事方案。
4. 用户选择或合并方案。
5. Agent 生成角色、Scene 和 Shot Plan。
6. 用户在生成媒体前确认影响范围和预算。
7. OpenMovie 构建候选素材与 Take。
8. 系统运行技术和连续性检查。
9. 用户在预览中反馈并继续迭代。

### 8.3 修复一个镜头

1. 用户在时间码处暂停并评论：“人物不像上一个镜头。”
2. 系统将反馈绑定到具体 Take、Shot 和参考镜头。
3. Agent 分析生成溯源和身份一致性评测。
4. Agent 提交修复计划和预算。
5. OpenMovie 生成新的候选 Take。
6. 系统比较身份、构图、对白和风格评测。
7. 用户并排查看并选择。
8. 接受后生成 Revision，旧 Take 保留。

### 8.4 创建另一个剪辑版本

1. 用户从当前 Revision 创建“30 秒预告版”。
2. Agent 在独立 Variant 中缩短时间线。
3. 原版不受影响。
4. 用户比较两版时长、镜头和叙事覆盖。
5. 用户给 Variant 添加里程碑或发布标签。

### 8.5 在外部 Harness 中使用

1. 用户从项目设置复制或一键安装 OpenMovie MCP/Plugin 配置。
2. 用户在 Codex 或 Claude Code 中打开项目。
3. Harness 读取项目摘要和可用 OpenMovie Tools。
4. Agent 调用工具产生 Revision Proposal。
5. 用户回到 OpenMovie Desktop 查看媒体结果和审批。

### 8.6 Harness 不可用

1. 当前 Harness 进程异常退出。
2. OpenMovie 将 Run 标记为中断，不丢失已完成产物。
3. 界面解释原因并提供：
   - 重新连接。
   - 继续当前任务。
   - 切换到其他 Harness。
   - 导出诊断信息。
4. 新 Harness 从结构化 Task、Run 和 Revision 上下文恢复，而不是依赖原聊天文本重建全部状态。

## 9. 核心页面

### 9.1 Home

- 最近项目。
- 新建、导入和示例工程。
- 运行中的后台任务。
- Harness 和 Provider 健康状态。
- 磁盘空间与失败通知。

### 9.2 Project Workspace

- 项目导航。
- Task 列表和当前 Thread。
- 预览、Story 或 Shot 编辑器。
- Agent 计划、审批和运行状态。

### 9.3 Story

- Creative Brief。
- Story Bible。
- 人物关系和故事事实。
- Act、Scene 和情绪弧线。
- Story 级评测与未解决反馈。

### 9.4 Shot Workspace

- Shot Intent。
- 当前采用 Take 和候选 Take。
- 参考素材。
- 对白、摄影、表演和约束。
- 生成来源、测试和反馈。

### 9.5 Timeline

MVP 提供审阅和基础装配能力：

- 播放、暂停、逐帧和时间码。
- Take 选择和替换。
- Clip 排列和基础裁切。
- 字幕、对白和音轨预览。
- 时间码反馈。

复杂调色、特效和精细混音不属于 MVP。

### 9.6 Versions

- Revision 历史。
- Variant 和里程碑。
- 电影语义 Diff。
- 修改前后媒体对比。
- 恢复、分支、合并和冲突处理。

### 9.7 Tests

- 静态、技术、连续性和创作评测。
- 按 Scene、Shot、严重度和状态筛选。
- 证据帧和时间范围。
- 一键创建修复 Task。

### 9.8 Settings

- Agent Harness。
- 模型 Provider。
- 生成质量与成本策略。
- 存储与缓存。
- 权限与审批。
- 插件和开发者设置。

## 10. Agent Harness 产品设计

### 10.1 Harness 角色

Harness 负责：

- 理解用户目标。
- 阅读工程上下文。
- 制定和调整计划。
- 选择并调用 OpenMovie Tools。
- 分析结果和评测。
- 提交 Revision Proposal。

Harness 不负责：

- 成为 Movie IR 的唯一存储。
- 直接管理不可变媒体对象。
- 绕过 OpenMovie 权限和预算。
- 决定最终采用版本。
- 隐式持有唯一可恢复的任务状态。

### 10.2 Harness 能力探测

每个 Adapter 返回统一能力：

```yaml
id: codex
installed: true
authenticated: true
version: '...'
capabilities:
  streaming: true
  approvals: true
  resume: true
  tool_calls: true
  image_input: true
health: ready
```

产品只展示已确认的能力，不能因 Harness 名称推测能力。

### 10.3 Harness 切换

用户可以为新 Task 选择 Harness。运行中的 Task 只有在安全检查点才能切换。

切换时传递：

- Task 目标和限制。
- 当前计划与步骤状态。
- 相关 Movie IR 对象。
- Tool 调用结果和产物引用。
- 开放反馈、审批和失败信息。

不要求不同 Harness 共享内部思维过程或完整私有会话。

## 11. 模型与工作流选择

### 11.1 Harness 与 Provider

产品需要让用户理解“创作助手”和“生成服务”可以分别选择：

```text
Agent Harness
负责理解目标、规划和调用工具
例如：Codex、Claude Code、OpenMovie Agent

Provider
负责文本推理、图片理解、视频分析和媒体生成
例如：OpenRouter、OpenAI-compatible 服务、自定义 API
```

没有安装第三方 Harness 时，OpenMovie Agent 使用用户配置的 LLM Provider 完成规划和工具调用。安装 Harness 后，图片和视频生成仍通过 OpenMovie Provider Gateway 执行，因此更换 Harness 不需要重新配置所有媒体服务。

### 11.2 创作策略

普通用户选择“创作策略”，而不是直接面对大量模型参数：

```text
快速草稿
平衡
高质量
成本优先
自定义
```

策略决定：

- 默认文本、图像、视频和评测 Provider。
- 预览分辨率。
- 候选 Take 数量。
- 自动重试次数。
- 预算阈值。
- 哪些步骤需要审批。

专业模式允许覆盖单个 Shot 或 Run 的模型和参数。

### 11.3 Provider 设置

设置页按能力槽位组织，而不是只展示一张混合模型列表：

```text
智能与分析
├── Agent Reasoning
├── Text Generation
├── Image Understanding
└── Video Analysis

媒体生成
├── Image Generation
├── Image Editing
└── Video Generation
```

每个槽位可以选择：

- 默认 Provider 和 Model。
- 一个或多个备用 Provider。
- 是否允许自动切换。
- 质量、费用和速度优先级。
- 允许发送的数据类别。

### 11.4 添加 Provider

用户可以从以下方式添加：

- 内置 Provider 模板。
- OpenRouter。
- OpenAI-compatible API。
- 自定义 API 配置。
- 开发者编写的 Provider Plugin。

连接过程：

1. 输入 Base URL，或选择内置模板。
2. 将 API Key 保存到系统安全凭据存储。
3. 选择协议配置，例如 Responses 风格或 Chat Completions 风格。
4. 测试连接。
5. 获取或手动选择 Model。
6. 运行能力测试。
7. 将 Model 分配到能力槽位。

“API compatible”不自动代表所有能力可用。OpenMovie 只启用实际探测或用户明确声明的文本、图片输入、结构化输出、Tool Call、流式、图片生成和视频生成能力。

### 11.5 视频分析

视频分析提供两种方式：

1. Provider 原生支持视频输入时，直接提交受支持的视频或文件引用。
2. 默认通用流程：提取关键帧、镜头边界、音轨、字幕和元数据，分别分析后再聚合为结构化结果。

用户看到的是统一的“分析视频”能力，不需要理解底层采用哪种方式。分析结果应包含时间码证据，可以直接创建 Feedback 或测试。

### 11.6 多视频生成 Provider

一个 Project 可以同时配置多个视频生成 API。每个 Provider 显示：

- 支持的输入：文本、首帧、尾帧、参考视频、角色参考。
- 支持的操作：生成、延长、插值、局部编辑、口型或音频。
- 可用分辨率、时长和宽高比。
- 预计费用和等待时间。
- 当前健康状态和速率限制。
- 数据发送位置和项目授权状态。

普通用户使用“快速草稿”“高质量”等策略自动选择；专业用户可以在单个 Shot 上指定 Provider，并将多个 Provider 结果作为不同 Take 比较。

自动切换 Provider 必须满足：

- 目标能力兼容。
- 用户已授权该 Provider 接收相关素材。
- 费用不超过预算。
- 不会改变已经锁定的隐私或地区策略。

否则必须请求审批。

## 12. 审批与权限体验

### 12.1 默认需要审批

- 首次连接或上传素材到外部 Provider。
- 超过任务或项目预算。
- 删除或永久清理对象。
- 修改锁定的 Story Fact、角色或已批准镜头。
- 合并到受保护版本。
- 发布和导出最终成片。
- 运行任意未声明的外部命令。

### 12.2 审批卡片

审批必须说明：

```text
将要发生什么
为什么需要
影响哪些对象
会向哪个服务发送什么数据
预计费用与时间
允许一次 / 本任务允许 / 始终允许 / 拒绝
```

### 12.3 预算

用户可以设置：

- 单次 Run 上限。
- 单个 Task 上限。
- 项目每日或总预算。
- 超额审批人。
- 本地与云端执行偏好。

所有估算都应明确是不确定值，完成后显示实际值。

MVP 已交付的最小形态是“项目月度已报告费用上限”：设置保存在 Movie IR 并形成 Revision；设置页显示
当月 Run 数、Provider 明确报告的费用和未定价调用数。达到已报告费用上限后，Core 不再启动新的远程
Provider Step。没有返回价格的服务无法纳入绝对硬上限，产品必须持续显示 unknown/unpriced，不能把它
标成免费。单次、Task、每日预算和公开价目预估保留为后续策略层能力。

## 13. 反馈与通知

### 13.1 反馈入口

- Chat 中自然语言反馈。
- Preview 和 Timeline 时间码评论。
- Shot、Character、Scene 等对象评论。
- Test 失败创建的反馈。
- 外部协作者导入的评审意见。

### 13.2 通知等级

- 信息：步骤完成、缓存命中。
- 需要关注：低置信度或轻微评测退化。
- 需要操作：审批、冲突、Provider 登录。
- 失败：任务无法继续。

长时间运行任务完成或需要审批时，可使用系统通知；通知内容不泄露敏感素材。

## 14. 错误与恢复体验

每个错误必须回答：

1. 发生了什么。
2. 已完成的内容是否保留。
3. 是否产生费用。
4. 用户现在可以做什么。
5. 是否可以安全重试。

常见恢复操作：

- 从失败步骤继续。
- 使用相同输入重试。
- 更换模型或 Harness。
- 降低质量或候选数量。
- 回到上一个 Revision。
- 导出诊断包。

不得以“未知错误，请重试”作为唯一信息。

## 15. 跨平台体验

Windows 和 macOS 功能范围保持一致：

- 同一 Movie IR 和项目格式。
- 同一 Task、Revision 和 Tool 语义。
- 同一 Harness Adapter 能力模型。
- 同一快捷键语义，使用平台对应修饰键。
- 同一导入、导出和恢复能力。

允许存在平台差异：

- 文件选择器、菜单和系统通知遵循原生规范。
- 凭据存储使用平台安全设施。
- 安装、签名、更新和进程权限按平台实现。
- Windows 路径、长文件名和 PowerShell 不应暴露给普通用户。

## 16. MVP 产品范围

### 16.1 MVP 主路径

MVP 聚焦一个 3–10 镜头短场景：

1. 创建或导入项目。
2. 通过聊天生成 Story、Scene 和 Shot Plan。
3. 生成角色参考图与镜头候选。
4. 在预览中查看、选择和反馈。
5. Agent 根据一条反馈修改一个 Shot。
6. 自动运行基础技术和角色一致性评测。
7. 展示 Revision Diff 并接受或回滚。

### 16.2 MVP 页面

- Home。
- Project Workspace。
- Story/Scene 结构视图。
- Shot Workspace。
- Preview 与轻量 Timeline。
- Tasks/Runs。
- Tests。
- Versions。
- Settings。

### 16.3 MVP Harness

- OpenMovie Embedded/Direct Adapter：保证没有外部 Harness 时仍可使用。
- Codex Adapter：桌面内的结构化本地集成。
- OpenMovie MCP Server：让外部 Codex 或 Claude Code 调用 OpenMovie。
- Claude Code Adapter：使用公开非交互 print mode 和 JSON Schema 输出，以只读方式生成与 Direct Agent 相同的待审 Proposal；不解析交互式 TUI。

### 16.4 MVP Provider

- 一个 OpenAI-compatible LLM/Multimodal Adapter，可配置 Base URL、API Key 和 Model。
- 一个 Responses 风格 Adapter，用于文本、图片输入、结构化输出和 Tool Calling。
- OpenRouter 作为可选的内置配置模板，而不是写死在业务逻辑中。
- 一个自定义 Provider 配置入口。
- 一个图片生成 Adapter。
- 至少两个视频生成 Adapter 或一个真实 Adapter 加一个完整 Fake Adapter，以验证多 Provider 路由。
- 通用视频分析 Pipeline：FFprobe、抽帧、音频转写接口和多模态归纳。
- Provider 连接测试、能力探测、费用策略和 Secret 安全存储。

### 16.5 MVP 用户故事

- 作为首次用户，我可以在不打开终端的情况下创建第一个项目。
- 作为创作者，我可以用自然语言生成和修改 Scene、Shot。
- 作为创作者，即使没有安装 Codex 或 Claude Code，我也可以连接 API Provider 使用 OpenMovie Agent。
- 作为创作者，我可以为文本、图片理解、图片生成和视频生成选择不同 Provider。
- 作为创作者，我可以为一个 Shot 分别调用多个视频生成 API 并比较 Take。
- 作为创作者，我可以分析导入视频，并从带时间码的结果创建 Feedback。
- 作为创作者，我可以看到 Agent 当前在做什么、还要多久、花费多少。
- 作为创作者，我可以在发送素材或产生费用前做出审批。
- 作为创作者，我可以比较两个 Take 并选择采用版本。
- 作为创作者，我可以恢复到任一历史 Revision。
- 作为高级用户，我可以选择 Codex 或其他可用 Harness。
- 作为开发者，我可以从外部 Harness 调用 OpenMovie Tools。

### 16.6 MVP 验收

- 新用户在完成安装后，无需终端即可创建并预览一个示例场景。
- Harness 未安装或不可用时，用户可以通过已配置 API Provider 使用 OpenMovie Agent。
- OpenAI-compatible Provider 能通过连接测试和能力探测，不能把未经确认的能力标记为可用。
- 视频分析结果包含可回到原始媒体的时间码证据。
- 同一个 Shot 可以保留来自不同视频生成 Provider 的多个不可变 Take。
- 一个自然语言任务能产生结构化计划、Run、产物、评测和 Revision。
- 用户能取消 Run，且已经生成的有效产物不会丢失。
- 所有外部上传和超预算操作均经过策略检查。
- Agent 修改不会静默覆盖已采用 Take。
- 应用重启后能恢复任务历史、运行状态和未处理审批。
- 同一个项目能在 Windows 和 macOS 打开，Movie IR 语义一致。

## 17. MVP 非目标

- 多轨专业 NLE 的全部能力。
- 实时多人同时编辑。
- 云端跨设备任务执行。
- 完整插件市场。
- 所有主流视频和 Agent Provider。
- 完全自动生成长片。
- 自动通过所有审美类评测。

## 18. 成功指标

### 18.1 激活

- 首次安装到创建项目的完成率。
- 首次安装到生成第一个可播放预览的时间。
- 无需打开终端完成首个任务的用户比例。

### 18.2 核心价值

- Task 产生可接受 Revision 的比例。
- 反馈到可审查候选修改的时间。
- 用户接受、继续编辑或拒绝 Agent 提案的分布。
- 局部修改避免重建无关镜头的比例。

### 18.3 信任与控制

- 用户能正确理解审批影响的比例。
- 超预算、意外上传和不可恢复覆盖事件数量。
- 发生失败后成功恢复的 Run 比例。
- 修改前后对比和评测证据的查看率。

### 18.4 跨平台

- Windows 与 macOS 的核心流程成功率。
- Harness 检测和启动成功率。
- 安装、更新和项目迁移失败率。

## 19. 术语与文案原则

面向普通创作者优先使用：

- “保存版本”，而不是 Commit。
- “创作方案”，而不是 Branch。
- “修改提案”，而不是 Pull Request。
- “生成任务”，而不是 Build Node。
- “重新生成受影响内容”，而不是 Invalidate DAG。
- “连接创作助手”，而不是配置 Agent Runtime。

界面可以在高级模式显示对应工程术语。

Agent 文案应避免声称主观判断是事实。使用：

- “身份一致性评分提高。”
- “评测认为情绪更紧张，建议人工确认。”
- “预计影响 4 个镜头。”

避免：

- “已经完美修复。”
- “这是最佳版本。”
- “不会影响其他镜头。”

## 20. 产品设计判断标准

产品设计成立需要满足：

1. 用户可以从自然语言开始，但不会被困在聊天记录中。
2. 每个 Agent 行为都能落到结构化对象、工具调用和 Revision。
3. 普通用户无需理解底层工程概念，也能控制费用、数据和版本。
4. 高级用户可以逐层查看来源、依赖、参数和评测。
5. Codex、Claude Code 或其他 Harness 可以替换，而不改变电影工程语义。
6. Harness 中断、模型失败或应用重启不会破坏项目。
7. Windows 与 macOS 提供一致的核心创作闭环。

最终体验应像 Codex：用户只需要表达目标、观察过程和审查结果；但 OpenMovie 的每个结果都必须是一个可播放、可验证、可比较和可回滚的电影工程变更。
