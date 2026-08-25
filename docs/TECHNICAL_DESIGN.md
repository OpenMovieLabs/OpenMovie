# OpenMovie 技术方案

> 状态：Implementation Baseline v0  
> 更新日期：2026-08-26  
> 上位文档：[产品定义](../PRODUCT.md)  
> 配套文档：[产品设计](./PRODUCT_DESIGN.md) · [项目格式](./PROJECT_FORMAT.md) · [协议契约](./PROTOCOLS.md) · [安全设计](./SECURITY.md) · [实施计划](./IMPLEMENTATION_PLAN.md) · [ADR](./adr/README.md)

## 1. 技术目标

OpenMovie 技术架构需要支撑一个 Windows 与 macOS 本地优先的 AI 电影工作台。系统以 Movie IR 为源代码，以不可变媒体为构建产物，通过可恢复任务、增量构建、自动评测和 Revision 管理，为 Codex、Claude Code 或其他 Agent Harness 提供统一的电影工程能力。

核心技术目标：

1. Windows 与 macOS 使用同一项目格式和核心实现。
2. 桌面端无需用户安装开发环境即可完成基础创作流程。
3. Agent Harness 可以替换，不成为工程状态和媒体的唯一所有者。
4. 所有写操作都通过类型化命令、权限检查和 Revision 执行。
5. 文本、图像、视频和媒体处理任务支持取消、恢复、重试和缓存。
6. 任意媒体结果都能追溯到 Movie IR、输入素材、模型、参数和 Run。
7. 应用、Harness 或 Provider 异常不会破坏已保存的项目。
8. 外部上传、费用、文件访问和高风险修改均受策略控制。
9. 没有第三方 Harness 时，可通过 OpenAI-compatible、OpenRouter 或自定义 API Provider 驱动内置 Agent。
10. 文本、多模态理解、视频分析、图片生成和视频生成使用统一但不失真的 Provider Contract。

## 2. 非功能需求

### 2.1 可移植性

- 同一个 Project 可以在 Windows 与 macOS 打开。
- Movie IR 中的路径使用项目相对路径或对象 URI，不保存平台绝对路径。
- 文件名、ID 和序列化格式支持 Unicode。
- 不依赖 Bash、zsh、PowerShell 或 CMD 作为内部协议。

### 2.2 可恢复性

- Task、Run、Step、Approval 和 Revision 状态持久化。
- 应用重启后可以识别运行中断并从安全检查点恢复。
- 已成功写入对象库的产物不会因后续步骤失败而丢失。
- 任何源文件更新采用原子写入。

### 2.3 可观测性

- 所有用户任务具有 Trace ID。
- Tool、Build Node、Provider Request、Evaluation 和 Revision 可关联。
- 日志区分面向用户的事件与开发诊断信息。
- 成本、耗时、缓存命中和错误原因结构化记录。

### 2.4 安全性

- Renderer 不直接获得 Node.js、文件系统或进程执行权限。
- Harness 只获得当前 Project 和已声明 Tools 的能力。
- Secret 不写入 Project、日志或 Agent Prompt。
- 所有外部数据传输和收费操作经过策略检查。

### 2.5 性能

- 大型媒体不整体加载到 Renderer 内存。
- Preview 使用代理文件、缩略图和流式读取。
- 构建引擎按资源类型限制并发。
- DAG 节点使用内容哈希缓存。
- 性能目标在建立基准机与样例项目后量化，首版不承诺缺乏基线的数字。

## 3. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ OpenMovie Desktop                                           │
│                                                             │
│  ┌─────────────────┐      Typed IPC      ┌───────────────┐  │
│  │ Renderer        │◄───────────────────►│ Electron Main │  │
│  │ React UI        │                     │ App Lifecycle │  │
│  └─────────────────┘                     └───────┬───────┘  │
└─────────────────────────────────────────────────┼───────────┘
                                                  │ Node IPC
                                      ┌───────────▼───────────┐
                                      │ OpenMovie Core        │
                                      │                       │
                                      │ Project / Movie IR    │
                                      │ Revision / Task       │
                                      │ Build / Eval / Policy │
                                      └───┬────────┬──────────┘
                                          │        │
                         ┌────────────────┘        └───────────────┐
                         │                                         │
                ┌────────▼────────┐                       ┌────────▼────────┐
                │ Agent Gateway   │                       │ Provider/Worker │
                │                 │                       │                 │
                │ Codex Adapter   │                       │ Model Adapters  │
                │ Claude Adapter  │                       │ FFmpeg          │
                │ Direct Adapter  │                       │ Evaluators      │
                └────────┬────────┘                       └────────┬────────┘
                         │                                         │
                ┌────────▼────────┐                       ┌────────▼────────┐
                │ Local Harnesses │                       │ Local / Cloud   │
                │ or MCP Clients  │                       │ Providers       │
                └─────────────────┘                       └─────────────────┘
