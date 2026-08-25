# OpenMovie Project Format v0

> 状态：Implementation Baseline  
> 更新日期：2026-08-26  
> 关联：[技术方案](./TECHNICAL_DESIGN.md) · [协议契约](./PROTOCOLS.md)

## 1. 目的

本规范定义 OpenMovie MVP 的磁盘项目格式。目标是让项目：

- 在 Windows 与 macOS 间可移植。
- 可由人阅读和通过 Git 管理。
- 能在运行数据库丢失时恢复当前创作状态。
- 支持不可变媒体、增量构建和 Revision。
- 不携带用户 Secret。

v0 仅覆盖 MVP 所需实体，不试图表达完整影视制作行业格式。

## 2. 项目目录

```text
MyMovie/
├── openmovie.yaml
├── brief.yaml
├── story/
│   ├── bible.yaml
│   └── screenplay.yaml
├── characters/
│   └── <character-id>.yaml
├── locations/
│   └── <location-id>.yaml
├── scenes/
│   └── <scene-id>.yaml
├── shots/
│   └── <shot-id>.yaml
├── timeline/
│   └── main.yaml
├── tests/
│   └── <test-id>.yaml
├── assets/
│   └── manifest.yaml
└── .openmovie/
    ├── state.sqlite
    ├── objects/
    │   └── sha256/
    │       └── ab/
    │           └── <full-digest>
    ├── cache/
    ├── previews/
    ├── temp/
    ├── locks/
    └── logs/
```

## 3. 事实来源

| 数据                     | 事实来源                | 可删除     | 可进入 Git |
| ------------------------ | ----------------------- | ---------- | ---------- |
| 当前创作定义             | YAML Movie IR           | 否         | 是         |
| Asset 元数据与对象引用   | assets/manifest.yaml    | 否         | 是         |
| Task、Run、Revision 历史 | .openmovie/state.sqlite | 否         | 默认否     |
| 原始与生成媒体           | .openmovie/objects      | 否         | 默认否     |
| 构建缓存                 | .openmovie/cache        | 是         | 否         |
| 代理与缩略图             | .openmovie/previews     | 是         | 否         |
| 临时文件                 | .openmovie/temp         | 是         | 否         |
| Secret                   | 应用级 Secret Store     | 不属于项目 | 绝不       |

YAML 表达当前工程状态；SQLite 记录历史和运行状态。启动时两者通过 manifest hash 对齐。

## 4. 序列化规则

- 文件编码：UTF-8，无 BOM。
- 换行：写入时统一 LF；读取时接受 CRLF。
- YAML：YAML 1.2 安全子集。
- 不允许自定义 Tag、任意对象构造和可执行表达式。
- 时间：RFC 3339 UTC 字符串。
- 时长：整数微秒；界面可以显示秒或时间码。
- 帧率：有理数，例如 numerator 24000、denominator 1001。
- 颜色：明确色彩空间，不使用无上下文字符串。
- 未知扩展字段放入 extensions 命名空间。
- Core 写文件时使用稳定字段顺序，减少无意义 Diff。
- 浮点数不得用于时间线定位和金额。

## 5. ID

ID 规则：

- 正则：^[a-z][a-z0-9_]{2,63}$。
- 前缀反映实体类型，例如 char_、scene_、shot_、take_、asset_、eval_。
- 自动生成器使用类型前缀加小写 ULID。
- ID 创建后不可修改；可读名称放入 name、title 或 label。
- 文件名默认等于 ID 加 .yaml。

示例中的 shot_012 是合法手工 ID；生产自动 ID 可以是 shot_01k3abc...。

## 6. 根清单

openmovie.yaml：

```yaml
schema_version: 0
project:
  id: project_01k3example
  title: Example Movie
  default_locale: zh-CN
  created_at: 2026-08-25T00:00:00Z

delivery:
  width: 1920
  height: 1080
  frame_rate:
    numerator: 24
    denominator: 1
  audio_sample_rate: 48000

entrypoints:
  brief: brief.yaml
  story_bible: story/bible.yaml
  screenplay: story/screenplay.yaml
  timeline: timeline/main.yaml
  asset_manifest: assets/manifest.yaml

policies:
  default_generation_strategy: balanced
  protected_revision: null

extensions: {}
```

根清单不包含 API Key、绝对路径和 Provider Secret。

## 7. 通用实体头

```yaml
schema_version: 0
id: shot_012
type: shot
revision: 7
created_at: 2026-08-25T00:00:00Z
updated_at: 2026-08-25T00:10:00Z
extensions: {}
```

revision 是实体级乐观并发计数；项目级写操作仍以 Revision ID 为准。

## 8. Character

