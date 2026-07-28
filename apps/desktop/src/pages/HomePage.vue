<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, type ApprovalDto, type DoctorReportDto, type EventEnvelope, type MessageDto, type OrchestrationSnapshotDto, type PiArtifactDto, type PiModelDto, type PiSessionStateDto, type PiThinkingLevel, type ProjectDto, type RuntimeReadinessReceiptDto, type SessionDto, type ToolExecutionTimelineItemDto } from '../api'
import { basenameFromPath } from '../format'
import AppSidebar from '../components/AppSidebar.vue'
import AppHeader from '../components/AppHeader.vue'
import ChatPanel from '../components/ChatPanel.vue'
import ContextPanel from '../components/ContextPanel.vue'
import { useAgentActivity } from '@/composables/useAgentActivity'
import { useBackground } from '@/composables/useBackground'
import { usePanelStyles } from '@/composables/usePanelStyles'
import { useNotifications } from '@/composables/useNotifications'
import type { AgentMode, PermissionLevel } from '../types/mode'

const router = useRouter()
const { t } = useI18n()
const { notify, banner, dismissByKey } = useNotifications()

// ponytail: nested page+main-rise transitions left Home blank after Settings→Home.
// App.vue already owns route transitions; keep Home shell always painted.

const projects = ref<ProjectDto[]>([])
const sessions = ref<SessionDto[]>([])
const messages = ref<MessageDto[]>([])
const approvals = ref<ApprovalDto[]>([])
const events = ref<EventEnvelope[]>([])
const doctor = ref<DoctorReportDto | null>(null)
const readiness = ref<RuntimeReadinessReceiptDto | null>(null)
const orchestration = ref<OrchestrationSnapshotDto | null>(null)
const piModels = ref<PiModelDto[]>([])
const selectedPiModel = ref<PiModelDto | null>(null)
const thinkingLevel = ref<PiThinkingLevel>('medium')
const thinkingLevels = ref<PiThinkingLevel[]>(['off', 'minimal', 'low', 'medium', 'high'])
const piSessionState = ref<PiSessionStateDto | null>(null)
const toolExecutions = ref<ToolExecutionTimelineItemDto[]>([])
const artifactsByRun = ref<Record<string, PiArtifactDto[]>>({})

const selectedProjectId = ref<string | null>(null)
const selectedSessionId = ref<string | null>(null)
const pendingSessionId = ref<string | null>(null)
const draft = ref('')
const modelName = ref('')
const shellCommand = ref('npm test')
const busy = ref(false)
const streamingAssistant = ref<MessageDto | null>(null)
const streamingStatus = ref('')
const eventSource = ref<EventSource | null>(null)
const rightRailCollapsed = ref(false)
const rightRailWidth = ref(420)
const currentMode = ref<AgentMode>('auto')
const currentPermission = ref<PermissionLevel>('default')

const currentProject = computed(() => projects.value.find((project) => project.id === selectedProjectId.value) ?? null)
const currentSession = computed(() => sessions.value.find((session) => session.id === selectedSessionId.value) ?? null)
const recentEvents = computed(() => events.value.slice(-8).reverse())
// ---- Agent activity (moved from ChatPanel; data shared with both chat and sidebar) ----
const sessionIdRef = computed(() => currentSession.value?.id ?? null)
const {
  activity: agentActivity,
  toolCalls: agentToolCalls,
  thinkingSteps: agentThinkingSteps,
  agentStates: agentStatesMap,
  progressEvents: agentProgressEvents,
  appendThinkingDelta,
} = useAgentActivity(sessionIdRef, orchestration)

const displayMessages = computed(() => streamingAssistant.value
  ? [...messages.value, streamingAssistant.value]
  : messages.value
)
const isPiRunning = computed(() =>
  ['thinking', 'working', 'waiting_approval'].includes(agentActivity.value.status),
)
const hasSelectedPiModel = computed(() => selectedPiModel.value !== null)

