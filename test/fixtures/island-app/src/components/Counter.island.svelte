<script>
  let { start = 0, label } = $props();
  // svelte-ignore state_referenced_locally
  let count = $state(start);
</script>

<button class="island-count" onclick={() => count++}>{label}: {count}</button>

<style>
  .island-count {
    color: rgb(0, 0, 255);
  }
</style>
