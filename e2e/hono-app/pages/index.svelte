<script lang="ts">
  // A client page: the hover-prefetch script only ships with client entries.
  const label = "Home";
</script>

<h1>{label}</h1>
<nav>
  <a data-testid="to-static" href="/nested/static">Static</a>
  <a data-testid="to-client" href="/nested/client">Client</a>
</nav>