// ---- Background customization ----
// useBackground returns a singleton ref shared with App.vue (which renders
// the background layer globally) and the Settings appearance section.
const {
settings: backgroundSettings,
} = useBackground()

// ---- Panel styles (global material effect) ----
// All panels share the same global material setting.
// Styles are applied via reactive :style bindings (getPanelStyle returns
// a computed style object). No direct DOM manipulation needed.
const {
getPanelStyle,
getPanelDataAttributes,
} = usePanelStyles()

// Compute background style for the shell
const backgroundStyle = computed(() => {
  if (backgroundSettings.value.type === 'none') {
    return {}
  }
  
  const style: Record<string, string> = {
    position: 'relative',
    minHeight: '100vh',
  }
  
  return style
})
// Global material style — shared by all panels
const sidebarStyle = computed(() => getPanelStyle())
const sidebarDataAttrs = computed(() => getPanelDataAttributes())

const chatPanelStyle = computed(() => getPanelStyle())
const chatPanelDataAttrs = computed(() => getPanelDataAttributes())

const contextPanelStyle = computed(() => getPanelStyle())
const contextPanelDataAttrs = computed(() => getPanelDataAttributes())

function generateTitle(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return t('chat.newChat')
  const firstLine = trimmed.split('\n')[0]
  if (firstLine.length <= 50) return firstLine
  return firstLine.substring(0, 47) + '...'
}

async function run(label: string, action: () => Promise<void>) {
  busy.value = true
  try {
    await action()
  } catch (err) {
    notify.error(err, { title: `${label} failed` })
  } finally {
    busy.value = false
  }
}

async function loadInitial() {
  busy.value = true
  try {
    const [projectList, report, readinessReceipt] = await Promise.all([
      api.listProjects(),
      api.doctor(),
      api.readiness(),
    ])
    projects.value = projectList
    doctor.value = report
    readiness.value = readinessReceipt
    selectedProjectId.value = projectList[0]?.id ?? null
    await loadSessions()
    await loadPiModels()
    dismissByKey('home-load')
  } catch (err) {
    banner.error({
      key: 'home-load',
      title: t('app.loadFailed'),
      message: t('app.loadFailedMessage'),
      details: err instanceof Error ? err.message : t('app.loadFailed'),
      action: { label: t('app.retry'), run: () => loadInitial() },
    })
  } finally {
    busy.value = false
  }
}

async function loadSessions() {
  if (projects.value.length === 0) {
    sessions.value = []
    selectedSessionId.value = null
    return
  }

  const allSessions = await Promise.all(
    projects.value.map((p) => api.listSessions(p.id))
  )
  sessions.value = allSessions.flat()

  if (!selectedProjectId.value) {
    selectedSessionId.value = null
    return
  }

  const projectSessions = sessions.value.filter((s) => s.project_id === selectedProjectId.value)
  if (!projectSessions.find((s) => s.id === selectedSessionId.value)) {
    selectedSessionId.value = projectSessions[0]?.id ?? null
  }
}

async function loadMessagesAndApprovals() {
  if (!selectedSessionId.value) {
    messages.value = []
    approvals.value = []
    orchestration.value = null
    toolExecutions.value = []
    return
  }

  const [messageList, approvalList, orchestrationSnapshot, toolTimeline] = await Promise.all([
    api.listMessages(selectedSessionId.value),
    api.listApprovals(selectedSessionId.value),
    api.getOrchestrationSnapshot(selectedSessionId.value),
    api.listToolExecutions(selectedSessionId.value, { limit: 12 }),
  ])
  const runIds = [...new Set(messageList.map((message) => message.run_id).filter((id): id is string => Boolean(id)))]
  const artifactResults = await Promise.allSettled(
    runIds.map(async (runId) => [runId, await api.listPiRunArtifacts(selectedSessionId.value!, runId)] as const),
  )
  artifactsByRun.value = Object.fromEntries(
    artifactResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
  )
  messages.value = messageList
  approvals.value = approvalList
  orchestration.value = orchestrationSnapshot
  toolExecutions.value = toolTimeline
}

