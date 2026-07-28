<script setup lang="ts">
import { Brain, Check, ChevronDown, ChevronRight, CircleX, Loader2, Terminal } from '@lucide/vue'
import { ref, watch } from 'vue'
import type { ThinkingStep, ToolCall } from '@/composables/useAgentActivity'

const props = defineProps<{
  running: boolean
  thinkingSteps: ThinkingStep[]
  toolCalls: ToolCall[]
}>()

// Expanded while the run is live; collapse automatically when it finishes.
const expanded = ref(props.running)
watch(
  () => props.running,
  (running) => {
    expanded.value = running
  },
)

function thinkingText(steps: ThinkingStep[]): string {
  // Each run has its own model_thinking step; show only the latest so the
  // inline block reflects the current run rather than the whole session.
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    if (steps[i].type === 'model_thinking') return steps[i].description.trim()
  }
  return ''
}

function statusIcon(status: string) {
  if (status === 'completed') return Check
  if (status === 'failed') return CircleX
  return Loader2
}
</script>

<template>
  <section
    v-if="running || toolCalls.length > 0 || thinkingText(thinkingSteps)"
    class="run-activity"
    :class="{ running }"
  >
    <button class="run-activity-head" type="button" @click="expanded = !expanded">
      <component :is="expanded ? ChevronDown : ChevronRight" :size="12" />
      <Loader2 v-if="running" :size="12" class="run-activity-spin" />
      <Brain v-else :size="12" />
      <span class="run-activity-title">{{ running ? '正在思考与执行' : '本轮思考与工具' }}</span>
      <span v-if="toolCalls.length > 0" class="run-activity-count">{{ toolCalls.length }}</span>
    </button>

    <div v-if="expanded" class="run-activity-body">
      <!-- Model reasoning text -->
      <div v-if="thinkingText(thinkingSteps)" class="run-activity-thinking">
        <pre>{{ thinkingText(thinkingSteps) }}</pre>
      </div>

      <!-- Tool executions, compact rows -->
      <ol v-if="toolCalls.length > 0" class="run-activity-tools">
        <li v-for="tool in toolCalls" :key="tool.id" class="run-activity-tool" :class="tool.status">
          <Terminal :size="11" />
          <span class="run-activity-tool-name">{{ tool.toolName || tool.toolId }}</span>
          <span v-if="tool.resultSummary" class="run-activity-tool-summary">{{ tool.resultSummary }}</span>
          <component
            :is="statusIcon(tool.status)"
            :size="11"
            class="run-activity-tool-status"
            :class="{ 'run-activity-spin': tool.status === 'running' || tool.status === 'pending' }"
          />
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.run-activity {
  margin: 4px 0 10px;
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
}

.run-activity.running {
  border-left: 2px solid var(--accent-primary);
}

.run-activity-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.run-activity-head:hover {
  color: var(--text-primary);
}

.run-activity-title {
  flex: 1;
  letter-spacing: 0.04em;
}

.run-activity-count {
  padding: 0 6px;
  font-size: 10px;
  color: var(--accent-primary);
  border: 1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent);
}

.run-activity-body {
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.run-activity-thinking {
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.run-activity-thinking pre {
  margin: 0;
  padding: 8px;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
  border-left: 2px solid color-mix(in srgb, var(--accent-primary) 35%, transparent);
  font-family: inherit;
}

.run-activity-tools {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.run-activity-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
  min-width: 0;
}

.run-activity-tool-name {
  color: var(--text-primary);
  flex-shrink: 0;
  font-family: var(--font-mono, monospace);
}

.run-activity-tool-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

.run-activity-tool-status {
  flex-shrink: 0;
}

.run-activity-tool.completed .run-activity-tool-status {
  color: var(--accent-success);
}

.run-activity-tool.failed .run-activity-tool-status {
  color: var(--accent-danger);
}

.run-activity-spin {
  animation: run-activity-rotate 1s linear infinite;
}

@keyframes run-activity-rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .run-activity-spin {
    animation: none;
  }
}
</style>
