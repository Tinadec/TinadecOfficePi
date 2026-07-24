<script setup lang="ts">
import { computed } from 'vue'
import { Activity, Circle } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { SessionDto } from '../api'
import type { AgentMode } from '@/types/mode'

const { t } = useI18n()

const props = defineProps<{
  currentSession: SessionDto | null
  modelName: string
  mode: AgentMode
  busy: boolean
}>()

const modeLabel = computed(() => t(`mode.${props.mode}`))
const modelLabel = computed(() => props.modelName || t('settings.noModel'))
</script>

<template>
  <header class="conversation-head">
    <div class="conversation-head-title">
      <p class="conversation-head-kicker">SESSION / PI RUNTIME</p>
      <h1>{{ currentSession?.title ?? t('chat.title') }}</h1>
    </div>

    <dl class="conversation-head-instruments">
      <div>
        <dt>MODE</dt>
        <dd>{{ modeLabel }}</dd>
      </div>
      <div>
        <dt>MODEL</dt>
        <dd :title="modelLabel">{{ modelLabel }}</dd>
      </div>
      <div class="conversation-head-state" :class="{ active: busy }">
        <dt>RUN</dt>
        <dd>
          <Activity v-if="busy" :size="12" aria-hidden="true" />
          <Circle v-else :size="9" aria-hidden="true" />
          {{ busy ? t('agent.working') : t('chat.ready') }}
        </dd>
      </div>
    </dl>
  </header>
</template>
