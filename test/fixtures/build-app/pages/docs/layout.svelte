<script lang="ts">
  import type { Snippet } from "svelte";
  import { getPage } from "../../../../../src/page.js";
  import "./docs.css";

  let { children }: { children: Snippet } = $props();
  const page = getPage();
</script>

<nav class="docs-nav" data-route={page.route}>Docs</nav>
{@render children()}

<style>
  .docs-nav {
    color: seagreen;
  }
</style>
