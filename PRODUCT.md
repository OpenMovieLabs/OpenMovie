# OpenMovie 产品定义

> 状态：MVP Product Baseline v0  
> 更新日期：2026-08-25

配套设计：

- [桌面端产品设计](./docs/PRODUCT_DESIGN.md)
- [跨平台技术方案](./docs/TECHNICAL_DESIGN.md)
- [完整文档索引](./docs/README.md)

## 1. 产品概述

OpenMovie 是一个面向 AI 原生电影创作的开源 Harness 与工作台。它将电影工程建模为一种类似代码工程的、结构化且可执行的项目，使一部电影能够被持续构建、验证、调试、评审和修改。

OpenMovie 不以某个具体的视频生成模型为中心。模型只是运行时依赖，项目真正的源代码是一套模型无关的电影中间表示（Movie IR）。OpenMovie 负责把创作意图编译为可执行的生成任务，记录完整生成链路，验证结果，并让 AI Agent 以可审查的 Patch 方式持续改进工程。

OpenMovie 的主要产品形态是 Windows 与 macOS 桌面应用。普通创作者可以像使用 Codex 一样从自然语言任务开始，观察 Agent 的计划和执行过程，并审批可播放、可比较、可回滚的电影工程变更。Codex、Claude Code 和其他 Agent Harness 通过统一 Agent Gateway 接入，但不成为项目状态、媒体和版本的唯一所有者。

一句话定义：

> OpenMovie = 电影工程的结构化描述语言 + 可增量执行的生成引擎 + 自动评测与 Agent 修复循环。

英文定位：

> The open-source harness for building, testing, and iterating AI-native films.

## 2. 背景与问题

现有 AI 视频工具通常围绕单次生成展开：用户输入提示词，模型输出一段视频，然后通过反复修改提示词获得新的结果。这种方式适合制作独立片段，却很难支撑一部包含大量角色、场景、镜头、对白、声音和版本的完整电影。

当前工作流的主要问题包括：

- 创作意图散落在提示词、聊天记录和人工记忆中，缺少统一的工程表示。
- 生成结果与模型、参数、Seed、参考素材之间缺少完整溯源。
- 修改上游设定后，无法准确判断哪些镜头需要重新生成。
- 角色、服装、空间、动作和声音的连续性难以自动检查。
- 反馈通常是自然语言评论，无法沉淀为可重复执行的约束和测试。
- AI 可以生成内容，却难以定位问题、做局部修改并证明修改有效。
- 生成成本高，缺少缓存、增量构建、预算和审批机制。

OpenMovie 要解决的不是“如何再调用一个生成模型”，而是“如何管理一部会持续变化的 AI 电影”。

## 3. 产品愿景

让电影像软件一样可以持续演进：

- 创作意图可以被结构化描述和版本管理。
- 任意成片片段都能追溯到其输入、依赖、模型和生成过程。
- 修改局部内容时，只重新构建受影响的部分。
- 技术错误、连续性问题和创作目标可以被自动验证。
- 人类反馈可以转化为结构化问题、约束和回归测试。
- AI Agent 可以定位问题、提交修改、运行验证并展示修改证据。
- 人类始终拥有创作决策、预算控制和最终发布权。
- 普通用户无需安装开发环境或使用终端即可完成核心创作闭环。
- 用户可以选择或替换 Agent Harness，而不改变电影工程的语义和格式。

## 4. 目标用户

### 4.1 核心用户

- 使用多种 AI 模型制作短片、动画、广告或电影的独立创作者。
- 需要管理大量镜头、角色和素材的小型 AI 影视团队。
- 构建电影生成 Agent、工作流和模型适配器的开发者。
- 研究长视频生成、角色一致性和多 Agent 协作的研究人员。

### 4.2 用户角色

- 导演：定义整体创作意图，审批关键修改和最终版本。
- 编剧：管理故事事实、人物关系、对白和场景目标。
- 分镜师：定义镜头语言、构图、运动和场面调度。
- 生成创作者：选择模型、参考素材和生成参数，管理 Take。
- 剪辑与声音创作者：管理时间线、对白、音乐、音效和混音。
- 工程开发者：扩展模型适配器、评测器、Agent 和插件。

一个用户可以同时承担多个角色。

