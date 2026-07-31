<script setup lang="ts">
import { cn } from '@/lib/utils'

interface Props {
  class?: string
}

const props = defineProps<Props>()
</script>

<template>
  <div data-slot="chart" :class="cn('rounded-lg border bg-card text-card-foreground shadow', props.class)">
    <slot />
  </div>
</template>
