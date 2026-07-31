<script setup lang="ts">
import type { TraceSummary, TraceDetail, SpanNode } from '../types/trace'
import { getSpanColor } from '../types/trace'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search, ArrowLeft } from '@lucide/vue'

const { t } = useI18n()

const props = defineProps<{
  traces: TraceSummary[]
  currentTrace: TraceDetail | null
  selectedSpan: SpanNode | null
  loading: boolean
}>()

const emit = defineEmits<{
  'select-trace': [traceId: string]
  'select-span': [span: SpanNode]
}>()

const filterName = ref('')
const filterStatus = ref('')

const filteredTraces = computed(() => {
  let result = props.traces
  if (filterName.value) {
    const q = filterName.value.toLowerCase()
    result = result.filter(tr => tr.root_span_name.toLowerCase().includes(q))
  }
  if (filterStatus.value) {
    result = result.filter(tr => tr.error_count > 0 ? 'error' : 'ok' === filterStatus.value.toLowerCase())
  }
  return result
})

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function flattenSpans(nodes: SpanNode[], depth = 0): Array<SpanNode & { depth: number }> {
  const result: Array<SpanNode & { depth: number }> = []
  for (const node of nodes) {
    result.push({ ...node, depth })
    if (node.children?.length) {
      result.push(...flattenSpans(node.children, depth + 1))
    }
  }
  return result
}

const flatSpans = computed(() => {
  if (!props.currentTrace?.root_span) return []
  return flattenSpans(props.currentTrace.root_span)
})
</script>

<template>
  <div class="trace-timeline">
    <!-- Filter bar -->
    <div class="timeline-filter">
      <input v-model="filterName" :placeholder="t('debugStudio.filterName')" class="filter-input" />
      <select v-model="filterStatus" class="filter-select">
        <option value="">{{ t('debugStudio.filterAllStatus') }}</option>
        <option value="ok">{{ t('debugStudio.filterOk') }}</option>
        <option value="error">{{ t('debugStudio.filterError') }}</option>
      </select>
    </div>

    <!-- Trace list (when no trace selected) -->
    <div v-if="!currentTrace" class="trace-list">
      <div v-if="loading" class="timeline-empty">
        <Loader2 :size="24" class="empty-icon spinning" />
        <span>{{ t('debugStudio.loadingTraces') }}</span>
      </div>
      <div v-else-if="filteredTraces.length === 0" class="timeline-empty">
        <Search :size="24" class="empty-icon" />
        <span>{{ t('debugStudio.noTraces') }}</span>
      </div>
      <div
        v-for="trace in filteredTraces"
        :key="trace.trace_id"
        class="trace-item"
        @click="emit('select-trace', trace.trace_id)"
      >
        <div class="trace-item-color" :style="{ background: getSpanColor(trace.root_span_name, trace.error_count > 0 ? 'ERROR' : 'OK') }" />
        <div class="trace-item-info">
          <div class="trace-item-name">{{ trace.root_span_name }}</div>
          <div class="trace-item-meta">
            <span class="meta-duration">{{ formatDuration(trace.root_span_duration_ms) }}</span>
            <span class="meta-divider">·</span>
            <span>{{ t('debugStudio.spans', { count: trace.span_count }) }}</span>
            <span v-if="trace.error_count > 0" class="error-badge">{{ t('debugStudio.errors', { count: trace.error_count }) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Span waterfall (when trace selected) -->
    <div v-else class="span-waterfall">
      <button class="back-btn" @click="emit('select-trace', '')">
        <ArrowLeft :size="14" /> {{ t('debugStudio.backToTraces') }}
      </button>
      <div
        v-for="span in flatSpans"
        :key="span.span_id"
        class="span-row"
        :class="{ selected: selectedSpan?.span_id === span.span_id, error: span.status === 'ERROR' }"
        :style="{ paddingLeft: `${span.depth * 16 + 12}px` }"
        @click="emit('select-span', span)"
      >
        <div class="span-row-bar">
          <div
            class="span-bar"
            :style="{
              width: `${Math.min(span.duration_ms / (currentTrace?.root_span?.[0]?.duration_ms || 1) * 100, 100)}%`,
              background: getSpanColor(span.name, span.status)
            }"
          />
        </div>
        <div class="span-row-info">
          <span class="span-name">{{ span.name }}</span>
          <span class="span-duration">{{ formatDuration(span.duration_ms) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trace-timeline {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ---- Filter Bar ---- */
.timeline-filter {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #30363d;
  background: #0d1117;
}
.filter-input, .filter-select {
  background: #161b22;
  border: 1px solid #30363d;
  color: #e6edf3;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  transition: border-color 0.15s;
}
.filter-input:focus, .filter-select:focus {
  outline: none;
  border-color: #58a6ff;
}
.filter-input { flex: 1; }

/* ---- Trace List ---- */
.trace-list { flex: 1; overflow-y: auto; }
.trace-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #21262d;
  transition: background 0.12s;
}
.trace-item:hover { background: #161b22; }
.trace-item-color {
  width: 4px;
  height: 36px;
  border-radius: var(--radius-compact);
  flex-shrink: 0;
}
.trace-item-name { font-size: 13px; font-weight: 500; line-height: 1.4; }
.trace-item-meta {
  font-size: 11px;
  color: #8b949e;
  display: flex;
  align-items: center;
  gap: 4px;
}
.meta-divider { color: #30363d; }
.error-badge {
  color: #f85149;
  margin-left: 4px;
  background: rgba(248, 81, 73, 0.12);
  padding: 0 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
}
.timeline-empty {
  padding: 32px;
  text-align: center;
  color: #8b949e;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.empty-icon { color: #6e7681; }
.empty-icon.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ---- Span Waterfall ---- */
.span-waterfall { flex: 1; overflow-y: auto; }
.back-btn {
  background: none;
  border: none;
  color: #58a6ff;
  cursor: pointer;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 2px;
  transition: color 0.12s;
}
.back-btn:hover { color: #79c0ff; }

.span-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-bottom: 1px solid #21262d;
  cursor: pointer;
  min-height: 30px;
  transition: background 0.12s;
}
.span-row:hover { background: #161b22; }
.span-row.selected { background: #1c2333; }
.span-row.error .span-name { color: #f85149; }

.span-row-bar {
  flex: 2;
  height: 16px;
  background: #21262d;
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}
.span-bar {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 4px;
  opacity: 0.7;
  transition: opacity 0.15s;
}
.span-row:hover .span-bar { opacity: 0.9; }

.span-row-info {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}
.span-name {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.span-duration {
  font-size: 11px;
  color: #8b949e;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
</style>