## 5. 产品目标与非目标

### 5.1 产品目标

1. 定义开放、可版本化、模型无关的 Movie IR。
2. 将电影工程编译为可执行、可缓存的任务依赖图。
3. 支持从最终画面反向追踪到所有生成输入和决策。
4. 提供技术、语义、连续性和创作目标的分层验证体系。
5. 将时间码反馈转换为结构化问题和持久化测试。
6. 支持 AI Agent 通过 Patch、验证和对比完成受控修改。
7. 为不同生成模型和媒体处理工具提供统一适配器接口。
8. 在 Windows 与 macOS 提供无需终端的桌面创作体验。
9. 通过 Agent Gateway 支持 Codex、Claude Code 和其他兼容 Harness。
10. 通过 Provider Gateway 接入 OpenRouter、OpenAI-compatible 服务和自定义文本、多模态、图片及视频 API。

### 5.2 当前非目标

- 不自行训练基础视频、图像、语音或音乐模型。
- MVP 不以替代 Premiere Pro、DaVinci Resolve 等完整 NLE 为目标。
- 不承诺审美判断存在唯一正确答案。
- 不在 MVP 阶段追求无需人工参与的全自动长片生成。
- 不把某个模型供应商的提示词格式作为项目源文件。

## 6. 核心产品原则

### 6.1 项目描述是源代码，媒体是构建产物

剧本、角色、镜头、约束和时间线的结构化描述构成源代码。图片、视频、语音、音乐、代理文件和最终成片是由源代码及外部素材构建出的产物。

### 6.2 模型无关

Movie IR 描述创作意图，不直接绑定特定模型语法。模型适配器负责将结构化意图编译为提示词、参数和 API 请求。

### 6.3 一切对象均可寻址

Project、Character、Scene、Shot、Take、Asset、Constraint、Evaluation 和 Feedback 都必须拥有稳定 ID。反馈、修改、依赖和评测必须指向明确对象及可选时间范围。

### 6.4 一切结果均可溯源

任何最终帧、声音或字幕都必须能够追溯到对应 Take、Shot、输入素材、模型版本、参数、Seed、执行环境和评测记录。

### 6.5 生成结果不可静默覆盖

生成产物默认不可变。新的生成产生新的 Take 或 Revision，由用户或规则决定是否提升为当前采用版本。

### 6.6 AI 通过 Patch 工作

Agent 不直接覆盖工程或成片。Agent 提交结构化差异、影响范围、成本预估、评测结果和前后对比，经过策略判断或人工批准后合并。

### 6.7 反馈应成为工程资产

一次反馈不应只解决一次问题。可以泛化的问题应沉淀为约束、评测器配置或回归测试。

### 6.8 Harness 可替换

Codex、Claude Code 或其他 Agent Harness 负责理解目标、制定计划和调用工具，但 OpenMovie Core 始终掌握 Movie IR、Revision、媒体、任务状态、权限和评测。Harness 中断或被替换不应导致工程无法恢复。

### 6.9 Harness 与 Provider 解耦

Agent Harness 负责规划和工具调用，Provider 负责文本推理、多模态理解、图片生成或视频生成。没有安装第三方 Harness 时，OpenMovie 可以使用用户配置的 API Provider 驱动内置 Agent；安装 Harness 后，媒体生成仍统一经过 OpenMovie Provider Gateway。用户可以分别选择 Agent、分析模型和生成模型。

## 7. 电影工程与代码工程的映射

| 代码工程       | OpenMovie 电影工程                       |
| -------------- | ---------------------------------------- |
| 产品需求       | Creative Brief、主题、受众和时长目标     |
| 源代码         | 剧本、场景、镜头、角色、风格和时间线定义 |
| 类型定义       | 角色、地点、道具、服装和视觉规则         |
| 函数或模块     | Scene、Shot、表演和音频段落              |
| 依赖包         | 模型、LoRA、素材、字体、音乐和工具       |
| 编译器         | 剧本拆解器、镜头规划器和 Prompt Compiler |
| Runtime        | 图像、视频、语音、音乐模型及媒体工具     |
| Build Pipeline | 生成、补帧、配音、剪辑、调色和混音       |
| Build Artifact | Take、预览片、成片和多语言版本           |
| 单元测试       | 单镜头构图、角色、时长和口型检查         |
| 集成测试       | 跨镜头连续性、音画同步和故事完整性检查   |
| Git Commit     | 工程 Revision 和创作决策记录             |
| Debugger       | 生成链路、依赖、参数和输入输出追踪       |
| CI/CD          | 自动构建预览、质量检查、评审和发布       |
| Coding Agent   | 编剧、导演、分镜、剪辑和质检 Agent       |

