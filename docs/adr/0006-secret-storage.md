# ADR-0006: Secret Storage

- 状态：Accepted
- 日期：2026-08-25

## Context

OpenMovie 需要保存多 Provider API Key。明文配置会经 Git、项目导出、同步和日志泄露。直接维护 macOS/Windows 两套原生 Credential API 会增加 MVP 打包复杂度。

## Decision

- Electron Main 使用 safeStorage 异步 API。
- macOS 使用 Keychain-backed encryption。
- Windows 使用当前用户 DPAPI。
- 加密 Blob 存应用级 settings.sqlite。
- Project 只保存 Secret Ref。
- Provider Worker 通过 Secret Broker 获取短生命周期 Lease。
- 开发者/CI 环境变量不持久化。

## Consequences

- 不需要自建加密和双平台原生 Credential 模块。
- Windows 同一用户权限的恶意进程仍可能访问应用能力。
- macOS 必须保持稳定签名以获得一致 Keychain 行为。
- Secret 不随 Project 跨机器移动，需要用户重新配置。

## Guardrails

- Renderer 后续不可读取完整 Key。
- Secret 不进入 Prompt、Event、Error、日志和诊断包。
- 使用 Canary Secret 自动测试。
- 企业远程执行未来使用独立 Secret Vault。
