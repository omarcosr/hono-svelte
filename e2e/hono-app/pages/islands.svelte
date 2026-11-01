<script lang="ts">
  import Counter from "../../shared/Counter.island.svelte";
</script>

<svelte:head>
  <title>Islands page</title>
</svelte:head>

<p data-testid="page">Static around the islands</p>
<Counter start={2} label="first" />
<Counter start={10} label="second" onchange={() => {}} />