```

### 3.1 边界

- Desktop 负责窗口、菜单、通知、文件选择、更新和用户界面。
- Core 负责全部业务状态和规则，是唯一可信写入口。
- Agent Gateway 负责 Harness 生命周期与协议归一化。
- Provider Gateway 负责 LLM、多模态理解、图片与视频生成 API 的协议归一化、能力探测和路由。
- Worker Runtime 负责 Provider 调用、媒体处理、视频分析和评测执行。
- Project Store 负责 Movie IR、对象、运行状态和 Revision。
- 外部 Agent 通过 OpenMovie MCP Server 调用相同 Core Command，不建立旁路。

## 4. 技术栈决策

### 4.1 桌面框架：Electron

MVP 推荐 Electron + React + TypeScript。

选择理由：

- Windows 与 macOS 成熟的一致桌面能力。
- Node.js 对本地子进程、stdio、JSON-RPC、文件监听和工具生态支持直接。
- 更容易集成本地 Codex App Server、其他 Agent CLI 和 FFmpeg。
- TypeScript 适合共享 Renderer、Main、Core、MCP 和 Plugin SDK 类型。
- 开源贡献者更容易参与 UI、Adapter 和工作流开发。

代价：

- 安装体积和基础内存高于原生或轻量 WebView 方案。
- 必须严格隔离 Renderer 与 Node 权限。
- 原生依赖、签名和多架构打包需要持续 CI 验证。

重新评估条件：

- 应用体积或空闲内存成为主要增长障碍。
- Core 大量转向 Rust，并且团队具备稳定维护能力。
- Electron 无法满足某项确定的媒体或安全约束。

Tauri 是未来可评估替代方案，但不在 MVP 同时维护两套桌面壳。

### 4.2 UI

- React + TypeScript。
- Vite 负责 Renderer 构建。
- Zustand 管理纯 UI 与编辑器临时状态；Core Snapshot 和事件通过类型化 Client Store 管理。
- 状态按 Remote/Core State、Editor State、Transient UI State 分离。
- 媒体播放通过受控本地协议提供，不暴露任意文件读取。
- Timeline MVP 使用自有轻量组件；不在首版实现完整 NLE 引擎。

视觉组件库在 UI 原型后选择，不进入领域层和协议层。业务组件不得直接依赖 Provider、SQLite 或 Electron API。

### 4.3 Core

- TypeScript 模块化单体。
- 独立子进程运行，通过 Node IPC 与 Electron Main 通信。
- Core 业务模块不依赖 Electron，可以被 CLI、测试和未来服务端复用。
- CPU 密集型和不可信任务不在 Core 主事件循环执行。

MVP 先保持单一 Core 服务，达到明确扩展阈值后再拆分网络微服务。

### 4.4 数据

- Movie IR：YAML 文本文件；JSON Schema 是格式规范和验证来源。
- Schema Validation：AJV；TypeScript 类型从 JSON Schema 生成或进行一致性检查。
- YAML Parser：支持稳定格式和可理解错误位置的 YAML 解析器。
- 运行状态与索引：SQLite，通过 Repository Port 访问。
- MVP SQLite Driver：better-sqlite3，并在 Windows/macOS 打包 CI 中运行 Electron ABI 重建和 Smoke Test。
- 媒体对象：基于 SHA-256 的内容寻址文件存储。
- 缓存：可清理的本地 Cache Store。
- Secret：Electron Main 中的异步 safeStorage；macOS 使用 Keychain，Windows 使用 DPAPI。
- Secret 密文与 Provider Profile 存在应用级数据库，不进入 Project SQLite。

SQLite 驱动封装在 Storage Port 后。若 better-sqlite3 无法通过目标 Electron 版本的双平台打包门禁，可以替换驱动，但不得改变 Repository Contract 或 Project 格式。

Open Project 时若运行数据库缺失，Core 先重建受控 `.openmovie` 目录和全部 Migration，再从已验证的 Movie IR 捕获一个新的 Recovery Revision。若数据库包含另一个 Project ID，则拒绝打开，避免把错误数据库静默绑定到当前文件树。该恢复只承诺源文件可读；完整运行历史依赖备份中的 SQLite 与 Object Store。

### 4.5 媒体

- FFmpeg/FFprobe 通过参数数组调用。开发构建从 `PATH` 或 `OPENMOVIE_FFMPEG_PATH` 探测；公开发行包在 M6 固定并校验 Sidecar 版本。
- 缩略图、波形和代理媒体异步生成。
- 所有命令使用参数数组启动，不通过 Shell 拼接。
- 原始媒体与生成媒体进入内容寻址对象库。

当前视频分析实现按 Shot 微秒时长确定性抽取四个关键帧，将每帧作为标准 OpenAI-compatible 多模态输入提交给视觉 Provider，并把带时间码的摘要、证据和模型 Provenance 持久化。图片分析直接读取受大小限制的对象，不依赖 FFmpeg。

Current Cut Renderer 读取 Timeline 的选定 Take，检查其 Shot 归属和源 Revision，将图片/视频 Clip 逐段缩放、Letterbox、帧率归一化并编码为 H.264/yuv420p；视频源音频被统一为 AAC，静态图或无音轨视频补入等长静音，随后无重编码拼接。渲染通过可取消、可恢复 Task 执行，结果进入内容寻址对象库并保存 Render Record。

Direct Agent 的文本输出不直接写文件。Core 只解析 `agentPlanSchema` 白名单动作，并把 Plan 与生成时的 Base Revision 存入 `revision_proposals`。Desktop 用户接受时再次执行乐观并发检查，先在内存中构造并验证所有目标文档，再通过单次 `commitFiles` 写为一个 Agent Revision；过期、未知实体或无实际改动的 Plan 均失败且不覆盖现有工作。

文本与视觉 Provider 同时支持 OpenAI-compatible Chat Completions 和 Responses 两种标准协议。Responses 请求将 System Prompt 映射为 `instructions`，多模态内容映射为 `input_text` / `input_image`，并默认 `store: false`；响应优先读取顶层 `output_text`，再安全聚合 `output[].content[].output_text`。两种协议都只返回稳定 HTTP 状态错误，不把响应正文或凭据写入 Task Event。

## 5. 推荐仓库结构

```text
OpenMovie/
├── apps/
│   ├── desktop/                 # Electron Main、Preload、Renderer
│   ├── core/                    # 本地 Core 服务入口
│   └── cli/                     # OpenMovie CLI
├── packages/
│   ├── contracts/               # IPC、事件、错误和公共类型
│   ├── movie-ir/                # Schema、解析、迁移和验证
│   ├── project-store/           # 文件、SQLite、对象库
│   ├── revision-engine/         # Patch、Diff、Merge、历史
│   ├── task-engine/             # Task、Run、Step、Approval
│   ├── build-engine/            # DAG、缓存、调度和恢复
│   ├── agent-gateway/           # Harness Adapter 接口
│   ├── tool-runtime/            # OpenMovie Tool 定义与执行
│   ├── provider-gateway/        # Registry、能力、路由和协议配置
│   ├── model-adapters/          # LLM、视觉、图片和视频 Provider
│   ├── video-analysis/          # 抽帧、转写、分段和多模态归纳
│   ├── eval-engine/             # Evaluator 与评测聚合
│   ├── policy-engine/           # 权限、预算和数据策略
│   ├── media/                   # FFmpeg、代理和元数据
│   ├── mcp-server/              # 外部 Harness 入口
│   ├── plugin-sdk/              # 扩展协议
│   └── ui/                      # 共享 UI 和设计系统
├── schemas/                     # 发布的 Movie IR Schema
├── examples/                    # 示例电影工程
├── docs/
├── scripts/
└── tests/
    ├── fixtures/
    ├── contracts/
    ├── integration/
    └── e2e/
```

初期可以使用 Workspace Monorepo。包边界用于建立依赖方向，不意味着发布为多个进程。

## 6. Project 文件格式

### 6.1 可见结构

```text
MyMovie/
├── openmovie.yaml
├── brief.yaml
├── story/
│   ├── bible.yaml
│   └── screenplay.yaml
├── characters/
│   └── char_anna.yaml
├── locations/
├── scenes/
│   └── scene_003.yaml
├── shots/
│   └── shot_012.yaml
├── timeline/
│   └── main.yaml
├── tests/
├── assets/
│   └── manifest.yaml
└── .openmovie/
    ├── state.sqlite
    ├── objects/
    │   └── sha256/
    ├── cache/
    ├── previews/
    ├── temp/
    └── logs/
```

### 6.2 事实来源

- 可见 Movie IR 文件是项目当前状态的可移植表示。
- SQLite 保存 Revision 图、Task、Run、审批、索引和本地 UI 状态。
- Object Store 保存媒体内容；IR 使用对象 URI 引用。
- Cache 可以删除，不是事实来源。
- Secret 不属于 Project。

### 6.3 对象 URI

```text
om://object/sha256/<digest>
om://asset/<asset-id>
om://take/<take-id>
```

Movie IR 不保存用户机器上的绝对路径。导入外部文件时先复制或显式链接为 Asset；链接资产需要记录不可移植状态。

### 6.4 外部编辑

Core 使用文件监视器检测 Movie IR 外部变化：

1. 解析和 Schema 验证。
2. 计算与当前 Revision 的结构化 Diff。
3. 将其标记为 Working Changes。
4. 用户或开发者显式保存为 Revision。

无效外部修改不覆盖最后有效状态，并在 Problems 中显示。

## 7. Movie IR

### 7.1 Schema

每个实体包含：

```yaml
schema_version: 1
id: shot_012
type: shot
revision: 7
```

要求：

- ID 在 Project 内稳定且唯一。
- Schema 版本显式声明。
- 未知字段的处理策略由 Schema 版本定义。
- Provider 特有配置必须位于命名空间扩展中。
- 所有引用在静态验证阶段解析。

### 7.2 迁移

- Schema 迁移是纯函数：旧文档输入，新文档输出。
- 迁移前自动创建 Revision。
- 迁移支持 dry-run 和 Diff。
- 降级不默认承诺；必要时通过导出旧版本格式实现。

### 7.3 Provider 扩展

```yaml
generation:
  intent:
    quality: preview
    motion_strength: medium
  extensions:
    provider.example:
      custom_parameter: value
