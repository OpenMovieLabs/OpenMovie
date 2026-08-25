# OpenMovie Implementation Plan

> 状态：Active Implementation  
> 更新日期：2026-08-26  
> 输入：[产品设计](./PRODUCT_DESIGN.md) · [技术方案](./TECHNICAL_DESIGN.md) · [项目格式](./PROJECT_FORMAT.md) · [协议契约](./PROTOCOLS.md) · [安全设计](./SECURITY.md)

## 1. 实施策略

采用垂直切片，而不是先实现完整领域模型或全部 UI。

第一个可运行切片：

```text
Desktop 启动
→ 创建 Project
→ 写入最小 Movie IR
→ 配置 Fake Provider
→ 创建 Task
→ 生成一张 Fake/Fixture 图片
→ 导入 Object Store
→ 创建 Take
→ 提交 Revision
→ UI 预览并回滚
```

每个后续阶段都保持这条主路径可运行。

当前可运行基线已覆盖 M0–M4 的核心路径，以及 M5 的媒体反馈闭环：多文件 Movie IR Revision、Brief/Story Bible、Scene/Shot、确定性 Timeline 与 H.264 Current Cut、创作分支、持久化 Task/Approval、Codex App Server、MCP、加密 Provider Secret、Provider 无费用连通性检查、OpenAI-compatible 图片与视觉理解、异步视频 Job、不可变 Take、关键帧视频分析、确定性 Evaluation、结构化 Feedback、受限媒体预览、选片 Revision、Project Doctor、CLI 导出和 Windows/macOS 发布工作流。后续条目仍以各 Milestone Exit Criteria 为准，不因局部实现而提前视为完成。

## 2. 工程约束

- Monorepo 使用 pnpm workspace。
- Runtime、Electron、pnpm 和 FFmpeg 版本通过版本文件和 Lockfile 固定。
- TypeScript 开启 strict。
- 公共 Contract 必须有运行时验证。
- Movie IR JSON Schema 是格式规范。
- Core 模块不 import Electron。
- Renderer 不 import Node API。
- 真实 Provider 不进入默认 CI。
- Windows 与 macOS 从第一个可执行版本开始构建。

版本号不写死在长期设计文档；初始化仓库时选择当日稳定兼容组合，并由 Lockfile、ADR 和 CI 固定。

## 3. Milestone 依赖

```text
M0 Repository Foundation
  ↓
M1 Project Core
  ↓
M2 Task + Provider Vertical Slice
  ↓
M3 Desktop Creator Flow
  ↓
M4 Harness + MCP
  ↓
M5 Media, Eval, Revision Loop
  ↓
M6 Beta Hardening
```

M0–M3 构成第一个公开可演示 Alpha。

## 4. M0：Repository Foundation

### 4.1 Deliverables

- pnpm Workspace。
- Electron Main、Preload、Renderer 最小应用。
- Core 子进程和 initialize 握手。
- packages/contracts。
- packages/movie-ir。
- Lint、Format、Typecheck、Unit Test。
- Windows/macOS CI。
- 开发、测试和打包命令。
- 根 README、CONTRIBUTING 和 SECURITY 入口。

### 4.2 初始目录

```text
apps/desktop
apps/core
apps/cli
packages/contracts
packages/movie-ir
packages/project-store
packages/ui
schemas
examples
tests
```

其他包在实际需要时增加，避免空包占位。

### 4.3 Exit Criteria

- pnpm install 后可以启动 Desktop。
- Renderer 与 Core 完成版本握手。
- Windows/macOS CI 均执行 Typecheck 和 Test。
- 打包 Smoke Test 能启动应用并退出。
- Renderer Security 基线测试通过。

## 5. M1：Project Core

### 5.1 Movie IR

- openmovie.yaml v0 Schema。
- Character、Scene、Shot、Timeline、Asset Manifest Schema。
- YAML Parser、错误位置和稳定 Serializer。
- ID、相对路径和引用验证。
- Schema Migration 框架。

### 5.2 Project Store

- 创建、打开、关闭 Project。
- Project Lock。
- SQLite Migration。
- Repository Port。
- 外部文件监视。
- Working Changes。
- Project Doctor 骨架。

### 5.3 Object Store

- 流式导入。
- SHA-256。
- MIME 和媒体最小验证。
- 去重。
- Artifact Metadata。
- 临时文件恢复。

### 5.4 Revision

- Revision 和 Parent。
- MoviePatch。
- expectedRevisionId。
- Snapshot。
- Diff。
- Restore。

### 5.5 Exit Criteria

