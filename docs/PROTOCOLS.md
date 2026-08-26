# OpenMovie Protocol Contracts v0

> 状态：Implementation Baseline  
> 更新日期：2026-08-26  
> 关联：[技术方案](./TECHNICAL_DESIGN.md) · [项目格式](./PROJECT_FORMAT.md) · [安全设计](./SECURITY.md)

## 1. 范围

本规范定义 MVP 中进程、模块和外部 Harness 之间的稳定边界：

- Renderer ↔ Electron Main。
- Electron Main ↔ OpenMovie Core。
- Core ↔ Agent Adapter。
- Core ↔ Provider Adapter。
- 外部 Harness ↔ OpenMovie MCP Server。
- Core Event 与错误模型。

所有 Contract 先在 packages/contracts 中定义，再由实现引用。禁止在 UI、Adapter 或 Worker 中复制不一致的私有类型。

## 2. 版本

每个握手包含：

```typescript
interface ProtocolVersion {
  name: string;
  major: number;
  minor: number;
}
```

规则：

- major 不同默认不兼容。
- minor 新增可选字段和事件类型。
- 接收方忽略未知可选字段，但拒绝未知必需能力。
- 每个进程启动后先完成 initialize，再接受业务请求。
- 协议版本独立于 Desktop App 和 Movie IR Schema。

当前 Core Protocol/API 为 `0.2.0`。该版本移除 Branch 命令，并把版本管理收敛为线性历史与
`revision.restore` 追加恢复。

## 3. 标识

- request_id：单次请求。
- trace_id：跨组件完整操作。
- project_id：项目。
- task_id：用户目标。
- run_id：一次执行。
- step_id：执行步骤。
- session_id：Agent 会话。
- tool_call_id：Tool 调用。
- provider_job_id：供应商任务。
- revision_id：工程版本。
- artifact_id：产物记录。

生成 ID 使用类型前缀加 ULID。

## 4. 时间、金额和进度

```typescript
type Timestamp = string;
type DurationUs = number;

interface Money {
  amountMicros: string;
  currency: string;
}

interface Progress {
  completed?: number;
  total?: number;
  ratio?: number;
  message?: string;
}
```

金额使用十进制微单位字符串，禁止浮点金额。Progress 可未知，不伪造百分比。

## 5. Core Command

```typescript
interface CoreCommand<T = unknown> {
  protocol: ProtocolVersion;
  requestId: string;
  traceId: string;
  method: string;
  projectId?: string;
  expectedRevisionId?: string;
  payload: T;
}
```

写命令必须携带 expectedRevisionId；创建新 Project 等无父版本操作例外。

### 5.1 当前 Core JSONL 方法

桌面 Sidecar 使用带 `id` 的 JSONL/Node IPC 变体。当前运行时验证的方法包括：

- Project：`project.create`、`project.open`、`project.get_summary`、`project.doctor`、存储报告/清理与
  `project.policy_update`。
- Revision：commit、list、diff、working changes、restore。历史是线性的，restore 追加新 Revision。
- Movie IR：Brief、Story Bible、Character、Scene、Shot、Screenplay 和 Timeline 的读取、创建、装配、Current Cut Render 与乐观并发更新。
- Media：Object import、Take list/select、Evaluation list、图片/视频分析及带证据的 Analysis list。
- Feedback：绑定 Project、Scene、Shot、Take 或 Revision 的创建、查询与解决状态。
- Task：create、run、list、events、approve、cancel。
- Provider：OpenAI-compatible Chat/Vision/Images、通用异步 HTTP Video Jobs、Profile 配置与
  `provider.usage_summary`。
- Harness：Codex App Server 与可用性探测。

`task.create` 将对话与媒体工具明确分离。`mediaKind: none`（默认）只运行文本回复和可选的 Movie IR Proposal，不执行媒体生成；`image` 或 `video` 只运行相应媒体工具。未提供 `targetShotId` 的媒体任务在生成成功后自动创建可版本化的归档 Shot，再把产物登记为 Take，禁止留下 UI 不可见的孤立对象。长任务创建后立即返回；状态通过持久化 Task 查询和 Event sequence 观察。异步 Provider Job ID 在 Step checkpoint 中持久化，重试时优先恢复远程 Job。

## 6. Core Response