```

核心意图与 Provider 私有配置分离，防止工程被单一模型格式锁定。

## 8. Revision Engine

### 8.1 Revision

```typescript
interface Revision {
  id: string;
  parents: string[];
  author: ActorRef;
  message: string;
  patch: MoviePatch;
  manifestHash: string;
  createdAt: string;
  affectedEntities: EntityRef[];
  affectedTimelineRanges: TimeRange[];
  buildImpact?: BuildImpact;
  evaluationSummary?: EvaluationSummary;
  approval?: ApprovalSummary;
}
```

### 8.2 写入流程

1. Command 携带当前 expected Revision。
2. Core 校验权限、Schema 和乐观并发。
3. Revision Engine 在内存中应用 Patch。
4. 计算语义 Diff 和 Build Impact。
5. 持久化新增对象到临时路径。
6. 在 SQLite 事务中保存 Revision、索引和引用。
7. 原子替换受影响 Movie IR 文件。
8. 发布 RevisionCreated 事件。

任何步骤失败都不得留下部分可见 Revision。

### 8.3 并发

写命令必须携带：

```typescript
type MutationContext = {
  projectId: string;
  expectedRevisionId: string;
  actor: ActorRef;
  taskId?: string;
};
```

Revision 不匹配时返回结构化 Conflict，不做最后写入者覆盖。

### 8.4 媒体

- Take 和 Asset 产物不可变。
- Revision 只改变引用或状态。
- 不对视频和音频进行字节级合并。
- 未引用对象由垃圾回收策略延迟清理，默认不立即删除。

### 8.5 Git 互操作

MVP 不要求系统 Git 才能工作。

提供：

- 将 Movie IR 与 Asset Manifest 导出到普通 Git 仓库。
- 将外部 Git 工作树变化导入为 Working Changes。
- 可选把 OpenMovie Revision 映射为 Git Commit。

OpenMovie 自身 Revision ID 和 Git Commit ID 不假设一一对应。

## 9. Task Engine

### 9.1 数据模型

```text
Task
└── Thread
    └── Run
        ├── Plan
        ├── Steps
        ├── Tool Calls
        ├── Approvals
        ├── Artifacts
        └── Revision Proposal
```

### 9.2 Step 状态

```text
pending
→ running
→ completed

running → waiting_for_approval
running → failed
running → cancelled
failed → pending（重试）
```

每个 Step 声明是否：

- 幂等。
- 可缓存。
- 可恢复。
- 可取消。
- 有外部费用。
- 发送数据到外部。

### 9.3 检查点

以下时机写入检查点：

- 计划完成。
- Tool Call 完成。
- Provider 返回可用产物。
- Evaluation 完成。
- Approval 创建或解决。
- Revision Proposal 创建。

Harness 断开后，新的 Harness 可以从检查点继续。

## 10. Build Engine

### 10.1 Build Node

```typescript
interface BuildNode {
  id: string;
  type: BuildNodeType;
  inputs: ArtifactRef[];
  dependencies: string[];
  inputHash: string;
  executor: ExecutorRef;
  cachePolicy: CachePolicy;
  resourceClass: 'cpu' | 'gpu' | 'network' | 'media';
  estimate?: CostEstimate;
}
```

### 10.2 输入哈希

输入哈希包括：

- 规范化 Movie IR 输入。
- 上游对象哈希。
- Adapter 与工作流版本。
- 模型标识和影响输出的参数。
- 参考素材内容哈希。
- 评测器版本。

不影响输出的 UI 状态不进入哈希。

### 10.3 调度

- 为 CPU、GPU、Network、Media 设置独立并发池。
- Provider Adapter 声明速率和并发约束。
- 支持优先级、取消和暂停。
- 交互式预览优先于后台完整构建。
- 相同 inputHash 的并发请求合并为单个执行。

### 10.4 失败

- 节点失败不删除已成功上游产物。
- Retry Policy 区分网络、限流、输入、内容策略和永久错误。
- 不确定是否产生费用的请求标记为 unknown，而不是按零费用处理。
- 更换 Provider 会产生新的 Build Node，不覆盖旧记录。

## 11. Agent Gateway

### 11.1 Adapter 接口

```typescript
interface AgentAdapter {
  readonly id: string;

  detect(): Promise<AgentInstallation>;
  capabilities(): Promise<AgentCapabilities>;
  startSession(input: StartSessionInput): Promise<AgentSession>;
  send(sessionId: string, message: AgentMessage): Promise<void>;
  approve(sessionId: string, decision: ApprovalDecision): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  resume(checkpoint: AgentCheckpoint): Promise<AgentSession>;
  dispose(): Promise<void>;
}
```

所有 Adapter 输出统一事件：

```typescript
type AgentEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'message.delta'; text: string }
  | { type: 'plan.updated'; plan: AgentPlan }
  | { type: 'tool.requested'; call: ToolCall }
  | { type: 'approval.requested'; approval: ApprovalRequest }
  | { type: 'usage.updated'; usage: Usage }
  | { type: 'session.completed'; result: AgentResult }
  | { type: 'session.failed'; error: PublicError };