```yaml
schema_version: 0
id: char_anna
type: character
revision: 1
name: Anna

identity:
  age_range: adult
  appearance: Short black hair, oval face
  distinguishing_features:
    - small scar above left eyebrow

voice:
  language: en-US
  description: Low, restrained voice

wardrobe:
  default: wardrobe_anna_coat

reference_assets:
  - asset_anna_ref_front

constraints:
  - constraint_anna_identity

extensions: {}
```

## 9. Scene

```yaml
schema_version: 0
id: scene_003
type: scene
revision: 1
title: Before Sunrise
order: 3

story_goal: Anna decides to leave
location: location_station
characters:
  - char_anna

emotion:
  start: controlled anxiety
  end: committed urgency

facts:
  required:
    - The train has not arrived
  forbidden:
    - Anna boards the train

shots:
  - shot_012
  - shot_013

constraints: []
extensions: {}
```

## 10. Shot

```yaml
schema_version: 0
id: shot_012
type: shot
revision: 1
scene: scene_003
order: 1
duration_us: 4500000

characters:
  - char_anna

camera:
  framing: medium_close_up
  movement: slow_dolly_in
  screen_direction: left

performance:
  emotion: restrained_anxiety

dialogue:
  speaker: char_anna
  text: We should leave before sunrise.

constraints:
  - constraint_anna_identity
  - constraint_dialogue_lipsync

generation:
  strategy: balanced
  preferred_mode: image_to_video
  references:
    - asset_anna_ref_front
  provider_override: null

selected_take: null
extensions: {}
```

Shot 表达意图；模型、实际 Prompt、Seed、Job ID 和输出属于 Take/Run。

## 11. Take

Take 不要求单独 YAML 文件。MVP 将 Take 和生成来源写入 SQLite，并在需要导出时序列化。

```yaml
id: take_01k3example
shot: shot_012
status: ready
artifact: om://object/sha256/<digest>
created_by_run: run_01k3example
provider:
  profile: provider_video_a
  model: model-video-a
  adapter_version: 0.1.0
generation:
  request_hash: sha256:<digest>
  seed: 18421
evaluations:
  - eval_01k3example
```

Take 和其 Artifact 不可变。选择 Take 只修改 Shot.selected_take 或 Timeline 引用。

对 Take 的 Evaluation、Multimodal Analysis 与 Feedback 保存在 SQLite。Analysis 记录模型、摘要、证据、关键帧时间码和 Provenance；它不修改不可变 Artifact。

Current Cut Render 同样是不可变对象。`timeline_renders` 记录源 Project Revision、Timeline entity revision、对象 URI、时长、MIME 和字节数；重复渲染产生新记录，不覆盖旧成片。

## 12. Asset Manifest

```yaml
schema_version: 0
assets:
  - id: asset_anna_ref_front
    type: image
    object_uri: om://object/sha256/<digest>
    original_name: anna-front.png
    mime_type: image/png
    byte_size: 1200345
    width: 2048
    height: 2048
    source:
      kind: imported
      imported_at: 2026-08-25T00:00:00Z
    rights:
      status: user_confirmed
      license: null
    classification: sensitive_identity
```

manifest 中的 object_uri 必须解析到对象库；外链 Asset 使用 external_uri 并标记 portable: false。

## 13. Timeline

```yaml
schema_version: 0
id: timeline_main
type: timeline
revision: 1

video_tracks:
  - id: video_main
    clips:
      - id: clip_001
        shot: shot_012
        take: take_01k3example
        start_us: 0
        source_in_us: 0
        duration_us: 4500000

audio_tracks: []
subtitle_tracks: []
extensions: {}
```

MVP 不在 Timeline 表达复杂调色、节点特效和专业混音。

## 14. Test

```yaml
schema_version: 0
id: test_anna_identity
type: evaluation_spec
revision: 1
scope:
  entity: scene_003
evaluator: character_similarity
expectation:
  threshold: 0.88
approval: human_on_failure
```

Evaluation Result 进入 SQLite，因为它绑定具体输入哈希、Evaluator 版本和 Run。

## 15. 对象存储

对象 URI：

```text
om://object/sha256/<64-char-hex-digest>
```

磁盘路径：

```text
.openmovie/objects/sha256/<first-two-hex>/<full-digest>
```

写入算法：

1. 流式写入 .openmovie/temp。
2. 同时计算 SHA-256 和字节数。
3. 根据内容检测 MIME，不信任扩展名。
4. 对媒体运行最小可解码检查。
5. fsync 可用时刷新文件。
6. 原子移动到最终对象路径。
7. 已存在相同 Digest 时丢弃临时副本。
8. 在 SQLite 事务中增加对象引用。

对象文件永不原地修改。

