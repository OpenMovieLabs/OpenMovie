# ADR-0005: Agent and Provider Gateways

- 状态：Accepted
- 日期：2026-08-25

## Context

Codex、Claude Code 和内置 Agent 负责理解目标；OpenRouter、OpenAI-compatible 和媒体 API 负责模型执行。将二者混为一层会造成供应商锁定和状态不可恢复。

## Decision

- Agent Gateway 归一化会话、计划、Tool、审批、取消和恢复。
- Provider Gateway 归一化 LLM、多模态理解和媒体生成。
- Harness 与 Provider 可以独立选择。
- 没有第三方 Harness 时，Direct Agent 使用 Provider Gateway。
- 外部 Harness 通过 MCP 调用相同 Tool Runtime。
- 媒体生成使用异步 Job Contract，不强行套用聊天响应。

## Consequences

- Harness 可替换且 Project 不丢失。
- 多 Provider 可以产生可比较 Take。
- 需要 Capability Negotiation 和 Compatibility Fixture。
- Provider Fallback 涉及数据外发与费用审批。

## Guardrails

- 不解析交互 TUI。
- unknown capability 默认关闭。
- Agent 只能通过 Tool 修改。
- Fallback 只在预授权 Provider 间自动发生。
