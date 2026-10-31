<script lang="ts">
  let count = $state(0);
</script>

<button class="theme-marker" onclick={() => (count += 1)}>Clicked {count}</button>

<style>
  button {
    color: tomato;
  }
</style>
