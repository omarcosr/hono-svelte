<script lang="ts">
  import { page } from "$app/state";
  import Counter from "../../../../../shared/Counter.svelte";
</script>

<svelte:head>
  <title>Client page</title>
</svelte:head>

<Counter path={page.url.pathname} />
