<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<nav class="docs-nav">Docs</nav>
{@render children()}

<style>
  .docs-nav {
    color: seagreen;
  }
</style>