const DEFAULT_THINKING_LEVELS: PiThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high']
const PI_THINKING_LEVELS = new Set<PiThinkingLevel>([
  'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max',
])

function modelKey(model: Pick<PiModelDto, 'provider' | 'id'>): string {
  return `${model.provider ?? ''}\u0000${model.id ?? ''}`
}

function modelLabel(model: PiModelDto | null | undefined): string {
  if (!model || model.id === 'unknown') return ''
  return model.name || [model.provider, model.id].filter(Boolean).join('/')
}

function modelThinkingLevels(model: PiModelDto | null): PiThinkingLevel[] {
  return model?.reasoning ? DEFAULT_THINKING_LEVELS : ['off']
}

function applyThinkingState(state: { thinking_level?: unknown; thinking_levels?: unknown }) {
  const supported = Array.isArray(state.thinking_levels)
    ? state.thinking_levels.filter((level): level is PiThinkingLevel =>
      typeof level === 'string' && PI_THINKING_LEVELS.has(level as PiThinkingLevel),
    )
    : []
  thinkingLevels.value = supported.length > 0 ? supported : modelThinkingLevels(selectedPiModel.value)
  const current = state.thinking_level
  thinkingLevel.value = typeof current === 'string' && PI_THINKING_LEVELS.has(current as PiThinkingLevel)
    ? current as PiThinkingLevel
    : thinkingLevels.value.includes(thinkingLevel.value)
      ? thinkingLevel.value
      : thinkingLevels.value[0] ?? 'off'
}

function rememberPiModel(model: PiModelDto | null) {
  selectedPiModel.value = model
  modelName.value = modelLabel(model)
  if (model?.provider && model.id) localStorage.setItem('tinadec-selected-pi-model', modelKey(model))
  else localStorage.removeItem('tinadec-selected-pi-model')
}

async function loadPiModels() {
  const sessionId = selectedSessionId.value
  try {
    const [models, state] = await Promise.all([
      api.listPiModels(sessionId ?? undefined),
      sessionId ? api.getPiState(sessionId) : Promise.resolve(null),
    ])
    piModels.value = models.filter((model) => model.id !== 'unknown')
    const stateModel = state?.model
    const current = stateModel && typeof stateModel === 'object'
      ? piModels.value.find((model) => modelKey(model) === modelKey(stateModel as PiModelDto)) ?? stateModel as PiModelDto
      : null
    const remembered = localStorage.getItem('tinadec-selected-pi-model')
    const selected = current
      ?? piModels.value.find((model) => modelKey(model) === modelKey(selectedPiModel.value ?? {}))
      ?? piModels.value.find((model) => modelKey(model) === remembered)
      ?? null
    rememberPiModel(selected)
    piSessionState.value = state
    if (state) applyThinkingState(state)
    else applyThinkingState({})
  } catch {
    piSessionState.value = null
    piModels.value = []
    if (!selectedPiModel.value) modelName.value = ''
    applyThinkingState({})
  }
}

async function selectModel(model: PiModelDto) {
  const provider = model.provider
  const modelId = model.id
  if (!provider || !modelId) return
  rememberPiModel(model)
  applyThinkingState({})
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  await run('select Pi model', async () => {
    const selected = await api.selectPiModel(sessionId, provider, modelId)
    rememberPiModel(selected ?? model)
    applyThinkingState(await api.getPiState(sessionId))
  })
}

async function selectThinkingLevel(level: PiThinkingLevel) {
  thinkingLevel.value = level
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  await run('select Pi thinking level', async () => {
    const selected = await api.setPiThinkingLevel(sessionId, level)
    applyThinkingState(selected)
  })
}

