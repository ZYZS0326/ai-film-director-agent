export type Intent = 'new_brief' | 'revision' | 'question' | 'chat' | 'continue'

export interface SkillMeta {
  id: string
  name: string
  role: string
  stage: number
  outputKey: string
  description: string
  triggers: string[]
}

export interface Constraints {
  duration?: number
  aspect?: string
  level?: number
  platforms?: string[]
  language?: string
}

/** 剧本等级 1-5 */
export interface ScriptLevel {
  id: number
  key: string
  name: string
  desc: string
  length: string
  contains: string[]
}

/** 时长模式 */
export interface DurationMode {
  id: string
  duration: number
  label: string
  mode: 'short' | 'medium' | 'feature'
  scenes: string
  shots: string
  note: string
}

export interface Shot {
  locked?: boolean
  no: number
  start: number
  end: number
  duration: number
  sceneNo?: number
  shotSize: string
  angle?: string
  camera?: string
  lens?: string
  movement?: string
  composition?: string
  subject?: string
  action?: string
  expression?: string
  environment?: string
  lighting?: string
  color?: string
  material?: string
  sound?: string
  emotion?: string
  transition?: string
  promptZh?: string
  promptEn?: string
  negative?: string
}

export interface PromptData {
  characterLock?: { zh: string; en: string }
  sceneAssets?: { name: string; promptZh: string; promptEn: string }[]
  imageAssets?: { assetId: string; type: string; sheet: string; aspectRatio: string; promptZh: string; promptEn?: string; negative?: string; inheritsFrom?: string[]; lockedFacts?: string[]; allowedChange?: string }[]
  keyframes?: { shotNo: number; phase: string; assetIds: string[]; aspectRatio: string; promptZh: string; promptEn?: string; negative?: string; motionNote?: string }[]
  shots?: { no: number; start: number; end: number; promptZh: string; promptEn: string; negative?: string; platform?: string }[]
}

/**
 * 连续性圣经（Continuity Bible）的结构化形态。
 * 由 continuity 环节产出，锁定跨镜头必须逐字复用的描述片段与核对规则。
 */
export interface ContinuityData {
  lockZh?: string
  lockEn?: string
  characters?: { name: string; appearance: string; age: string; clothing: string; marks: string }[]
  environments?: { scene: string; time: string; light: string; spatial: string }[]
  props?: { name: string; position: string; state: string; shots: string }[]
  rules?: string[]
}

/** 提示词 13 要素校验结果 */
export interface PromptValidation {  banned: string[]
  elements: { id: string; name: string; present: boolean }[]
  covered: number
  total: number
}

export interface Memory {
  preferences: string[]
  revisions: { instruction: string; at: number }[]
  decisions: string[]
}

export interface SessionState {
  editorNotes?: { storyboard?: string; prompts?: string }
  editVersion?: number
  versions?: { id: string; at: number; label: string }[]
  generationMode?: 'llm' | 'demo'
  productionChecks?: { ok: boolean; targetDuration: number; actualDuration: number; issues: { code: string; message: string }[] }
  pendingSkills?: string[]
  id: string
  title: string
  brief: string
  constraints: Constraints
  outputs: Record<string, string>
  shots: Shot[]
  promptData: PromptData | null
  continuityData?: ContinuityData | null
  promptValidation?: PromptValidation | null
  reviewScores?: { name: string; score: number }[] | null
  stageReviews?: Record<string, StageReview>
  pipeline: string[]
  skillHistory?: string[]
  memory: Memory
}

export interface StageReview {
  status: 'pass' | 'warn' | 'block' | 'unverified'
  issues: { code: string; evidence: string; suggestion: string; severity: string }[]
  outputHash: string
  at: number
  kind: string
  note?: string
}

export interface SessionSummary {
  id: string
  title: string
  updatedAt: number
  brief: string
  pipeline: string[]
  hasOutput: boolean
}

export interface Settings {
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  contextWindow: number
  presetId: string
  provider: string
  roleModels: Record<string, { provider: string; model: string }>
  roles: { id: string; name: string }[]
  providerConfigs: Record<string, { baseUrl: string; model: string; hasKey: boolean; fallbackModels?: string[] }>
  fallbackModels?: string[]
  theme: 'dark' | 'light'
  hasKey: boolean
  keyMask: string
  presets: { id: string; name: string; baseUrl: string; model: string; note: string; fallbackModels?: string[]; models: { id: string; label?: string }[] }[]
  mode: 'llm' | 'demo'
}