电影与代码并不完全等价。代码通常具有相对明确的正确与错误；电影还包含主观审美和创作取舍。因此 OpenMovie 的验证结果需要同时支持布尔判断、连续评分、相对比较和人工审批。

## 8. 核心领域模型：Movie IR

Movie IR 是 OpenMovie 的产品核心，也是模型、工作台、CLI、Agent 和插件之间的公共协议。

```text
Project
├── CreativeBrief
├── StoryBible
├── Characters
├── Locations
├── Props
├── StyleBible
├── Story
│   ├── Acts
│   └── Scenes
├── ShotGraph
│   ├── Shots
│   └── Takes
├── AudioGraph
├── Timeline
├── Constraints
├── Evaluations
├── Feedback
└── BuildRecords
```

### 8.1 关键实体

- `Project`：工程元数据、全局配置、目标交付格式和权限。
- `CreativeBrief`：主题、受众、叙事目标、时长、语言和整体创作方向。
- `StoryBible`：世界观、人物关系、故事事实和不可违反的设定。
- `Character`：身份、外貌、声音、服装、行为特征和参考素材。
- `Location`：空间结构、光线、时间、天气和视觉参考。
- `StyleBible`：摄影、色彩、美术、镜头、剪辑和声音风格。
- `Scene`：叙事目标、地点、人物、情绪弧线和场景内约束。
- `Shot`：期望得到的镜头意图，是可编辑的源定义。
- `Take`：某次具体执行产生的候选媒体及完整生成记录。
- `Asset`：参考图、视频、音频、字体、模型权重和其他外部资源。
- `Timeline`：被采用 Take 的时间排列、转场、字幕和混音关系。
- `Constraint`：必须满足或尽量满足的技术、连续性和创作要求。
- `Evaluation`：某个评测器对指定对象及版本的执行结果。
- `Feedback`：绑定对象、时间范围、问题类型和状态的人类或 AI 意见。
- `BuildRecord`：一次构建的输入哈希、执行环境、成本、输出和日志。

### 8.2 Shot 示例

```yaml
id: shot_012
scene: scene_003
duration: 4.5s

characters:
  - char_anna

camera:
  framing: medium_close_up
  movement: slow_dolly_in

performance:
  emotion: restrained_anxiety

dialogue:
  speaker: char_anna
  text: 'We should leave before sunrise.'

constraints:
  - anna_identity_consistency
  - screen_direction_left
  - dialogue_lipsync

preferred_generation:
  adapter: video/default
  source_image: asset_anna_ref_03
```

具体模型名称、模型版本、编译后的提示词、Seed 和运行参数属于 Take 或 BuildRecord，而不是 Shot 的核心创作意图。

## 9. Build Graph 与执行模型

OpenMovie 将 Movie IR 编译为有向无环依赖图（DAG）：

```text
Creative Brief
    ↓
Story Bible → Screenplay
    ↓             ↓
Characters → Scenes → Shots
    ↓             ↓
Reference Assets → Takes
                       ↓
Dialogue / Music → Timeline
                       ↓
                    Master
```

每个任务节点至少记录：

- 结构化输入及其内容哈希。
- 上游依赖及版本。
- 使用的适配器、模型和工具版本。
- 模型参数、Seed 和编译后的实际输入。
- 输出产物、代理文件和缩略图。
- 运行时间、费用、硬件与错误日志。
- 自动评测及人工审批状态。

当上游内容发生变化时，系统根据依赖图计算受影响范围，只使必要节点失效，并复用其余缓存结果。这是控制生成时间和成本的关键能力。

## 10. Git-like 版本管理与多人协作

OpenMovie 将版本管理视为核心产品能力，而不是对底层 Git 的简单包装。系统需要同时管理结构化创作定义、大型媒体对象和可重新生成的构建缓存，并向不同类型的用户提供符合其习惯的操作界面。

