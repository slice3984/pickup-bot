<template>
  <router-link v-if="!link" :to="to" :class="mode"><slot></slot></router-link>
  <a v-else :href="to" :class="mode"><slot></slot></a>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  props: {
    link: {
      type: Boolean,
      required: false,
      default: false,
    },
    to: {
      required: true,
    },
    mode: {
      type: String,
      required: false,
      default: null,
    },
  },
});
</script>

<style lang="scss" scoped>
a {
  color: $red;
  text-decoration: none;
}

.bold {
  font-weight: 600;
}
</style>