<script lang="ts">
  import type { Snippet } from "svelte";
  import { secret } from "../lib/server/secret";

  let { children }: { children: Snippet } = $props();
</script>

<nav data-secret={secret}>Leak</nav>
{@render children()}
