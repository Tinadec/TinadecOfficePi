<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { ChevronDown, Map, FileSearch, HelpCircle, Sparkles, Zap, Network, UsersRound } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { AgentMode } from '@/types/mode'

const { t } = useI18n()

interface ModeOption {
  key: AgentMode
  label: string
  icon: any
}

const modes = computed<ModeOption[]>(() => [
  { key: 'plan', label: t('mode.plan'), icon: Map },
  { key: 'spec', label: t('mode.spec'), icon: FileSearch },
  { key: 'ask', label: t('mode.ask'), icon: HelpCircle },
  { key: 'vibe', label: t('mode.vibe'), icon: Sparkles },
  { key: 'auto', label: t('mode.auto'), icon: Zap },
  { key: 'agent', label: t('mode.agent'), icon: Network },
  { key: 'space', label: t('mode.space'), icon: UsersRound },
])

const props = defineProps<{
  modelValue: AgentMode
}>()

const emit = defineEmits<{
  'update:modelValue': [value: AgentMode]
}>()

const showDropdown = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const dropdownRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref<Record<string, string>>({})

const currentMode = computed(() => modes.value.find(m => m.key === props.modelValue) ?? modes.value[0])

function updateDropdownPosition() {
  const trigger = triggerRef.value
  if (!trigger) return
  const rect = trigger.getBoundingClientRect()
  const margin = 8
  const spaceAbove = rect.top - margin
  const spaceBelow = window.innerHeight - rect.bottom - margin
  const menuHeight = Math.min(dropdownRef.value?.scrollHeight ?? 300, 320)
  // Composer sits low: prefer above, flip down only if above cannot fit.
  const above = spaceAbove >= 96 || spaceBelow < 96
  const maxHeight = Math.max(96, Math.min(menuHeight, above ? spaceAbove : spaceBelow))
  dropdownStyle.value = {
    position: 'fixed',
    top: `${above
      ? Math.max(margin, rect.top - maxHeight - 6)
      : Math.min(window.innerHeight - margin - maxHeight, rect.bottom + 6)}px`,
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - 188))}px`,
    minWidth: '180px',
    maxHeight: `${maxHeight}px`,
    overflowY: 'auto',
  }
}

async function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) {
    await nextTick()
    updateDropdownPosition()
    requestAnimationFrame(updateDropdownPosition)
  }
}

function selectMode(key: AgentMode) {
  emit('update:modelValue', key)
  showDropdown.value = false
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.mode-selector-trigger') && !target.closest('.mode-selector-portal')) {
    showDropdown.value = false
  }
}

function handleViewportChange() {
  if (showDropdown.value) updateDropdownPosition()
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
  <div class="mode-selector">
    <button
      ref="triggerRef"
      class="mode-selector-trigger"
      @click="toggleDropdown"
    >
      <component :is="currentMode.icon" :size="14" />
      <span class="mode-selector-label">{{ currentMode.label }}</span>
      <ChevronDown :size="12" class="mode-selector-chevron" />
    </button>

    <Teleport to="body">
      <div
        v-if="showDropdown"
        ref="dropdownRef"
        class="mode-selector-portal"
        :style="dropdownStyle"
      >
        <button
          v-for="mode in modes"
          :key="mode.key"
          class="mode-selector-item"
          :class="{ active: mode.key === modelValue }"
          @click="selectMode(mode.key)"
        >
          <component :is="mode.icon" :size="14" />
          <span>{{ mode.label }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>
