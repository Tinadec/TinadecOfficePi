<script setup lang="ts">
import { cn } from '@/lib/utils'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

interface Props {
  open?: boolean
  class?: string
  placement?: 'top' | 'bottom'
}

const props = withDefaults(defineProps<Props>(), {
  placement: 'bottom',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const isOpen = ref(props.open)
const triggerRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

function updatePosition() {
  const trigger = triggerRef.value
  const menu = menuRef.value
  if (!trigger || !menu) return

  const rect = trigger.getBoundingClientRect()
  const gap = 6
  const margin = 8
  const naturalHeight = menu.scrollHeight || menu.offsetHeight || 240
  const menuWidth = menu.offsetWidth || 128
  const spaceAbove = rect.top - margin
  const spaceBelow = window.innerHeight - rect.bottom - margin
  // Prefer requested placement; only flip when that side cannot fit ~96px.
  const preferAbove = props.placement === 'top'
  const above = preferAbove
    ? spaceAbove >= 96 || spaceBelow < 96
    : spaceBelow < 96 && spaceAbove > spaceBelow
  const cap = Math.min(above ? spaceAbove : spaceBelow, 240)
  // Position with the real rendered height so short menus hug the trigger.
  const effectiveHeight = Math.min(naturalHeight, cap)

  menuStyle.value = {
    position: 'fixed',
    top: `${above
      ? Math.max(margin, rect.top - gap - effectiveHeight)
      : Math.min(window.innerHeight - margin - effectiveHeight, rect.bottom + gap)}px`,
    left: `${Math.max(margin, Math.min(rect.left, window.innerWidth - menuWidth - margin))}px`,
    width: `${Math.min(menuWidth, window.innerWidth - margin * 2)}px`,
    maxHeight: `${cap}px`,
  }
}

async function setOpen(next: boolean) {
  isOpen.value = next
  emit('update:open', next)
  if (next) {
    await nextTick()
    updatePosition()
    requestAnimationFrame(updatePosition)
  }
}

function handlePointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (!triggerRef.value?.contains(target) && !menuRef.value?.contains(target)) {
    void setOpen(false)
  }
}

function handleViewportChange() {
  if (isOpen.value) updatePosition()
}

watch(() => props.open, (value) => {
  isOpen.value = value
  if (value) void nextTick(updatePosition)
})

onMounted(() => {
  document.addEventListener('pointerdown', handlePointerDown)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handlePointerDown)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})
</script>

<template>
  <div ref="triggerRef" class="relative">
    <div @click="setOpen(!isOpen)">
      <slot name="trigger" />
    </div>
  </div>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="menuRef"
      data-slot="dropdown-content"
      :class="cn(
        'fixed z-[10000] min-w-[8rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[var(--radius-overlay)] border bg-popover p-1 text-popover-foreground shadow-md',
        props.class,
      )"
      :style="menuStyle"
    >
      <slot />
    </div>
  </Teleport>
</template>
