<script lang="ts">
  import type { Snippet } from "svelte";
  import "./admin.css";

  let { children }: { children: Snippet } = $props();
</script>

<nav class="admin-nav">Admin</nav>
{@render children()}

<style>
  .admin-nav {
    color: seagreen;
  }
</style>