## 16. SQLite 范围

MVP 表：

```text
projects
revisions
revision_parents
entity_index
tasks
threads
runs
run_steps
tool_calls
approvals
build_nodes
artifacts
object_refs
takes
evaluations
analyses
timeline_renders
feedback
events
schema_migrations
```

具体 DDL 由首次实现迁移生成，但必须遵守：

- 外键开启。
- 写事务短且明确。
- WAL 模式是否启用由文件系统能力检查决定。
- 每个迁移只执行一次并记录校验。
- 数据库不存储 API Key。
- JSON 列只存不适合关系查询的版本化 Payload。

## 17. Revision 与文件写入

Revision Commit：

1. 获取项目写锁。
2. 检查 expected_revision_id。
3. 验证 Patch 和目标实体版本。
4. 在内存中生成新 YAML 内容。
5. 将新文件写入同目录临时文件。
6. 开启 SQLite 事务。
7. 写 Revision、Patch、索引和事件。
8. 原子替换 YAML。
9. 写新的 project manifest hash。
10. 提交 SQLite 事务。
11. 释放锁并发布事件。

若平台无法跨 SQLite 与文件系统提供真正原子事务，启动修复日志记录待完成步骤。恢复时根据 Revision 状态完成或回滚文件替换。

## 18. 项目锁

- 每个 Project 同时只有一个 Core Writer。
- 锁文件：.openmovie/locks/core.lock。
- 内容包括 instance_id、pid、host、created_at 和 heartbeat。
- 不能仅凭 PID 判断锁有效；需要 heartbeat 和进程探测。
- 第二个 OpenMovie 实例默认只读打开，用户可以请求接管失效锁。
- 外部文本编辑不需要获取 Core Lock，但会产生 Working Changes。

## 19. 外部修改

文件监视器按以下流程处理：

1. 去抖并等待文件稳定。
2. 安全解析 YAML。
3. Schema 与引用验证。
4. 计算相对当前 Revision 的 MoviePatch。
5. 产生 WorkingChangesDetected 事件。
6. 用户保存、丢弃或修复。

无效 YAML 不覆盖 Core Snapshot。

## 20. 跨平台路径

- IR 中只使用正斜线项目相对路径。
- 解析后必须验证路径没有逃出 Project Root。
- 拒绝 ..、绝对路径和未授权符号链接逃逸。
- Windows 比较路径时处理盘符与大小写。
- 导入对象后不再依赖原始路径。
- UI 显示原始文件名，不把它当唯一标识。

## 21. Git

推荐 .gitignore：

```gitignore
.openmovie/state.sqlite
.openmovie/state.sqlite-*
.openmovie/objects/
.openmovie/cache/
.openmovie/previews/
.openmovie/temp/
.openmovie/locks/
.openmovie/logs/
```

进入 Git：

- openmovie.yaml。
- Movie IR YAML。
- Asset Manifest。
- Tests。

大媒体通过未来 Git LFS 适配器或 OpenMovie Remote Store 同步。

## 22. Backup 与 Export

完整备份包括：

- 所有 Movie IR。
- state.sqlite 的一致快照。
- 被引用的 Object。
- Project Format 与 Schema Version。
- 不包含 Secret。

Portable Export 可以选择：

- Source Only：IR + Manifest。
- Current Cut：IR + 当前采用媒体。
- Full Project：IR + History + 所有被引用媒体。

导出过程生成清单和内容哈希，导入时验证。

## 23. Schema 迁移

- 打开旧项目先读取 openmovie.yaml 的 schema_version。
- 不支持的未来版本以只读方式打开。
- 迁移前创建完整本地备份。
- 迁移生成 Revision 和 Migration Report。
- Migration 是可重复测试的纯转换。
- Core 版本不得静默降级项目格式。

## 24. 损坏与修复

Project Doctor 检查：

- YAML 解析和 Schema。
- ID 唯一性与引用。
- Manifest Hash。
- SQLite integrity_check。
- Object 存在、大小和哈希。
- Take 与 Artifact 引用。
- 临时 Revision Journal。
- 过期锁。

修复操作必须先备份，并输出逐项报告。

## 25. v0 实现验收

1. Windows 创建的 Project 能在 macOS 打开，反之亦然。
2. 删除 Cache 和 Preview 后可以重新构建。
3. 删除 state.sqlite 后仍能恢复当前 IR 和 Asset Manifest。
4. Project Export 不包含任何 Secret。
5. 修改一个 Shot YAML 能生成结构化 Working Changes。
6. 对象导入具有确定 SHA-256 URI，并能去重。
7. Revision 失败不会留下半更新 YAML。
8. 未来 Schema 版本以只读方式打开。