### 10.1 三层版本模型

```text
OpenMovie Revision System
├── Movie IR：文本和结构化创作定义
├── Media Store：图片、视频、音频等不可变对象
└── Build Cache：可以重新生成的中间产物
```

- Movie IR 支持提交、分支、比较、合并、回滚和标签。
- Media Store 通过内容哈希寻址和去重，Revision 只保存媒体对象引用。
- Build Cache 记录输入哈希和构建环境，可按需清理和重新生成。
- 开发者可以使用 Git 管理文本定义，大型媒体可以存放在本地对象库、Git LFS 或远程对象存储中。
- OpenMovie Revision 是面向产品和电影语义的版本层，可以映射到 Git，但不依赖用户理解 Git。

### 10.2 面向创作者的 Git 语义

| Git 概念       | OpenMovie 用户概念         |
| -------------- | -------------------------- |
| Repository     | 电影工程                   |
| Commit         | 保存版本 / Checkpoint      |
| Commit message | 修改说明                   |
| Branch         | 创作版本 / Cut / Variant   |
| Diff           | 创作差异                   |
| Merge          | 合并修改                   |
| Merge conflict | 创作冲突                   |
| Tag            | 里程碑 / 发布版本          |
| Pull Request   | 修改提案 / Change Proposal |
| Author         | 创作者或 Agent             |
| Blame          | 修改者、时间和原因         |
| Checkout       | 切换创作版本               |
| Revert         | 恢复历史版本               |

普通创作者通过“保存版本”“创建方案”“比较”“恢复”和“接受修改”等操作使用版本系统，不需要接触 Git 命令。专业团队可以使用分支、审批和冲突解决；开发者可以直接使用 Git、OpenMovie CLI、Hooks 和 CI。

### 10.3 Revision 数据结构

每次保存生成一个不可变 Revision，而不是复制整个项目目录。

```yaml
id: rev_0042
parents:
  - rev_0041

author:
  type: agent
  id: director_agent

message: '提高 shot_012 的角色一致性'

changes:
  - target: shot_012
    operation: update
    fields:
      - preferred_generation.source_image
      - constraints

assets_added:
  - take_012_v4

evaluations:
  identity_similarity:
    before: 0.71
    after: 0.91

build_cost:
  amount: 0.84
  currency: USD
```

Revision 至少记录：

- 父版本、作者、时间和修改说明。
- 对 Movie IR 的结构化 Patch。
- 新增、移除或重新选择的 Asset 与 Take。
- 受影响的 Scene、Shot 和最终时间范围。
- 构建环境、模型、执行成本和耗时。
- 修改前后的评测结果及人工审批状态。

### 10.4 电影语义 Diff

OpenMovie Diff 不应只展示 YAML 或 JSON 行变化，还应解释创作含义和构建影响，例如：

```text
Character Anna 的主参考图已变更
├── 影响 17 个引用镜头
├── 其中 6 个已构建镜头需要重新评估
├── 预计重新生成 3 个镜头
└── 预计成本 $12.00
```

Diff 可以覆盖：

- Story Fact、角色、地点和风格规则的变化。
- Scene 目标、Shot 意图和 Timeline 结构变化。
- 当前采用 Take 的变化。
- 依赖失效范围、预计构建任务和费用。
- 验证结果的改善、新增失败和潜在回归。

### 10.5 合并与冲突

Movie IR 使用对象级和字段级合并，而不是只进行文件级文本合并：

```text
用户 A 修改 shot_012.camera
用户 B 修改 shot_012.dialogue
→ 可以自动合并

用户 A 修改 shot_012.duration
用户 B 也修改 shot_012.duration
→ 产生字段级冲突
```

生成媒体不进行二进制合并。发生 Take 冲突时，用户可以选择一个候选 Take、保留多个创作版本，或重新生成新的候选。Timeline 冲突应通过可视化方式展示受影响的 Clip、时间范围和上下游依赖。

### 10.6 多用户协作

协作模型采用乐观并发与对象级保护相结合：

