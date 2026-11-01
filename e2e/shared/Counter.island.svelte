<script lang="ts">
  let { start, label }: { start: number; label: string } = $props();
  // svelte-ignore state_referenced_locally
  let count = $state(start);
</script>

<button class="island" data-testid={label} onclick={() => count++}>{count}</button>

<style>
  .island {
    color: rgb(0, 0, 255);
  }
</style>
