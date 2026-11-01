<script>
  import Counter from "../../components/Counter.island.svelte";
  let { children } = $props();
</script>

<nav><Counter start={7} label="nav" /></nav>
{@render children()}