- 用户、团队、角色和项目级权限。
- Scene、Shot 或其他对象的负责人。
- 对象级编辑状态和必要的临时锁定，避免锁住整个工程。
- 时间码评论、反馈指派、状态和审批。
- 受保护的主版本和发布标签。
- 修改提案、评审者和必要审批数量。
- 完整的作者、Agent、外部调用和发布审计记录。

### 10.7 Agent 与版本系统

Agent 必须作为可识别的协作者参与版本系统。每个自主任务在隔离的工作 Revision 或分支中运行：

```text
main
 └── agent/fix-feedback-027
      ├── 修改 Movie IR
      ├── 生成新 Take
      ├── 执行相关测试
      └── 提交 Change Proposal
```

Agent 不能绕过版本系统直接修改主版本。修改提案需要展示结构化 Patch、影响范围、费用、评测结果、前后媒体对比和残余风险，并根据项目策略自动合并或等待人工批准。

### 10.8 分阶段实现

1. MVP：线性 Revision、自动保存、版本对比、恢复、不可变 Take 和内容寻址。
2. V1：创作分支、Agent 修改提案、审批、标签和受保护版本。
3. V2：多用户协作、对象级合并、字段级冲突、权限和远程同步。
4. V3：跨项目复用、Git 双向映射和可扩展协作服务。

底层可以兼容 Git，但产品体验不能停留在 Git。Git 能发现某一行文件发生变化；OpenMovie 还必须理解该变化影响了哪些人物、镜头、构建任务、评测结果和生成成本。

## 11. 可验证性

OpenMovie 提供四层验证。

### 11.1 静态验证

无需执行媒体模型即可完成：

- Schema 和字段类型是否合法。
- ID 引用是否存在。
- 必需素材和依赖是否缺失。
- 镜头时长、帧率、分辨率和交付配置是否合法。
- 时间线是否存在冲突、空洞或越界。

### 11.2 技术验证

针对生成媒体和最终交付：

- 黑帧、花屏、重复帧和编码错误。
- 音量、峰值、静音、噪声和响度。
- 字幕越界、拼写和时间同步。
- 对白口型与音频同步。
- 分辨率、帧率、码率、色彩空间和交付格式。

### 11.3 语义与连续性验证

- 角色身份、年龄、服装和声音是否一致。
- 地点、时间、天气、光线和道具是否连续。
- 视线、轴线、动作和空间方向是否正确承接。
- 对白、表演和画面内容是否匹配。
- 镜头是否覆盖 Scene 规定的故事事实和叙事目标。

### 11.4 创作验证

- 节奏是否符合预期。
- 情绪是否按场景目标发展。
- 视觉和声音是否符合 Style Bible。
- 主题、人物动机和叙事信息是否有效传达。

这一层主要使用多模态模型评审、规则、版本 A/B 对比和人工审批。结果允许是评分和解释，不强制简化为 pass/fail。

### 11.5 测试定义示例

```yaml
- id: test_anna_identity
  scope: scene_003
  evaluator: character_similarity
  threshold: 0.88

- id: test_scene_tension
  scope: scene_003
  evaluator: vision_language_judge
  expectation: 'Tension should rise continuously.'
  approval: human_required
```

评测器输出必须包含版本、置信度、解释和证据位置。由生成模型自己评价自己的结果时，应明确标记，避免将自评当作客观事实。

## 12. 可调试性

OpenMovie 的调试目标是让任意最终片段都能回答：它为什么会变成这样，以及最可能需要修改哪个上游对象。

从最终时间码向上追踪：

```text
Master 时间码
→ Timeline Clip
→ 采用的 Take
→ Shot 定义
→ Prompt 编译结果
→ Character / Location / Style 引用
→ 输入素材
→ 模型、版本、Seed 和参数
→ 构建日志与评测结果
```

工作台需要提供：

- 当前版本与基线版本的并排或叠加比较。
- Frame、Clip、Take、Shot、Scene 之间的双向跳转。
- 构建依赖图和受影响范围展示。
- 原始输入、编译输入和模型输出查看器。
- 失败节点重试、替换模型和局部重新构建。
- 日志、成本、耗时和评测结果的统一 Trace。

## 13. 反馈系统

所有反馈都应绑定明确上下文：

```yaml
id: feedback_027
target: shot_012
time_range: 00:01.200-00:03.500
author: user_001
issue: character_identity
comment: '女主角这里不像前一个镜头'
reference:
  - shot_011
severity: high
status: open
```

