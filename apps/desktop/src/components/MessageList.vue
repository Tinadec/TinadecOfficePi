<script setup lang="ts">
import { Bot } from '@lucide/vue'
import { UiScrollArea } from '@/components/ui'
import type { PiArtifactDto, MessageDto } from '../api'
import type { ThinkingStep, ToolCall } from '@/composables/useAgentActivity'
import MessageItem from './MessageItem.vue'
import RunActivityBlock from './RunActivityBlock.vue'

const props = defineProps<{
  messages: MessageDto[]
  artifactsByRun?: Record<string, PiArtifactDto[]>
  streamingStatus?: string
  activityRunning?: boolean
  activityThinkingSteps?: ThinkingStep[]
  activityToolCalls?: ToolCall[]
}>()

const emit = defineEmits<{
  'download-artifact': [artifact: PiArtifactDto]
  'continue-artifact': [artifact: PiArtifactDto]
}>()

function isStreamingMessage(message: MessageDto): boolean {
  return message.id.startsWith('stream-')
}

/** The activity block anchors right before the streaming assistant message,
 *  or after the last message once the run has finished. */
function activityAnchorIndex(messages: MessageDto[]): number {
  const streamingIndex = messages.findIndex(isStreamingMessage)
  return streamingIndex >= 0 ? streamingIndex : messages.length - 1
}
</script>

<template>
  <div class="message-stream-container">
    <UiScrollArea class="message-stream">
      <div class="message-stream-inner" aria-live="polite">
        <template v-for="(message, index) in messages" :key="message.id">
          <RunActivityBlock
            v-if="index === activityAnchorIndex(messages)"
            :running="activityRunning ?? false"
            :thinking-steps="activityThinkingSteps ?? []"
            :tool-calls="activityToolCalls ?? []"
          />
          <MessageItem
            :message="message"
            :index="index"
            :streaming-status="isStreamingMessage(message) ? streamingStatus : undefined"
            :artifacts="message.run_id ? artifactsByRun?.[message.run_id] ?? [] : []"
            @download-artifact="emit('download-artifact', $event)"
            @continue-artifact="emit('continue-artifact', $event)"
          />
        </template>
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
