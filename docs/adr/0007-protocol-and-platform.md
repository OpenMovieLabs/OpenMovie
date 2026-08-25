# ADR-0007: Versioned Contracts and Platform Matrix

- 状态：Accepted
- 日期：2026-08-25

## Context

OpenMovie 由多个进程、Adapter 和跨平台安装包组成。隐式 TypeScript 结构无法防止运行时不兼容，延后 Windows 测试会造成路径、进程和原生依赖返工。

## Decision

- 公共消息拥有 major/minor Protocol Version。
- packages/contracts 提供类型和运行时 Schema。
- Event 先持久化并具有 Project sequence。
- Adapter 使用 Capability Negotiation。
- Windows x64、macOS arm64/x64 从 M0 进入 CI。
- 每个原生依赖和 Sidecar 运行打包 Smoke Test。

## Consequences

- 协议升级更可控，断线可以恢复。
- 增加 Fixture 和兼容测试成本。
- 多平台问题更早暴露。
- 发布流程需要维护架构产物矩阵。

## Guardrails

- major 不兼容立即失败。
- unknown 可选字段可忽略，未知必需能力拒绝。
- 不把 Shell 作为跨平台协议。
- Runtime 与依赖具体版本进入 Lockfile 和发布清单。
