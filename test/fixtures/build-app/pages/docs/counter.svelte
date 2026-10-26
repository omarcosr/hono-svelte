<script lang="ts">
  let { start = 0 }: { start?: number } = $props();
  let count = $state(start);
</script>

<button onclick={() => (count += 1)}>Clicked {count}</button>

<style>
  button {
    color: tomato;
  }
</style>
