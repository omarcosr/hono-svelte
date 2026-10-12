<script lang="ts">
  import type { Snippet } from "svelte";
  import Inner from "../../../shared/Inner.svelte";

  let { children }: { children: Snippet } = $props();
</script>

<Inner>{@render children()}</Inner>