```

### 11.2 能力协商

Adapter 启动时报告实际能力，不按产品名称硬编码：

- Streaming。
- Tool Calls。
- Approvals。
- Session Resume。
- Image Input。
- Structured Output。
- Cancellation。
- Usage Reporting。

Task Planner 只能使用已协商能力。能力变化需要提示用户并进入兼容模式。

### 11.3 Codex Adapter

Codex 深度集成采用本地 App Server：

- OpenMovie 启动用户已安装或兼容版本的 Codex App Server。
- MVP 使用默认本地 stdio 传输和 JSONL 消息。
- 将认证、会话、审批和流式事件映射到 Agent Gateway。
- App Server 版本与协议能力在运行时探测。
- 不解析 Codex 交互式终端 UI。
- 不复制或读取 Codex 私有凭据文件。

官方 OpenAI 文档将 App Server 定位为产品内深度嵌入接口，覆盖认证、会话历史、审批和流式 Agent 事件。文档同时说明 WebSocket 传输是实验性且不支持生产，因此 MVP 不以 WebSocket 作为桌面内部传输。[Codex App Server](https://learn.chatgpt.com/docs/app-server)

自动化或无 UI 的未来场景可以增加 Codex SDK Adapter，但与 App Server Adapter 使用同一 Gateway Contract。

### 11.4 Claude Code Adapter

Claude Code 采用其公开 CLI 非交互 print mode：

- 使用 `claude -p` 和 JSON output，不解析交互式 TUI、ANSI 输出或模拟键盘。
- 使用 `--json-schema` 约束 `OPENMOVIE_PLAN_V1`，Core 再以同一 `agentPlanSchema` 做信任边界校验。
- 使用 Plan permission mode，Tool 限制为 `Read`、`Glob`、`Grep`，并拒绝 MCP Tool；它只能检查 Movie IR，不能直接修改项目。
- Prompt 从 stdin 传入；工作目录固定为当前 Project；环境变量采用显式白名单。
- 禁用 Session 持久化和浏览器集成，限制最大 Turn、stdout/stderr 大小和执行时间，并支持 AbortSignal 取消。
- 认证仍由 Claude Code 自己管理，OpenMovie 不读取其凭据文件。
- 结构化计划进入统一 Proposal 流程，用户接受时才由 Core 原子写入一个 Revision。

外部 Claude Code 仍可在 Desktop 未持有项目写锁时，通过 OpenMovie MCP Server 使用更完整的工程 Tool Surface。

### 11.5 Direct/Embedded Adapter

为保证低门槛和可用性，OpenMovie 提供不依赖外部 Coding Harness 的 Adapter：

- 通过 Provider Gateway 使用用户配置的 API Provider 或本地模型。
- 只拥有 OpenMovie Tool 能力。
- 使用相同 Task、Approval、Revision 和 Event 模型。
- 优先使用原生 Tool Calling；其次使用 JSON Schema 结构化 Action。
- Provider 只有普通文本输出且无法可靠产生结构化 Action 时，只启用文本生成功能，不宣称可以驱动 Agent。

它是完整的基础创作路径，但不需要复制 Codex 或 Claude Code 的通用编码、Shell 和仓库操作能力。OpenRouter、OpenAI-compatible 服务和自定义 Provider 都通过相同能力协商进入该 Adapter。

### 11.6 进程管理

- 使用显式可执行文件路径和参数数组。
- 记录版本、PID、启动时间和退出原因。
- 标准输出只用于协议，诊断输出单独处理。
- 消息设置大小上限和 Schema 验证。
- 取消时先发送协议取消，再在超时后终止进程树。
- Windows 使用可靠的进程树终止机制；macOS 使用进程组。
- 禁止 Adapter 任意继承全部环境变量。

## 12. OpenMovie Tool Runtime

### 12.1 原则

- Tool 是 Agent 修改工程的唯一业务入口。
- 输入输出有 JSON Schema。
- 写 Tool 必须携带 expected Revision。
- 每个 Tool 声明权限、费用、外部数据和幂等性。
- Tool 返回结构化结果和 Artifact 引用，不返回无法追踪的临时路径。

### 12.2 MVP Tools

项目读取：

```text
project.get_summary
project.get_context
story.get
scene.get
shot.get
asset.list
revision.get
evaluation.list
```

结构化修改：

```text
story.propose_patch
character.propose_patch
scene.propose_patch
shot.propose_patch
timeline.propose_patch
revision.propose
```

生成：

```text
text.generate
vision.analyze
video.analyze
image.generate
image.edit
take.generate
media.inspect
provider.list_capabilities
```

验证：

```text
project.validate
evaluation.run
revision.compare
build.impact
```

控制：

```text
run.status
run.cancel
approval.respond
```

### 12.3 Tool 调用流程

```text
Agent Tool Request
→ Schema Validation
→ Capability Check
→ Project Scope Check
→ Policy Evaluation
→ Optional Approval
→ Command Execution
→ Audit Record
→ Structured Result
```

### 12.4 禁止旁路

- Agent 不应直接写 SQLite。
- Agent 不应直接写 Object Store。
- 普通创作模式不提供通用 Shell Tool。
- 开发者模式允许的文件或 Shell 操作仍需限定 Project Scope，并与业务 Tool 产生的 Revision 区分。

## 13. MCP Server

OpenMovie MCP Server 让外部 Codex、Claude Code 或兼容 Harness 操作 Project。

### 13.1 传输

- 本地默认 stdio。
- 若未来提供本地 Socket/HTTP，必须使用随机会话凭据、仅绑定本地地址并防止跨站请求。
- 远程访问不属于 MVP。

### 13.2 Scope

一个 MCP Server 实例默认绑定一个 Project：

- Root 不可在会话中静默切换。
- 所有 Asset 路径解析限制在 Project 或对象库。
- Tool 列表由用户模式和项目策略过滤。

### 13.3 外部修改

外部 Harness 的写操作产生 Revision Proposal：

1. Agent 调用 propose Tool。
2. Core 计算 Diff、影响和预算。
3. 策略决定自动接受或创建审批。
4. Desktop 展示并允许接受、拒绝或继续修改。

## 14. Provider Gateway 与 Model Adapter

Provider Gateway 是 Harness 之外的独立模型执行层。Codex、Claude Code、OpenMovie Agent 和确定性工作流都调用相同 Gateway，不直接依赖某家模型 API。

### 14.1 能力域

```text
Provider Gateway
├── LLM
│   ├── Text Generation
│   ├── Structured Output
│   └── Tool Calling
├── Multimodal Understanding
│   ├── Image Understanding
│   └── Video Understanding
├── Image
│   ├── Generation
│   └── Editing
├── Video
│   ├── Generation
│   ├── Extension
│   ├── Interpolation
│   └── Editing
└── Audio
    ├── Speech
    ├── Transcription
    └── Music / Sound
```

LLM 和理解类请求可以共享内容块、Tool 和结构化输出语义；图片与视频生成具有异步任务、二进制产物、轮询、取消、费用和生命周期，使用独立 Media Generation Contract。

### 14.2 Provider 配置

```typescript
interface ProviderProfile {
  id: string;
  displayName: string;
  protocol:
    'openai-responses' | 'openai-chat-completions' | 'openmovie-media' | 'custom-http' | 'plugin';
  baseUrl: string;
  credentialRef?: string;
  defaultHeaders?: Record<string, SecretSafeValue>;
  models: ProviderModelConfig[];
  timeoutMs: number;
  dataPolicy?: ProviderDataPolicy;
}
```

规则：

- API Key 只保存为系统凭据引用。
- Base URL 必须经过 URL、TLS 和本地网络策略校验。
- Header 值支持 Secret 引用，不能进入 Project 和日志。
- 不允许用户配置任意本地文件读取模板。
- Provider Profile 可以导出，但 Secret 永不随配置导出。
- OpenRouter 是内置 Profile 模板，不在核心业务中写死特殊分支。

### 14.3 Model Registry

```typescript
interface ProviderModel {
  providerId: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  pricing?: PricingDescriptor;
  limits?: ModelLimits;
  discoveredAt: string;
  source: 'provider' | 'preset' | 'user' | 'probe';
}
```

Model 来源可以是 Provider 列表接口、内置模板、用户手动配置或能力探测。服务未提供 Model 列表时，允许用户输入 Model ID。

不能仅根据 Model 名称推测能力。内置模板只提供初始声明，连接测试和实际请求可以修正状态。

### 14.4 内部 Multimodal Contract

```typescript
type MultimodalContent =
  | { type: 'text'; text: string }
  | { type: 'image'; artifact: ArtifactRef; detail?: 'low' | 'high' | 'auto' }
  | { type: 'video'; artifact: ArtifactRef; sampling?: VideoSamplingPolicy }
  | { type: 'audio'; artifact: ArtifactRef }
  | { type: 'file'; artifact: ArtifactRef; mimeType: string };

interface MultimodalRequest {
  model: ModelRef;
  instructions?: string;
  messages: Array<{
    role: 'system' | 'developer' | 'user' | 'assistant';
    content: MultimodalContent[];
  }>;
  tools?: ToolDefinition[];
  responseSchema?: JsonSchema;
  generation?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
  metadata: RunMetadata;
}
```

内部 Contract 是 OpenMovie 标准，不等同于任何供应商 JSON。Adapter 负责转换，并明确报告丢失或不支持的字段。

OpenAI 官方 Responses API 支持文本、图片或文件输入，文本或 JSON 输出，以及自定义 Tool；这类内容块与结构化结果适合作为 OpenMovie 多模态 Contract 的重要兼容基线，但不应假设所有 OpenAI-compatible 服务完整实现相同行为。[Create a model response — official OpenAI API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)

### 14.5 协议配置

#### OpenAI Responses 风格

支持映射：

- 文本、图片和文件内容块。
- 流式文本事件。
- Structured Output。
- Tool Definition、Tool Call 和 Tool Result。
- Usage、状态和错误。

Adapter 必须通过能力探测决定具体 Provider 支持的子集。

#### OpenAI Chat Completions 风格

用于大量 OpenAI-compatible 服务：

- Message/Role。
- 文本和可用的图片内容块。
- Tool Call。
- JSON/Schema 输出能力。
- Streaming。

不同 Provider 对图片格式、Tool、JSON Schema、Usage 和错误存在差异，因此维护 Compatibility Flags，不能只拼接 Base URL。

#### Custom HTTP

声明式 Custom HTTP 只支持安全、有限的映射：

- URL Path。
- Method。
- Header Secret 引用。
- 请求字段模板。
- 响应字段路径。
- Job ID、状态、结果和错误映射。

不允许在配置中执行任意 JavaScript。超出声明式能力时使用隔离的代码 Plugin Adapter。

### 14.6 能力探测

能力来源按可信度合并：

1. Adapter 代码定义。
2. Provider 元数据接口。
3. 用户明确声明。
4. 低成本 Probe 请求。
5. 最近成功或失败的运行证据。

```typescript
interface ModelCapabilities {
  input: {
    text: boolean;
    image: boolean;
    video: boolean;
    audio: boolean;
    file: boolean;
  };
  output: {
    text: boolean;
    jsonSchema: boolean;
    image: boolean;
    video: boolean;
    audio: boolean;
  };
  toolCalling: boolean;
  streaming: boolean;
  nativeVideoUnderstanding: boolean;
  media?: MediaCapabilities;
}
```

能力状态支持：

- supported。
- unsupported。
- unknown。
- degraded。

unknown 不得被 UI 当成 supported。

### 14.7 LLM Adapter

```typescript
interface LlmAdapter {
  capabilities(model: ModelRef): Promise<ModelCapabilities>;
  respond(input: MultimodalRequest, context: ProviderRunContext): AsyncIterable<LlmEvent>;
  cancel(runId: string): Promise<void>;
}
```

事件包括：

- response.started。
- output_text.delta。
- tool_call.started/delta/completed。
- usage.updated。
- response.completed。
- response.failed。

Provider 原始响应在完成脱敏后可进入诊断附件；业务状态只使用规范化事件。

### 14.8 图片理解

图片理解流程：

1. 根据 Provider 要求决定 Data URL、上传文件或受控临时 URL。
2. Policy Engine 检查图片数据分类和 Provider 授权。
3. 将 Artifact 转为 Provider 输入。
4. 要求返回符合任务 Schema 的结构化结果。
5. 保存 Provider、Model、请求哈希和输出。
6. 将证据指向原图区域；Provider 不支持区域证据时明确标记。

典型 Schema：

- 角色身份与外观特征。
- 构图、景别、镜头角度和光线。
- 物体、文字和潜在技术问题。
- 与参考图的差异。

### 14.9 视频分析

视频分析不能假设 Provider 原生接受视频。统一入口支持两种 Executor。

#### Native Video Executor

当能力探测确认原生视频输入：

```text
Video Artifact
→ Upload / Reference
→ Provider Native Video Understanding
→ Timestamped Analysis
```

#### Decomposed Video Executor

通用默认方案：

```text
Video Artifact
├── FFprobe：格式、时长、帧率、音轨
├── Shot Boundary Detection
├── Keyframe Sampling
├── Audio Extraction
├── Speech Transcription
└── Optional OCR
        ↓
