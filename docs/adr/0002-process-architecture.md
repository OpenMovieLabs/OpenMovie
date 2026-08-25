# ADR-0002: Process Architecture

- 状态：Accepted
- 日期：2026-08-25

## Context

UI、电影工程状态、Agent、Provider 和媒体处理具有不同可靠性与权限。把全部能力放入 Renderer 或 Electron Main 会扩大故障和安全范围。

## Decision

```text
Renderer
→ Preload Typed API
→ Electron Main
→ Node IPC
→ OpenMovie Core
→ Agent/Provider/Media Workers
```

- Renderer 是低信任 UI。
- Main 管理窗口、系统 API、Secret Store 和 Core 生命周期。
- Core 是业务事实和唯一写入口。
- Harness、Plugin、Provider 和媒体执行放入独立 Worker/进程。
- Core 采用 TypeScript 模块化单体，不在 MVP 拆网络微服务。

## Consequences

- Renderer 崩溃不破坏业务状态。
- Provider/Harness 崩溃可以隔离。
- 多进程协议需要版本、验证、取消和重连。
- Secret Broker 需要在 Main 与 Worker 间建立受控流程。

## Guardrails

- 媒体不通过 JSON IPC 内联。
- Worker 不直接写 Project。
- 所有跨进程消息使用 packages/contracts。
- 不使用本地开放 TCP 端口作为 Desktop 内部默认通道。
