<script lang="ts">
  import type { Snippet } from "svelte";

  let { user = "anon", children }: { user?: string; children: Snippet } = $props();
</script>

<nav class="who">{user}</nav>
{@render children()}