反馈生命周期：

```text
自由文本或时间码评论
→ 结构化分类
→ 定位目标和可能原因
→ 生成修改提案
→ 局部重新构建
→ 自动评测和前后对比
→ 人工接受、拒绝或继续修改
→ 必要时沉淀为回归测试
```

系统必须保留原始反馈，AI 的结构化解释只能作为派生信息，不能替换用户原意。

## 14. AI Agent 修改闭环

Agent 的标准工作协议：

1. 读取创作目标、当前工程状态和权限边界。
2. 定位失败测试、反馈或未完成目标。
3. 沿依赖图分析可能根因和影响范围。
4. 生成结构化 Patch，而不是直接覆盖工程。
5. 预估需要重新执行的节点、费用和时间。
6. 按策略自动执行或请求用户批准。
7. 只重新构建受影响内容。
8. 运行相关测试及必要的回归测试。
9. 将新版本与基线进行比较。
10. 提交修改说明、证据、残余风险和建议。

Agent 提案至少包含：

- 修改了哪些 Movie IR 对象和字段。
- 为什么认为这些修改可以解决问题。
- 将影响哪些镜头和最终时间范围。
- 预计和实际消耗的时间与费用。
- 修改前后的媒体预览。
- 通过、失败和发生退化的评测项。
- 是否需要人工审批。

### 14.1 Agent 边界

- 最大迭代次数和最大费用。
- 允许使用的模型、工具和数据范围。
- 不得修改的锁定对象和已批准镜头。
- 不得违反的故事事实、对白和版权约束。
- 允许自动合并的修改类型与分数阈值。
- 必须人工批准的角色变更、剧情变更和发布节点。

## 15. 产品形态

### 15.1 Desktop Workbench

Desktop Workbench 同时支持 Windows 与 macOS，以自然语言 Task 为默认入口，通过渐进披露让普通创作者无需理解 Git、Movie IR、MCP 或终端。主要交互界面包括：

- Task / Thread：表达目标、查看计划、执行进度和结果。
- Project Explorer：浏览 Story、Scene、Shot、Take、Asset 和测试。
- Story / Shot Editor：编辑结构化创作意图，同时保留自然语言体验。
- Graph View：查看生成依赖和变更影响范围。
- Preview / Timeline：播放、选择 Take、编辑装配并添加时间码反馈。
- Inspector：查看对象定义、模型输入、生成参数和溯源。
- Test Center：查看静态、技术、连续性和创作评测。
- Agent Review：查看 AI Patch、成本、测试和前后对比。
- Run Console：查看任务队列、缓存、日志、耗时和预算。

### 15.2 CLI

CLI 面向自动化、开发者和 CI，概念命令包括：

```text
openmovie validate
openmovie plan
openmovie build scene_003
openmovie test scene_003
openmovie trace shot_012
openmovie diff revision_a revision_b
openmovie agent fix feedback_027
```

命令名称仅用于表达产品能力，最终 CLI 设计由实现阶段确定。

### 15.3 Plugin 与 Adapter

开放扩展点包括：

- 文本、视觉理解、视频分析、图像、视频、语音和音乐 Provider Adapter。
- OpenAI-compatible、OpenRouter 类聚合服务和自定义 HTTP Provider。
- Prompt Compiler。
- 媒体处理工具。
- Evaluator。
- Agent。
- 导入器、导出器和发布器。
- 工作台面板和工作流模板。

### 15.4 Agent Gateway

Agent Gateway 为不同 Harness 提供统一的能力探测、会话、流式事件、Tool Call、审批、取消和恢复接口：

- Codex 可以作为 Desktop 内的本地 Agent，也可以从外部调用 OpenMovie Tools。
- Claude Code 和其他兼容 Harness 优先通过公开结构化接口或 OpenMovie MCP Server 接入。
- OpenMovie 提供不依赖外部 Coding Harness 的 Direct/Embedded Adapter，保证基础体验可用。
- 不解析交互式终端界面，不把第三方 Harness 的私有会话作为唯一任务状态。

### 15.5 Provider Gateway

Provider Gateway 将模型服务分为两类：