```typescript
type CoreResponse<T = unknown> =
  | {
      requestId: string;
      traceId: string;
      ok: true;
      result: T;
    }
  | {
      requestId: string;
      traceId: string;
      ok: false;
      error: PublicError;
    };
```

Response 只表示请求是否被接受和同步阶段结果。长任务通过 Run 和 Event 报告。

## 7. Core Event

```typescript
interface CoreEvent<T = unknown> {
  protocol: ProtocolVersion;
  eventId: string;
  sequence: number;
  traceId: string;
  type: string;
  createdAt: Timestamp;
  projectId?: string;
  taskId?: string;
  runId?: string;
  payload: T;
}
```

事件要求：

- 一个 Project 内 sequence 单调递增。
- Event 先持久化再发布。
- UI 重连携带 lastSequence。
- 如果事件历史已压缩，Core 返回 SnapshotRequired。
- UI 不把流式 Event 当作唯一事实来源。

## 8. MVP Event 类型

```text
project.opened
project.closed
project.working_changes_detected
project.problem_detected

task.created
task.updated
task.completed

run.created
run.started
run.progress
run.waiting_for_approval
run.evaluating
run.completed
run.failed
run.cancelled

step.started
step.progress
step.completed
step.failed

agent.session_started
agent.message_delta
agent.plan_updated
agent.tool_requested
agent.session_completed
agent.session_failed

approval.requested
approval.resolved

artifact.created
take.created
evaluation.completed
feedback.created
revision.proposed
revision.created
revision.conflict

provider.job_queued
provider.job_progress
provider.job_completed
provider.job_failed
provider.usage_updated
```

## 9. Public Error

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
    | 'protocol'
    | 'internal';
  message: string;
  retryable: boolean;
  userActions: UserAction[];
  traceId: string;
  details?: Record<string, unknown>;
}
```

稳定错误码：

```text
VALIDATION_SCHEMA
VALIDATION_REFERENCE
CONFLICT_REVISION
CONFLICT_ENTITY_LOCKED
PERMISSION_DENIED
APPROVAL_REQUIRED
PROVIDER_NOT_CONFIGURED
PROVIDER_AUTH_FAILED
PROVIDER_CAPABILITY_UNSUPPORTED
PROVIDER_RATE_LIMITED
PROVIDER_JOB_LOST
HARNESS_NOT_INSTALLED
HARNESS_NOT_AUTHENTICATED
HARNESS_PROTOCOL_INCOMPATIBLE
HARNESS_PROCESS_EXITED
MEDIA_UNSUPPORTED
MEDIA_CORRUPT
STORAGE_DISK_FULL
STORAGE_PROJECT_LOCKED
PROTOCOL_INVALID_MESSAGE
INTERNAL_UNEXPECTED
```

details 必须经过脱敏，不能放 Secret、完整 Header 或敏感 Prompt。

## 10. Initialize

Core：

```typescript
interface InitializeRequest {
  client: {
    name: string;
    version: string;
    platform: 'darwin' | 'win32';
    arch: string;
  };
  supportedProtocols: ProtocolVersion[];
}