async function applyRuntimePreferences(sessionId: string) {
  const model = selectedPiModel.value
  if (!model?.provider || !model.id) {
    throw new Error(t('chat.selectModelFirst'))
  }
  const selected = await api.selectPiModel(sessionId, model.provider, model.id)
  rememberPiModel(selected ?? model)
  const thinking = await api.setPiThinkingLevel(sessionId, thinkingLevel.value)
  applyThinkingState(thinking)
}

async function openProject() {
  await run('open project', async () => {
    const path = await window.tinadec.openProjectDialog()
    if (!path) return

    const project = await api.createProject(basenameFromPath(path), path)
    projects.value = [project, ...projects.value.filter((item) => item.id !== project.id)]
    selectedProjectId.value = project.id
  })
}

async function createSession(projectId: string) {
  if (pendingSessionId.value) {
    const existing = sessions.value.find((s) => s.id === pendingSessionId.value)
    if (existing && existing.project_id === projectId) {
      selectedSessionId.value = pendingSessionId.value
      selectedProjectId.value = projectId
      return
    }
  }

  await run('create session', async () => {
    const session = await api.createSession(projectId, 'Tinadec session')
    sessions.value = [session, ...sessions.value]
    selectedSessionId.value = session.id
    selectedProjectId.value = projectId
    pendingSessionId.value = session.id
    if (selectedPiModel.value) await applyRuntimePreferences(session.id)
  })
}

async function sendMessage() {
  const content = draft.value.trim()
  if (!content) return
  if (isPiRunning.value) {
    await steerCurrentRun(content)
    return
  }
  await handleSend(content)
}

async function steerCurrentRun(content: string) {
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  try {
    await api.steerPi(sessionId, content)
    draft.value = ''
  } catch (error) {
    notify.error(error, { title: t('chat.steer') })
  }
}

async function handleWelcomeSend(content: string) {
  await handleSend(content)
}

function streamMessage(sessionId: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    api.invokeStream(
      sessionId,
      content,
      (chunk) => {
        if (chunk.kind === 'run_started') {
          streamingStatus.value = chunk.mode === 'space'
            ? 'DmaEA 已接收任务，正在组织分布式智能体协作。'
            : 'Pi 已接收任务，正在准备回答。'
        }
        if (chunk.kind === 'thinking_delta' && chunk.delta) {
          streamingStatus.value = '模型思考中。'
          appendThinkingDelta(chunk.delta)
        }
        if (chunk.kind === 'tool_call_delta') {
          streamingStatus.value = `正在调用 ${chunk.tool_id ?? '工具'}。`
        }
        if (chunk.kind === 'tool_execution') {
          const toolLabel = chunk.tool_id ?? '工具'
          streamingStatus.value = chunk.status === 'failed'
            ? `${toolLabel} 执行失败。`
            : chunk.status === 'completed'
              ? `${toolLabel} 已完成。`
              : `${toolLabel} 执行中。`
        }
        if (chunk.kind === 'artifact_created') {
          streamingStatus.value = `${chunk.title ?? 'Markdown 产物'} 已生成。`
        }
        if (chunk.kind === 'delta' && chunk.delta && streamingAssistant.value) {
          streamingStatus.value = '正在生成回答。'
          streamingAssistant.value = {
            ...streamingAssistant.value,
            content: streamingAssistant.value.content + chunk.delta,
          }
        }
        if (chunk.kind === 'error') {
          if (chunk.finish_reason === 'cancelled') {
            // User-initiated abort: not an error. Partial output is persisted server-side.
            resolve()
          } else {
            reject(new Error(chunk.safe_error_message ?? 'Pi invocation failed'))
          }
        }
        if (chunk.kind === 'done') resolve()
      },
      reject,
      resolve,
      currentMode.value,
    )
  })
}

