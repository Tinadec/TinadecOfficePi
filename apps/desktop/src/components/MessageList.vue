<script setup lang="ts">
import { Bot } from '@lucide/vue'
import { UiScrollArea } from '@/components/ui'
import type { PiArtifactDto, MessageDto } from '../api'
import MessageItem from './MessageItem.vue'

const props = defineProps<{
  messages: MessageDto[]
  artifactsByRun?: Record<string, PiArtifactDto[]>
  streamingStatus?: string
}>()

const emit = defineEmits<{
  'download-artifact': [artifact: PiArtifactDto]
  'continue-artifact': [artifact: PiArtifactDto]
}>()
</script>

<template>
  <div class="message-stream-container">
    <UiScrollArea class="message-stream">
      <div class="message-stream-inner" aria-live="polite">
        <MessageItem
          v-for="(message, index) in messages"
          :key="message.id"
          :message="message"
          :index="index"
          :streaming-status="message.id.startsWith('stream-') ? streamingStatus : undefined"
          :artifacts="message.run_id ? artifactsByRun?.[message.run_id] ?? [] : []"
          @download-artifact="emit('download-artifact', $event)"
          @continue-artifact="emit('continue-artifact', $event)"
        />
        <div v-if="messages.length === 0" class="empty-state">
          <Bot :size="20" />
          <span>{{ $t('chat.ready') }}</span>
        </div>
      </div>
    </UiScrollArea>
  </div>
</template>

<style scoped>
.message-stream-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.message-stream-container :deep(.message-stream) {
  flex: 1;
  min-height: 0;
}
</style>