interface InitializeResult {
  selectedProtocol: ProtocolVersion;
  coreVersion: string;
  capabilities: string[];
  instanceId: string;
}
```

不兼容时返回 HARNESS_PROTOCOL_INCOMPATIBLE 或 PROTOCOL_INVALID_MESSAGE 的对应协议错误。

## 11. Renderer IPC

Renderer 只可调用 Preload 暴露的命名方法：

```typescript
interface OpenMovieDesktopApi {
  project: {
    create(input: CreateProjectInput): Promise<ProjectSummary>;
    open(): Promise<ProjectSummary | null>;
    getSnapshot(projectId: string): Promise<ProjectSnapshot>;
  };
  command<T>(command: UiCommand<T>): Promise<CoreResponse>;
  subscribe(
    projectId: string,
    afterSequence: number,
    listener: (event: CoreEvent) => void,
  ): Unsubscribe;
  dialog: {
    pickFiles(options: PickFileOptions): Promise<PickedFile[]>;
  };
}
```

Renderer 不能：

- 传任意可执行文件。
- 直接读取绝对路径。
- 直接获得 Secret。
- 创建任意 IPC Channel。
- 启动 Harness 或 Provider 进程。

## 12. Agent Adapter

### 12.1 Installation

```typescript
interface AgentInstallation {
  id: string;
  installed: boolean;
  executable?: string;
  version?: string;
  authenticated: 'yes' | 'no' | 'unknown';
  health: 'ready' | 'degraded' | 'unavailable';
  problems: PublicError[];
}
```

executable 只在 Core/Main 内使用，不发送 Renderer。

### 12.2 Capabilities

```typescript
interface AgentCapabilities {
  streaming: boolean;
  approvals: boolean;
  resume: boolean;
  toolCalls: boolean;
  imageInput: boolean;
  structuredOutput: boolean;
  cancellation: boolean;
  usageReporting: boolean;
}
```

### 12.3 Session

```typescript
interface StartAgentSession {
  task: TaskContext;
  project: ProjectContext;
  tools: ToolDefinition[];
  policy: AgentPolicy;
  checkpoint?: AgentCheckpoint;
}
```

Adapter 返回统一 AgentEvent。未知原始事件可以进入 diagnostic，不可直接传 UI。

## 13. Tool Definition

```typescript
interface ToolDefinition {
  name: string;
  version: number;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  effect: 'read' | 'write' | 'external' | 'cost';
  idempotency: 'idempotent' | 'conditional' | 'non_idempotent';
  requiredCapabilities: string[];
}
```

Tool 名称采用 namespace.action，例如 shot.get、shot.propose_patch。

### 13.1 已实现 Tool Surface

独立 MCP stdio Server 与 Desktop 内 Codex Dynamic Tools 复用相同 Project Store 语义。当前实现：

- project_summary / openmovie_project_summary
- entity_list / openmovie_entity_list
- revision_list、revision_diff、revision_restore、working_changes
- scene_create / openmovie_scene_create
- shot_create / openmovie_shot_create
- story_get、story_update、timeline_get、timeline_assemble
- timeline_render_list
- take_list、evaluation_list、analysis_list
- feedback_list、feedback_create
- proposal_list（只读；接受/拒绝由 Desktop 用户操作）

所有创建命令要求 expectedRevisionId，写入形成完整 Movie IR 文件树 Revision。Desktop 内 Dynamic Tool 由当前 Core 直接执行；独立 MCP Server 获取项目写锁，因此不会与 Desktop 形成双写入口。

Core IPC 另实现 `proposal.list`、`proposal.accept` 和 `proposal.reject`。Proposal 携带经过 `agentPlanSchema` 验证的受限动作、Base Revision、状态和可选 Feedback ID；`proposal.accept` 必须同时匹配当前 Revision，成功后只产生一个 Agent Revision。

Desktop 内置规划 Harness 使用统一 `OPENMOVIE_PLAN_V1` 输出契约。Codex App Server 只获得 `openmovie_project_summary` 与 `openmovie_entity_list` 两个只读 Dynamic Tool。Claude Code 使用公开 CLI print mode，以 stdin 接收目标，要求 JSON Schema 结构化输出，并限制为 Plan permission mode 以及 `Read`、`Glob`、`Grep`。两者的输出都再次通过 `agentPlanSchema` 校验后才可建立 Proposal；CLI 返回信封、诊断文本、Session ID 和费用元数据不被解释为 Movie IR 操作。

Provider 配置实现 `provider.configure_openai_compatible`、`provider.configure_openai_responses` 与 `provider.configure_http_video`。Responses Adapter 使用 `POST /responses`，将 System 内容放入 `instructions`，文本/图片转为 `input_text` / `input_image`，设置 `store: false`，并把 `output_text`、状态与 Token Usage 归一化为统一 `GenerateTextResult`。自定义 LLM Profile 在 MVP 中明确表示“OpenAI Chat-compatible”，不猜测任意私有 Payload。

当前 `remote_media_policy` 在每个远程文本、图片、视频或分析 Step 执行前由 Core 再次检查：
`confirm` 使 Task 进入 `awaiting_approval`，`deny` 阻断请求，`allow` 允许执行。本地 Fake、Harness 与
显式开发 Plugin 不视为远程 Provider。`project.policy_update` 是携带 `expectedRevisionId` 的版本化写入，
Agent 不能隐式改变它。

完成的 Provider 调用写入 `provider_runs`，记录 Provider、Model、Capability、Task、请求哈希、Job ID
和 Provider 明确返回的 Token/费用。`provider.usage_summary` 汇总当前 UTC 月份。费用单位为
`costUsdMicros`；未返回价格的调用计入 `unpricedRunCount`，不把 unknown 错报为零成本。

## 14. Tool Call

```typescript
interface ToolCall {
  id: string;
  name: string;
  version: number;
  arguments: unknown;
  projectId: string;
  expectedRevisionId?: string;
  idempotencyKey?: string;
}