- 示例 Project 在 Windows/macOS 双向打开。
- 外部修改 Shot YAML 产生 Working Changes。
- 导入相同文件只产生一个 Object。
- Revision 冲突不会覆盖。
- 删除 state.sqlite 后仍可读取当前 IR。

## 6. M2：Task + Provider Vertical Slice

### 6.1 Task Engine

- Task、Thread、Run、Step 状态机。
- Event Store 和 sequence。
- Cancel。
- Retry。
- Approval。
- Checkpoint 和重启恢复。

### 6.2 Provider Gateway

- Provider Profile。
- Model Registry。
- Capability。
- Fake LLM Provider。
- Fake Image Provider。
- OpenAI-compatible Protocol Adapter。
- Responses Protocol Adapter。
- Cost/Usage。
- Provider Error Mapping。

### 6.3 Secret Store

- Electron Main safeStorage Async。
- 应用级 settings.sqlite。
- Secret Ref。
- Secret Broker。
- Redaction。
- Key 更新、删除和不可用状态。

### 6.4 Direct Agent

- 最小规划 Prompt。
- Tool Calling。
- Structured Action Fallback。
- project.get_summary。
- shot.propose_patch。
- image.generate。
- revision.propose。

### 6.5 Exit Criteria

- 无第三方 Harness 时可以配置 API Provider。
- Fake Provider 驱动完整 Task。
- 图片产物进入 Object Store 并成为 Take。
- 任务中断后可以恢复。
- Canary Secret 不出现在日志、Event、错误和导出中。

## 7. M3：Desktop Creator Flow

### 7.1 Home

- Recent Projects。
- Create/Open/Import。
- Harness 与 Provider Health。
- 磁盘空间提示。

### 7.2 Workspace

- Project Explorer。
- Task Thread。
- Plan 和 Run Progress。
- Approval Card。
- Problems。

### 7.3 Story/Shot

- Brief、Scene、Shot 结构编辑。
- Take List。
- 图片 Preview。
- Selected Take。

### 7.4 Versions

- Revision History。
- Semantic Diff。
- Accept Proposal。
- Restore。

### 7.5 Settings

- Provider Profile。
- API Key 输入和掩码状态。
- Model/Capability。
- Generation Strategy。
- Budget 和数据策略。

### 7.6 Exit Criteria

- 新用户无需终端完成 Project → Task → Image Take → Revision。
- 用户可以取消、批准、回滚。
- API Key 保存后不再显示完整值。
- 应用重启恢复 Project、Task 和未处理 Approval。
- Windows/macOS 主路径 E2E 通过。

## 8. M4：Harness + MCP

### 8.1 Agent Gateway

- Adapter Contract。
- Capability Negotiation。
- Session、Message、Plan、Tool、Approval、Cancel。
- Harness Health。
- Checkpoint Handoff。

### 8.2 Codex

- 安装和版本探测。
- App Server stdio 生命周期。
- initialize。
- Thread/Session。
- Stream Event Mapping。
- Approval Mapping。
- Cancel 和进程退出。
- 协议 Fixture。

### 8.3 MCP

- Project-scoped stdio Server。
- Tool Schema。
- Read Tools。
- Proposal Write Tools。
- Audit。
- 安装配置文档。

### 8.4 Claude Code

- MVP 先通过 MCP 验证外部调用。
- Desktop Embedded Adapter 只有在正式结构化接口、认证和取消语义验证后进入。

### 8.5 Exit Criteria

- Codex 在 Desktop 内驱动与 Direct Agent 相同的 Project Tool。
- 外部 Harness 通过 MCP 创建 Revision Proposal。
- 切换 Harness 不丢失 Task 结构化状态。
- Harness 崩溃不会损坏 Project。

## 9. M5：Media, Eval, Revision Loop

### 9.1 Media

- FFmpeg/FFprobe Sidecar。
- 图片元数据。
- 视频代理。
- Thumbnail。
- Waveform。
- 受控 Artifact Protocol。

### 9.2 Video Analysis

- Shot Boundary。
- Keyframe Sampling。
- Audio Extraction。
- Transcription Port。
- Multimodal Batch Analysis。
- Timestamped Result。

### 9.3 Video Generation

- Media Generation Contract。
- Fake Async Video Provider。
- 至少一个真实 Video Provider Adapter。
- 第二个 Provider Adapter 或可执行兼容 Fixture。
- Poll、Cancel、Resume、Collect。
- 多 Provider Take 对比。

### 9.4 Evaluation

- 静态验证。
- Media Technical。
- Character Similarity Port。
- Evidence 和 Time Range。
- Revision Regression。

