<script setup lang="ts">
import { ArrowUp, BrainCircuit, ChevronDown, Cpu, Plus, Image, FileText, Settings } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { UiButton } from '@/components/ui'
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
const thinkingLabel = computed(() => t(`thinking.${props.thinkingLevel}`))

// ---- Shared dropdown portal logic (same as ModeSelector) ----
function usePortal() {
  const show = ref(false)
  const triggerRef = ref<HTMLElement | null>(null)
  const dropdownRef = ref<HTMLElement | null>(null)
  const style = ref<Record<string, string>>({})

  function update() {
    const trigger = triggerRef.value
    const menu = dropdownRef.value
    if (!trigger || !menu) return
    const rect = trigger.getBoundingClientRect()
    const gap = 6
    const margin = 8
    const naturalHeight = menu.scrollHeight || menu.offsetHeight || 240
    const menuWidth = menu.offsetWidth || 180
    const spaceAbove = rect.top - margin
    const spaceBelow = window.innerHeight - rect.bottom - margin
    // Same as ModeSelector: composer sits low, prefer above; flip down only when above cannot fit.
    const above = spaceAbove >= 96 || spaceBelow < 96
    const cap = Math.min(above ? spaceAbove : spaceBelow, 360)
    // Use the real rendered height so short menus hug the trigger without a gap.
    const effectiveHeight = Math.min(naturalHeight, cap)
    style.value = {
      position: 'fixed',
      top: `${above
        ? Math.max(margin, rect.top - gap - effectiveHeight)
        : Math.min(window.innerHeight - margin - effectiveHeight, rect.bottom + gap)}px`,
      left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin))}px`,
      width: `${Math.min(menuWidth, window.innerWidth - margin * 2)}px`,
      maxHeight: `${cap}px`,
    }
  }

  function toggle() {
    show.value = !show.value
    if (show.value) {
      nextTick(() => { update(); requestAnimationFrame(update) })
    }
  }

  function close() { show.value = false }

  function onResize() { if (show.value) update() }

  return { show, triggerRef, dropdownRef, style, toggle, close, onResize }
}

const modelPortal = usePortal()
const thinkingPortal = usePortal()
const plusPortal = usePortal()

function onGlobalClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.composer-model-trigger') && !target.closest('.composer-model-portal')) modelPortal.close()
  if (!target.closest('.composer-thinking-trigger') && !target.closest('.composer-thinking-portal')) thinkingPortal.close()
  if (!target.closest('.composer-plus') && !target.closest('.composer-plus-portal')) plusPortal.close()
}

onMounted(() => {
  document.addEventListener('click', onGlobalClick)
  window.addEventListener('resize', () => { modelPortal.onResize(); thinkingPortal.onResize(); plusPortal.onResize() })
  window.addEventListener('scroll', () => { modelPortal.onResize(); thinkingPortal.onResize(); plusPortal.onResize() }, true)
})
onUnmounted(() => {
  document.removeEventListener('click', onGlobalClick)
})

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
          <UiButton variant="ghost" size="icon" class="composer-plus" @click="plusPortal.toggle()">
            <Plus :size="14" />
          </UiButton>
          <Teleport to="body">
            <div v-if="plusPortal.show.value" :ref="(el: any) => { plusPortal.dropdownRef.value = el }" class="mode-selector-portal composer-plus-portal" :style="plusPortal.style.value">
              <button class="mode-selector-item" @click="emit('add-image'); plusPortal.close()">
                <Image :size="14" />
                <span>{{ t('chat.addImage') }}</span>
              </button>
              <button class="mode-selector-item" @click="emit('add-file'); plusPortal.close()">
                <FileText :size="14" />
                <span>{{ t('chat.addFile') }}</span>
              </button>
            </div>
          </Teleport>
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
          <!-- Model picker (custom portal, same style as ModeSelector) -->
          <div class="composer-trigger-wrapper">
            <button :ref="(el: any) => { modelPortal.triggerRef.value = el }" class="composer-model-trigger" type="button" @click="modelPortal.toggle()">
              <Cpu :size="12" />
              <span>{{ modelName || t('settings.noModel') }}</span>
              <ChevronDown :size="11" />
            </button>
            <Teleport to="body">
              <div v-if="modelPortal.show.value" :ref="(el: any) => { modelPortal.dropdownRef.value = el }" class="mode-selector-portal composer-model-portal" :style="modelPortal.style.value">
                <template v-if="models.length > 0">
                  <button
                    v-for="model in models"
                    :key="`${model.provider}/${model.id}`"
                    class="mode-selector-item"
                    @click="emit('select-model', model); modelPortal.close()"
                  >
                    <Cpu :size="14" />
                    <span>{{ model.name || `${model.provider}/${model.id}` }}</span>
                  </button>
                </template>
                <span v-else class="mode-selector-item" style="color: var(--text-muted)">{{ t('settings.noConfiguredModels') }}</span>
              </div>
            </Teleport>
          </div>

          <!-- Thinking level picker (custom portal, same style as ModeSelector) -->
          <div class="composer-trigger-wrapper">
            <button :ref="(el: any) => { thinkingPortal.triggerRef.value = el }" class="composer-model-trigger composer-thinking-trigger" type="button" @click="thinkingPortal.toggle()">
              <BrainCircuit :size="12" />
              <span>{{ thinkingLabel }}</span>
              <ChevronDown :size="11" />
            </button>
            <Teleport to="body">
              <div v-if="thinkingPortal.show.value" :ref="(el: any) => { thinkingPortal.dropdownRef.value = el }" class="mode-selector-portal composer-thinking-portal" :style="thinkingPortal.style.value">
                <button
                  v-for="level in thinkingLevels"
                  :key="level"
                  class="mode-selector-item"
                  :class="{ active: level === thinkingLevel }"
                  @click="emit('update:thinkingLevel', level); thinkingPortal.close()"
                >
                  <BrainCircuit :size="14" />
                  <span>{{ t(`thinking.${level}`) }}</span>
                </button>
              </div>
            </Teleport>
          </div>

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