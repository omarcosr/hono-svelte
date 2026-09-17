<main class="props">
  <h1>Greeting page</h1>
</main>

<script lang="ts">
  let { name = "world" }: { name?: string } = $props();
</script>