Batch Multimodal Analysis
        ↓
Temporal Reduce / Synthesis
        ↓
Timestamped Structured Result
```

```typescript
interface VideoAnalysisResult {
  summary: string;
  segments: Array<{
    range: TimeRange;
    description: string;
    characters?: EntityRef[];
    dialogue?: string;
    issues?: AnalysisIssue[];
    evidence: ArtifactRef[];
  }>;
  technical: MediaMetadata;
  provenance: AnalysisProvenance;
}
```

抽帧策略支持：

- 固定间隔。
- 镜头边界。
- 场景变化。
- 用户指定时间范围。
- 分层采样：低密度全片 + 高密度问题片段。

长视频分批处理，最终聚合不能丢失原始时间码和子任务来源。

### 14.10 Media Generation Contract

```typescript
interface MediaGenerationAdapter<TRequest> {
  id: string;
  kind: 'image' | 'video' | 'audio';
  capabilities(model: ModelRef): Promise<MediaCapabilities>;
  estimate(input: TRequest): Promise<CostEstimate>;
  submit(input: TRequest, context: ProviderRunContext): Promise<ProviderJob>;
  watch(job: ProviderJob): AsyncIterable<MediaGenerationEvent>;
  cancel(job: ProviderJob): Promise<CancelResult>;
  collect(job: ProviderJob): Promise<GeneratedArtifact[]>;
}
```

```typescript
type MediaGenerationEvent =
  | { type: 'job.queued'; providerJobId: string }
  | { type: 'job.progress'; progress?: number; preview?: ArtifactRef }
  | { type: 'job.completed'; artifacts: GeneratedArtifact[] }
  | { type: 'job.failed'; error: ProviderError }
  | { type: 'usage.updated'; usage: Usage };
```

不是所有 Provider 支持准确进度或取消。Adapter 必须报告能力；本地取消不代表远程任务或费用一定取消。

### 14.11 图片生成

统一请求覆盖：

- Text-to-Image。
- Image-to-Image。
- Edit/Inpaint。
- 多参考图。
- 尺寸、宽高比、质量和候选数量。
- 透明背景或 Mask。

Provider 特有参数位于 Extension Namespace。产物进入 Object Store，保存 MIME、尺寸、内容哈希、安全结果和 Provider Provenance。

### 14.12 视频生成

```typescript
interface VideoGenerationRequest {
  model: ModelRef;
  prompt: CompiledPrompt;
  mode: 'text-to-video' | 'image-to-video' | 'video-to-video' | 'extend' | 'interpolate' | 'edit';
  firstFrame?: ArtifactRef;
  lastFrame?: ArtifactRef;
  references?: ArtifactRef[];
  sourceVideo?: ArtifactRef;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  audio?: ArtifactRef;
  seed?: number;
  extensions?: Record<string, unknown>;
}
```

视频 Provider 能力描述：

- 支持的 mode。
- 输入参考类型和数量。
- 最小/最大时长。
- 分辨率、宽高比和帧率。
- 是否生成音频。
- Seed 与确定性。
- 异步状态、预览和取消。
- 费用估算维度。
- 内容政策、数据地区和保留策略。

一个 Shot 可以向多个 Video Provider 提交任务，每个结果成为独立 Take，并共享相同 Shot Intent 与评测集。

### 14.13 Provider 路由

```typescript
interface RoutingPolicy {
  capability: CapabilityRequirement;
  preference: Array<'quality' | 'cost' | 'latency' | 'privacy'>;
  allowedProviders: string[];
  fallback: 'never' | 'preapproved-only' | 'ask';
  maxEstimatedCost?: Money;
  dataResidency?: string[];
}
```

路由步骤：

1. 过滤不满足能力的 Model。
2. 过滤项目未授权或数据策略不兼容的 Provider。
3. 过滤预算和当前健康状态。
4. 按策略排序。
5. 执行首选 Provider。
6. 失败时按 Fallback Policy 决定是否切换。

不得因首选 Provider 失败而静默把私人素材发送给另一个 Provider。跨 Provider Fallback 需要预授权或即时审批。

### 14.14 费用与用量

统一记录：

- Provider 报告的 Usage。
- OpenMovie 根据公开配置推算的 Estimate。
- 请求、轮询和生成任务的实际状态。
- 币种、计费单位和价格配置版本。

Estimate 与 Actual 分开保存。无法确认费用时使用 unknown，禁止显示为免费。

### 14.15 可靠性

- HTTP 超时区分连接、首字节和总任务超时。
- 支持 Provider Rate Limit 与 Retry-After。
- POST 生成任务尽量使用 Idempotency Key。
- Provider Job ID 在创建后立即持久化。
- 轮询使用退避并可在应用重启后恢复。
- 临时下载 URL 在过期前导入 Object Store。
- 对下载产物验证 MIME、大小、内容哈希和媒体可解码性。

### 14.16 Provenance

每次 Provider Run 保存：

- Provider Profile ID。
- Adapter、协议和版本。
- Base URL 的安全标识，不保存 Secret。
- Model ID。
- 规范化请求哈希。
- 经脱敏的编译请求。
- Provider Job/Response ID。
- 输入 Artifact 哈希。
- 输出 Artifact。
- Usage、Estimate 和 Actual。
- 时间、状态、重试和错误。

UI 可以回答任一 Take 来自哪个 Provider、Model 和 Run。

## 15. Evaluation Engine

### 15.1 Evaluator

```typescript
interface Evaluator {
  id: string;
  version: string;
  scopes: EntityType[];
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
}
```

结果包含：

- pass/fail/score。
- 置信度。
- 解释。
- 证据帧或时间范围。
- Evaluator 与模型版本。
- 输入对象哈希。
- 是否由与生成相同的模型家族自评。

### 15.2 回归

Revision Proposal 触发：

1. 直接相关测试。
2. 受影响下游对象测试。
3. 项目规定的必跑测试。
4. 成本允许范围内的创作评测。

评测不能直接决定主观创作修改是否合并，除非项目策略明确授权。

## 16. Policy Engine

### 16.1 输入

- Actor。
- User Mode。
- Project Scope。
- Tool/Command。
- Data Classification。
- Provider。
- Cost Estimate。
- Locked Entities。
- Current Revision。

### 16.2 结果

```typescript
type PolicyDecision =
  | { outcome: 'allow' }
  | { outcome: 'deny'; reason: string }
  | { outcome: 'require_approval'; request: ApprovalRequest };