async function handleSend(content: string) {
  await run('send message', async () => {
    if (!selectedPiModel.value) throw new Error(t('chat.selectModelFirst'))
    let sessionId = selectedSessionId.value

    if (!sessionId && selectedProjectId.value) {
      const session = await api.createSession(selectedProjectId.value, 'Tinadec session')
      sessions.value = [session, ...sessions.value]
      selectedSessionId.value = session.id
      sessionId = session.id
      pendingSessionId.value = session.id
    }

    if (!sessionId) {
      throw new Error('Open a project before sending a message.')
    }

    await applyRuntimePreferences(sessionId)
    draft.value = ''
    streamingStatus.value = '正在创建 Pi 运行。'
    streamingAssistant.value = {
      id: `stream-${Date.now()}`,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString()
    }
    try {
      await streamMessage(sessionId, content)

      if (pendingSessionId.value === sessionId) {
        const title = generateTitle(content)
        try {
          await api.updateSessionTitle(sessionId, title)
        } catch {
          // Title persistence is best-effort; local list still updates below.
        }
        const idx = sessions.value.findIndex((s) => s.id === sessionId)
        if (idx !== -1) {
          sessions.value[idx] = { ...sessions.value[idx], title }
        }
        pendingSessionId.value = null
      }
    } finally {
      // Always reload: the user message (and any partial assistant output on
      // abort/failure) is already persisted server-side.
      await loadMessagesAndApprovals().catch(() => undefined)
      streamingAssistant.value = null
      streamingStatus.value = ''
    }
  })
}

async function abortCurrentRun() {
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  await run('interrupt Pi run', async () => {
    await api.abortPi(sessionId)
  })
}

function continueArtifact(artifact: PiArtifactDto) {
  currentMode.value = artifact.kind === 'spec' ? 'plan' : 'agent'
  draft.value = artifact.kind === 'spec'
    ? '基于上一条规范生成可执行规划，并明确文件、步骤、验证和风险。'
    : '执行上一条已批准的规划。先核对当前工作区状态，完成后报告改动、验证和剩余风险。'
}

