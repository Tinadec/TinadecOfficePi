<script setup lang="ts">
import { computed, ref } from 'vue'
import MessageList from './MessageList.vue'
import ComposerBar from './ComposerBar.vue'
import WelcomeScreen from './WelcomeScreen.vue'
import { useChatResponsiveMode } from '@/composables/useElementSize'
import type { MessageDto, SessionDto, ProjectDto, OrchestrationSnapshotDto, PiArtifactDto, PiModelDto, PiThinkingLevel } from '../api'
import type { AgentMode, PermissionLevel } from '@/types/mode'

const props = defineProps<{
  messages: MessageDto[]
  sessions: SessionDto[]
  projects: ProjectDto[]
  currentSession: SessionDto | null
  currentProject: ProjectDto | null
  selectedProjectId: string | null
  modelName: string
  models?: PiModelDto[]
  runtimeReady?: boolean
  thinkingLevel?: PiThinkingLevel
  thinkingLevels?: PiThinkingLevel[]
  orchestration: OrchestrationSnapshotDto | null
  artifactsByRun?: Record<string, PiArtifactDto[]>
  streamingStatus?: string
  busy: boolean
  isRunning?: boolean
  draft: string
  mode: AgentMode
  permission: PermissionLevel
  panelStyle?: Record<string, string>
  panelDataAttrs?: Record<string, string>
}>()

const emit = defineEmits<{
  'update:draft': [value: string]
  'update:mode': [value: AgentMode]
  'update:permission': [value: PermissionLevel]
  'select-model': [model: PiModelDto]
  'update:thinkingLevel': [level: PiThinkingLevel]
  'download-artifact': [artifact: PiArtifactDto]
  'continue-artifact': [artifact: PiArtifactDto]
  'send': []
  'welcome-send': [content: string]
  'create-project': []
  'select-project': [id: string]
  'approve': [approvalId: string]
  'reject': [approvalId: string]
}>()

// ---- Responsive mode detection for chat area ----
const conversationRef = ref<HTMLElement | null>(null)
const { mode: chatMode } = useChatResponsiveMode(conversationRef)

const conversationClass = computed(() => ({
  'chat-narrow': chatMode.value === 'narrow' || chatMode.value === 'ultra',
  'chat-ultra': chatMode.value === 'ultra',
}))

function handleApprove(approvalId: string) {
  emit('approve', approvalId)
}

function handleReject(approvalId: string) {
  emit('reject', approvalId)
}
</script>

<template>
  <section ref="conversationRef" class="conversation" :class="conversationClass">
    <Transition name="chat-panel" mode="out-in">
      <template v-if="messages.length === 0">
        <WelcomeScreen
          :projects="props.projects"
          :selected-project-id="selectedProjectId"
          :model-name="modelName"
          :models="models ?? []"
          :runtime-ready="runtimeReady ?? false"
          :thinking-level="thinkingLevel ?? 'off'"
          :thinking-levels="thinkingLevels ?? ['off']"
          :mode="mode"
          :permission="permission"
          :busy="busy"
          :panel-style="panelStyle"
          :panel-data-attrs="panelDataAttrs"
          @send="emit('welcome-send', $event)"
          @create-project="emit('create-project')"
          @select-project="emit('select-project', $event)"
          @update:mode="emit('update:mode', $event)"
          @update:permission="emit('update:permission', $event)"
          @select-model="emit('select-model', $event)"
          @update:thinking-level="emit('update:thinkingLevel', $event)"
        />
      </template>
      <template v-else>
        <div class="chat-active-panel" key="chat-active" :style="panelStyle" v-bind="panelDataAttrs">
          <MessageList
            :messages="messages"
            :artifacts-by-run="artifactsByRun ?? {}"
            :streaming-status="streamingStatus"
            @download-artifact="emit('download-artifact', $event)"
            @continue-artifact="emit('continue-artifact', $event)"
            @approve="handleApprove"
            @reject="handleReject"
          />
          <ComposerBar
            :busy="busy"
            :is-running="isRunning"
            :model-value="draft"
            :model-name="modelName"
            :models="models ?? []"
            :runtime-ready="runtimeReady ?? false"
            :thinking-level="thinkingLevel ?? 'off'"
            :thinking-levels="thinkingLevels ?? ['off']"
            :mode="mode"
            :permission="permission"
            @update:model-value="emit('update:draft', $event)"
            @update:mode="emit('update:mode', $event)"
            @update:permission="emit('update:permission', $event)"
            @select-model="emit('select-model', $event)"
            @update:thinking-level="emit('update:thinkingLevel', $event)"
            @submit="emit('send')"
          />
        </div>
      </template>
    </Transition>
  </section>
</template>