```

### 16.3 数据分类

- Public：可公开的项目数据。
- Project Private：默认不发送到未授权服务。
- Sensitive Identity：肖像、声音和身份参考。
- Restricted：项目策略禁止外传。

每个 Provider Adapter 声明外发数据类别，审批卡片显示目标服务和数据摘要。

### 16.4 费用

- Estimate 使用区间和币种。
- Provider 无法估算时必须标记 unknown。
- 实际费用以 Provider 可获得记录和本地推算分别保存。
- 超过阈值时暂停后续节点，不能在事后才通知。

## 17. Desktop 安全边界

### 17.1 Renderer

- contextIsolation 开启。
- nodeIntegration 关闭。
- sandbox 开启。
- Preload 只暴露类型化、最小 API。
- CSP 禁止任意远程脚本。
- 不直接显示未经清理的模型 HTML。

### 17.2 IPC

- 每个通道具有固定输入输出 Schema。
- Renderer 不能传入任意文件路径或命令。
- 请求与 Project、Window 和用户会话绑定。
- Core 事件经过过滤后才发送 Renderer。

### 17.3 本地媒体协议

使用自定义受控协议提供缩略图和媒体流：

- 只接受 Artifact ID，不接受任意绝对路径。
- 验证当前 Window 的 Project 权限。
- 支持 Range 请求。
- 设置正确 MIME、缓存和安全头。

### 17.4 Secret

- Renderer 只在添加或更新 Provider 时提交一次明文 Secret，之后只看到掩码、状态和 credentialRef。
- Electron Main 独占 safeStorage，优先使用 encryptStringAsync 与 decryptStringAsync。
- macOS 的加密密钥由 Keychain 保存；Windows 由当前用户上下文的 DPAPI 保护。
- 加密后的 Secret Blob 存入应用级 settings.sqlite，不存入 Project 的 .openmovie/state.sqlite。
- Project 和 Provider Profile 只保存 secret://provider/<profile-id>/<slot> 引用。
- Provider Worker 通过 Secret Broker 获取短生命周期 Secret Lease；Secret 只在执行请求时进入内存。
- API Key 不进入 Agent Prompt、Tool Result、日志、遥测、诊断包、Project Export 或 Git。
- Header、URL Query、错误对象和 Provider 原始响应都执行 Secret Redaction。
- 更新 Secret 时先验证新值，再原子替换密文；删除 Provider 时同步删除 Secret Blob。
- Harness 凭据归第三方 Harness 管理，OpenMovie 不读取其凭据文件。
- 开发者和 CI 可以通过环境变量注入临时 Secret，但默认不持久化，也不回显。

```typescript
interface SecretStore {
  isAvailable(): Promise<boolean>;
  put(ref: SecretRef, value: string): Promise<void>;
  lease(ref: SecretRef, purpose: SecretPurpose): Promise<SecretLease>;
  delete(ref: SecretRef): Promise<void>;
}
```

安全语义限制：

- Windows DPAPI 主要防止其他用户和离线读取，不能防止同一用户权限下已经执行的恶意程序。
- macOS 应保持稳定代码签名，否则应用更新可能触发重复 Keychain 授权。
- safeStorage 不等于远程 Secret Vault；未来组织级云执行需要独立凭据服务。

### 17.5 Plugin

- Plugin Manifest 声明 Tools、网络域名、文件范围和 Secret 需求。
- 默认在独立进程中运行。
- 消息经过 Schema 验证和大小限制。
- Plugin 崩溃不影响 Core。
- MVP 可以只支持本地开发插件，不急于建设市场。

## 18. 跨平台实现

### 18.1 文件系统

- 内部统一使用规范化项目相对路径。
- 对磁盘路径使用平台 API，不手工拼接分隔符。
- 测试大小写敏感与不敏感文件系统。
- Windows 测试长路径、盘符、UNC 和文件占用。
- 原子替换策略按平台封装并测试。

### 18.2 子进程

- 禁止依赖 Shell 解析。
- 统一捕获 exit code、signal、stderr 和协议错误。
- Sidecar 按 os/arch 分发并校验哈希。
- 处理 Windows Defender、防火墙和首次运行延迟。
- 处理 macOS App Sandbox、Quarantine 和 Gatekeeper。

正式安装包把 FFmpeg 与 FFprobe 作为 `Resources/ffmpeg/bin` 下的独立 Sidecar 分发，Main 在启动 Core 时通过显式环境覆盖传入绝对路径；Renderer 只看到 `bundled` / `custom` / `system` 与稳定健康状态。开发版仍允许 PATH 或 `OPENMOVIE_FFMPEG_PATH` / `OPENMOVIE_FFPROBE_PATH`。macOS 从固定 SHA-256 的 FFmpeg 9.0.1 官方源码构建 LGPL、禁网络、无 GPL/nonfree 组件的静态 CLI；Windows 使用固定 BtbN Release Tag 与资产 SHA-256 的 LGPL Static Build。License、源代码 URL、构建脚本版本和校验值随 Sidecar 分发。

Timeline 在运行时读取 `ffmpeg -encoders`，依次选择 `libx264`、`h264_videotoolbox`、`h264_mf` 和内置 `mpeg4`。因此开发环境可使用高质量 H.264，最小 LGPL Sidecar 仍有确定的 MP4 Fallback；不因某个 GPL 编码器缺失而让渲染主路径失效。

### 18.3 打包

目标：

- macOS arm64。
- macOS x64，是否持续支持由用户数据决定。
- Windows x64。
- Windows arm64 在依赖生态满足后评估。

发布要求：

- macOS Developer ID 签名和 Notarization。
- Windows 代码签名。
- 更新包签名验证。
- Sidecar SBOM、许可证和哈希清单。

### 18.4 更新

- MVP 使用 OpenMovieLabs/OpenMovie 的公开 GitHub Release Stable Channel；Beta 和 Nightly 保留为后续能力。
- electron-builder 生成 `latest.yml`、`latest-mac.yml` 与 Blockmap，electron-updater 校验清单和平台代码签名。
- 仅正式安装的 Windows/macOS Build 自动检查；开发版和不受支持平台保持 disabled，不产生后台网络请求。
- 更新可后台下载，但 `autoInstallOnAppQuit` 关闭；只有用户点击“Install and restart”才调用安装。
- Update IPC 只暴露版本、百分比和稳定状态文案，不把 URL、响应正文或网络错误送入 Renderer。
- 数据 Schema 迁移前创建备份。
- Core、Desktop、Adapter 和 Project Schema 兼容性检查。
- 自动更新失败不影响打开现有项目。

Tag Release 采用 fail-closed 签名门禁。macOS 需要 `MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD` 与 `APPLE_TEAM_ID`，由 electron-builder 完成 Developer ID 签名、公证和 Stapling；Windows 需要 `WIN_CSC_LINK` 与 `WIN_CSC_KEY_PASSWORD` 完成 Authenticode 签名。Secret 只从受保护 GitHub Actions 环境注入，不写入仓库或构建日志。Workflow dispatch 可生成明确标识用途的无签名开发包，但 Tag 不允许静默降级。

## 19. Core IPC

### 19.1 Command

```typescript
type CoreCommand<T> = {
  id: string;
  method: string;
  projectId?: string;
  expectedRevisionId?: string;
  payload: T;
};
```

### 19.2 Response

```typescript
type CoreResponse<T> =
  { id: string; ok: true; result: T } | { id: string; ok: false; error: PublicError };
