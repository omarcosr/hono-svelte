<script>
  import Counter from "../components/Counter.island.svelte";
  let { title } = $props();
</script>

<h1>{title}</h1>
<Counter start={2} label="a" />
<Counter start={5} label={'"quoted" & <tagged>'} />
