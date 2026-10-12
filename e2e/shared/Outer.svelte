<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<div class="outer" data-testid="outer">
  {@render children()}
</div>

<style>
  .outer {
    border-left: 4px solid rgb(255, 0, 0);
  }
</style>