export interface PlanEvent {
  intent: Intent
  skills: string[]
  skillNames: { id: string; name: string; role: string; stage: number }[]
  reasoning: string
  constraints: Constraints
  mode: 'llm' | 'demo'
}

export interface KnowledgeEvent {
  genres: string[]
  moods: string[]
  conflict?: string
  positioning?: string
  styles: { id: string; name: string; summary: string }[]
  directors: { id: string; name: string; signature: string; reasons: string[] }[]
  structures?: { id: string; name: string; reasons: string[] }[]
  visualSystems?: string[]
  colors?: string[]
  aspectRatio?: string
  durationMode?: string
  scriptLevel?: string
  films: string[]
}

export interface StageRun {
  skill: string
  name: string
  role: string
  stage: number
  index: number
  total: number
  status: 'running' | 'done' | 'error'
  text: string
  parsed?: Record<string, unknown> | null
}

export type ChatItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'plan'; plan: PlanEvent; at: number }
  | { kind: 'knowledge'; data: KnowledgeEvent; at: number }
  | { kind: 'stage'; run: StageRun; at: number }
  | { kind: 'answer'; text: string; done: boolean; at: number }
  | { kind: 'error'; text: string; at: number }

export interface KnowledgeStats {
  referenceCards?: { id: string; title: string; domain: string; stages: string[]; tags: string[]; method: string; deliverable: string; check: string; pitfall: string; sourceIds: string[]; provenance: string }[]
  referenceSources?: { id: string; title: string; publisher: string; url: string; scope: string; checkedAt: string; verification: string }[]
  referenceDomains?: { id: string; name: string }[]
  stats: Record<string, number>
  directors: {
    id: string; name: string; nameEn: string; nationality: string; era: string
    philosophy: string; narrative: string[]; lensLanguage: string[]
    themes: string[]; aesthetic: string; filmAnalyses: { title: string; year: number; analysis: string }[]
    method: string; signature: string; tags: string[]; bestFor: string[]; avoidWhen: string
  }[]
  films: {
    id: string; title: string; titleEn: string; year: number; director: string
    tags: string[]; genre: string[]; logline: string; learnFrom: string[]
  }[]
  styles: {
    id: string; name: string; category: string; summary: string; rationale: string
    visual: Record<string, string>; fit: string[]; avoidWhen: string
  }[]
  genres: {
    id: string; name: string; structure: string; expectation: string
    failurePoints: string[]; visual: string; examples: string[]
  }[]
  platforms: {
    id: string; name: string; type: string; lang: string; structure: string[]
    notes: string; styleTag: string; negativeHint: string; maxLength: number
    tasks?: { id: string; name: string; input: string }[]
    license?: string
  }[]
  promptElements: { id: string; name: string; desc: string }[]
  bannedWords: string[]
  structures: {
    id: string; name: string; definition: string; beats: string[]; fitGenres: string[]
    pros: string[]; cons: string[]; cases: string[]; difficulty: number
  }[]
  cameras: { id: string; name: string; sensor: string; note: string; psychology: string; bestFor: string[] }[]
  lenses: { id: string; name: string; fov: string; effect: string; psychology: string; use: string[]; cases: string[] }[]
  shotSizes: { id: string; name: string; en: string; emotion: string; scene: string; cases: string[] }[]
  movements: { id: string; name: string; emotion: string; scene: string; cases: string[] }[]
  aspectRatios: {
    id: string; name: string; value: number; label: string
    composition: string; lens: string; narrative: string; strength: string; weakness: string; bestFor: string[]
  }[]
  colors: { id: string; name: string; meaning: string; nuance: string; usage: string; caution: string; cases: string[] }[]
  visualSystems: {
    id: string; name: string; origin: string; philosophy: string; palette: string
    light: string; material: string; composition: string; lens: string; sound: string; bestFor: string[]; cases: string[]
  }[]
  materials: { id: string; name: string; mood: string[]; desc: string; cases?: string[] }[]
  scriptLevels: ScriptLevel[]
  durationModes: DurationMode[]
  editing: { id: string; name: string; desc: string; cases?: string[] }[]
  sound: { id: string; name: string; desc: string; cases?: string[] }[]
  checks: { id: string; category: string; name: string; question: string; weight: number }[]
}
