# ADR-0001: Desktop Stack

- 状态：Accepted
- 日期：2026-08-25

## Context

OpenMovie 需要同时支持 Windows 与 macOS，运行本地子进程、FFmpeg、Agent Harness、SQLite 和大量媒体预览。项目需要开源贡献者容易参与，并快速完成 MVP。

## Decision

- Electron 作为 MVP 桌面框架。
- React + TypeScript 构建 Renderer。
- Vite 构建 Renderer。
- pnpm Workspace 管理 Monorepo。
- Electron Main 负责系统集成，Core 不依赖 Electron。

具体版本在初始化时选取稳定兼容组合并进入 Lockfile。

## Consequences

正面：

- 跨平台能力成熟。
- Node 子进程与 stdio 集成简单。
- UI、Core Contract、MCP 和 Adapter 可共享 TypeScript 类型。

负面：

- 安装体积与内存更高。
- 必须严格执行 Electron 安全基线。
- 原生 SQLite 依赖需要 Electron ABI 打包测试。

## Guardrails

- Renderer 禁止 Node Integration。
- Electron API 不进入领域包。
- Windows/macOS 从首个 PR 进入 CI。
- 不并行维护 Tauri 版本。
