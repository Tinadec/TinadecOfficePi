<script setup lang="ts">
import { ArrowUp, BrainCircuit, ChevronDown, Cpu, Plus, Image, FileText, Settings } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { UiButton, UiDropdownMenu } from '@/components/ui'
import ModeSelector from './ModeSelector.vue'
import PermissionSelector from './PermissionSelector.vue'
import type { AgentMode, PermissionLevel } from '@/types/mode'
import type { PiModelDto, PiThinkingLevel } from '@/api'

const { t } = useI18n()
const router = useRouter()

const props = defineProps<{
  busy: boolean
  isRunning?: boolean
  modelValue: string
  modelName: string
  models: PiModelDto[]
  runtimeReady: boolean
  thinkingLevel: PiThinkingLevel
  thinkingLevels: PiThinkingLevel[]
  mode: AgentMode
  permission: PermissionLevel
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:mode': [value: AgentMode]
  'update:permission': [value: PermissionLevel]
  'select-model': [model: PiModelDto]
  'update:thinkingLevel': [level: PiThinkingLevel]
  'submit': []
  'add-image': []
  'add-file': []
}>()

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const showPlusMenu = ref(false)
const showModelMenu = ref(false)
const showThinkingMenu = ref(false)
const thinkingLabel = computed(() => t(`thinking.${props.thinkingLevel}`))

function autoResize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    emit('submit')
  }
}

function goToAgentSettings() {
  router.push('/settings')
}
</script>

<template>
  <div class="composer">
    <div class="composer-box">
      <div class="composer-main">
        <div class="composer-plus-wrapper">
          <UiDropdownMenu v-model:open="showPlusMenu" placement="top" class="plus-dropdown-menu">
            <template #trigger>
              <UiButton variant="ghost" size="icon" class="composer-plus">
                <Plus :size="14" />
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
          :value="modelValue"
          class="composer-input"
          :placeholder="t('chat.placeholder')"
          rows="1"
          @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value); autoResize()"
          @keydown="handleKeydown"
        />

        <UiButton
          variant="ghost"
          size="icon"
          class="composer-send"
          :disabled="!modelValue.trim() || (!isRunning && !runtimeReady)"
          :title="isRunning ? t('chat.steer') : t('chat.send')"
          @click="emit('submit')"
        >
          <ArrowUp :size="14" />
        </UiButton>
      </div>

      <div class="composer-toolbar">
        <div class="composer-toolbar-left">
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
            @update:model-value="emit('update:mode', $event)"
          />
          <PermissionSelector
            :model-value="permission"
            @update:model-value="emit('update:permission', $event)"
          />
        </div>
        <div class="composer-toolbar-right">
          <span v-if="isRunning" class="composer-run-state">{{ t('chat.steer') }}</span>
          <button class="composer-agent-config" @click="goToAgentSettings">
            <Settings :size="11" />
            <span>{{ t('chat.agentConfig') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
