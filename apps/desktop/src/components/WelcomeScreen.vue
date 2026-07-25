<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import {
  ArrowUp,
  BrainCircuit,
  ChevronDown,
  Cpu,
  FolderOpen,
  FolderPlus,
  Image,
  MessageCircle,
  Plus,
  SquareTerminal,
  FileText,
  ChevronRight,
  Settings,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { PiModelDto, PiThinkingLevel, ProjectDto } from '../api'
import { UiButton, UiDropdownMenu, UiScrollArea } from '@/components/ui'
import ModeSelector from './ModeSelector.vue'
import PermissionSelector from './PermissionSelector.vue'
import type { AgentMode, PermissionLevel } from '@/types/mode'

const { t } = useI18n()
const router = useRouter()

const props = defineProps<{
  projects: ProjectDto[]
  selectedProjectId: string | null
  modelName: string
  models: PiModelDto[]
  runtimeReady: boolean
  thinkingLevel: PiThinkingLevel
  thinkingLevels: PiThinkingLevel[]
  mode: AgentMode
  permission: PermissionLevel
  busy: boolean
  panelStyle?: Record<string, string>
  panelDataAttrs?: Record<string, string>
}>()

const emit = defineEmits<{
  'send': [content: string]
  'create-project': []
  'select-project': [id: string]
  'add-image': []
  'add-file': []
  'update:mode': [value: AgentMode]
  'update:permission': [value: PermissionLevel]
  'select-model': [model: PiModelDto]
  'update:thinkingLevel': [level: PiThinkingLevel]
}>()

const draft = ref('')
const showPlusMenu = ref(false)
const showProjectDropdown = ref(false)
const showModelMenu = ref(false)
const showThinkingMenu = ref(false)
const isChatMode = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const projectTriggerRef = ref<HTMLElement | null>(null)
const projectDropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})

const selectedProject = computed(() =>
  props.projects.find((p) => p.id === props.selectedProjectId) ?? null
)

const titleText = computed(() =>
  isChatMode.value ? t('chat.chatWithTinadec') : t('chat.startProject')
)
const thinkingLabel = computed(() => t(`thinking.${props.thinkingLevel}`))

function handleSend() {
  const content = draft.value.trim()
  if (!content) return
  draft.value = ''
  resetTextareaHeight()
  emit('send', content)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSend()
  }
}

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

function resetTextareaHeight() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
}

function toggleChatMode() {
  isChatMode.value = !isChatMode.value
}