type ToolResult =
  { ok: true; value: unknown; artifacts?: ArtifactRef[] } | { ok: false; error: PublicError };
```

流程：

1. 验证 Tool 存在和版本。
2. 验证输入 Schema。
3. 检查 Project Scope。
4. 运行 Policy。
5. 必要时创建 Approval。
6. 执行。
7. 验证输出 Schema。
8. 写 Audit。
9. 返回结果。

## 15. Approval

```typescript
interface ApprovalRequest {
  id: string;
  projectId: string;
  runId: string;
  kind:
    'data_egress' | 'cost' | 'protected_change' | 'destructive' | 'external_command' | 'publish';
  summary: string;
  consequences: string[];
  affectedEntities: EntityRef[];
  provider?: ProviderRef;
  dataClasses?: string[];
  estimatedCost?: CostEstimate;
  choices: ApprovalChoice[];
  expiresAt?: Timestamp;
}
```

审批决定：

- allow_once。
- allow_for_run。
- allow_for_project_policy。
- deny。

永久策略变更必须是独立 Revision 或设置操作，不能由 Agent 在 Tool Result 中隐式完成。

## 16. Cancellation

```typescript
interface CancelRequest {
  runId: string;
  reason: 'user' | 'shutdown' | 'budget' | 'dependency_failed';
}
```

语义：

- cancel 是请求，不保证远程 Provider 已停止计费。
- Core 立即停止启动新下游 Step。
- 正在执行的 Adapter 尝试协议取消。
- 已完成 Artifact 保留。
- 最终状态包含 cancellation_scope 和 possible_external_activity。

## 17. Provider Profile

```typescript
interface ProviderProfile {
  id: string;
  displayName: string;
  protocol:
    'openai-responses' | 'openai-chat-completions' | 'openmovie-media' | 'custom-http' | 'plugin';
  baseUrl: string;
  credentialRefs: Record<string, string>;
  models: ProviderModelConfig[];
  timeoutMs: number;
  dataPolicy: ProviderDataPolicy;
}
```

内置桌面配置当前区分 `openai_chat`、`openai_images` 和 `http_video_jobs`，避免把“URL 看起来兼容”误当成能力兼容。Secret 只保存在应用级系统加密数据库中，Project 与 Renderer 只看到 Profile ID 和掩码状态。

桌面端 Provider Probe 对 OpenAI-compatible Profile 调用标准 `models` 端点，对异步 Video Profile 使用无费用的 `HEAD` 检查。Probe 禁止自动跟随重定向，只向用户保存的 Origin 发送凭据，且返回稳定脱敏错误，不返回响应正文或 Header。

credentialRefs 只能是 Secret Ref，不接受明文。

## 18. Multimodal Request

```typescript
interface MultimodalRequest {
  model: ModelRef;
  instructions?: string;
  messages: MultimodalMessage[];
  tools?: ToolDefinition[];
  responseSchema?: JsonSchema;
  generation?: {
    maxOutputTokens?: number;
    temperature?: number;
  };
  metadata: RunMetadata;
}
```

Adapter 必须返回字段损失或不支持能力，不能静默丢弃 responseSchema、Tool 或媒体输入。

## 19. LLM Event

```text
response.started
output_text.delta
tool_call.started
tool_call.arguments_delta
tool_call.completed
usage.updated
response.completed
response.failed
```

流式 arguments 在 completed 前不可执行。

### 19.1 Project storage

`project.storage_report` 返回项目源文件、SQLite、不可变 Object Store、Cache、Preview 和 Temp
的分类字节数，以及项目所在文件系统的容量、可用空间与低空间状态。

`project.storage_clean` 只接受 `cache`、`previews`、`temp` 类别。Core 在 Task 运行时拒绝清理；
该动作不接受任意路径，也不会删除 Object Store、Movie IR、Revision 或运行数据库。

`feedback.create` 可选接收 `timeRangeUs: { startUs, endUs }`。两者必须是整数微秒、
`startUs >= 0` 且 `endUs > startUs`；该范围采用半开区间 `[startUs, endUs)`。

## 20. Media Job

```typescript
interface ProviderJob {
  providerId: string;
  modelId: string;
  externalJobId: string;
  submittedAt: Timestamp;
  requestHash: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
}
```

ProviderJob 在 submit 成功后立即持久化，保证应用重启后继续轮询。

## 21. Artifact

```typescript
interface ArtifactRef {
  id: string;
  objectUri: string;
  kind: 'image' | 'video' | 'audio' | 'text' | 'json' | 'file';
  mimeType: string;
  byteSize: string;
  sha256: string;
}
```

远程 URL 不是最终 ArtifactRef。下载、验证并导入 Object Store 后才发布 artifact.created。

## 22. Cost

```typescript
interface CostEstimate {
  status: 'known' | 'range' | 'unknown';
  minimum?: Money;
  maximum?: Money;
  basis?: string;
  pricingVersion?: string;
}