```

### 19.3 Event

```typescript
type CoreEvent = {
  id: string;
  sequence: number;
  projectId?: string;
  taskId?: string;
  runId?: string;
  traceId: string;
  type: string;
  payload: unknown;
  createdAt: string;
};
```

### 19.4 顺序与恢复

- 每个 Project 事件具有单调 sequence。
- Renderer 重连时携带 lastSequence。
- Core 可以补发持久化事件或要求刷新 Snapshot。
- UI 不把事件流本身当作唯一状态来源。

## 20. 错误模型

```typescript
interface PublicError {
  code: string;
  category:
    | 'validation'
    | 'conflict'
    | 'permission'
    | 'approval'
    | 'provider'
    | 'harness'
    | 'media'
    | 'storage'
    | 'internal';
  message: string;
  retryable: boolean;
  userActions: UserAction[];
  traceId: string;
  details?: Record<string, unknown>;
}
```

错误必须区分：

- 用户输入错误。
- Revision 冲突。
- 未授权或需要审批。
- Provider 限流、内容拒绝、余额或服务异常。
- Harness 未安装、未登录、协议不兼容或崩溃。
- 媒体损坏或不支持。
- 磁盘空间、权限和文件占用。

## 21. Observability

### 21.1 日志

- JSON 结构化日志。
- 按 Project、Task、Run、Step 和 Trace 关联。
- 默认不记录完整 Prompt、媒体内容和 Secret。
- 用户可以生成经过脱敏的诊断包。

### 21.2 指标

- Task/Run 成功与恢复率。
- Harness 检测、启动和协议错误。
- Tool 调用延迟和错误。
- Build Node 耗时、缓存命中和重试。
- Provider 费用与估算偏差。
- Electron Renderer 崩溃与 Core 崩溃。

遥测默认策略、是否启用及数据范围需要在实现前形成隐私 ADR。开源本地构建必须能在不发送遥测的情况下完整工作。

## 22. 测试策略

### 22.1 单元测试

- Movie IR Schema、解析和迁移。
- Patch、Diff、Merge 和冲突。
- DAG 失效与缓存哈希。
- Policy 和 Cost。
- Task 状态机。
- 路径规范化和对象存储。

### 22.2 Contract Test

- Core IPC Schema。
- Agent Adapter 事件。
- Provider Protocol Profile、能力探测和规范化事件。
- LLM、Multimodal 与 Media Generation Adapter 输入输出。
- Custom HTTP 声明式映射。
- Tool 与 MCP Schema。
- Plugin Manifest。
- `@openmovie/plugin-sdk` 实现 v0.1 Manifest 与 JSON-RPC Contract；开发 Plugin 只在显式环境变量
  下加载，以请求级独立 Node 进程运行。MVP Capability 限定为 `text.generate`，无 Secret 和
  Project Path 注入，输出仍须通过 Agent Plan Schema 与 Revision Proposal 门禁。

每个 Adapter 必须有 Fake Server/Fixture，CI 不依赖真实付费服务。

### 22.3 集成测试

- 创建项目到生成 Revision 的完整 Core 流程。
- Harness 中断与恢复。
- Provider 超时、重试与取消。
- OpenAI-compatible Provider 的能力缺失与协议差异。
- 多 Provider 路由、预授权 Fallback 和预算阻断。
- 视频抽帧、转写、分批分析与时间码归纳。
- 异步视频 Job 在应用重启后的轮询恢复和产物收集。
- 文件外部修改与冲突。
- Object Store 去重和垃圾回收。
- Desktop 对 Object Store、源文件、SQLite 与可重建 Cache 分类计量；只允许用户清理
  `.openmovie/cache`、`.openmovie/previews` 和 `.openmovie/temp`。运行中 Task 会阻止清理，
  不可变 Object Store 不进入这一清理动作。
- 视频分析先由本地 LGPL FFmpeg Sidecar 生成最长边 1280 的审阅代理、16 kHz 单声道 WAV、
  有界 8 kHz 峰值波形和基于 scene score 的候选镜头边界。所有派生产物进入内容寻址
  Object Store，Analysis Provenance 记录对象 URI、编码器、阈值和媒体探测结果；远程视觉
  Provider 只接收确定性采样帧。
- Provider Gateway 暴露可选 `audio.transcribe` Port；支持该能力的分析 Provider 会接收本地抽取的
  WAV，并把带起止时间的 Transcript Segment 写入同一 Analysis Evidence。Provider 不声明能力时，
  视频视觉分析仍可独立完成。
- Evaluation Engine 聚合可复现性规则与媒体技术规则，输出带 JSON Pointer 或微秒 Time Range 的
  Findings。每个新 Take 与同 Shot 最近一次 Evaluation 比较状态、分数和新增 Finding Code；回归会
  产生 `REVISION_EVALUATION_REGRESSION`。角色一致性通过 `CharacterSimilarityPort` 保留可替换的
  本地或远程实现边界。
- Feedback 可选绑定 `[start_us, end_us)`，Desktop 以秒输入但在 IPC 前转换为整数微秒。时间范围
  会进入 Feedback → Task 的修复目标，并随 Proposal 的 `feedbackId` 关联到最终解决 Revision。
- Renderer 使用 typed in-repository locale catalog，不把协议枚举或 Movie IR 数据翻译后持久化。
  语言选择仅保存在设备本地；语义控件、焦点圈、Modal Focus Trap、Live Region、Skip Link 和
  Reduced Motion 构成桌面可访问性基线。
- Schema 升级和备份恢复。

### 22.4 Desktop E2E

在 Windows 与 macOS CI 或真实 Runner 上验证：

- 安装与首次启动。
- 创建、打开和恢复项目。
- Harness 检测。
- 示例 Task。
- Preview 播放。
- Approval。
- 更新后的项目迁移。

### 22.5 媒体测试

- 固定小型许可素材。
- FFmpeg 输出元数据快照。
- 允许编码器造成的非关键字节差异，使用感知或元数据断言。
- 不在常规 CI 调用昂贵视频生成。

## 23. 发布与兼容

### 23.1 版本

独立跟踪：

- Desktop App Version。
- Core Protocol Version。
- Movie IR Schema Version。
- Plugin API Version。
- Adapter Compatibility Range。

### 23.2 兼容原则

- 新 Desktop 至少能读取支持范围内的旧 Project。
- 迁移需要备份和可查看 Diff。
- Adapter 协议不兼容时禁用该 Adapter，不阻止打开 Project。
- Provider 下线不影响查看既有媒体和生成来源。

## 24. 实施阶段

### Phase 0：工程基础

- Monorepo、CI 和 Windows/macOS 最小桌面壳。
- Contracts、Core IPC 和错误模型。
- Movie IR v0 Schema。
- Project Store、SQLite 与对象库。
- 示例 Project。

退出标准：两个平台可以创建、打开、保存同一个无媒体 Project。

### Phase 1：可播放的垂直闭环

- Task/Run 状态机。
- Direct/Embedded Agent Adapter。
- Provider Gateway、Model Registry 和 Secret 管理。
- OpenAI-compatible LLM/Multimodal Adapter。
- Responses 风格协议 Adapter。
- 图片生成 Adapter 与通用视频分析 Pipeline。
- Story、Scene、Shot 和 Take。
- Preview、基础评测和 Revision。

退出标准：没有安装第三方 Harness 时，用户可以配置 API Provider，由 OpenMovie Agent 产生一个可查看图片产物、带时间码的视频分析结果及可回滚 Revision。

### Phase 2：Harness 集成

- Agent Gateway 完整事件模型。
- Codex App Server stdio Adapter。
- Claude Code 非交互结构化规划 Adapter。
- OpenMovie MCP Server。
- Harness 检测、登录状态、取消与恢复。
- 外部 Harness Revision Proposal。

退出标准：Codex 与 Claude Code 可以在 Desktop 内产生可审查 Proposal，外部兼容 Harness 可以通过 MCP 修改工程。

### Phase 3：电影工程闭环

- Build DAG 与增量缓存。
- 多视频生成 Provider、异步 Job 恢复和 Take 对比。
- 角色一致性和媒体技术评测。
- 时间码 Feedback。
- Agent 修复、前后对比和回归。
- 预算与审批。

退出标准：三镜头样例可从至少两个视频 Provider 产生候选 Take，并完成“发现问题—Agent 修复—评测—审批—回滚”闭环。

### Phase 4：Beta 质量

- 安装、签名、自动更新和崩溃恢复。
- 大项目性能和磁盘管理。
- Claude Code Adapter 跨平台兼容矩阵与回归 Fixture。
- 插件开发体验。
- 隐私、诊断和发布文档。

退出标准：Windows 与 macOS 的非开发用户无需终端即可完成 MVP 主路径。

## 25. 关键风险

### 25.1 Harness 协议变化

缓解：

- Agent Gateway 隔离。
- 运行时能力探测。
- Adapter Contract Test。
- 版本兼容矩阵。
- Direct Adapter 作为降级路径。

### 25.2 生成成本和长耗时

缓解：

- Build Impact。
- 内容哈希缓存。
- 预览质量策略。
- 预算暂停和并发限制。
- 已完成产物持久化。

### 25.3 评测不可靠

缓解：

- 保留证据、置信度和版本。
- 生成与评测尽量解耦。
- 人工审批主观结果。
- 使用回归集校准。

### 25.4 跨平台 Sidecar

缓解：

- Phase 0 即运行双平台 CI。
- 统一 Sidecar Manifest。
- 禁用 Shell 拼接。
- 发布前安装包 Smoke Test。

### 25.5 Movie IR 过度抽象

缓解：

- 以三镜头真实样例驱动 Schema。
- 允许命名空间扩展。
- Schema 迁移机制。
- 不在 MVP 为所有影视流程建模。

### 25.6 双重状态

Movie IR 文件和 SQLite 可能不一致。

缓解：

- 明确文件是当前状态的可移植表示，SQLite 是运行与历史索引。
- 所有内部写入经过单事务流程。
- 启动时校验 Manifest Hash。
- 外部变化进入 Working Changes。
- 提供 Project Repair 和完整备份。

### 25.7 “OpenAI-compatible”兼容差异

不同 Provider 可能只实现相同路径和少量字段，却在图片输入、Tool Call、Structured Output、Streaming、Usage 和错误模型上不一致。

缓解：

- 区分 Responses 和 Chat Completions Protocol Profile。
- 能力探测和 Compatibility Flags。
- unknown 能力默认关闭。
- Provider Contract Fixture 与真实连接 Smoke Test。
- Adapter 转换失败时返回明确 Unsupported Capability。

### 25.8 多 Provider 数据外发

自动 Fallback 可能把私人媒体发送给用户未预期的服务。

缓解：

- Provider 级数据授权。
- Restricted Asset 禁止自动切换。
- Fallback 仅限预授权 Provider，否则请求审批。
- 审计记录实际接收数据的 Provider。

## 26. 架构决策记录

首批决策按相关边界合并为 7 份 Accepted ADR，完整索引见 [docs/adr](./adr/README.md)：

1. [ADR-0001：桌面技术栈](./adr/0001-desktop-stack.md)。
2. [ADR-0002：进程架构与安全边界](./adr/0002-process-architecture.md)。
3. [ADR-0003：项目存储](./adr/0003-project-storage.md)。
4. [ADR-0004：Revision Engine](./adr/0004-revision-engine.md)。
5. [ADR-0005：Agent 与 Provider Gateway](./adr/0005-agent-provider-gateways.md)。
6. [ADR-0006：Secret Storage](./adr/0006-secret-storage.md)。
7. [ADR-0007：协议版本与跨平台门禁](./adr/0007-protocol-and-platform.md)。

ADR 是架构选择的事实来源。本节只提供导航；若后续改变 Accepted 决策，必须新建 superseding ADR。

## 27. 待验证技术问题

- 首个工程 PR 应锁定的 Electron、Node、pnpm 与 better-sqlite3 兼容版本；若双平台打包门禁失败，保持 Storage Port 不变并替换驱动。
- Timeline MVP 采用现有组件还是自研最小渲染层。
- FFmpeg 分发许可、编码器范围和安装包体积。
- Codex App Server 协议版本探测和兼容测试策略。
- Claude Code CLI 版本变化对 print mode、JSON Schema、Plan 权限和取消语义的兼容矩阵。
- OpenRouter 和其他 OpenAI-compatible Provider 的兼容测试矩阵。
- Direct Adapter 对 Tool Calling、Structured Output 和纯文本 Model 的分级支持。
- 自定义 HTTP 声明式映射的安全边界。
- 视频 Provider 的定价、能力和健康状态如何形成可解释的路由评分。
- Native Video Understanding 与抽帧分析结果的一致性评测。
- Object Store 在可移动硬盘、网络盘和云同步目录中的一致性。
- Project 备份、导出和多机器同步格式。
- Plugin 隔离是否需要额外 Sandbox 进程。
- 远程 Worker 和多人协作何时进入架构。

## 28. 技术验收判断

技术方案成立需要证明：

1. Windows 与 macOS 能打开并修改同一示例 Project。
2. Renderer 无法直接访问任意文件、进程和 Secret。
3. Codex、Claude Code 或 Direct Adapter 可以通过统一 Agent Gateway 替换。
4. 外部 Harness 只能通过有 Schema 和权限的 Tool 修改项目。
5. Harness、应用或 Provider 崩溃后，Task 和产物可以恢复。
6. 修改一个 Shot 只失效依赖它的 Build Node。
7. 任意 Take 都能追溯到输入、Adapter、模型、参数和 Run。
8. Agent 修改生成可审查 Revision，并能拒绝和回滚。
9. 未审批的外部上传、超预算和受保护修改无法执行。
10. 没有任何第三方 Harness 时，用户能配置 API Provider 驱动 OpenMovie Agent。
11. OpenAI-compatible Provider 的能力经过探测，未知能力不会被误用。
12. 图片理解和视频分析输出具有可追溯输入与时间码证据。
13. 同一 Shot 可以调用多个视频 Provider，并将输出保存为独立不可变 Take。
14. Provider Fallback 不会绕过数据授权和预算审批。

## 29. 参考

- [Codex App Server — official OpenAI documentation](https://learn.chatgpt.com/docs/app-server)：用于确认产品内深度集成、认证、会话、审批、流式事件、JSON-RPC 与本地 stdio 边界。
- [Create a model response — official OpenAI API reference](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)：用于确认文本、图片和文件输入、结构化文本/JSON 输出及自定义 Tool 等多模态协议基线。
- [Claude Code CLI reference — official Anthropic documentation](https://code.claude.com/docs/en/cli-usage)：用于确认 print mode、JSON output、JSON Schema、Plan permission mode、Tool 白名单与非持久 Session 参数。
- [Electron safeStorage — official Electron documentation](https://www.electronjs.org/docs/latest/api/safe-storage)：用于确认 macOS Keychain、Windows DPAPI 以及异步加解密边界。
- [FFmpeg Download — official FFmpeg project](https://ffmpeg.org/download.html)：用于固定源码、签名发布和由项目列出的二进制构建入口。
- [BtbN FFmpeg Builds](https://github.com/BtbN/FFmpeg-Builds)：用于 Windows LGPL Sidecar 的可复现构建脚本与固定 Release 资产。

第三方 Harness 的具体 Adapter 在实现时必须重新核对其当时的官方接口和许可。本方案只固定 OpenMovie 的 Adapter Contract，不把未经确认的第三方行为写成稳定事实。
