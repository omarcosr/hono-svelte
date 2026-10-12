<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="inner" data-testid="inner">
  {@render children()}
</div>

<style>
  .inner {
    border-left: 4px solid rgb(0, 0, 255);
  }
</style>