1. LLM 与多模态理解：文本生成、结构化输出、图片理解和视频分析，统一为 OpenMovie Multimodal Request/Response，并提供 OpenAI-compatible、Responses 风格和自定义协议适配器。
2. 媒体生成：图片生成、图片编辑和视频生成，统一为异步 Job、进度、取消、Artifact、费用和来源记录，不强制套用普通聊天响应。

用户可以为文本规划、图片理解、视频分析、图片生成和视频生成分别选择默认 Provider、Model 与备用路由。视频生成允许同时配置多个 API，根据 Shot 所需能力、质量、成本和可用性选择。

## 16. MVP 范围

MVP 目标不是自动生成一部长片，而是证明一个短场景可以完成完整的“定义—构建—验证—反馈—修改”闭环。

### 16.1 MVP 必须具备

- 一个可版本管理的 Movie IR Schema。
- Windows 与 macOS 桌面应用，无需终端即可完成 MVP 主路径。
- Task、Thread、Run、Approval 与可恢复执行状态。
- 可替换的 Agent Gateway、至少一个本地 Harness Adapter 和 Direct/Embedded 降级路径。
- OpenMovie MCP Server，供外部兼容 Harness 调用类型化 Tools。
- 可配置的 Provider Gateway；没有外部 Harness 时，可以使用 API Provider 驱动内置 Agent。
- 至少支持一种 OpenAI-compatible 文本/多模态 Provider 配置和一种自定义 Provider 配置。
- 图片理解和基于关键帧、音轨与元数据的视频分析流程。
- 图片生成与视频生成使用独立异步 Adapter，并允许配置多个视频生成 API。
- 线性 Revision、自动保存、语义版本对比、历史恢复和不可变 Take。
- Project、Character、Scene、Shot、Take、Asset、Constraint、Evaluation、Feedback 和 BuildRecord。
- 至少一个图像生成和一个视频生成适配器。
- 从 Shot 构建多个 Take，并选择采用版本。
- 内容哈希、缓存和基础增量构建。
- 模型、参数、Seed、输入素材和输出的完整溯源。
- 基础静态验证、媒体技术检查和至少一种连续性评测。
- 绑定 Shot 与时间码的反馈。
- Agent 将一条反馈转换成 Patch，重新构建并提交前后对比。
- 预算限制、对象锁定和人工批准。
- CLI 与基础可视化 Workbench。

### 16.2 MVP 演示场景

一个包含同一角色、同一地点和连续动作的三镜头场景：

1. 用户定义角色、场景目标和三个镜头。
2. OpenMovie 生成候选 Take 并组装预览。
3. 系统发现第二个镜头的角色一致性低于阈值。
4. 用户补充反馈：“角色不像上一个镜头。”
5. Agent 定位角色参考和生成配置，提交修改 Patch。
6. 系统只重新生成第二个镜头。
7. 自动评测显示身份一致性提高，其他测试未退化。
8. 用户查看前后对比并批准新 Take。

### 16.3 MVP 验收标准

- 用户能通过稳定 ID 精确定位任一 Scene、Shot、Take 和反馈。
- 用户无需理解 Git 即可保存、比较和恢复电影工程版本。
- 任一预览片段都能追溯到 Movie IR、素材、模型、参数和构建记录。
- 修改一个 Shot 时，不会无故重新生成无依赖关系的 Shot。
- 同一输入和执行配置可被复现；若底层服务不保证确定性，系统必须明确显示该限制。
- 失败测试能够指向具体对象、证据位置和可理解的原因。
- Agent 的任何修改都以可查看、可拒绝、可回滚的 Patch 呈现。
- Agent 能针对一个镜头级反馈完成至少一次闭环修复并提供评测证据。
- 未经批准，Agent 不能突破费用、迭代次数、对象锁定或发布权限。

## 17. 成功指标

早期产品优先衡量工程闭环，而不是单纯衡量生成数量：

- 可追溯率：最终时间线中的媒体是否具有完整生成链路。
- 增量构建命中率：修改后复用的有效缓存比例。
- 局部修改率：反馈是否在不重建无关镜头的情况下完成。
- 反馈闭环时间：从提出问题到获得已验证候选修改的时间。
- 回归发现率：修改造成的其他质量退化被自动发现的比例。
- Agent 提案接受率：用户批准或基于提案继续编辑的比例。
- 单个已采用镜头的生成时间和成本。
- 可复现性：在供应商能力允许范围内重建相同结果或等价结果的成功率。