function updateDropdownPosition() {
  const trigger = projectTriggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const margin = 8
  const width = Math.max(rect.width, 220)
  const menuHeight = Math.min(projectDropdownRef.value?.offsetHeight ?? 260, 360)
  const spaceAbove = rect.top - margin
  const spaceBelow = window.innerHeight - rect.bottom - margin
  // Project picker sits higher: prefer below, flip up only if below is tight.
  const above = spaceBelow < 96 && spaceAbove > spaceBelow
  const maxHeight = Math.max(96, Math.min(menuHeight, above ? spaceAbove : spaceBelow))
  dropdownStyle.value = {
    position: 'fixed',
    top: `${above
      ? Math.max(margin, rect.top - maxHeight - 6)
      : Math.min(window.innerHeight - margin - maxHeight, rect.bottom + 6)}px`,
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`,
    minWidth: `${width}px`,
    maxHeight: `${maxHeight}px`,
    overflowY: 'auto',
  }
}

async function toggleProjectDropdown() {
  showProjectDropdown.value = !showProjectDropdown.value
  if (showProjectDropdown.value) {
    await nextTick()
    updateDropdownPosition()
  }
}

function selectProject(id: string) {
  emit('select-project', id)
  showProjectDropdown.value = false
}

function openNewProject() {
  emit('create-project')
  showProjectDropdown.value = false
}

function handleModeChange(mode: AgentMode) {
  emit('update:mode', mode)
}

function handlePermissionChange(perm: PermissionLevel) {
  emit('update:permission', perm)
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.project-dropdown-trigger') && !target.closest('.project-dropdown-portal')) {
    showProjectDropdown.value = false
  }
  if (!target.closest('.welcome-dialog-plus-wrapper')) {
    showPlusMenu.value = false
  }
}

function handleViewportChange() {
  if (showProjectDropdown.value) updateDropdownPosition()
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})
onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div class="welcome-screen">
    <div class="welcome-content">
      <div class="welcome-title-row">
        <Transition name="title-fade" mode="out-in">
          <h1 :key="titleText" class="welcome-title">{{ titleText }}</h1>
        </Transition>
        <UiButton
          variant="ghost"
          size="icon"
          class="welcome-title-action"
          :title="isChatMode ? t('chat.terminal') : t('chat.chatMode')"
          @click="toggleChatMode"
        >
          <MessageCircle v-if="isChatMode" :size="15" />
          <SquareTerminal v-else :size="15" />
        </UiButton>
      </div>

      <div class="welcome-dialog" :style="panelStyle" v-bind="panelDataAttrs">
        <div class="welcome-dialog-main">
          <div class="welcome-dialog-plus-wrapper">
            <UiDropdownMenu v-model:open="showPlusMenu" class="plus-dropdown-menu">
              <template #trigger>
                <UiButton variant="ghost" size="icon" class="welcome-dialog-plus">
                  <Plus :size="15" />
                </UiButton>
              </template>
              <button class="plus-menu-item" @click="emit('add-image'); showPlusMenu = false">
                <Image :size="12" />
                <span>{{ t('chat.addImage') }}</span>
              </button>
              <button class="plus-menu-item" @click="emit('add-file'); showPlusMenu = false">
                <FileText :size="12" />
                <span>{{ t('chat.addFile') }}</span>
              </button>
            </UiDropdownMenu>
          </div>

          <textarea
            ref="textareaRef"
            v-model="draft"
            class="welcome-dialog-input"
            :placeholder="t('chat.whatToDo')"
            rows="1"
            @keydown="handleKeydown"
            @input="autoResize"
          />

          <UiButton
            variant="ghost"
            size="icon"
            class="welcome-dialog-send"
            :disabled="!draft.trim() || !runtimeReady"
            @click="handleSend"
          >
            <ArrowUp :size="15" />
          </UiButton>
        </div>

        <div class="welcome-dialog-toolbar">
          <div class="toolbar-left">
            <UiDropdownMenu v-model:open="showModelMenu" placement="top" class="composer-model-menu">
              <template #trigger>
                <button class="composer-model-trigger" type="button">
                  <Cpu :size="12" />
                  <span>{{ modelName || t('settings.noModel') }}</span>
                  <ChevronDown :size="11" />
                </button>
              </template>
              <template v-if="models.length > 0">
                <button
                  v-for="model in models"
                  :key="`${model.provider}/${model.id}`"
                  class="plus-menu-item"
                  @click="emit('select-model', model); showModelMenu = false"
                >
                  <Cpu :size="12" />
                  <span>{{ model.name || `${model.provider}/${model.id}` }}</span>
                </button>
              </template>
              <span v-else class="plus-menu-item composer-model-empty">{{ t('settings.noConfiguredModels') }}</span>
            </UiDropdownMenu>
            <UiDropdownMenu v-model:open="showThinkingMenu" placement="top" class="composer-thinking-menu">
              <template #trigger>
                <button class="composer-model-trigger" type="button">
                  <BrainCircuit :size="12" />
                  <span>{{ thinkingLabel }}</span>
                  <ChevronDown :size="11" />
                </button>
              </template>
              <button
                v-for="level in thinkingLevels"
                :key="level"
                class="plus-menu-item"
                :class="{ active: level === thinkingLevel }"
                @click="emit('update:thinkingLevel', level); showThinkingMenu = false"
              >
                <BrainCircuit :size="12" />
                <span>{{ t(`thinking.${level}`) }}</span>
              </button>
            </UiDropdownMenu>
            <ModeSelector
              :model-value="mode"
              @update:model-value="handleModeChange"
            />
            <PermissionSelector
              :model-value="permission"
              @update:model-value="handlePermissionChange"
            />
            <button
              ref="projectTriggerRef"
              class="project-dropdown-trigger"
              @click="toggleProjectDropdown"
            >
              <FolderOpen :size="12" />
              <span class="project-dropdown-label">
                {{ selectedProject ? selectedProject.name : t('chat.selectProject') }}
              </span>
              <ChevronDown :size="11" class="project-dropdown-chevron" />
            </button>
          </div>
          <div class="toolbar-right">
            <button class="toolbar-agent-config" @click="router.push('/settings')">
              <Settings :size="11" />
              <span>{{ t('chat.agentConfig') }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="showProjectDropdown"
        ref="projectDropdownRef"
        class="project-dropdown-portal"
        :style="dropdownStyle"
      >
        <UiScrollArea v-if="projects.length > 0" class="project-dropdown-scroll">
          <div class="project-dropdown-section">
            <div class="project-dropdown-section-title">{{ t('chat.openedProjects') }}</div>
            <button
              v-for="project in projects"
              :key="project.id"
              class="project-dropdown-item"
              :class="{ active: project.id === selectedProjectId }"
              @click="selectProject(project.id)"
            >
              <FolderOpen :size="12" />
              <span>{{ project.name }}</span>
            </button>
          </div>
        </UiScrollArea>
        <div class="project-dropdown-divider" />
        <button class="project-dropdown-item project-dropdown-new" @click="openNewProject">
          <FolderPlus :size="12" />
          <span>{{ t('chat.openNewProject') }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
