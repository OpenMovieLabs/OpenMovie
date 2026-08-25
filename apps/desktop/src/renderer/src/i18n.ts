export type UiLocale = 'en' | 'zh-CN';

const en = {
  settings: 'Settings',
  project: 'Project',
  movieProject: 'Movie project',
  overview: 'Overview',
  story: 'Story',
  characters: 'Characters',
  scenes: 'Scenes',
  shots: 'Shots',
  timeline: 'Timeline',
  tests: 'Tests',
  giveTask: 'Give OpenMovie a task',
  homeEyebrow: 'AI-native filmmaking workspace',
  homeTitle: 'Build films like software.',
  homeSubtitle: 'Plan, generate, test, compare, and revise every shot in one inspectable project.',
  newMovie: 'New movie',
  openProject: 'Open project',
  recentProjects: 'Recent projects',
  continueMovie: 'Continue a movie',
  noMovies: 'Your movies will appear here',
  noMoviesHelp: 'Create a structured movie project, then give OpenMovie a goal in plain language.',
  startingCore: 'Starting OpenMovie Core…',
  coreUnavailable: 'Core unavailable: {{message}}',
  language: 'Language',
  english: 'English',
  chinese: '简体中文',
  application: 'Application',
  close: 'Close',
  skipToContent: 'Skip to main content',
  busy: 'OpenMovie is working',
} as const;

export type TranslationKey = keyof typeof en;

const zh: Record<TranslationKey, string> = {
  settings: '设置',
  project: '工程',
  movieProject: '电影工程',
  overview: '概览',
  story: '故事',
  characters: '角色',
  scenes: '场景',
  shots: '镜头',
  timeline: '时间线',
  tests: '测试',
  giveTask: '给 OpenMovie 一个任务',
  homeEyebrow: 'AI 原生电影创作工作台',
  homeTitle: '像开发软件一样制作电影。',
  homeSubtitle: '在一个可检查的工程中规划、生成、测试、对比并迭代每个镜头。',
  newMovie: '新建电影',
  openProject: '打开工程',
  recentProjects: '最近工程',
  continueMovie: '继续创作',
  noMovies: '你的电影工程会显示在这里',
  noMoviesHelp: '创建结构化电影工程，然后用自然语言告诉 OpenMovie 你的目标。',
  startingCore: '正在启动 OpenMovie Core…',
  coreUnavailable: 'Core 不可用：{{message}}',
  language: '界面语言',
  english: 'English',
  chinese: '简体中文',
  application: '应用',
  close: '关闭',
  skipToContent: '跳到主要内容',
  busy: 'OpenMovie 正在工作',
};

const catalogs: Record<UiLocale, Record<TranslationKey, string>> = { en, 'zh-CN': zh };

export function detectUiLocale(language: string): UiLocale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function translate(
  locale: UiLocale,
  key: TranslationKey,
  values: Record<string, string> = {},
): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    catalogs[locale][key],
  );
}