具体目标值应在获得真实项目基线后确定，避免用缺乏依据的数字驱动产品。

## 18. 权利、安全与治理

- Asset 应记录来源、作者、许可、使用范围和到期时间。
- 模型和适配器应记录使用条款及内容限制。
- 角色身份、声音和肖像素材需要明确授权信息。
- 敏感内容和发布动作需要可配置的审核策略。
- 项目应支持对生成内容和外部素材进行来源披露。
- Agent 的外部调用、文件修改、费用和审批必须进入审计记录。
- 开源核心不应把用户锁定到单一模型供应商或云平台。

## 19. 关键产品决策

当前已确定：

- OpenMovie 是电影生成 Harness，而不是单模型客户端。
- Movie IR 是源代码，模型提示词是编译产物。
- Shot 表达期望，Take 表达一次具体生成结果。
- 生成产物默认不可变，选择和提升采用版本是显式操作。
- 依赖图、溯源和评测是一等能力，不是后期附加功能。
- Agent 通过 Patch 和验证工作，不能静默覆盖项目。
- Windows 与 macOS 是同一产品的一等平台，使用相同项目格式和核心语义。
- 对话是低门槛入口，结构化 Movie IR、Task、Run 和 Revision 是持久化结果。
- Agent Harness 通过统一 Gateway 接入并可替换，OpenMovie Core 是工程事实来源。
- 没有安装 Codex 或 Claude Code 时，用户仍能打开、编辑、验证和导出项目，并可使用 Direct/Embedded Adapter。
- Agent Harness 与模型 Provider 解耦；用户可以独立配置规划、理解和媒体生成服务。
- OpenAI-compatible 是重要兼容协议，但不是 Movie IR 或 Provider Gateway 的唯一内部格式。
- 视频分析默认可由抽帧、音频转写和多模态归纳组成；Provider 原生支持视频输入时可由能力协商启用。
- 图片和视频生成采用统一异步媒体任务语义，并允许多个 Provider 共存。
- OpenMovie Revision 面向电影语义并可映射到 Git，但不要求普通用户理解 Git。
- Movie IR 进行结构化合并，媒体对象保持不可变且不进行二进制合并。
- 审美评价保留评分、比较和人工决策，不伪装成绝对真值。

## 20. 待验证问题

- 项目导出、远程 Object Store 和 Git LFS 的边界如何随协作需求演进。
- Claude Code 等第三方 Harness 可用于 Desktop 深度嵌入的稳定结构化接口和支持范围。
- OpenAI-compatible Chat Completions、Responses 风格和不同聚合服务之间的兼容级别如何定义。
- 自定义 Provider 的声明式映射能力边界，以及何时必须编写代码 Adapter。
- 多个视频生成 Provider 的能力、费用和质量如何建立可比较的路由指标。
- 如何定义跨供应商的通用生成意图，同时保留模型特有能力。
- 哪些评测适合本地执行，哪些需要多模态模型或云端服务。
- 如何校准多模态评测器，避免评分漂移和被 Agent 投机优化。
- Timeline 应由 OpenMovie 原生管理到什么程度，何时与现有 NLE 交换 EDL、OTIO 或其他格式。
- 多人协作中的对象锁定、分支、合并和冲突应如何呈现。
- 如何在可复现性、生成多样性、质量、速度和成本之间提供清晰策略。

## 21. 最终产品判断标准

当 OpenMovie 能稳定回答以下问题时，产品核心成立：

1. 这一个画面为什么会生成成现在这样？
2. 修改这个创作意图，会影响哪些内容和多少成本？
3. 当前版本违反了哪些技术、连续性或创作目标？
4. 用户的一条反馈能否变成可执行的修改和可复用的测试？
5. AI 修改之后，能否用证据说明问题已改善且没有明显回归？
6. 人类能否在任何关键节点理解、限制、拒绝或回滚 AI 的行为？

OpenMovie 的核心竞争力不是生成更多视频，而是建立一套让电影能够像软件一样持续构建、测试、调试和演进的开放工程系统。
