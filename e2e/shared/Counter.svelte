<script lang="ts">
  let { path }: { path: string } = $props();
  let count = $state(0);
</script>

<p class="page" data-testid="page">Client body at <span data-testid="path">{path}</span></p>
<button data-testid="count" onclick={() => count++}>{count}</button>

<style>
  .page {
    color: rgb(0, 128, 0);
  }
</style>
