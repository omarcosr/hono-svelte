<script lang="ts">
  import type { Snippet } from "svelte";
  import font from "../assets/font.woff2?url";

  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <link rel="preload" href={font} as="font" type="font/woff2" crossorigin="anonymous" />
</svelte:head>

{@render children()}