async function downloadArtifact(artifact: PiArtifactDto) {
  const sessionId = selectedSessionId.value
  if (!sessionId) return
  try {
    const source = await api.getPiArtifact(sessionId, artifact.id)
    const url = URL.createObjectURL(new Blob([source.content ?? ''], { type: 'text/markdown' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${artifact.kind}-${artifact.run_id}.md`
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    notify.error(error, { title: artifact.title })
  }
}

async function requestShellApproval() {
  await run('request approval', async () => {
    const approval = await api.createShellApproval(selectedSessionId.value, shellCommand.value, currentProject.value?.path)
    approvals.value = [approval, ...approvals.value]
  })
}

async function decideApproval(approval: ApprovalDto, decision: 'approved' | 'rejected') {
  await run('decide approval', async () => {
    await api.decideApproval(approval.id, decision)
    await loadMessagesAndApprovals()
  })
}

function recordApproval(approval: ApprovalDto) {
  approvals.value = [approval, ...approvals.value.filter((item) => item.id !== approval.id)]
}

function reconnectEvents() {
  eventSource.value?.close()
  eventSource.value = api.connectEvents(selectedSessionId.value, async (event) => {
    const bySeq = new Map(events.value.map((item) => [item.seq, item]))
    bySeq.set(event.seq, event)
    events.value = [...bySeq.values()].sort((left, right) => left.seq - right.seq).slice(-80)
    if (
      event.type.startsWith('message.') ||
      event.type.startsWith('approval.') ||
      event.type.startsWith('tool.') ||
      event.type.startsWith('run.') ||
      event.type.startsWith('task') ||
      event.type.startsWith('supervision.') ||
      event.type.startsWith('context.') ||
      event.type.startsWith('step.')
    ) {
      await loadMessagesAndApprovals()
    }
  })
}

watch(selectedProjectId, () => {
  void loadSessions()
})

watch(selectedSessionId, (sessionId) => {
  if (sessionId) localStorage.setItem('tinadec-active-pi-session', sessionId)
  void loadMessagesAndApprovals()
  void loadPiModels()
  reconnectEvents()
})

onMounted(() => {
  void loadInitial()
  reconnectEvents()
})

onUnmounted(() => {
  eventSource.value?.close()
})
</script>

<template>
    <main class="shell" data-ark-theme="ark" data-ark-depth="moderate" :style="backgroundStyle">
      <!-- Background Layer is now rendered globally in App.vue, outside the page transition -->

      <!-- Full-width draggable bar for window dragging -->
      <div class="top-drag-bar" />

      <AppHeader :busy="busy" />

    <section
      class="workspace"
      :style="{
        '--chat-left': '268px',
        '--chat-right': rightRailCollapsed ? '52px' : `${rightRailWidth + 8}px`,
        '--chat-top': '40px',
        '--chat-bottom': '0px'
      }"
    >
      <ChatPanel
        :messages="displayMessages"
        :sessions="sessions"
        :projects="projects"
        :current-session="currentSession"
        :current-project="currentProject"
        :selected-project-id="selectedProjectId"
        :model-name="modelName"
        :models="piModels"
        :runtime-ready="hasSelectedPiModel"
        :thinking-level="thinkingLevel"
        :thinking-levels="thinkingLevels"
        :orchestration="orchestration"
        :artifacts-by-run="artifactsByRun"
        :streaming-status="streamingStatus"
        :activity-running="isPiRunning"
        :activity-thinking-steps="agentThinkingSteps"
        :activity-tool-calls="agentToolCalls"
        :busy="busy"
        :is-running="isPiRunning"
        :draft="draft"
        :mode="currentMode"
        :permission="currentPermission"
        :panel-style="chatPanelStyle"
        :panel-data-attrs="chatPanelDataAttrs"
        @update:draft="draft = $event"
        @update:mode="currentMode = $event"
        @update:permission="currentPermission = $event"
        @select-model="selectModel"
        @update:thinking-level="selectThinkingLevel"
        @download-artifact="downloadArtifact"
        @continue-artifact="continueArtifact"
        @send="sendMessage"
        @abort="abortCurrentRun"
        @welcome-send="handleWelcomeSend"
        @create-project="openProject"
        @select-project="selectedProjectId = $event"
      />

      <AppSidebar
        :projects="projects"
        :sessions="sessions"
        :selected-project-id="selectedProjectId"
        :selected-session-id="selectedSessionId"
        :busy="busy"
        :panel-style="sidebarStyle"
        :panel-data-attrs="sidebarDataAttrs"
        @select-project="selectedProjectId = $event"
        @select-session="selectedSessionId = $event"
        @create-session="createSession"
        @open-project="openProject"
        @go-market="router.push('/market')"
        @go-settings="router.push('/settings')"
      />

      <ContextPanel
        v-model:collapsed="rightRailCollapsed"
        v-model:width="rightRailWidth"
        :approvals="approvals"
        :events="recentEvents"
        :doctor="doctor"
        :readiness="readiness"
        :orchestration="orchestration"
        :tool-executions="toolExecutions"
        :shell-command="shellCommand"
        :busy="busy"
        :selected-session-id="selectedSessionId"
        :current-project-path="currentProject?.path"
        :agent-activity="agentActivity"
        :agent-states="agentStatesMap"
        :thinking-steps="agentThinkingSteps"
        :tool-calls="agentToolCalls"
        :progress-events="agentProgressEvents"
        :pi-session-state="piSessionState"
        :panel-style="contextPanelStyle"
        :panel-data-attrs="contextPanelDataAttrs"
        @request-approval="requestShellApproval"
        @decide-approval="decideApproval"
        @approval-created="recordApproval"
        @abort-run="abortCurrentRun"
        @update:shell-command="shellCommand = $event"
      />
    </section>
    </main>
</template>
