<script lang="ts">
  import { getPage } from "hono-svelte/page";
  import Counter from "../../../shared/Counter.svelte";

  const page = getPage();
</script>

<svelte:head>
  <title>Client page</title>
</svelte:head>

<Counter path={page.path} />