interface Usage {
  providerReported?: Record<string, string>;
  estimatedCost?: Money;
  actualCost?: Money;
  actualStatus: 'confirmed' | 'estimated' | 'unknown';
}
```

unknown 不等于零。

## 23. Revision Proposal

```typescript
interface RevisionProposal {
  id: string;
  baseRevisionId: string;
  patch: MoviePatch;
  message: string;
  affectedEntities: EntityRef[];
  buildImpact: BuildImpact;
  evaluationSummary?: EvaluationSummary;
  costSummary?: Usage;
  artifacts: ArtifactRef[];
  author: ActorRef;
}
```

接受 Proposal 时再次检查 baseRevisionId。过期 Proposal 进入冲突处理。

## 24. MoviePatch

MVP 使用语义操作，不直接暴露 RFC 6902 路径给普通 Agent：

```typescript
type MoviePatchOperation =
  | { op: 'entity.create'; entity: MovieEntity }
  | { op: 'entity.update'; id: string; changes: Record<string, unknown> }
  | { op: 'entity.delete'; id: string }
  | { op: 'list.insert'; id: string; field: string; index: number; value: unknown }
  | { op: 'list.remove'; id: string; field: string; index: number }
  | { op: 'take.select'; shotId: string; takeId: string | null };
```

Core 将语义 Patch 编译为文件变化，并进行字段级冲突检测。

## 25. MCP 映射

- Tool Definition 映射 MCP Tool。
- Artifact/Project Context 映射 MCP Resource 或受控 URI。
- MCP Client 不能访问 Core 内部 IPC。
- 一个 MCP Server 进程默认绑定一个 Project。
- MCP 写 Tool 默认产生 Revision Proposal。
- MCP Error 转为稳定 PublicError。

MCP 协议版本由其自身规范管理；OpenMovie Tool version 仍必须显式声明。

## 26. Secret Ref

```typescript
type SecretRef = string;

interface SecretLease {
  leaseId: string;
  expiresAt: Timestamp;
  purpose: string;
}
```

格式：

```text
secret://provider/<provider-profile-id>/<slot>
```

Secret 值不允许出现在 Contract 序列化、Event、Error 和 Audit Payload 中。

## 27. 兼容测试

每个 Contract 必须具备：

- JSON Schema 或等价运行时验证器。
- Golden Fixture。
- 旧 minor 版本读取测试。
- 未知可选字段测试。
- 缺少必需字段失败测试。
- Secret Redaction 测试。
- 消息大小上限测试。
- Fuzz/Property Test，优先用于 Patch、路径和协议解析。

## 28. 消息限制

初始限制：

- 单个 IPC JSON 消息：16 MiB。
- 单个 Agent/Provider 文本增量：1 MiB。
- 媒体永不内联通过 IPC。
- Base64 媒体只在 Provider 明确要求时由 Worker 局部生成。
- 超限返回 PROTOCOL_INVALID_MESSAGE。

限制值可配置，但修改必须进入 ADR 和压力测试。

## 29. v0 验收

1. Renderer、Core、Fake Agent 和 Fake Provider 共享同一 contracts 包。
2. 协议 major 不兼容时启动失败且错误可理解。
3. Event 断线重连不会丢失最终状态。
4. Tool 输入输出全部运行时验证。
5. Revision 冲突不会最后写入者覆盖。
6. Provider Job 可以在 Core 重启后恢复。
7. Secret 不出现在任何 Fixture 快照和日志。
8. Windows 与 macOS Contract Test 结果一致。
