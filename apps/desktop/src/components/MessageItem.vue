<script setup lang="ts">
import { Activity, ArrowRight, Check, Clock, Copy, Download, FileText, Bot } from '@lucide/vue'
import { computed, ref } from 'vue'
import { UiButton } from '@/components/ui'
import MarkdownRender from './MarkdownRender.vue'
import type { MessageDto, PiArtifactDto } from '../api'

const props = defineProps<{
  message: MessageDto
  index: number
  artifacts?: PiArtifactDto[]
  streamingStatus?: string
}>()

const emit = defineEmits<{
  'download-artifact': [artifact: PiArtifactDto]
  'continue-artifact': [artifact: PiArtifactDto]
}>()

const copied = ref(false)
const isStreaming = computed(() => props.message.id.startsWith('stream-'))

function handleCopy() {
  navigator.clipboard.writeText(props.message.content)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

const timeLabel = computed(() => {
  if (!props.message.created_at) return null
  try {
    return new Date(props.message.created_at).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return null
  }
})
</script>

<template>
  <article class="message-wrapper" :class="[message.role, { streaming: isStreaming }]">
    <template v-if="message.role === 'assistant'">
      <div class="assistant-message-row">
        <div class="message-content assistant">
          <div v-if="timeLabel || isStreaming" class="assistant-meta-row">
            <div class="assistant-agent-tag">
              <Bot :size="10" />
              <span>Pi</span>
            </div>
            <span v-if="isStreaming" class="assistant-stream-tag">
              <Activity :size="10" />
              {{ streamingStatus || '正在等待模型输出。' }}
            </span>
            <span v-else-if="timeLabel" class="assistant-time">
              <Clock :size="9" />
              {{ timeLabel }}
            </span>
          </div>

          <div v-if="isStreaming && !message.content" class="assistant-stream-placeholder">
            <span /><span /><span />
          </div>
          <MarkdownRender v-if="message.content" :content="message.content" />

          <div v-if="artifacts && artifacts.length > 0" class="message-artifacts">
            <div v-for="artifact in artifacts" :key="artifact.id" class="message-artifact-row">
              <span class="message-artifact-label">
                <FileText :size="13" />
                {{ artifact.kind === 'plan' ? '规划文件' : '规范文件' }}
              </span>
              <button
                type="button"
                class="message-artifact-action icon-only"
                :title="`下载${artifact.kind === 'plan' ? '规划' : '规范'}文件`"
                @click="emit('download-artifact', artifact)"
              >
                <Download :size="12" />
              </button>
              <button
                type="button"
                class="message-artifact-action"
                @click="emit('continue-artifact', artifact)"
              >
                <span>{{ artifact.kind === 'spec' ? '继续规划' : '开始执行' }}</span>
                <ArrowRight :size="12" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="user-message-row">
        <div class="user-message-actions">
          <UiButton variant="ghost" size="icon" class="message-action-btn" :title="$t('chat.copy')" @click="handleCopy">
            <Check v-if="copied" :size="11" />
            <Copy v-else :size="11" />
          </UiButton>
        </div>

        <div class="message-content user">
          <p>{{ message.content }}</p>
          <div v-if="timeLabel" class="user-message-time">
            <Clock :size="9" />
            {{ timeLabel }}
          </div>
        </div>
      </div>
    </template>
  </article>
</template>
