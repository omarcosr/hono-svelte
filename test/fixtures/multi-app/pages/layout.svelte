<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<nav class="app-nav">App</nav>
{@render children()}

<style>
  .app-nav {
    color: navy;
  }
</style>
