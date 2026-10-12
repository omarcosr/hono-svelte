<script lang="ts">
  import type { Snippet } from "svelte";
  import Outer from "../../shared/Outer.svelte";

  let { children }: { children: Snippet } = $props();
</script>

<Outer>{@render children()}</Outer>
