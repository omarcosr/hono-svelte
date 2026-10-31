<script lang="ts">
  import type { Snippet } from "svelte";
  import "./theme.css";

  let { children }: { children: Snippet } = $props();
</script>

<nav class="dev-nav">Dev</nav>
{@render children()}

<style>
  .dev-nav {
    color: seagreen;
  }
</style>