### 9.5 Feedback Loop

- Preview 时间码 Feedback。
- Feedback → Task。
- Agent Patch。
- 局部 Build。
- Evaluation。
- Before/After。
- Accept/Reject。

### 9.6 Exit Criteria

- 三镜头样例可以从多个 Provider 生成 Take。
- 视频分析结果具有时间码。
- Agent 修复一个连续性问题并提交证据。
- 只重建受影响 Shot。
- 用户可以拒绝和回滚。

## 10. M6：Beta Hardening

- 安装包和自动更新。
- macOS 签名与 Notarization。
- Windows 签名。
- Crash Recovery。
- Project Backup/Repair。
- 磁盘与 Cache 管理。
- 性能基线。
- Accessibility。
- 国际化基础。
- Plugin 开发模式。
- SBOM、依赖扫描和安全报告渠道。
- 完整用户与开发文档。

Exit Criteria 使用 SECURITY.md 的 Security Gate 和 PRODUCT_DESIGN.md 的 MVP 验收。

## 11. 第一批 Issues

按以下顺序创建和实现：

1. chore: initialize pnpm TypeScript monorepo。
2. build: add Windows/macOS CI matrix。
3. feat(contracts): protocol version and initialize types。
4. feat(core): child process bootstrap and handshake。
5. feat(desktop): secure preload and empty renderer shell。
6. feat(movie-ir): root project JSON Schema。
7. feat(movie-ir): YAML parse/serialize and diagnostics。
8. feat(project-store): create/open project。
9. feat(project-store): SQLite migrations and repositories。
10. feat(object-store): SHA-256 streaming import。
11. feat(revision): MoviePatch and linear revision。
12. feat(events): persisted sequence and subscriptions。
13. feat(task): Task/Run state machine。
14. feat(provider): fake LLM and image adapters。
15. feat(secret): Electron safeStorage broker。
16. feat(provider): OpenAI-compatible adapter。
17. feat(agent): Direct Agent tool loop。
18. feat(ui): project creation and task thread。
19. feat(ui): image Take preview and selection。
20. test(e2e): first creator flow on Windows/macOS。

不要把多个编号压成一个巨大 PR。

## 12. PR 规则

每个 PR：

- 一个清晰 Outcome。
- 更新或引用 Contract。
- 包含测试。
- 不混入无关重构。
- 新外部依赖说明用途、许可证和替代方案。
- 新 IPC、Tool 或网络能力需要安全检查。
- 新用户可见行为更新文档。
- 不能提交 Secret、真实用户媒体和付费 Provider 响应。

## 13. Definition of Done

代码完成：

- Typecheck。
- Unit/Contract Test。
- 错误路径。
- Cancellation/cleanup。
- 双平台考虑。

协议完成：

- Runtime Schema。
- Fixture。
- Compatibility Test。
- Public Error。

安全完成：

- 权限与数据流。
- Redaction。
- Path/URL 校验。
- 无 Secret 日志。

产品完成：

- Loading、Empty、Error、Retry 状态。
- Accessibility Label。
- 用户文案。
- 对应验收场景。

## 14. CI

每个 PR：

```text
lint
format-check
typecheck
unit
contracts
security-static
build-desktop-macos
build-desktop-windows
package-smoke
```

可以按变更路径跳过昂贵任务，但 main 和发布候选必须运行全部。

Nightly：

- 完整 E2E。
- Project Migration Fixtures。
- Media Fixtures。
- Dependency Audit。
- Provider Contract Smoke，使用专用低权限测试账户且有费用上限。

## 15. Fixtures

必须建立：

- minimal-project。
- three-shot-continuity。
- malformed-yaml。
- future-schema-version。
- missing-object。
- revision-conflict。
- fake-agent-stream。
- fake-provider-llm。
- fake-provider-image。
- fake-provider-video-async。
- secret-redaction-canary。

Fixture 不包含真实人物敏感素材。

## 16. 开发开始门禁

开始 M0 前确认：

- [x] 产品定义。
- [x] 产品设计。
- [x] 总体技术方案。
- [x] Project Format v0。
- [x] Protocol Contract v0。
- [x] Security Design v0。
- [x] 首批 ADR。
- [x] Milestone 与首批 Issues。
- [x] 初始化 Monorepo 与 Lockfile。
- [x] 选择并记录具体 Runtime/Dependency 版本。
- [x] 配置 CI。

产品与架构门禁、仓库基线和双平台 CI 已建立；剩余工作按 M5–M6 验收项持续收敛。
